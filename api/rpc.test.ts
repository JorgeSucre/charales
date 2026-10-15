/**
 * Domain bridge tests (D13): the Angular services running in the API over a real MariaDB, through HTTP with the
 * session cookie. Temporary database `ef_rpctest_<pid>` (schema + migrations + 010 + the MockDb demo seed), dropped
 * at the end. Run: `npm run api:test`.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Pool } from 'mariadb';
import { createApp } from './server.ts';
import { grantsOf } from './demo.ts';
import { applyChanges, cachedTables, columns, domain, loadTables, unitOfWork } from './rpc.ts';
import { TEST_NOW, openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
let db: Pool;
let base: string;
let mail: TestDb['mail'];
let login: TestDb['login'];
let call: TestDb['call'];
let ok: TestDb['ok'];
let count: TestDb['count'];

before(async () => {
  t = await openTestDb('ef_rpctest');
  ({ db, base, mail, login, call, ok, count } = t);
});
after(() => t?.close());

const newPlayer = (firstName: string) => ({
  firstName,
  lastName1: 'Prueba',
  lastName2: null,
  birthDate: '2016-03-04',
  sex: 'M',
  phone: null,
  email: null,
  address: null,
});

test('the column map round-trips every table of the MockDb seed through MariaDB', async () => {
  const conn = await db.getConnection();
  try {
    const tables = await loadTables(conn, await columns(conn));
    const seed = (await domain).seedTables();
    for (const [key, rows] of Object.entries(tables)) {
      if (['roles', 'permissions', 'rolePermissions'].includes(key)) continue;
      const strip = (r: Record<string, unknown>[]) =>
        key === 'users' ? r.map(({ passwordHash: _, ...u }) => u) : r;
      assert.deepEqual(strip(rows), strip(seed[key]!), key);
    }
    // permissions.ts (MockDb) and db/mariadb/010_permisos_app.sql grant exactly the same (AGENTS.md).
    assert.deepEqual(grantsOf(tables), grantsOf(seed));
  } finally {
    conn.release();
  }
});

test('rpc: 401 without session, 404 outside the allowlist, 400 malformed', async () => {
  assert.equal((await call(null, 'PlayerService', 'search', {})).status, 401);
  const admin = await login('admin@example.com');
  for (const [s, m] of [
    ['UserService', 'profileAccount'],
    ['AuthService', 'login'],
    ['PlayerService', 'constructor'],
    ['PlayerService', '__proto__'],
    ['MockDb', 'insert'],
  ])
    assert.equal((await call(admin, s!, m!)).status, 404, `${s}.${m}`);
  const bad = await fetch(`${base}/api/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: admin },
    body: JSON.stringify({ service: 'PlayerService', method: 'search', args: 'x' }),
  });
  assert.equal(bad.status, 400);
  // Arguments the service can't use (missing list): 400, nothing written.
  const missing = await call(admin, 'AttendanceService', 'record', 1);
  assert.equal(missing.status, 400);
  assert.deepEqual(await missing.json(), { error: 'Datos de la solicitud inválidos.' });
});

test('HU-008: a player created through the API is stored in MariaDB with its audit row', async () => {
  const admin = await login('admin@example.com');
  const player = await ok<{ id: number; identifier: string }>(
    call(admin, 'PlayerService', 'create', newPlayer('Persistente')),
  );
  const [row] = await db.query(
    'SELECT identificador, nombre, estatus FROM jugadores WHERE id = ?',
    [player.id],
  );
  assert.deepEqual(
    { ...row },
    { identificador: player.identifier, nombre: 'Persistente', estatus: 'ACTIVO' },
  );
  assert.equal(
    await count(
      `SELECT COUNT(*) AS n FROM auditoria a JOIN usuarios u ON u.id = a.usuario_id
        WHERE a.entidad = 'jugadores' AND a.entidad_id = ? AND u.email = 'admin@example.com'`,
      [player.id],
    ),
    1,
  );
  // …and a new request sees it (nothing lives only in memory).
  const page = await ok<{ items: { player: { id: number } }[] }>(
    call(admin, 'PlayerService', 'search', { query: 'Persistente' }),
  );
  assert.deepEqual(
    page.items.map((i) => i.player.id),
    [player.id],
  );
});

test('a business-rule error answers 400 with the service message and writes nothing', async () => {
  const admin = await login('admin@example.com');
  const before = await count('SELECT COUNT(*) AS n FROM jugadores');
  const res = await call(admin, 'PlayerService', 'create', { ...newPlayer(''), firstName: '' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /nombre/i);
  assert.equal(await count('SELECT COUNT(*) AS n FROM jugadores'), before);
});

test('authorization runs on the server: role, tutor isolation and coach scope', async () => {
  const tutor = await login('tutor@example.com'); // tutor 1: players 1 and 2
  const coach = await login('coach@example.com'); // coach 1: category 1
  const secretaria = await login('secretaria@example.com');
  assert.equal((await call(tutor, 'PlayerService', 'search', {})).status, 403);
  assert.equal(
    (await call(tutor, 'PortalService', 'child', 3)).status,
    403,
    "another family's child",
  );
  await ok(call(tutor, 'PortalService', 'child', 1));
  assert.equal(
    (await call(coach, 'CategoryService', 'members', 2)).status,
    403,
    'foreign category',
  );
  await ok(call(coach, 'CategoryService', 'members', 1));
  assert.equal(
    (await call(secretaria, 'BillingService', 'cancelPayment', 1, 'x')).status,
    403,
    'D12',
  );
  assert.equal(await count("SELECT COUNT(*) AS n FROM pagos WHERE estado = 'CANCELADO'"), 0);
});

test('HU-045/049: payment, balance and cancellation persist; an over-payment rolls back entirely', async () => {
  const admin = await login('admin@example.com');
  const [{ n: paymentsBefore }] = await db.query('SELECT COUNT(*) AS n FROM pagos');
  const over = await call(admin, 'BillingService', 'registerPayment', {
    playerId: 2,
    tutorId: 1,
    amountCents: 10_000_000,
    method: 'EFECTIVO',
  });
  assert.equal(over.status, 400);
  assert.equal(await count('SELECT COUNT(*) AS n FROM pagos'), Number(paymentsBefore));

  const payment = await ok<{ id: number; folio: string }>(
    call(admin, 'BillingService', 'registerPayment', {
      playerId: 2,
      tutorId: 1,
      amountCents: 20_000,
      method: 'EFECTIVO',
      chargeIds: [5],
    }),
  );
  const [charge] = await db.query('SELECT estado FROM cargos WHERE id = 5');
  assert.equal(charge.estado, 'PARCIAL');
  assert.equal(
    await count('SELECT SUM(importe_aplicado) * 100 AS n FROM pago_aplicacion WHERE pago_id = ?', [
      payment.id,
    ]),
    20_000,
  );
  await ok(call(admin, 'BillingService', 'cancelPayment', payment.id, 'Capturado por error'));
  const [cancelled] = await db.query('SELECT estado, motivo_cancelacion FROM pagos WHERE id = ?', [
    payment.id,
  ]);
  assert.deepEqual(
    { ...cancelled },
    { estado: 'CANCELADO', motivo_cancelacion: 'Capturado por error' },
  );
  assert.equal((await db.query('SELECT estado FROM cargos WHERE id = 5'))[0].estado, 'PENDIENTE');
});

test('HU-073: MariaDB rejects what the services let through, and the whole unit of work rolls back', async () => {
  const before = await count('SELECT COUNT(*) AS n FROM jugadores');
  await assert.rejects(
    unitOfWork(db, async (tables) => {
      tables['players']!.push({ ...tables['players']![0]!, id: 9999, identifier: 'J-9999' });
      tables['tutorPlayers']!.push({
        tutorId: 1,
        playerId: 424242, // no such player: fk_tutor_jugador_jugador
        relationship: 'Padre',
        isPrimary: false,
        createdAt: '2026-10-01T10:00:00',
      });
      return { tables };
    }),
    (e: { errno?: number }) => e.errno === 1452,
  );
  assert.equal(
    await count('SELECT COUNT(*) AS n FROM jugadores'),
    before,
    'the valid insert was rolled back',
  );
});

test('responses never carry password or token hashes', async () => {
  const admin = await login('admin@example.com');
  const text = await (await call(admin, 'UserService', 'list', {})).text();
  assert.ok(text.includes('admin@example.com'));
  assert.doesNotMatch(text, /passwordHash|tokenHash|argon2/);
});

test('HU-004: a new staff account gets a 24 h invitation (D3c/D3e), usable once through the API', async () => {
  const admin = await login('admin@example.com');
  const user = await ok<{ id: number }>(
    call(admin, 'UserService', 'save', {
      roleId: 2,
      firstName: 'Nora',
      lastName: 'Nueva',
      email: 'Nora@Example.com',
    }),
  );
  const [token] = await db.query(
    `SELECT finalidad, TIMESTAMPDIFF(HOUR, creado_en, expira_en) AS horas FROM tokens_recuperacion
      WHERE usuario_id = ?`,
    [user.id],
  );
  assert.deepEqual({ ...token }, { finalidad: 'INVITACION', horas: 24 });
  const message = mail.find((m) => m.to === 'nora@example.com')!;
  const link = /token=([\w-]+)/.exec(message.text)![1]!;
  const confirm = (password: string) =>
    fetch(`${base}/auth/password-reset/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: link, newPassword: password }),
    });
  assert.equal((await confirm('Bienvenida123')).status, 204);
  await login('nora@example.com', 'Bienvenida123');
  assert.equal((await confirm('OtraVez1234')).status, 400, 'single use');
});

test('HU-004: without a mail transport the account is not created (503, rolled back)', async () => {
  const noMail = createApp(db, { secureCookie: false }).listen(0);
  await new Promise((resolve) => noMail.once('listening', resolve));
  const url = `http://127.0.0.1:${(noMail.address() as AddressInfo).port}`;
  try {
    const res0 = await fetch(`${url}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'demo1234' }),
    });
    const admin = res0.headers.get('set-cookie')!.split(';')[0]!;
    const res = await fetch(`${url}/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: admin },
      body: JSON.stringify({
        service: 'UserService',
        method: 'save',
        args: [{ roleId: 2, firstName: 'Sin', lastName: 'Correo', email: 'sincorreo@example.com' }],
      }),
    });
    assert.equal(res.status, 503);
    assert.equal(
      await count("SELECT COUNT(*) AS n FROM usuarios WHERE email = 'sincorreo@example.com'"),
      0,
    );
  } finally {
    noMail.close();
  }
});

test('HU-004.3: deactivating an account through the API closes its open sessions', async () => {
  const admin = await login('admin@example.com');
  const victim = await login('marta@example.com');
  await ok(call(victim, 'PortalService', 'overview'));
  await ok(call(admin, 'UserService', 'setActive', 6, false));
  assert.equal((await call(victim, 'PortalService', 'overview')).status, 401);
  await ok(call(admin, 'UserService', 'setActive', 6, true));
});

test('HU-006: a permission removed through the API applies to the next request of open sessions', async () => {
  const admin = await login('admin@example.com');
  const secretaria = await login('secretaria@example.com');
  await ok(call(secretaria, 'PlayerService', 'search', {}));
  const [perm] = await db.query(
    "SELECT id FROM permisos WHERE modulo = 'jugadores' AND accion = 'consultar'",
  );
  await ok(call(admin, 'RoleService', 'setPermission', 2, perm.id, false));
  assert.equal((await call(secretaria, 'PlayerService', 'search', {})).status, 403);
  await ok(call(admin, 'RoleService', 'setPermission', 2, perm.id, true));
  await ok(call(secretaria, 'PlayerService', 'search', {}));
});

test('concurrency: parallel writes and logins never collide (ids, audit rows)', async () => {
  const admin = await login('admin@example.com');
  const auditBefore = await count('SELECT COUNT(*) AS n FROM auditoria');
  const results = await Promise.all([
    ...Array.from({ length: 8 }, (_, i) =>
      call(admin, 'PlayerService', 'create', newPlayer(`Paralelo${i}`)),
    ),
    ...Array.from({ length: 4 }, () =>
      fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'secretaria@example.com', password: 'demo1234' }),
      }),
    ),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    Array(12).fill(200),
  );
  assert.equal(
    await count(
      "SELECT COUNT(DISTINCT identificador) AS n FROM jugadores WHERE nombre LIKE 'Paralelo%'",
    ),
    8,
  );
  assert.equal(await count('SELECT COUNT(*) AS n FROM auditoria'), auditBefore + 8 + 4);
});

test('applyChanges writes only what changed (an unchanged load is a no-op)', async () => {
  const conn = await db.getConnection();
  try {
    const meta = await columns(conn);
    const tables = await loadTables(conn, meta);
    await conn.beginTransaction();
    const writes: string[] = [];
    const spy = new Proxy(conn, {
      get: (target, prop) =>
        prop === 'query'
          ? (sql: string, params?: unknown[]) => (writes.push(sql), target.query(sql, params))
          : Reflect.get(target, prop),
    });
    await applyChanges(spy, meta, tables, structuredClone(tables));
    assert.deepEqual(writes, []);
    await conn.rollback();
  } finally {
    conn.release();
  }
});

// ---------------------------------------------------------------- audit 2026-10-15: regressions

test('audit: names of Object.prototype are not operations (404, never a 500)', async () => {
  const admin = await login('admin@example.com');
  for (const [s, m] of [
    ['constructor', 'x'],
    ['__proto__', 'x'],
    ['toString', 'call'],
    ['hasOwnProperty', 'x'],
    ['PlayerService', 'toString'],
  ])
    assert.equal((await call(admin, s!, m!)).status, 404, `${s}.${m}`);
});

test('audit: a client cannot set fields outside the draft (mass assignment) when editing', async () => {
  const admin = await login('admin@example.com');
  const extra = { active: false, createdAt: '2000-01-01T00:00:00' };
  await ok(
    call(admin, 'CategoryService', 'save', {
      id: 3,
      seasonId: 2,
      name: 'Sub-8',
      minAge: 6,
      maxAge: 8,
      maxCapacity: null,
      ...extra,
    }),
  );
  await ok(
    call(admin, 'ScheduleService', 'save', {
      id: 5,
      categoryId: 1,
      venueId: 2,
      weekday: 6,
      startTime: '09:00',
      endTime: '10:30',
      ...extra,
    }),
  );
  await ok(
    call(admin, 'SeasonService', 'save', {
      id: 1,
      name: 'Temporada 2025-2026',
      startDate: '2025-08-01',
      endDate: '2026-06-30',
      active: true,
      isCurrent: false,
      createdAt: '2000-01-01T00:00:00',
    }),
  );
  const rows = await db.query(
    `SELECT 'c' AS t, activo, creado_en FROM categorias WHERE id = 3
     UNION ALL SELECT 'h', activo, creado_en FROM horarios_entrenamiento WHERE id = 5
     UNION ALL SELECT 's', activa, creado_en FROM temporadas WHERE id = 1`,
  );
  for (const r of rows) {
    assert.equal(r.activo, 1, `${r.t}: active only changes through setActive (audited)`);
    assert.notEqual(r.creado_en, '2000-01-01 00:00:00', `${r.t}: creado_en is the server's`);
  }
});

test('audit: CSRF and CORS — a non-JSON body never runs an operation; no CORS headers are sent', async () => {
  const admin = await login('admin@example.com');
  const before = await count('SELECT COUNT(*) AS n FROM jugadores');
  const form = await fetch(`${base}/api/rpc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: admin,
      Origin: 'https://evil.example',
    },
    body: 'service=PlayerService&method=create&args=%5B%5D',
  });
  assert.equal(form.status, 400);
  assert.equal(form.headers.get('access-control-allow-origin'), null);
  assert.equal(await count('SELECT COUNT(*) AS n FROM jugadores'), before);
});

test('audit: session cookie attributes — HttpOnly, SameSite=Strict, Path=/, 8 h; Secure when configured', async () => {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'demo1234' }),
  });
  const cookie = res.headers.get('set-cookie')!;
  assert.match(
    cookie,
    /^charales_sid=[\w-]{40,}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800$/,
  );
  const secure = createApp(db, { secureCookie: true }).listen(0);
  await new Promise((resolve) => secure.once('listening', resolve));
  try {
    const r = await fetch(`http://127.0.0.1:${(secure.address() as AddressInfo).port}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'demo1234' }),
    });
    assert.match(r.headers.get('set-cookie')!, /; Secure$/);
  } finally {
    secure.close();
  }
});

test('audit: a payment cancelled twice is reverted only once', async () => {
  const admin = await login('admin@example.com');
  const p = await ok<{ id: number }>(
    call(admin, 'BillingService', 'registerPayment', {
      playerId: 3,
      tutorId: 2,
      amountCents: 1000,
      method: 'EFECTIVO',
    }),
  );
  await ok(call(admin, 'BillingService', 'cancelPayment', p.id, 'Primera'));
  const res = await call(admin, 'BillingService', 'cancelPayment', p.id, 'Segunda');
  assert.equal(res.status, 400);
  const [row] = await db.query('SELECT estado, motivo_cancelacion FROM pagos WHERE id = ?', [p.id]);
  assert.deepEqual({ ...row }, { estado: 'CANCELADO', motivo_cancelacion: 'Primera' });
});

test('audit: two simultaneous payments for the whole balance — exactly one succeeds, no double charge', async () => {
  const admin = await login('admin@example.com');
  const charge = await ok<{ id: number }>(
    call(admin, 'BillingService', 'createCharge', {
      playerId: 5,
      conceptId: 2,
      amountCents: 40_000,
      dueDate: '2026-12-31',
      reference: null,
    }),
  );
  const pay = () =>
    call(admin, 'BillingService', 'registerPayment', {
      playerId: 5,
      tutorId: 3,
      amountCents: 40_000,
      method: 'EFECTIVO',
      chargeIds: [charge.id],
    });
  const statuses = (await Promise.all([pay(), pay()])).map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 400]);
  assert.equal(
    Number(
      (
        await db.query(
          'SELECT SUM(importe_aplicado) AS s FROM pago_aplicacion WHERE cargo_id = ?',
          [charge.id],
        )
      )[0].s,
    ),
    400,
  );
});

test('audit: after writes, the in-memory tables of the bridge equal what MariaDB stores', async () => {
  const admin = await login('admin@example.com');
  await ok(call(admin, 'PlayerService', 'search', {}));
  await ok(
    call(admin, 'MatchService', 'reschedule', 3, {
      date: '2026-10-19',
      time: '12:00',
      venueId: 2,
      reason: 'Auditoría',
    }),
  );
  await ok(call(admin, 'TrainingService', 'saveNotes', 3, { objective: 'Auditoría', notes: null }));
  const conn = await db.getConnection();
  try {
    const fresh = await loadTables(conn, await columns(conn));
    for (const [key, rows] of Object.entries(cachedTables(db)!))
      assert.deepEqual(
        rows.map((r) => ({ ...r })),
        fresh[key],
        key,
      );
  } finally {
    conn.release();
  }
});

test('audit: the API tests run on a fixed clock — Node and MariaDB agree, whatever the real date', async () => {
  assert.equal(Date.now(), TEST_NOW.getTime());
  const [row] = await db.query('SELECT NOW() AS now, CURDATE() AS today');
  assert.deepEqual({ ...row }, { now: '2026-10-13 12:00:00', today: '2026-10-13' });
});

/**
 * Phase 6 HU (docs/TRACEABILITY.md): reports and dashboard (HU-065..068), the critical flows of HU-074 end to end on
 * MariaDB, the performance target of HU-075 with large volumes, and the consistency of the in-memory tables of the
 * domain bridge (D13 + migration 003).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { createApp } from './server.ts';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
let admin: string;
let secretaria: string;
before(async () => {
  t = await openTestDb('ef_hu6');
  [admin, secretaria] = await Promise.all(
    ['admin', 'secretaria'].map((u) => t.login(`${u}@example.com`)),
  );
});
after(() => t?.close());

type Kpi = { label: string; value: number; source: string; link: string };

test('HU-065: dashboard — KPIs with source and link, straight from the database, period filter', async () => {
  const d1 = await t.ok<{ kpis: Kpi[]; upcoming: unknown[]; categories: unknown[] }>(
    t.call(secretaria, 'ReportService', 'dashboard', '2026-10-01', '2026-10-31'),
  );
  assert.ok(
    d1.kpis.length >= 4 && d1.kpis.every((k) => k.source && k.link),
    '1/4) KPIs with source and link',
  );
  const active = (d: { kpis: Kpi[] }) => d.kpis.find((k) => /activos/i.test(k.label))!.value;
  // 2) a player written straight into MariaDB (as another API instance would, bumping the version) shows up.
  await t.db.query(
    `INSERT INTO jugadores (identificador, nombre, apellido_paterno, fecha_nacimiento, estatus)
     VALUES ('J-9001', 'Directo', 'BD', '2016-01-01', 'ACTIVO')`,
  );
  await t.db.query('UPDATE version_datos SET version = version + 1 WHERE id = 1');
  const d2 = await t.ok<{ kpis: Kpi[] }>(
    t.call(secretaria, 'ReportService', 'dashboard', '2026-10-01', '2026-10-31'),
  );
  assert.equal(active(d2), active(d1) + 1, '2) data from the database');
  const sept = await t.ok<{ kpis: Kpi[] }>(
    t.call(secretaria, 'ReportService', 'dashboard', '2026-09-01', '2026-09-30'),
  );
  assert.ok(sept.kpis.length === d2.kpis.length, '3) period filter');
  const tutorCookie = await t.login('tutor@example.com'); // before: a login writes its audit row
  await t.refused(
    () => t.call(tutorCookie, 'ReportService', 'dashboard'),
    403,
    /^No tienes permiso para esta operación\.$/,
  );
});

test('HU-066: players by category — category/status filters, primary tutor and contact, totals', async () => {
  const rows = await t.ok<
    { categoryId: number | null; players: { tutor: string | null; contact: string | null }[] }[]
  >(t.call(secretaria, 'ReportService', 'playersByCategory', { categoryId: 2 }));
  assert.deepEqual(
    rows.map((r) => r.categoryId),
    [2],
  );
  assert.equal(rows[0]!.players.length, 2, '3) total');
  assert.ok(
    rows[0]!.players.every((p) => p.tutor && p.contact),
    '2) primary tutor and contact',
  );
  const bajas = await t.ok<{ players: { status: string }[] }[]>(
    t.call(secretaria, 'ReportService', 'playersByCategory', { status: 'BAJA_TEMPORAL' }),
  );
  assert.ok(
    bajas.flatMap((r) => r.players).every((p) => p.status === 'BAJA_TEMPORAL'),
    '1) status filter',
  );
});

test('HU-067: income — date filter, grouped by concept, cancelled payments excluded, total', async () => {
  const before = await t.ok<{ conceptName: string; totalCents: number }[]>(
    t.call(admin, 'ReportService', 'income', '2026-08-01', '2026-10-31'),
  );
  const total = (rows: { totalCents: number }[]) => rows.reduce((s, r) => s + r.totalCents, 0);
  assert.equal(total(before), 60_000 + 50_000 + 30_000, '4) total of the seeded payments');
  await t.ok(t.call(admin, 'BillingService', 'cancelPayment', 3, 'Duplicado'));
  const after = await t.ok<{ totalCents: number }[]>(
    t.call(admin, 'ReportService', 'income', '2026-08-01', '2026-10-31'),
  );
  assert.equal(total(after), total(before) - 30_000, '3) cancelled excluded');
  assert.deepEqual(
    await t.ok(t.call(admin, 'ReportService', 'income', '2030-01-01', '2030-01-31')),
    [],
    '1) date filter',
  );
});

test('HU-068: global agenda — trainings and matches together, category/coach, venue and time', async () => {
  const items = await t.ok<
    { kind: string; categoryId: number; coachIds: number[]; venueName: string; start: string }[]
  >(t.call(secretaria, 'ReportService', 'agenda', '2026-10-01', '2026-10-31'));
  assert.ok(
    items.some((i) => i.kind === 'training') && items.some((i) => i.kind === 'match'),
    '2) both kinds',
  );
  assert.ok(
    items.every((i) => i.venueName && i.start),
    '4) venue and time',
  );
  assert.ok(
    items.some((i) => i.coachIds.length),
    '3) coach to filter by',
  );
});

test('HU-074: the critical flows on MariaDB — login, registration + enrollment, payment and balance, match, tutor isolation', async () => {
  // 1) login: valid by role, invalid without details
  const bad = await fetch(`${t.base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'secretaria@example.com', password: 'incorrecta1' }),
  });
  assert.deepEqual(
    [bad.status, (await bad.json()).error],
    [401, 'Correo o contraseña incorrectos.'],
  );
  // 2) registration + annual enrollment + category membership
  const p = await t.ok<{ id: number }>(
    t.call(secretaria, 'PlayerService', 'create', {
      firstName: 'Flujo',
      lastName1: 'Crítico',
      lastName2: null,
      birthDate: '2016-06-06',
      sex: 'F',
      phone: null,
      email: null,
      address: null,
    }),
  );
  await t.ok(
    t.call(secretaria, 'EnrollmentService', 'enroll', {
      playerId: p.id,
      seasonId: 2,
      enrolledOn: '2026-10-13',
      amountCents: 120_000,
      status: 'ACTIVA',
      conceptId: 2,
      dueDate: '2026-11-30',
    }),
  );
  await t.ok(
    t.call(secretaria, 'PlayerCategoryService', 'assign', {
      playerId: p.id,
      categoryId: 1,
      date: '2026-10-13',
      exceptionReason: null,
    }),
  );
  // 3) payment and balance
  const [charge] = await t.db.query(
    'SELECT id FROM cargos WHERE jugador_id = ? AND concepto_id = 2',
    [p.id],
  );
  await t.ok(
    t.call(secretaria, 'BillingService', 'registerPayment', {
      playerId: p.id,
      tutorId: null,
      amountCents: 120_000,
      method: 'EFECTIVO',
      chargeIds: [charge.id],
    }),
  );
  const st = await t.ok<{ totals: { balanceCents: number } }>(
    t.call(secretaria, 'BillingService', 'statement', p.id),
  );
  assert.equal(st.totals.balanceCents, 0);
  assert.equal(
    (await t.db.query('SELECT estado FROM cargos WHERE id = ?', [charge.id]))[0].estado,
    'PAGADO',
  );
  // 4) match scheduling with result
  const m = await t.ok<{ id: number }>(
    t.call(secretaria, 'MatchService', 'schedule', {
      competitionCategoryId: 1,
      opponentId: 1,
      venueId: 1,
      date: '2026-10-12',
      time: '10:00',
      homeAway: 'LOCAL',
      notes: null,
    }),
  );
  await t.ok(
    t.call(secretaria, 'MatchService', 'recordResult', m.id, {
      goalsFor: 1,
      goalsAgainst: 1,
      notes: null,
    }),
  );
  // 5) tutor restricted to own children
  const tutor = await t.login('tutor@example.com');
  await t.refused(
    () => t.call(tutor, 'PortalService', 'child', p.id),
    403,
    /^No tienes acceso a la información de este jugador\.$/,
  );
  await t.refused(
    () => t.call(tutor, 'PlayerService', 'search', {}),
    403,
    /^No tienes permiso para esta operación\.$/,
  );
});

test('D13 cache: what the API keeps in memory always equals MariaDB, also across two API instances', async () => {
  const other = createApp(t.db, { secureCookie: false, mailer: () => undefined }).listen(0);
  await new Promise((resolve) => other.once('listening', resolve));
  const url2 = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
  try {
    const login2 = await fetch(`${url2}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'secretaria@example.com', password: 'demo1234' }),
    });
    const cookie2 = login2.headers.get('set-cookie')!.split(';')[0]!;
    const via2 = (service: string, method: string, ...args: unknown[]) =>
      fetch(`${url2}/api/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie2 },
        body: JSON.stringify({ service, method, args }),
      });
    // Both instances share the same pool here; a second API process would have its own memory — the version row is
    // what keeps them in sync, and an instance that wrote can't hand out stale tables either.
    await t.ok(t.call(secretaria, 'VenueService', 'list'));
    await t.ok(
      via2('VenueService', 'save', {
        name: 'Desde la instancia 2',
        location: null,
        reference: null,
      }),
    );
    const names = (await t.ok<{ name: string }[]>(t.call(secretaria, 'VenueService', 'list'))).map(
      (v) => v.name,
    );
    assert.ok(names.includes('Desde la instancia 2'));
    // The daily job bumps the version too.
    await t.db.query(
      `INSERT INTO cargos (jugador_id, concepto_id, temporada_id, periodo, fecha_cargo, fecha_vencimiento, monto_original, estado)
       VALUES (1, 1, 2, '2025-12', '2025-12-01', '2025-12-10', 650.00, 'PENDIENTE')`,
    );
    await t.db.query('UPDATE version_datos SET version = version + 1 WHERE id = 1');
    await t.db.query('CALL marcar_cargos_vencidos()');
    const charges = await t.ok<{ items: { period: string | null; status: string }[] }>(
      t.call(secretaria, 'BillingService', 'charges', { period: '2025-12' }),
    );
    assert.equal(charges.items[0]?.status, 'VENCIDO');
  } finally {
    other.close();
  }
});

test('HU-075: common queries answer in < 300 ms through the API with 5 000 players, 20 000 charges and 10 000 payments', async () => {
  const conn = await t.db.getConnection();
  try {
    for (const stmt of readFileSync(new URL('./perf-data.sql', import.meta.url), 'utf8')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean))
      await conn.query(stmt);
  } finally {
    conn.release();
  }
  await t.db.query('UPDATE version_datos SET version = version + 1 WHERE id = 1');
  assert.ok((await t.count('SELECT COUNT(*) AS n FROM cargos')) >= 20_000);
  await t.ok(t.call(admin, 'PlayerService', 'search', {})); // first request fills the in-memory tables
  const timings: Record<string, number> = {};
  for (const [label, service, method, args] of [
    ['búsqueda', 'PlayerService', 'search', [{ query: 'Nombre12' }]],
    ['integrantes', 'CategoryService', 'members', [1]],
    ['adeudos', 'BillingService', 'debts', [{}]],
    ['cargos', 'BillingService', 'charges', [{}]],
    ['estado de cuenta', 'BillingService', 'statement', [10]],
    ['tablero', 'ReportService', 'dashboard', []],
    ['auditoría', 'AuditService', 'list', [{}]],
  ] as [string, string, string, unknown[]][]) {
    const runs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      await t.ok(t.call(admin, service, method, ...args));
      runs.push(performance.now() - t0);
    }
    timings[label] = Math.round(runs.sort((a, b) => a - b)[1]!);
  }
  console.log('HU-075 medianas (ms):', JSON.stringify(timings));
  for (const [label, ms] of Object.entries(timings)) assert.ok(ms < 300, `${label}: ${ms} ms`);
});

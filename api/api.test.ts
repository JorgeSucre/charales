/**
 * API integration tests (node:test) on a temporary database `ef_apitest_<pid>`: schema + 010 + 020 dev seed,
 * dropped at the end. Never touches escuela_futbol. Run: `npm run api:test` (needs a local MariaDB; the `mariadb` CLI
 * and the API both use the DB_* variables / client defaults, like db/mariadb/scripts).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Pool } from 'mariadb';
import { createApp, createPool } from './server.ts';

const DB = `ef_apitest_${process.pid}`;
const root = new URL('../', import.meta.url);
const sql = (file: string) => readFileSync(new URL(file, root), 'utf8');
const mariadbCli = (input: string, db = '') =>
  execSync(`mariadb ${db}`, { input, stdio: ['pipe', 'ignore', 'inherit'] });

let db: Pool;
let server: Server;
let base: string;
/** E-mails captured by the test transport (HU-005); the real console transport is never used in tests. */
const mail: { to: string; subject: string; text: string }[] = [];

before(async () => {
  mariadbCli(sql('docs/escuela_futbol_mariadb.sql').replaceAll('escuela_futbol', DB));
  mariadbCli(sql('db/mariadb/010_permisos_app.sql'), DB);
  mariadbCli(sql('db/mariadb/020_dev_seed.sql'), DB);
  db = createPool({ ...process.env, DB_NAME: DB });
  server = createApp(db, {
    secureCookie: false,
    mailer: (to, subject, text) => void mail.push({ to, subject, text }),
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  await db?.end();
  mariadbCli(`DROP DATABASE IF EXISTS \`${DB}\``);
});

function login(email: string, password = 'demo1234') {
  return fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}
const cookieOf = (res: Response) => res.headers.get('set-cookie')?.split(';')[0] ?? '';
const getSession = (cookie?: string) =>
  fetch(`${base}/auth/session`, { headers: cookie ? { Cookie: cookie } : {} });
const logout = (cookie?: string) =>
  fetch(`${base}/auth/logout`, { method: 'POST', headers: cookie ? { Cookie: cookie } : {} });

test('GET /health reports the database', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok', database: 'ok' });
});

test('unknown route → 404', async () => {
  assert.equal((await fetch(`${base}/nope`)).status, 404);
});

test('login without e-mail or password → 400', async () => {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"email":"admin@example.com"}',
  });
  assert.equal(res.status, 400);
});

test('wrong password, unknown e-mail and disabled account → same 401, no cookie', async () => {
  for (const res of [
    await login('admin@example.com', 'mala1234'),
    await login('nadie@example.com'),
    await login('baja@example.com'),
  ]) {
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'Correo o contraseña incorrectos.' });
    assert.equal(res.headers.get('set-cookie'), null);
  }
  const [{ n }] = await db.query(
    "SELECT COUNT(*) AS n FROM auditoria WHERE descripcion = 'Intento de acceso fallido'",
  );
  assert.equal(n, 3);
});

test('valid login → AuthUser + HttpOnly cookie; only the token hash is stored', async () => {
  const res = await login('ADMIN@example.com');
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie') ?? '';
  assert.match(
    setCookie,
    /^charales_sid=[\w-]{43}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800$/,
  );
  const user = await res.json();
  assert.equal(user.email, 'admin@example.com');
  assert.deepEqual(user.roles, ['ADMINISTRADOR']);
  assert.equal(user.isStaff, true);
  assert.equal(user.officePermissions.length, 56);
  assert.match(user.expiresAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
  assert.ok(!JSON.stringify(user).includes('password'));
  const token = cookieOf(res).split('=')[1]!;
  const [row] = await db.query('SELECT token_hash FROM sesiones WHERE id = ?', [user.sessionId]);
  assert.notEqual(row.token_hash, token);
  assert.equal(row.token_hash.length, 64);
});

test('profile account: roles from tutores/entrenadores, no office permissions (D12)', async () => {
  const user = await (await login('marta@example.com')).json();
  assert.deepEqual(user.roles, ['TUTOR', 'ENTRENADOR']);
  assert.deepEqual(user.officePermissions, []);
  assert.equal(user.isStaff, false);
  assert.equal(user.displayName, 'Marta Díaz');
});

test('GET /auth/session: 401 anonymous or bogus cookie, 200 with the login cookie', async () => {
  assert.equal((await getSession()).status, 401);
  assert.equal((await getSession('charales_sid=inventado')).status, 401);
  const res = await login('secretaria@example.com');
  const cookie = cookieOf(res);
  const loggedIn = await res.json();
  const session = await getSession(cookie);
  assert.equal(session.status, 200);
  const current = await session.json();
  assert.equal(current.sessionId, loggedIn.sessionId);
  assert.deepEqual(current.roles, ['SECRETARIA']);
});

test('logout closes the session and clears the cookie; anonymous logout is a no-op 204', async () => {
  const cookie = cookieOf(await login('coach@example.com'));
  const res = await logout(cookie);
  assert.equal(res.status, 204);
  assert.match(res.headers.get('set-cookie') ?? '', /^charales_sid=; .*Max-Age=0/);
  assert.equal((await getSession(cookie)).status, 401);
  assert.equal((await logout()).status, 204);
  const [{ n }] = await db.query(
    "SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'LOGOUT' AND descripcion = 'Cierre de sesión'",
  );
  assert.equal(n, 1);
});

test('idle session (30 min) and deactivated account → 401 and the session is closed', async () => {
  let res = await login('tutor@example.com');
  let cookie = cookieOf(res);
  const { sessionId } = await res.json();
  await db.query(
    'UPDATE sesiones SET ultimo_uso_en = ultimo_uso_en - INTERVAL 31 MINUTE WHERE id = ?',
    [sessionId],
  );
  assert.equal((await getSession(cookie)).status, 401);
  const [row] = await db.query('SELECT cerrada_en FROM sesiones WHERE id = ?', [sessionId]);
  assert.notEqual(row.cerrada_en, null);

  res = await login('tutor@example.com');
  cookie = cookieOf(res);
  await db.query("UPDATE usuarios SET activo = FALSE WHERE email = 'tutor@example.com'");
  assert.equal((await getSession(cookie)).status, 401);
  await db.query("UPDATE usuarios SET activo = TRUE WHERE email = 'tutor@example.com'");
});

test('5 wrong passwords lock that e-mail for this client → 429, even with the right password', async () => {
  for (let i = 0; i < 5; i++)
    assert.equal((await login('secretaria@example.com', `mala${i}`)).status, 401);
  assert.equal((await login('secretaria@example.com')).status, 429);
  assert.equal((await login('admin@example.com')).status, 200);
});

const getAs = (path: string, cookie?: string) =>
  fetch(`${base}${path}`, { headers: cookie ? { Cookie: cookie } : {} });

test('GET /api/jugadores: 401 anonymous, 403 profile-only account, 200 with jugadores.consultar (admin; secretaria is locked by the 429 test)', async () => {
  assert.equal((await getAs('/api/jugadores')).status, 401);
  assert.equal(
    (await getAs('/api/jugadores', cookieOf(await login('coach@example.com')))).status,
    403,
  );
  const res = await getAs('/api/jugadores', cookieOf(await login('admin@example.com')));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
  const rows = await res.json();
  assert.deepEqual(rows, await db.query('SELECT * FROM jugadores ORDER BY id'));
  assert.deepEqual(
    rows.map((r: { identificador: string }) => r.identificador),
    ['J-0001', 'J-0002', 'J-0003', 'J-0004', 'J-0005', 'J-0006'],
  );
});

test('GET /api/categorias: 401 anonymous, 403 profile-only account, 200 with an office role', async () => {
  assert.equal((await getAs('/api/categorias')).status, 401);
  assert.equal(
    (await getAs('/api/categorias', cookieOf(await login('marta@example.com')))).status,
    403,
  );
  const res = await getAs('/api/categorias', cookieOf(await login('admin@example.com')));
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.deepEqual(rows, await db.query('SELECT * FROM categorias ORDER BY id'));
  assert.deepEqual(
    rows.map((r: { nombre: string }) => r.nombre),
    ['Sub-10', 'Sub-12', 'Sub-8'],
  );
});

// ---------------------------------------------------------------- HU-005: password change and recovery (M0 D2–D8)

const post = (path: string, body: unknown, cookie?: string) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
const changePassword = (cookie: string | undefined, currentPassword: string, newPassword: string) =>
  post('/auth/password', { currentPassword, newPassword }, cookie);
const requestReset = (email: string) => post('/auth/password-reset/request', { email });
const confirmReset = (token: string, newPassword: string) =>
  post('/auth/password-reset/confirm', { token, newPassword });
/** Raw token from the last captured e-mail to `to`. */
const tokenFor = (to: string) =>
  /token=([\w-]+)/.exec(mail.filter((m) => m.to === to).at(-1)!.text)![1]!;

test('change password: 401 without session; wrong current → 400; policy and same password → 400', async () => {
  assert.equal((await changePassword(undefined, 'demo1234', 'Nueva12345')).status, 401);
  const cookie = cookieOf(await login('coach@example.com'));
  const wrong = await changePassword(cookie, 'mala1234', 'Nueva12345');
  assert.equal(wrong.status, 400);
  assert.deepEqual(await wrong.json(), { error: 'La contraseña actual no es correcta.' });
  assert.equal((await changePassword(cookie, 'demo1234', 'corta1')).status, 400);
  assert.equal((await changePassword(cookie, 'demo1234', 'sololetras')).status, 400);
  assert.equal((await changePassword(cookie, 'demo1234', 'demo1234')).status, 400);
  assert.equal((await getSession(cookie)).status, 200, 'a failed change keeps the session');
});

test('change password (D2): keeps the current session, closes the others, only the hash is stored', async () => {
  const current = cookieOf(await login('coach@example.com'));
  const other = cookieOf(await login('coach@example.com'));
  const res = await changePassword(current, 'demo1234', 'Nueva12345');
  assert.equal(res.status, 204);
  assert.equal((await getSession(current)).status, 200);
  assert.equal((await getSession(other)).status, 401);
  assert.equal((await login('coach@example.com', 'demo1234')).status, 401);
  assert.equal((await login('coach@example.com', 'Nueva12345')).status, 200);
  const [row] = await db.query(
    "SELECT password_hash FROM usuarios WHERE email = 'coach@example.com'",
  );
  assert.match(row.password_hash, /^\$argon2id\$/);
  assert.ok(!row.password_hash.includes('Nueva12345'));
  const [{ n }] = await db.query(
    "SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'EDITAR' AND descripcion = 'Cambio de contraseña'",
  );
  assert.equal(n, 1);
});

test('change password: 5 wrong current passwords → 429, even with the right one', async () => {
  const cookie = cookieOf(await login('marta@example.com'));
  for (let i = 0; i < 5; i++)
    assert.equal((await changePassword(cookie, `mala${i}x1`, 'Nueva12345')).status, 400);
  assert.equal((await changePassword(cookie, 'demo1234', 'Nueva12345')).status, 429);
});

test('reset request (D7): same 204 for existing, unknown and inactive accounts; only the existing one gets mail', async () => {
  const before = mail.length;
  for (const email of ['tutor@example.com', 'nadie@example.com', 'baja@example.com']) {
    const res = await requestReset(email);
    assert.equal(res.status, 204, email);
    assert.equal(await res.text(), '');
  }
  assert.deepEqual(
    mail.slice(before).map((m) => m.to),
    ['tutor@example.com'],
  );
  const token = tokenFor('tutor@example.com');
  const rows = await db.query('SELECT token_hash FROM tokens_recuperacion');
  assert.ok(
    rows.every((r: { token_hash: string }) => r.token_hash !== token && r.token_hash.length === 64),
  );
});

test('reset (D3a/D3b/D8): a new request revokes the earlier token; single use; closes every session', async () => {
  const session = cookieOf(await login('tutor@example.com'));
  await requestReset('tutor@example.com');
  const first = tokenFor('tutor@example.com');
  await requestReset('tutor@example.com');
  const second = tokenFor('tutor@example.com');
  assert.notEqual(first, second);

  const revoked = await confirmReset(first, 'Recupera123');
  assert.equal(revoked.status, 400);
  assert.deepEqual(await revoked.json(), { error: 'El enlace no es válido o ya expiró.' });

  const ok = await confirmReset(second, 'Recupera123');
  assert.equal(ok.status, 204);
  assert.match(ok.headers.get('set-cookie') ?? '', /Max-Age=0/);
  assert.equal((await getSession(session)).status, 401, 'reset closes open sessions');
  assert.equal((await login('tutor@example.com', 'Recupera123')).status, 200);
  assert.equal((await confirmReset(second, 'OtraVez123')).status, 400, 'single use');

  const [{ total, used }] = await db.query(
    `SELECT COUNT(*) AS total, COUNT(t.usado_en) AS used FROM tokens_recuperacion t
       JOIN usuarios u ON u.id = t.usuario_id WHERE u.email = 'tutor@example.com'`,
  );
  assert.equal(total, used, 'revoked and used tokens are kept (usado_en), not deleted');
});

test('reset: an expired token is rejected and the password does not change', async () => {
  await requestReset('marta@example.com');
  const token = tokenFor('marta@example.com');
  await db.query(
    `UPDATE tokens_recuperacion SET creado_en = creado_en - INTERVAL 3 HOUR, expira_en = expira_en - INTERVAL 2 HOUR
      WHERE token_hash = SHA2(?, 256)`,
    [token],
  );
  assert.equal((await confirmReset(token, 'Expirada123')).status, 400);
  assert.equal((await login('marta@example.com', 'Expirada123')).status, 401);
});

test('reset: policy is checked; invalid tokens get the generic message', async () => {
  assert.equal((await confirmReset('cualquiera', 'corta')).status, 400);
  const res = await confirmReset('no-existe', 'Valida12345');
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'El enlace no es válido o ya expiró.' });
});

test('reset request: limited per e-mail and IP (429), whether the account exists or not', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await requestReset('limite@example.com')).status, 204);
  assert.equal((await requestReset('limite@example.com')).status, 429);
  assert.equal((await requestReset('LIMITE@example.com ')).status, 429, 'normalized e-mail');
});

test('reset request without a mail transport (D4b): 503 before reading the account, no token created', async () => {
  const noMail = createApp(db, { secureCookie: false }).listen(0);
  await new Promise((resolve) => noMail.once('listening', resolve));
  const url = `http://127.0.0.1:${(noMail.address() as AddressInfo).port}/auth/password-reset/request`;
  try {
    const [{ n: before }] = await db.query('SELECT COUNT(*) AS n FROM tokens_recuperacion');
    for (const email of ['admin@example.com', 'nadie@example.com']) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      assert.equal(res.status, 503, email);
      assert.deepEqual(await res.json(), {
        error: 'La recuperación de contraseña no está disponible.',
      });
    }
    const [{ n: after }] = await db.query('SELECT COUNT(*) AS n FROM tokens_recuperacion');
    assert.equal(after, before);
  } finally {
    noMail.close(); // even when an assertion fails, or the open server keeps the test process alive
  }
});

test('the console mail transport exists only in development with MAIL_CONSOLE=true (D4a)', async () => {
  const { mailerFromEnv } = await import('./password.ts');
  assert.equal(mailerFromEnv({}), null);
  assert.equal(mailerFromEnv({ MAIL_CONSOLE: 'false' }), null);
  assert.equal(mailerFromEnv({ MAIL_CONSOLE: 'true', NODE_ENV: 'production' }), null);
  assert.equal(typeof mailerFromEnv({ MAIL_CONSOLE: 'true' }), 'function');
});

test('database errors do not echo query parameters into logs (logParam: false, D4d)', async () => {
  await assert.rejects(
    db.query('SELECT * FROM tabla_inexistente WHERE x = ?', ['SECRETO-123']),
    (e: Error & { sql?: string }) => !`${e.message} ${e.sql ?? ''}`.includes('SECRETO-123'),
  );
});

/**
 * S-02 · shared Argon2id turns (api/argon2-guard.ts, migration 006) and the order of the checks before Argon2id in
 * login, password change and recovery. Every case reads the real Argon2id runs of this process (`argon2Stats`: total
 * and most at once) and the turns stored in MariaDB, not just the HTTP codes. Fixed clock (api/test-db.ts): a turn's
 * expiry is moved with `advance`. Several instances, a restart and the limiter pool: api/argon2-guard-instances.test.ts.
 */
import { after, before, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { argon2Stats, localDateTime, resetArgon2Peak, sha256 } from './auth.ts';
import { argon2LimitsFrom, type Argon2Limits } from './argon2-guard.ts';
import { forgetRefusals } from './login-limit.ts';
import { createApp } from './server.ts';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
const servers: Server[] = [];
before(async () => {
  t = await openTestDb('ef_s02');
});
after(async () => {
  for (const s of servers) s.close();
  await t?.close();
});
beforeEach(async () => {
  forgetRefusals();
  await t.db.query('DELETE FROM turnos_argon2');
  await t.db.query('DELETE FROM limite_acceso');
});

/** Another instance of the API on the test database, with its own Argon2id limits. */
async function app(argon2: Argon2Limits): Promise<string> {
  const server = createApp(t.db, { secureCookie: false, argon2 }).listen(0);
  servers.push(server);
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const post = (base: string, path: string, body: unknown, cookie?: string) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
const login = (base: string, email: string, password = 'demo1234') =>
  post(base, '/auth/login', { email, password });
/** Argon2id runs of `work`. */
async function runs<T>(work: () => Promise<T>): Promise<[T, number]> {
  const before = argon2Stats().runs;
  const result = await work();
  return [result, argon2Stats().runs - before];
}
const turns = () => t.count('SELECT COUNT(*) AS n FROM turnos_argon2');
/** Takes `n` turns as another (or a dead) process would, until `seconds` from MariaDB's now. */
const hold = (n: number, seconds = 600) =>
  Promise.all(
    Array.from({ length: n }, () =>
      t.db.query('INSERT INTO turnos_argon2 (vence_en) VALUES (NOW(3) + INTERVAL ? SECOND)', [
        seconds,
      ]),
    ),
  );
const BUSY = { error: 'El servicio está ocupado. Intenta de nuevo en unos segundos.' };
const ACCOUNTS = ['admin', 'secretaria', 'coach', 'tutor', 'marta'].map((u) => `${u}@example.com`);
const NEW_PASSWORD = 'Nueva2026segura';

/** A recovery token of `email`, as the request would store it (only its SHA-256). */
async function recoveryToken(email: string, opts: { expired?: boolean; used?: boolean } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const [{ id }]: { id: number }[] = await t.db.query('SELECT id FROM usuarios WHERE email = ?', [
    email,
  ]);
  const now = Date.now();
  await t.db.query(
    `INSERT INTO tokens_recuperacion (usuario_id, finalidad, token_hash, creado_en, expira_en, usado_en)
     VALUES (?, 'RECUPERACION', ?, ?, ?, ?)`,
    [
      id,
      sha256(token),
      localDateTime(now - 120_000),
      localDateTime(now + (opts.expired ? -60_000 : 3_600_000)),
      opts.used ? localDateTime(now - 30_000) : null,
    ],
  );
  return { token, userId: id };
}
const passwordHash = async (email: string) =>
  (
    (await t.db.query('SELECT password_hash AS h FROM usuarios WHERE email = ?', [email])) as {
      h: string;
    }[]
  )[0]!.h;

// ------------------------------------------------------------------ configuration and schema

test('S-02: invalid ARGON2_* settings stop the start instead of switching the guard off', () => {
  assert.deepEqual(argon2LimitsFrom({}), { limit: 3, waitMs: 2000 });
  assert.deepEqual(argon2LimitsFrom({ ARGON2_MAX_CONCURRENT: ' 6 ', ARGON2_WAIT_MS: '0' }), {
    limit: 6,
    waitMs: 0,
  });
  for (const bad of ['0', '-1', '2.5', 'diez', '65'])
    assert.throws(() => argon2LimitsFrom({ ARGON2_MAX_CONCURRENT: bad }), /ARGON2_MAX_CONCURRENT/);
  assert.throws(() => argon2LimitsFrom({ ARGON2_WAIT_MS: '10001' }), /ARGON2_WAIT_MS/);
});

// ------------------------------------------------------------------ the cap

test('S-02: 10 simultaneous logins with a limit of 2 — never more than 2 Argon2id at once, all answered, turns freed', async () => {
  const base = await app({ limit: 2, waitMs: 5000 });
  resetArgon2Peak();
  const [responses, n] = await runs(() =>
    Promise.all(ACCOUNTS.flatMap((email) => [login(base, email), login(base, email, 'mala-1')])),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [
    ...Array(5).fill(200),
    ...Array(5).fill(401),
  ]);
  assert.equal(n, 10);
  assert.ok(argon2Stats().peak <= 2, `peak ${argon2Stats().peak}`);
  assert.equal(await turns(), 0);
});

test('S-02: no turn free → 503 without Argon2id, the S-01 attempt is given back, and it works once a turn frees', async () => {
  const base = await app({ limit: 2, waitMs: 0 });
  await hold(2);
  const [busy, n] = await runs(() => login(base, 'marta@example.com'));
  assert.equal(busy.status, 503);
  assert.deepEqual(await busy.json(), BUSY);
  assert.equal(n, 0, 'nothing verified');
  assert.deepEqual(
    (await t.db.query('SELECT ambito, intentos FROM limite_acceso'))
      .map((r: { ambito: string; intentos: number }) => [r.ambito, r.intentos])
      .sort(),
    [
      ['CUENTA_IP', 0],
      ['IP', 0],
    ],
    'the attempt that never happened is not counted',
  );
  await t.db.query('DELETE FROM turnos_argon2');
  const [ok, m] = await runs(() => login(base, 'marta@example.com'));
  assert.equal(ok.status, 200);
  assert.equal(m, 1);
});

test('S-02: a waiting request continues as soon as a turn frees (bounded wait)', async () => {
  const base = await app({ limit: 1, waitMs: 5000 });
  await hold(1);
  const pending = runs(() => login(base, 'marta@example.com'));
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(argon2Stats().running, 0, 'still waiting, nothing running');
  await t.db.query('DELETE FROM turnos_argon2');
  const [res, n] = await pending;
  assert.equal(res.status, 200);
  assert.equal(n, 1);
});

test('S-02: a turn left by a dead process expires on its own (MariaDB clock)', async () => {
  const base = await app({ limit: 1, waitMs: 0 });
  await hold(1, 30);
  assert.equal((await login(base, 'marta@example.com')).status, 503);
  await t.advance(31_000);
  forgetRefusals();
  const [res, n] = await runs(() => login(base, 'marta@example.com'));
  assert.equal(res.status, 200);
  assert.equal(n, 1);
  assert.equal(await turns(), 0, 'the expired turn was removed');
});

test('S-02: an exception inside Argon2id frees the turn', async () => {
  const base = await app({ limit: 1, waitMs: 0 });
  const failing = mock.method(crypto, 'argon2', (_a: string, _p: unknown, cb: (e: Error) => void) =>
    cb(new Error('fallo simulado')),
  );
  try {
    const res = await login(base, 'marta@example.com');
    assert.equal(res.status, 500);
    assert.doesNotMatch(await res.text(), /fallo simulado/, 'no internal detail');
  } finally {
    failing.mock.restore();
  }
  assert.equal(await turns(), 0);
  assert.equal((await login(base, 'marta@example.com')).status, 200);
});

test('S-02: if MariaDB cannot give turns (migration 006 missing), nothing is verified — 503', async () => {
  const base = await app({ limit: 3, waitMs: 0 });
  await t.db.query('RENAME TABLE turnos_argon2_guarda TO turnos_argon2_guarda_fuera');
  try {
    const [res, n] = await runs(() => login(base, 'marta@example.com'));
    assert.equal(res.status, 503);
    assert.equal(n, 0);
  } finally {
    await t.db.query('RENAME TABLE turnos_argon2_guarda_fuera TO turnos_argon2_guarda');
  }
  await t.db.query('DELETE FROM turnos_argon2_guarda');
  try {
    const [res, n] = await runs(() => login(base, 'marta@example.com'));
    assert.equal(res.status, 503, 'without the guard row the count could not be atomic: refuse');
    assert.equal(n, 0);
  } finally {
    await t.db.query('INSERT INTO turnos_argon2_guarda (id) VALUES (1)');
  }
});

test('S-02 + S-01: a login refused by the attempt limits never takes a turn nor runs Argon2id', async () => {
  const base = await app({ limit: 3, waitMs: 0 });
  for (let i = 0; i < 5; i++) await login(base, 'marta@example.com', 'mala-1');
  const [res, n] = await runs(() => login(base, 'marta@example.com'));
  assert.equal(res.status, 429);
  assert.equal(n, 0);
  assert.equal(await turns(), 0);
});

// ------------------------------------------------------------------ password recovery: the token before Argon2id

test('S-02: recovery with an unknown, expired or used token runs no Argon2id', async () => {
  const base = await app({ limit: 3, waitMs: 0 });
  const expired = await recoveryToken('tutor@example.com', { expired: true });
  const used = await recoveryToken('tutor@example.com', { used: true });
  for (const token of ['no-existe-' + 'x'.repeat(20), expired.token, used.token]) {
    const [res, n] = await runs(() =>
      post(base, '/auth/password-reset/confirm', { token, newPassword: NEW_PASSWORD }),
    );
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'El enlace no es válido o ya expiró.' });
    assert.equal(n, 0);
  }
  // malformed requests: no query needed, no Argon2id
  for (const body of [
    {},
    { token: 'x' },
    { token: 'x', newPassword: 'corta' },
    { token: 1, newPassword: NEW_PASSWORD },
  ]) {
    const [res, n] = await runs(() => post(base, '/auth/password-reset/confirm', body));
    assert.equal(res.status, 400);
    assert.equal(n, 0);
  }
});

test('S-02: a valid token still works — one Argon2id, the token used once, the password changed', async () => {
  const base = await app({ limit: 3, waitMs: 0 });
  const { token, userId } = await recoveryToken('tutor@example.com');
  const before = await passwordHash('tutor@example.com');
  const [res, n] = await runs(() =>
    post(base, '/auth/password-reset/confirm', { token, newPassword: NEW_PASSWORD }),
  );
  assert.equal(res.status, 204);
  assert.equal(n, 1);
  assert.notEqual(await passwordHash('tutor@example.com'), before);
  assert.equal(
    await t.count(
      'SELECT COUNT(*) AS n FROM tokens_recuperacion WHERE token_hash = ? AND usado_en IS NOT NULL',
      [sha256(token)],
    ),
    1,
  );
  assert.equal((await login(base, 'tutor@example.com', NEW_PASSWORD)).status, 200);
  // restore the demo password for the other cases
  await t.db.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [before, userId]);
});

test('S-02: two simultaneous confirmations of one token — exactly one changes the password', async () => {
  const base = await app({ limit: 3, waitMs: 2000 });
  const { token, userId } = await recoveryToken('coach@example.com');
  const before = await passwordHash('coach@example.com');
  const statuses = (
    await Promise.all([
      post(base, '/auth/password-reset/confirm', { token, newPassword: NEW_PASSWORD }),
      post(base, '/auth/password-reset/confirm', { token, newPassword: 'Otra2026segura' }),
    ])
  ).map((r) => r.status);
  assert.deepEqual(statuses.sort(), [204, 400]);
  assert.equal(
    await t.count(
      "SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'usuarios' AND entidad_id = ? AND descripcion = 'Restablecimiento de contraseña'",
      [userId],
    ),
    1,
  );
  await t.db.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [before, userId]);
});

test('S-02: a failure computing the hash, or no turn, leaves the token unused and the password as it was', async () => {
  const { token, userId } = await recoveryToken('secretaria@example.com');
  const before = await passwordHash('secretaria@example.com');
  const unused = () =>
    t.count(
      'SELECT COUNT(*) AS n FROM tokens_recuperacion WHERE usuario_id = ? AND usado_en IS NULL',
      [userId],
    );
  // the hash throws
  const base = await app({ limit: 3, waitMs: 0 });
  const failing = mock.method(crypto, 'argon2', (_a: string, _p: unknown, cb: (e: Error) => void) =>
    cb(new Error('fallo simulado')),
  );
  try {
    assert.equal(
      (await post(base, '/auth/password-reset/confirm', { token, newPassword: NEW_PASSWORD }))
        .status,
      500,
    );
  } finally {
    failing.mock.restore();
  }
  assert.equal(await unused(), 1);
  assert.equal(await passwordHash('secretaria@example.com'), before);
  // no turn
  const full = await app({ limit: 1, waitMs: 0 });
  await hold(1);
  const [res, n] = await runs(() =>
    post(full, '/auth/password-reset/confirm', { token, newPassword: NEW_PASSWORD }),
  );
  assert.equal(res.status, 503);
  assert.equal(n, 0);
  assert.equal(await unused(), 1);
  // and it still works afterwards
  await t.db.query('DELETE FROM turnos_argon2');
  assert.equal(
    (await post(base, '/auth/password-reset/confirm', { token, newPassword: NEW_PASSWORD })).status,
    204,
  );
  await t.db.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [before, userId]);
});

// ------------------------------------------------------------------ password change

test('S-02: password change — invalid new passwords cost no Argon2id; a valid change runs 2 in one turn; busy → 503', async () => {
  const base = await app({ limit: 1, waitMs: 0 });
  const cookie = (await login(base, 'marta@example.com')).headers.get('set-cookie')!.split(';')[0]!;
  const change = (currentPassword: string, newPassword: string) =>
    post(base, '/auth/password', { currentPassword, newPassword }, cookie);
  for (const [current, next] of [
    ['demo1234', 'demo1234'], // same as the current one
    ['demo1234', 'corta'], // policy
    ['x'.repeat(201), NEW_PASSWORD], // over the length limit
  ]) {
    const [res, n] = await runs(() => change(current!, next!));
    assert.equal(res.status, 400);
    assert.equal(n, 0, `${current!.slice(0, 10)} → ${next}`);
  }
  await hold(1);
  const [busy, b] = await runs(() => change('demo1234', NEW_PASSWORD));
  assert.equal(busy.status, 503);
  assert.equal(b, 0);
  await t.db.query('DELETE FROM turnos_argon2');
  resetArgon2Peak();
  const [res, n] = await runs(() => change('demo1234', NEW_PASSWORD));
  assert.equal(res.status, 204);
  assert.equal(n, 2, 'verify the current one and hash the new one');
  assert.equal(argon2Stats().peak, 1, 'one turn, one operation at a time');
  assert.equal(await turns(), 0);
  const [wrong, w] = await runs(() => change('mala-1234', 'Otra2026segura'));
  assert.equal(wrong.status, 400);
  assert.equal(w, 1, 'a wrong current password is verified once and nothing is hashed');
  assert.equal((await change(NEW_PASSWORD, 'demo1234')).status, 204); // back to the demo password
});

test('S-02: unknown accounts and wrong passwords still cost one Argon2id each (no enumeration by timing)', async () => {
  const base = await app({ limit: 3, waitMs: 0 });
  const [a, n1] = await runs(() => login(base, 'nadie@example.com', 'mala-1'));
  const [b, n2] = await runs(() => login(base, 'marta@example.com', 'mala-1'));
  assert.deepEqual([a.status, b.status, n1, n2], [401, 401, 1, 1]);
});

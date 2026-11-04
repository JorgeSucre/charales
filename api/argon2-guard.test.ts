/**
 * S-02 · the per-process Argon2id gate in the API routes (login, password change, recovery) and its interplay with the
 * S-01 attempt limits, over MariaDB. Every case reads the real Argon2id runs of this process (`argon2Stats`: total and
 * most at once), not just the HTTP codes. The gate alone: api/argon2-gate.test.ts.
 * Each app of these tests has its own gate, as each API process does in production.
 */
import { after, before, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { argon2Stats, localDateTime, resetArgon2Peak, sha256 } from './auth.ts';
import {
  ARGON2_DEFAULTS,
  MAX_WAITERS,
  argon2Gate,
  argon2LimitsFrom,
  type Argon2Gate,
} from './argon2-guard.ts';
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
  await t.db.query('DELETE FROM limite_acceso');
});

/** Another instance of the API on the test database, with its own Argon2id gate. */
async function app(gate: Argon2Gate): Promise<string> {
  const server = createApp(t.db, { secureCookie: false, argon2: gate }).listen(0);
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
const counters = async () =>
  (await t.db.query('SELECT ambito, intentos FROM limite_acceso'))
    .map((r: { ambito: string; intentos: number }) => [r.ambito, r.intentos])
    .sort();
const BUSY = { error: 'El servicio está ocupado. Intenta de nuevo en unos segundos.' };
const ACCOUNTS = ['admin', 'secretaria', 'coach', 'tutor', 'marta'].map((u) => `${u}@example.com`);
const NEW_PASSWORD = 'Nueva2026segura';
const statuses = (responses: Response[]) =>
  responses.reduce<Record<number, number>>(
    (n, r) => ({ ...n, [r.status]: (n[r.status] ?? 0) + 1 }),
    {},
  );

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
const tokenUnused = (token: string) =>
  t.count(
    'SELECT COUNT(*) AS n FROM tokens_recuperacion WHERE token_hash = ? AND usado_en IS NULL',
    [sha256(token)],
  );
const failingArgon2 = () =>
  mock.method(crypto, 'argon2', (_a: string, _p: unknown, cb: (e: Error) => void) =>
    cb(new Error('fallo simulado')),
  );

// ------------------------------------------------------------------ configuration

test('S-02: invalid ARGON2_* settings stop the start instead of switching the gate off', () => {
  assert.deepEqual(argon2LimitsFrom({}), ARGON2_DEFAULTS);
  assert.deepEqual(argon2LimitsFrom({ ARGON2_MAX_CONCURRENT: ' 6 ', ARGON2_WAIT_MS: '0' }), {
    limit: 6,
    waitMs: 0,
  });
  for (const bad of ['0', '-1', '2.5', 'diez', 'NaN', '65'])
    assert.throws(() => argon2LimitsFrom({ ARGON2_MAX_CONCURRENT: bad }), /ARGON2_MAX_CONCURRENT/);
  for (const bad of ['-1', '1.5', '10001'])
    assert.throws(() => argon2LimitsFrom({ ARGON2_WAIT_MS: bad }), /ARGON2_WAIT_MS/);
});

// ------------------------------------------------------------------ the cap in the routes

test('S-02: 10 simultaneous logins with a limit of 2 — never more than 2 Argon2id at once, all answered', async () => {
  const gate = argon2Gate({ limit: 2, waitMs: 5000 });
  const base = await app(gate);
  resetArgon2Peak();
  const [responses, n] = await runs(() =>
    Promise.all(ACCOUNTS.flatMap((email) => [login(base, email), login(base, email, 'mala-1')])),
  );
  assert.deepEqual(statuses(responses), { 200: 5, 401: 5 });
  assert.equal(n, 10);
  assert.equal(argon2Stats().peak, 2);
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 });
});

test('S-02: no slot → 503 without Argon2id and the S-01 attempt is given back; it works once the slot frees', async () => {
  const gate = argon2Gate({ limit: 1, waitMs: 0 });
  const base = await app(gate);
  const held = (await gate.acquire())!;
  const [busy, n] = await runs(() => login(base, 'marta@example.com'));
  assert.equal(busy.status, 503);
  assert.deepEqual(await busy.json(), BUSY);
  assert.equal(n, 0, 'nothing verified');
  assert.deepEqual(await counters(), [
    ['CUENTA_IP', 0],
    ['IP', 0],
  ]);
  held();
  const [ok, m] = await runs(() => login(base, 'marta@example.com'));
  assert.equal(ok.status, 200);
  assert.equal(m, 1);
});

test('S-02: a waiting login continues as soon as the slot frees', async () => {
  const gate = argon2Gate({ limit: 1, waitMs: 5000 });
  const base = await app(gate);
  const held = (await gate.acquire())!;
  const pending = runs(() => login(base, 'marta@example.com'));
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(gate.stats(), { active: 1, waiting: 1 });
  held();
  const [res, n] = await pending;
  assert.equal(res.status, 200);
  assert.equal(n, 1);
});

test('S-02: a wait that runs out answers 503 after ARGON2_WAIT_MS, without Argon2id', async () => {
  const gate = argon2Gate({ limit: 1, waitMs: 300 });
  const base = await app(gate);
  const held = (await gate.acquire())!;
  const started = performance.now();
  const [res, n] = await runs(() => login(base, 'marta@example.com'));
  assert.equal(res.status, 503);
  assert.ok(performance.now() - started >= 290, 'it waited');
  assert.equal(n, 0);
  assert.deepEqual(gate.stats(), { active: 1, waiting: 0 });
  held();
});

test(`S-02: the queue is bounded — with the slot taken, ${MAX_WAITERS} logins wait and the rest get 503 at once`, async () => {
  const gate = argon2Gate({ limit: 1, waitMs: 10_000 });
  const base = await app(gate);
  const held = (await gate.acquire())!;
  resetArgon2Peak();
  const answered: Response[] = [];
  const all = Array.from({ length: MAX_WAITERS + 8 }, (_, i) =>
    login(base, `cola${i}@example.com`, 'mala-1').then((r) => (answered.push(r), r)),
  );
  while (answered.length < 8 || gate.stats().waiting < MAX_WAITERS)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(statuses(answered), { 503: 8 }, 'refused before any wait');
  held();
  const responses = await Promise.all(all);
  assert.deepEqual(statuses(responses), { 401: MAX_WAITERS, 503: 8 });
  assert.equal(argon2Stats().peak, 1);
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 });
});

test('S-02: an exception inside Argon2id frees the slot (500, no internal detail)', async () => {
  const gate = argon2Gate({ limit: 1, waitMs: 0 });
  const base = await app(gate);
  const failing = failingArgon2();
  try {
    const res = await login(base, 'marta@example.com');
    assert.equal(res.status, 500);
    assert.doesNotMatch(await res.text(), /fallo simulado/);
  } finally {
    failing.mock.restore();
  }
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 });
  assert.equal((await login(base, 'marta@example.com')).status, 200);
});

// ------------------------------------------------------------------ S-01 × S-02 at the default limits

test('S-01 × S-02 (defaults): a 503 does not spend an S-01 attempt, and a 429 neither takes a slot nor runs Argon2id', async () => {
  const gate = argon2Gate(ARGON2_DEFAULTS);
  const base = await app(gate);
  const held = await Promise.all(
    Array.from({ length: ARGON2_DEFAULTS.limit }, () => gate.acquire()),
  );
  // the gate is full: 10 simultaneous wrong passwords. The S-01 reservation comes BEFORE the wait for a slot, so the
  // first 5 hold the account+IP allowance while they wait and the other 5 are refused by S-01 (429). The waits run out
  // (503) and give their reservations back: nothing counted, nothing verified.
  const [busy, b] = await runs(() =>
    Promise.all(Array.from({ length: 10 }, () => login(base, 'marta@example.com', 'mala-1'))),
  );
  assert.deepEqual(statuses(busy), { 429: 5, 503: 5 });
  assert.equal(b, 0);
  assert.deepEqual(await counters(), [
    ['CUENTA_IP', 0],
    ['IP', 0],
  ]);
  forgetRefusals(); // the 429s were remembered for a few seconds by this process (S-01, M-1)
  for (const release of held) release!();
  // with room again: the 5 allowed guesses are verified, the 6th is refused by S-01 before the gate
  for (let i = 0; i < 5; i++)
    assert.equal((await login(base, 'marta@example.com', 'mala-1')).status, 401);
  const blocked = await Promise.all(
    Array.from({ length: ARGON2_DEFAULTS.limit }, () => gate.acquire()),
  );
  const [refused, n] = await runs(() => login(base, 'marta@example.com'));
  assert.equal(refused.status, 429, 'S-01 answers first, even with the gate full');
  assert.equal(n, 0);
  assert.deepEqual(gate.stats(), { active: ARGON2_DEFAULTS.limit, waiting: 0 }, 'no slot taken');
  for (const release of blocked) release!();
});

// ------------------------------------------------------------------ password recovery

test('S-02: recovery with an unknown, expired or used token, or a malformed one, runs no Argon2id', async () => {
  const base = await app(argon2Gate(ARGON2_DEFAULTS));
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

test('S-02: a valid token still works — one Argon2id, the token used, the password changed', async () => {
  const base = await app(argon2Gate(ARGON2_DEFAULTS));
  const { token, userId } = await recoveryToken('tutor@example.com');
  const before = await passwordHash('tutor@example.com');
  const [res, n] = await runs(() =>
    post(base, '/auth/password-reset/confirm', { token, newPassword: NEW_PASSWORD }),
  );
  assert.equal(res.status, 204);
  assert.equal(n, 1);
  assert.equal(await tokenUnused(token), 0);
  assert.equal((await login(base, 'tutor@example.com', NEW_PASSWORD)).status, 200);
  await t.db.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [before, userId]);
});

test('S-02: two simultaneous confirmations of one token — exactly one changes the password', async () => {
  const base = await app(argon2Gate(ARGON2_DEFAULTS));
  const { token, userId } = await recoveryToken('coach@example.com');
  const before = await passwordHash('coach@example.com');
  const statusesOf = (
    await Promise.all([
      post(base, '/auth/password-reset/confirm', { token, newPassword: NEW_PASSWORD }),
      post(base, '/auth/password-reset/confirm', { token, newPassword: 'Otra2026segura' }),
    ])
  ).map((r) => r.status);
  assert.deepEqual(statusesOf.sort(), [204, 400]);
  assert.equal(
    await t.count(
      "SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'usuarios' AND entidad_id = ? AND descripcion = 'Restablecimiento de contraseña'",
      [userId],
    ),
    1,
  );
  await t.db.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [before, userId]);
});

test('S-02: a failure computing the hash, or a 503, leaves the token unused and the password as it was', async () => {
  const { token, userId } = await recoveryToken('secretaria@example.com');
  const before = await passwordHash('secretaria@example.com');
  const gate = argon2Gate({ limit: 1, waitMs: 0 });
  const base = await app(gate);
  const failing = failingArgon2();
  try {
    assert.equal(
      (await post(base, '/auth/password-reset/confirm', { token, newPassword: NEW_PASSWORD }))
        .status,
      500,
    );
  } finally {
    failing.mock.restore();
  }
  assert.equal(await tokenUnused(token), 1);
  assert.equal(await passwordHash('secretaria@example.com'), before);
  const held = (await gate.acquire())!;
  const [res, n] = await runs(() =>
    post(base, '/auth/password-reset/confirm', { token, newPassword: NEW_PASSWORD }),
  );
  assert.equal(res.status, 503);
  assert.equal(n, 0);
  assert.equal(await tokenUnused(token), 1);
  held();
  assert.equal(
    (await post(base, '/auth/password-reset/confirm', { token, newPassword: NEW_PASSWORD })).status,
    204,
  );
  await t.db.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [before, userId]);
});

// ------------------------------------------------------------------ password change

test('S-02: password change — invalid new passwords cost no Argon2id; a change runs 2 in ONE slot; 503 gives C1 back', async () => {
  const gate = argon2Gate({ limit: 1, waitMs: 0 });
  let acquires = 0;
  const acquire = gate.acquire;
  gate.acquire = () => (acquires++, acquire());
  const base = await app(gate);
  const cookie = (await login(base, 'marta@example.com')).headers.get('set-cookie')!.split(';')[0]!;
  const change = (currentPassword: string, newPassword: string) =>
    post(base, '/auth/password', { currentPassword, newPassword }, cookie);
  for (const [current, next] of [
    ['demo1234', 'demo1234'], // same as the current one
    ['demo1234', 'corta'], // policy
  ]) {
    const [res, n] = await runs(() => change(current!, next!));
    assert.equal(res.status, 400);
    assert.equal(n, 0);
  }
  // the right one: verify + hash with a single slot, never released in between (limit 1: never 2 at once)
  acquires = 0;
  resetArgon2Peak();
  const [ok, n] = await runs(() => change('demo1234', NEW_PASSWORD));
  assert.equal(ok.status, 204);
  assert.equal(n, 2, 'verify the current one and hash the new one');
  assert.equal(acquires, 1, 'one slot for both');
  assert.equal(argon2Stats().peak, 1);
  assert.equal((await change(NEW_PASSWORD, 'demo1234')).status, 204); // back to the demo password
  // over the length limit: refused without Argon2id (it counts as a C1 guess, as before S-02)
  const [long, l] = await runs(() => change('x'.repeat(201), NEW_PASSWORD));
  assert.equal(long.status, 400);
  assert.equal(l, 0);
  // busy: 503 without Argon2id, and the C1 attempt is given back each time
  const held = (await gate.acquire())!;
  for (let i = 0; i < 6; i++) {
    const [busy, b] = await runs(() => change('mala-1234', 'Otra2026segura'));
    assert.equal(busy.status, 503);
    assert.equal(b, 0);
  }
  held();
  // C1 still has its 4 guesses left (5 minus the long one): the 503s spent none
  for (let i = 0; i < 4; i++)
    assert.equal((await change('mala-1234', 'Otra2026segura')).status, 400, `guess ${i + 1}`);
  assert.equal((await change('mala-1234', 'Otra2026segura')).status, 429);
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 });
});

test('S-02: unknown accounts and wrong passwords still cost one Argon2id each (no enumeration by timing)', async () => {
  const base = await app(argon2Gate(ARGON2_DEFAULTS));
  const [a, n1] = await runs(() => login(base, 'nadie@example.com', 'mala-1'));
  const [b, n2] = await runs(() => login(base, 'marta@example.com', 'mala-1'));
  assert.deepEqual([a.status, b.status, n1, n2], [401, 401, 1, 1]);
});

// ------------------------------------------------------------------ several processes: the cap is per process

test('S-02 (documented assumption): the cap is PER PROCESS — two instances with a limit of 3 run up to 6 at once', async () => {
  // Each API process has its own gate; two apps here stand for two processes. Charales runs ONE process
  // (`node api/server.ts`, no cluster): with more, the total is processes × ARGON2_MAX_CONCURRENT (docs/API.md).
  const a = await app(argon2Gate({ limit: 3, waitMs: 10_000 }));
  const b = await app(argon2Gate({ limit: 3, waitMs: 10_000 }));
  const real = crypto.argon2;
  const slow = mock.method(crypto, 'argon2', (alg: string, params: unknown, cb: unknown) =>
    setTimeout(() => (real as (...x: unknown[]) => void).call(crypto, alg, params, cb), 150),
  );
  resetArgon2Peak();
  try {
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        login(i % 2 ? b : a, `proceso${i}@example.com`, 'mala-1'),
      ),
    );
    assert.deepEqual(statuses(responses), { 401: 12 });
  } finally {
    slow.mock.restore();
  }
  assert.equal(argon2Stats().peak, 6, '3 + 3: not a global limit');
});

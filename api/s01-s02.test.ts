/**
 * S-01 + S-02 together, at their DEFAULT settings: the login attempt limits (api/login-limit.ts: IP → account+IP lock
 * order, rollback on 429, selective retries) in front of the per-process Argon2id gate (api/argon2-guard.ts: 3 at once,
 * 32 waiting, 503 without Argon2id). Every case counts the real Argon2id runs (`argon2Stats`) and checks the counters
 * stored in MariaDB against what was verified: an attempt counts only if it reached Argon2id.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { Pool } from 'mariadb';
import type { AddressInfo } from 'node:net';
import { argon2Stats, resetArgon2Peak } from './auth.ts';
import { ARGON2_DEFAULTS, MAX_WAITERS, argon2Gate, type Argon2Gate } from './argon2-guard.ts';
import { LOGIN_LIMITS, forgetRefusals } from './login-limit.ts';
import { createApp, createLimiterPool } from './server.ts';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
const servers: Server[] = [];
const limiters: Pool[] = [];
before(async () => {
  t = await openTestDb('ef_s0102');
});
after(async () => {
  for (const s of servers) s.close();
  for (const p of limiters) await p.end();
  await t?.close();
});
beforeEach(async () => {
  forgetRefusals();
  await t.db.query('DELETE FROM limite_acceso');
});

/**
 * An API instance as the server starts one: its own Argon2id gate and its own limiter pool (2 connections, 2 s lock
 * wait), behind a trusted proxy so each request can pick its IP.
 */
async function instance(gate: Argon2Gate = argon2Gate(ARGON2_DEFAULTS)) {
  const limiterDb = createLimiterPool({ ...process.env, DB_NAME: t.name });
  limiters.push(limiterDb);
  const server = createApp(t.db, {
    secureCookie: false,
    trustedProxies: ['127.0.0.1'],
    limiterDb,
    argon2: gate,
  }).listen(0);
  servers.push(server);
  await new Promise((resolve) => server.once('listening', resolve));
  return { gate, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
const login = (base: string, email: string, ip: string, password = 'mala-1') =>
  fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.status);
const tally = (statuses: number[]) =>
  statuses.reduce<Record<number, number>>((n, s) => ({ ...n, [s]: (n[s] ?? 0) + 1 }), {});
/** Sum of the stored counters per scope, the largest of each, and how many exceed their limit. */
async function stored() {
  const rows: { ambito: string; intentos: number }[] = await t.db.query(
    'SELECT ambito, intentos FROM limite_acceso',
  );
  const of = (scope: string) => rows.filter((r) => r.ambito === scope).map((r) => r.intentos);
  return {
    ip: of('IP').reduce((a, b) => a + b, 0),
    pair: of('CUENTA_IP').reduce((a, b) => a + b, 0),
    over:
      of('IP').filter((n) => n > LOGIN_LIMITS.IP).length +
      of('CUENTA_IP').filter((n) => n > LOGIN_LIMITS.CUENTA_IP).length,
  };
}
const ACCOUNTS = ['admin', 'secretaria', 'coach', 'tutor', 'marta'].map((u) => `${u}@example.com`);

/** The invariants of every burst: Argon2id never above the gate, and the counters equal what was verified. */
async function burst(send: (i: number) => Promise<number>, n = 50) {
  const runs = argon2Stats().runs;
  resetArgon2Peak();
  const statuses = await Promise.all(Array.from({ length: n }, (_, i) => send(i)));
  const verified = argon2Stats().runs - runs;
  const counted = await stored();
  return { got: tally(statuses), verified, peak: argon2Stats().peak, counted };
}

test('S-01+S-02: 50 at once from one IP with 5 accounts — S-01 admits 25, all fit in the gate, the rest 429 without Argon2id', async () => {
  const { base } = await instance();
  const r = await burst((i) => login(base, ACCOUNTS[i % 5]!, '203.0.113.1'));
  assert.deepEqual(r.got, { 401: 25, 429: 25 });
  assert.equal(r.verified, 25);
  assert.ok(r.peak <= ARGON2_DEFAULTS.limit, `peak ${r.peak}`);
  assert.deepEqual(r.counted, { ip: 25, pair: 25, over: 0 });
});

test('S-01+S-02: one account from 10 IPs, 50 at once — the 18 the gate can not hold get 503 and give their S-01 attempt back', async () => {
  // the default cap and queue (3 + 32); a long wait so the 32 queued survive however slowly the 18 others are answered
  const { base, gate } = await instance(argon2Gate({ ...ARGON2_DEFAULTS, waitMs: 10_000 }));
  const overflow = 50 - MAX_WAITERS;
  const held = await Promise.all(
    Array.from({ length: ARGON2_DEFAULTS.limit }, () => gate.acquire()),
  );
  const answered: number[] = [];
  const r = await burst(async (i) => {
    const status = await login(base, 'coach@example.com', `198.51.100.${1 + (i % 10)}`);
    // S-01 admits all 50 (5 per account+IP, 10 IPs): once the queue is full, the rest are refused at once
    if (answered.push(status) === overflow) for (const release of held) release!();
    return status;
  });
  assert.deepEqual(
    answered.slice(0, overflow),
    Array(overflow).fill(503),
    'refused while the queue was full',
  );
  assert.deepEqual(r.got, { 401: MAX_WAITERS, 503: overflow });
  assert.equal(r.verified, MAX_WAITERS, 'Argon2id ran once per 401, never for a 503');
  assert.ok(r.peak <= ARGON2_DEFAULTS.limit, `peak ${r.peak}`);
  assert.deepEqual(
    r.counted,
    { ip: MAX_WAITERS, pair: MAX_WAITERS, over: 0 },
    'a 503 is not counted',
  );
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 });
});

test('S-01+S-02: two instances, one IP, 50 at once — the S-01 limits are shared, each gate is its own', async () => {
  const a = await instance();
  const b = await instance();
  const r = await burst((i) => login(i % 2 ? b.base : a.base, ACCOUNTS[i % 5]!, '203.0.113.2'));
  assert.deepEqual(
    r.got,
    { 401: 25, 429: 25 },
    'S-01 admits 5 per account+IP across both instances',
  );
  assert.equal(r.verified, 25);
  assert.ok(
    r.peak <= 2 * ARGON2_DEFAULTS.limit,
    `peak ${r.peak} (per process: ${ARGON2_DEFAULTS.limit} each)`,
  );
  assert.deepEqual(r.counted, { ip: 25, pair: 25, over: 0 });
});

test('S-01+S-02: gate saturated — 503 without Argon2id, nothing counted; a pair at its limit still gets 429 first', async () => {
  const gate = argon2Gate({ limit: ARGON2_DEFAULTS.limit, waitMs: 100 });
  const { base } = await instance(gate);
  const held = await Promise.all(
    Array.from({ length: ARGON2_DEFAULTS.limit }, () => gate.acquire()),
  );
  const r = await burst(() => login(base, 'marta@example.com', '203.0.113.3'), 10);
  // the first 5 hold the account+IP allowance while they wait (S-01 reserves before the gate); the other 5 get 429
  assert.deepEqual(r.got, { 429: 5, 503: 5 });
  assert.equal(r.verified, 0);
  assert.deepEqual(r.counted, { ip: 0, pair: 0, over: 0 }, 'every 503 gave its attempt back');
  for (const release of held) release!();
  forgetRefusals();
  for (let i = 0; i < LOGIN_LIMITS.CUENTA_IP; i++)
    assert.equal(await login(base, 'marta@example.com', '203.0.113.3'), 401);
  const again = await Promise.all(
    Array.from({ length: ARGON2_DEFAULTS.limit }, () => gate.acquire()),
  );
  const before = argon2Stats().runs;
  assert.equal(await login(base, 'marta@example.com', '203.0.113.3', 'demo1234'), 429);
  assert.equal(argon2Stats().runs - before, 0, '429 before the gate, no Argon2id');
  assert.deepEqual(gate.stats(), { active: ARGON2_DEFAULTS.limit, waiting: 0 }, 'no slot taken');
  for (const release of again) release!();
});

test('S-01+S-02: a right password gives the reservation back and clears the pair; S-01 and the gate are both left clean', async () => {
  const { base, gate } = await instance();
  for (let i = 0; i < 4; i++)
    assert.equal(await login(base, 'tutor@example.com', '203.0.113.4'), 401);
  assert.equal(await login(base, 'tutor@example.com', '203.0.113.4', 'demo1234'), 200);
  const rows: { ambito: string; intentos: number }[] = await t.db.query(
    'SELECT ambito, intentos FROM limite_acceso ORDER BY ambito',
  );
  assert.deepEqual(rows.map((r) => [r.ambito, r.intentos]).sort(), [
    ['CUENTA_IP', 0],
    ['IP', 4],
  ]);
  assert.deepEqual(gate.stats(), { active: 0, waiting: 0 });
});

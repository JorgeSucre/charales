/**
 * S-01 · lock order of the login reservation (api/login-limit.ts). Every request takes the IP row first — inserting it
 * if missing — and only then the account+IP row, so two requests can't hold them in opposite order (the deadlock found
 * by the 2026-11-04 audit). These cases drive `reserveLogin` through instrumented pools that can pause a transaction
 * right before it reads the account+IP row and record (or inject) MariaDB errors. They wrap a pool built like the API's
 * limiter pool (createLimiterPool: innodb_lock_wait_timeout of 2 s on its sessions), with 5 connections so three
 * transactions can interleave; the HTTP bursts use the real one (2 connections) per instance.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Pool, PoolConnection } from 'mariadb';
import { passwordVerifications } from './auth.ts';
import { forgetRefusals, loginKeys, reserveLogin } from './login-limit.ts';
import { argon2Gate } from './argon2-guard.ts';
import { createApp, createLimiterPool } from './server.ts';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
let limiter: Pool;
before(async () => {
  t = await openTestDb('ef_s01order');
  limiter = createLimiterPool({ ...process.env, DB_NAME: t.name }, { connectionLimit: 5 });
});
after(async () => {
  await limiter?.end();
  await t?.close();
});
beforeEach(async () => {
  forgetRefusals();
  await t.db.query('DELETE FROM limite_acceso');
});

const PAIR_SELECT = 'SELECT intentos, ventana_inicio FROM limite_acceso WHERE clave = ? FOR UPDATE';
interface Probe {
  pool: Pool;
  /** errno → count, for every MariaDB error the limiter got (also the ones it retried). */
  errors: Record<number, number>;
  /** Resolves when the transaction reaches the read of the account+IP row. */
  reached: Promise<void>;
}
/**
 * A pool for one `reserveLogin` call. `pause` holds the transaction right before it reads `pairKey`; `inject` makes the
 * statements matching it fail with that errno (`times` times).
 */
function probe(
  opts: {
    pairKey?: string;
    pause?: Promise<void>;
    inject?: { match: RegExp; errno: number; times: number };
  } = {},
): Probe {
  const errors: Record<number, number> = {};
  let arrived!: () => void;
  const reached = new Promise<void>((resolve) => (arrived = resolve));
  let injected = 0;
  const run = async (target: unknown, fn: Function, sql: string, params: unknown) => {
    if (opts.pairKey && sql === PAIR_SELECT && (params as string[])[0] === opts.pairKey) {
      arrived();
      await opts.pause;
    }
    if (opts.inject && opts.inject.match.test(sql) && injected < opts.inject.times) {
      injected++;
      errors[opts.inject.errno] = (errors[opts.inject.errno] ?? 0) + 1;
      throw Object.assign(new Error(`errno ${opts.inject.errno} inyectado`), {
        errno: opts.inject.errno,
      });
    }
    try {
      return await fn.call(target, sql, params);
    } catch (e) {
      const n = (e as { errno?: number }).errno ?? 0;
      errors[n] = (errors[n] ?? 0) + 1;
      throw e;
    }
  };
  const conn = (c: PoolConnection) =>
    new Proxy(c, {
      get(target, prop) {
        const v = Reflect.get(target, prop, target);
        if (prop === 'query')
          return (sql: string, params: unknown) => run(target, v as Function, sql, params);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
  const pool = new Proxy(limiter, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target);
      if (prop === 'getConnection') return async () => conn(await (v as Function).call(target));
      if (prop === 'query')
        return (sql: string, params: unknown) => run(target, v as Function, sql, params);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as Pool;
  return { pool, errors, reached };
}
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const counters = async (ip: string, email: string) => {
  const keys = await loginKeys(t.db, ip, email);
  const rows: { clave: string; intentos: number }[] = await t.db.query(
    'SELECT clave, intentos FROM limite_acceso WHERE clave IN (?)',
    [keys.map((k) => k.key)],
  );
  return Object.fromEntries(
    keys.map((k) => [k.scope, rows.find((r) => r.clave === k.key)?.intentos]),
  );
};
const deadlocks = (...probes: Probe[]) => probes.reduce((n, p) => n + (p.errors[1213] ?? 0), 0);
const IP = '198.51.100.40';
const EMAIL = 'marta@example.com';

// ------------------------------------------------------------------ the audit's interleaving

test('lock order: the T1/T2/T3 interleaving of the audit no longer deadlocks', async () => {
  const [, pair] = await loginKeys(t.db, IP, EMAIL);
  const go2 = deferred();
  const go1 = deferred();
  const t2 = probe({ pairKey: pair!.key, pause: go2.promise });
  const t1 = probe({ pairKey: pair!.key, pause: go1.promise });
  const t3 = probe();
  // T2 finds no IP row and stops right before reading the account+IP row. Before the fix it held nothing there, so T3
  // could commit both rows and T1 lock the IP row; T2 then locked the pair and waited on T1 for the IP: a deadlock.
  const r2 = reserveLogin(t2.pool, IP, EMAIL);
  await t2.reached;
  // T3, a first attempt of the same pair. Before the fix it committed both rows right away; now it waits on the IP row
  // T2 already holds. T1 starts once T3 is done (or after 300 ms if T3 is queued), so it finds the IP row committed and
  // locks it, then stops before the pair — the exact order of the deadlock the audit captured.
  const r3 = reserveLogin(t3.pool, IP, EMAIL);
  await Promise.race([r3, sleep(300)]);
  const r1 = reserveLogin(t1.pool, IP, EMAIL);
  await Promise.race([t1.reached, sleep(300)]);
  go2.resolve();
  await sleep(200);
  go1.resolve();
  const results = await Promise.all([r1, r2, r3]);
  assert.ok(
    results.every((r) => r !== null),
    'all three reserved',
  );
  assert.equal(deadlocks(t1, t2, t3), 0);
  assert.equal((t1.errors[1205] ?? 0) + (t2.errors[1205] ?? 0) + (t3.errors[1205] ?? 0), 0);
  assert.deepEqual(await counters(IP, EMAIL), { IP: 3, CUENTA_IP: 3 });
});

test('lock order: a request that misses the IP row holds it (inserted) before it reads the account+IP row', async () => {
  const [ipKey, pair] = await loginKeys(t.db, IP, EMAIL);
  const go = deferred();
  const p = probe({ pairKey: pair!.key, pause: go.promise });
  const pending = reserveLogin(p.pool, IP, EMAIL);
  await p.reached;
  // the IP row exists (uncommitted, locked by that transaction): another request waits on it, not on the pair
  const other = probe();
  let otherDone = false;
  const second = reserveLogin(other.pool, IP, 'coach@example.com').then(
    (r) => ((otherDone = true), r),
  );
  await sleep(300);
  assert.equal(otherDone, false, 'the second request queues on the IP row');
  go.resolve();
  assert.ok(await pending);
  assert.ok(await second);
  assert.equal(deadlocks(p, other), 0);
  const [row] = await t.db.query('SELECT intentos FROM limite_acceso WHERE clave = ?', [
    ipKey!.key,
  ]);
  assert.equal(row.intentos, 2);
});

// ------------------------------------------------------------------ the purged-IP state

test('lock order: account+IP row present, IP row purged — a burst of 50 reserves exactly the allowance, no deadlock', async () => {
  const [ipKey, pair] = await loginKeys(t.db, IP, EMAIL);
  await t.db.query(
    "INSERT INTO limite_acceso (clave, ambito, intentos, ventana_inicio) VALUES (?, 'CUENTA_IP', 2, ?)",
    [pair!.key, new Date().toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' })],
  );
  const probes = Array.from({ length: 50 }, () => probe());
  const results = await Promise.all(probes.map((p) => reserveLogin(p.pool, IP, EMAIL)));
  assert.equal(results.filter(Boolean).length, 3, '2 used + 3 = the 5 of the pair');
  assert.equal(deadlocks(...probes), 0);
  assert.deepEqual(await counters(IP, EMAIL), { IP: 3, CUENTA_IP: 5 });
  assert.ok(ipKey);
});

test('M-1: a refusal while the IP row is missing commits nothing — not even the IP row it had to insert', async () => {
  const [ipKey, pair] = await loginKeys(t.db, IP, EMAIL);
  await t.db.query(
    "INSERT INTO limite_acceso (clave, ambito, intentos, ventana_inicio) VALUES (?, 'CUENTA_IP', 5, ?)",
    [pair!.key, new Date().toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' })],
  );
  const result = await t.unchanged(() => reserveLogin(probe().pool, IP, EMAIL), []);
  assert.equal(result, null);
  assert.equal(
    await t.count('SELECT COUNT(*) AS n FROM limite_acceso WHERE clave = ?', [ipKey!.key]),
    0,
  );
});

// ------------------------------------------------------------------ retries

test('retries: a duplicate on the IP insert, a deadlock or a lock timeout are retried; the reservation is still exact', async () => {
  for (const [match, errno] of [
    [/INSERT INTO limite_acceso .*'IP', 0/, 1062],
    [/FOR UPDATE/, 1213],
    [/FOR UPDATE/, 1205],
  ] as const) {
    await t.db.query('DELETE FROM limite_acceso');
    const p = probe({ inject: { match, errno, times: 2 } });
    assert.ok(await reserveLogin(p.pool, IP, EMAIL), `${errno} retried`);
    assert.equal(p.errors[errno], 2);
    assert.deepEqual(await counters(IP, EMAIL), { IP: 1, CUENTA_IP: 1 }, 'counted once');
  }
});

test('retries: any other duplicate key (on the account+IP insert) is an error, not retried', async () => {
  const p = probe({ inject: { match: /'CUENTA_IP', 1/, errno: 1062, times: 1 } });
  await assert.rejects(reserveLogin(p.pool, IP, EMAIL), /inyectado/);
  assert.equal(p.errors[1062], 1, 'one attempt only');
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM limite_acceso'), 0, 'rolled back');
});

test('retries: a deadlock that never clears gives up within the budget (≤ 6 attempts, ~1.5 s) — the login fails closed', async () => {
  const p = probe({ inject: { match: /FOR UPDATE/, errno: 1213, times: 100 } });
  const started = performance.now();
  await assert.rejects(reserveLogin(p.pool, IP, EMAIL));
  const ms = performance.now() - started;
  assert.ok(p.errors[1213]! <= 6, `${p.errors[1213]} attempts`);
  assert.ok(ms < 2000, `${Math.round(ms)} ms`);
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM limite_acceso'), 0);
});

// ------------------------------------------------------------------ bursts over HTTP (one and two instances)

test('bursts of 50: one IP with many accounts, one account from many IPs, one pair, two instances — no 503, exact counters', async () => {
  const listen = async () => {
    // These bursts measure S-01 alone: an Argon2id gate with room for all of them (S-02's default, 3 at once and 32
    // waiting, answers 503 to the rest — api/s01-s02.test.ts covers that combination).
    const limiterDb = createLimiterPool({ ...process.env, DB_NAME: t.name });
    const s = createApp(t.db, {
      secureCookie: false,
      trustedProxies: ['127.0.0.1'],
      limiterDb,
      argon2: argon2Gate({ limit: 64, waitMs: 10_000 }),
    }).listen(0);
    await new Promise((resolve) => s.once('listening', resolve));
    return { s, limiterDb, base: `http://127.0.0.1:${(s.address() as AddressInfo).port}` };
  };
  const a = await listen();
  const b = await listen();
  const login = (base: string, email: string, client: string) =>
    fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': client },
      body: JSON.stringify({ email, password: 'mala-1' }),
    }).then((r) => r.status);
  const accounts = ['admin', 'secretaria', 'coach', 'tutor', 'marta'].map(
    (u) => `${u}@example.com`,
  );
  const scenarios: [string, (i: number) => Promise<number>, Record<number, number>][] = [
    [
      'one IP, 5 accounts',
      (i) => login(a.base, accounts[i % 5]!, '203.0.113.1'),
      { 401: 25, 429: 25 },
    ],
    [
      'one account, 10 IPs',
      (i) => login(a.base, 'coach@example.com', `203.0.113.${10 + (i % 10)}`),
      { 401: 50 },
    ],
    ['one pair', () => login(a.base, 'tutor@example.com', '203.0.113.30'), { 401: 5, 429: 45 }],
    [
      'two instances, one IP',
      (i) => login(i % 2 ? b.base : a.base, accounts[i % 5]!, '203.0.113.40'),
      { 401: 25, 429: 25 },
    ],
  ];
  try {
    for (const [name, send, expected] of scenarios) {
      await t.db.query('DELETE FROM limite_acceso');
      forgetRefusals();
      const before = passwordVerifications();
      const statuses = await Promise.all(Array.from({ length: 50 }, (_, i) => send(i)));
      const got = statuses.reduce<Record<number, number>>(
        (n, s) => ({ ...n, [s]: (n[s] ?? 0) + 1 }),
        {},
      );
      assert.deepEqual(got, expected, name);
      assert.equal(passwordVerifications() - before, expected[401], `${name}: Argon2id = 401s`);
      assert.equal(
        await t.count(
          "SELECT COUNT(*) AS n FROM limite_acceso WHERE (ambito = 'CUENTA_IP' AND intentos > 5) OR (ambito = 'IP' AND intentos > 50)",
        ),
        0,
        name,
      );
    }
  } finally {
    a.s.close();
    b.s.close();
    await a.limiterDb.end();
    await b.limiterDb.end();
  }
});

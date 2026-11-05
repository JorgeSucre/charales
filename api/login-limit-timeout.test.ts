/**
 * S-01 · the limiter pool's lock wait (api/server.ts, createLimiterPool): its sessions wait at most
 * LIMITER_LOCK_WAIT_S (2 s) for a counter row another transaction holds, then MariaDB answers 1205; every other session
 * keeps the server's innodb_lock_wait_timeout. Times are measured with performance.now (Date is mocked here).
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Pool, PoolConnection } from 'mariadb';
import { passwordVerifications } from './auth.ts';
import { forgetRefusals, loginKeys, reserveLogin } from './login-limit.ts';
import { LIMITER_LOCK_WAIT_S, createApp, createLimiterPool, createPool } from './server.ts';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
let limiter: Pool;
let serverWide: number;
before(async () => {
  t = await openTestDb('ef_s01lwt');
  limiter = createLimiterPool({ ...process.env, DB_NAME: t.name });
  serverWide = await lockWait(t.db, 'GLOBAL');
});
after(async () => {
  await limiter?.end();
  await t?.close();
});
beforeEach(async () => {
  forgetRefusals();
  await t.db.query('DELETE FROM limite_acceso');
});

async function lockWait(db: Pool | PoolConnection, scope: 'SESSION' | 'GLOBAL' = 'SESSION') {
  const [row] = await db.query(`SELECT @@${scope}.innodb_lock_wait_timeout AS s`);
  return Number(row.s);
}
const IP = '198.51.100.70';
const EMAIL = 'marta@example.com';
const LOCK = 'SELECT intentos FROM limite_acceso WHERE clave = ? FOR UPDATE';
/** The IP row of IP/EMAIL, created by one admitted attempt. */
async function ipRow() {
  assert.ok(await reserveLogin(limiter, IP, EMAIL));
  const [ip] = await loginKeys(t.db, IP, EMAIL);
  return ip!.key;
}
/** Locks `key` from the MAIN pool, as another request would, until the returned function is called. */
async function hold(key: string) {
  const c = await t.db.getConnection();
  await c.beginTransaction();
  await c.query(LOCK, [key]);
  return async () => {
    await c.rollback();
    await c.release();
  };
}
const counted = async (key: string) =>
  (await t.db.query('SELECT intentos FROM limite_acceso WHERE clave = ?', [key]))[0]?.intentos;

test(`lock wait: every limiter connection has ${LIMITER_LOCK_WAIT_S} s; the main pool and the server keep theirs`, async () => {
  assert.notEqual(
    serverWide,
    LIMITER_LOCK_WAIT_S,
    'the server value differs, or this test proves nothing',
  );
  const [a, b] = await Promise.all([limiter.getConnection(), limiter.getConnection()]);
  try {
    assert.notEqual(a.threadId, b.threadId, 'two sessions of the limiter pool');
    assert.equal(await lockWait(a), LIMITER_LOCK_WAIT_S);
    assert.equal(await lockWait(b), LIMITER_LOCK_WAIT_S);
  } finally {
    await a.release();
    await b.release();
  }
  assert.equal(await lockWait(t.db), serverWide, 'main pool: the server value');
  const other = createPool({ ...process.env, DB_NAME: t.name }, { connectionLimit: 1 });
  try {
    assert.equal(await lockWait(other), serverWide, 'a new general pool: the server value');
  } finally {
    await other.end();
  }
  assert.equal(await lockWait(t.db, 'GLOBAL'), serverWide, 'the global value is untouched');
});

test('lock wait: a connection the pool opens later gets it too, and it survives a transaction (no reset on release)', async () => {
  const first = await limiter.getConnection();
  const id = first.threadId;
  await first.destroy(); // gone: the pool must open a new session
  const fresh = await limiter.getConnection();
  try {
    assert.notEqual(fresh.threadId, id, 'a new session');
    assert.equal(await lockWait(fresh), LIMITER_LOCK_WAIT_S);
  } finally {
    await fresh.release();
  }
  assert.ok(await reserveLogin(limiter, IP, EMAIL)); // READ COMMITTED transactions on the pool's sessions
  const [a, b] = await Promise.all([limiter.getConnection(), limiter.getConnection()]);
  try {
    assert.equal(await lockWait(a), LIMITER_LOCK_WAIT_S);
    assert.equal(await lockWait(b), LIMITER_LOCK_WAIT_S);
  } finally {
    await a.release();
    await b.release();
  }
});

test(`lock wait: a row held longer than ${LIMITER_LOCK_WAIT_S} s → 1205 after ~${LIMITER_LOCK_WAIT_S} s on the limiter pool`, async () => {
  const key = await ipRow();
  const release = await hold(key);
  const c = await limiter.getConnection();
  try {
    await c.beginTransaction();
    const started = performance.now();
    await assert.rejects(c.query(LOCK, [key]), { errno: 1205 });
    const ms = performance.now() - started;
    console.log(`1205 tras ${Math.round(ms)} ms`);
    assert.ok(
      ms >= LIMITER_LOCK_WAIT_S * 1000 - 100 && ms < LIMITER_LOCK_WAIT_S * 1000 + 1000,
      `${ms} ms`,
    );
    await c.rollback();
  } finally {
    await c.release();
    await release();
  }
});

test('reservation: held past the lock wait it fails once, without a retry (the 1.5 s budget is spent) — the login 503s, untouched', async () => {
  const key = await ipRow();
  const release = await hold(key);
  try {
    let started = performance.now();
    await assert.rejects(reserveLogin(limiter, IP, EMAIL), { errno: 1205 });
    let ms = performance.now() - started;
    console.log(`reserveLogin: 1205 tras ${Math.round(ms)} ms`);
    // one wait of 2 s; a retry would start a second one (the budget only lets a retry START before 1.5 s)
    assert.ok(ms < 2 * LIMITER_LOCK_WAIT_S * 1000 - 500, `${ms} ms: no second lock wait`);
    // the same over HTTP: 503, no Argon2id, and the counters as they were
    const server: Server = createApp(t.db, {
      secureCookie: false,
      trustedProxies: ['127.0.0.1'], // the request comes from IP, whose row is held
      limiterDb: limiter,
    }).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const verified = passwordVerifications();
      started = performance.now();
      const res = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/auth/login`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': IP },
          body: JSON.stringify({ email: EMAIL, password: 'demo1234' }),
        },
      );
      ms = performance.now() - started;
      console.log(`login: ${res.status} tras ${Math.round(ms)} ms`);
      assert.equal(res.status, 503);
      assert.equal(passwordVerifications() - verified, 0, 'never verified without a reservation');
    } finally {
      server.close();
    }
  } finally {
    await release();
  }
  assert.equal(await counted(key), 1, 'only the first, admitted attempt');
});

test(`reservation: a lock held for less than ${LIMITER_LOCK_WAIT_S} s is waited for — no error, no 503`, async () => {
  const key = await ipRow();
  const release = await hold(key);
  setTimeout(() => void release(), 1000);
  const started = performance.now();
  assert.ok(await reserveLogin(limiter, IP, EMAIL), 'reserved after the wait');
  const ms = performance.now() - started;
  console.log(`reserva tras esperar ${Math.round(ms)} ms`);
  assert.ok(ms >= 900, `${ms} ms: it did wait`);
  assert.equal(await counted(key), 2);
});

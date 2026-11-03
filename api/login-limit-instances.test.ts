/**
 * S-01 · the login limits hold across API instances and survive a restart: two real `api/server.ts` processes on one
 * temporary database (real clock, like production), requests split between them, then one is restarted. Argon2id
 * counts are checked in-process in api/login-limit.test.ts; here a 401 is a verified attempt and a 429 a refused one.
 * Also on the real clock: the limiter's own pool (M-1), because the MariaDB driver measures its acquire timeout with
 * Date, which the fixed-clock harness freezes.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Server } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { passwordVerifications } from './auth.ts';
import { LOGIN_LIMITS, loginKeys } from './login-limit.ts';
import { createApp, createPool } from './server.ts';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
const running = new Set<ChildProcess>();
before(async () => {
  t = await openTestDb('ef_s01i', { realClock: true });
});
after(async () => {
  for (const p of running) p.kill();
  await t?.close();
});

async function freePort(): Promise<number> {
  const s = createServer().listen(0);
  await new Promise((resolve) => s.once('listening', resolve));
  const { port } = s.address() as { port: number };
  await new Promise((resolve) => s.close(resolve));
  return port;
}

/** `node api/server.ts` on the test database, as a separate process; resolves with its base URL once listening. */
async function instance(): Promise<{ base: string; stop: () => Promise<void> }> {
  const port = await freePort();
  const child = spawn(process.execPath, ['api/server.ts'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, DB_NAME: t.name, PORT: String(port), TRUSTED_PROXIES: '' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  running.add(child);
  await new Promise<void>((resolve, reject) => {
    child.stdout!.on('data', (d: Buffer) => d.toString().includes('Charales API en') && resolve());
    child.once('exit', (code) => reject(new Error(`api/server.ts terminó (${code})`)));
  });
  return {
    base: `http://127.0.0.1:${port}`,
    stop: async () => {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
      running.delete(child);
    },
  };
}

const login = (base: string, password: string) =>
  fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'marta@example.com', password }),
  });

test('S-01: two instances sharing MariaDB enforce one limit, and a restart keeps it', async () => {
  const a = await instance();
  const b = await instance();
  // 25 simultaneous wrong passwords, alternating between the two processes
  const responses = await Promise.all(
    Array.from({ length: 25 }, (_, i) => login(i % 2 ? b.base : a.base, 'mala-1')),
  );
  const count = (s: number) => responses.filter((r) => r.status === s).length;
  assert.equal(
    count(401),
    LOGIN_LIMITS.CUENTA_IP,
    'only the allowance was verified, across both instances',
  );
  assert.equal(count(429), 25 - LOGIN_LIMITS.CUENTA_IP);
  // the counters live in MariaDB, not in either process
  const [pair] = (await loginKeys(t.db, '127.0.0.1', 'marta@example.com')).filter(
    (k) => k.scope === 'CUENTA_IP',
  );
  assert.equal(
    await t.count('SELECT intentos AS n FROM limite_acceso WHERE clave = ?', [pair!.key]),
    LOGIN_LIMITS.CUENTA_IP,
  );
  // restart: stop both processes and start a new one — still refused, even with the right password
  await a.stop();
  await b.stop();
  const c = await instance();
  assert.equal((await login(c.base, 'demo1234')).status, 429);
  await c.stop();
});

async function inProcess(
  limiterDb: ReturnType<typeof createPool>,
): Promise<{ base: string; server: Server }> {
  const server = createApp(t.db, { secureCookie: false, limiterDb }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}
const loginAt = (base: string, email: string, password: string) =>
  fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

test('M-1: with its own pool the limiter cannot take the rest of the API down; exhausted, it fails closed (503)', async () => {
  const limiterDb = createPool(
    { ...process.env, DB_NAME: t.name },
    { connectionLimit: 1, acquireTimeout: 500 },
  );
  const { base, server } = await inProcess(limiterDb);
  const cookie = await t.login('admin@example.com');
  const held = await limiterDb.getConnection(); // the limiter's only connection is busy
  try {
    const before = passwordVerifications();
    const blocked = await loginAt(base, 'coach@example.com', 'demo1234');
    assert.equal(blocked.status, 503);
    assert.equal(passwordVerifications() - before, 0, 'never verified without a reservation');
    // meanwhile the rest of the API, on the main pool, answers normally
    const res = await fetch(`${base}/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ service: 'CategoryService', method: 'list', args: [{}] }),
    });
    assert.equal(res.status, 200);
  } finally {
    await held.release();
  }
  assert.equal((await loginAt(base, 'coach@example.com', 'demo1234')).status, 200);
  server.close();
  await limiterDb.end();
});

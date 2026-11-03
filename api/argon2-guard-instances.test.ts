/**
 * S-02 · Argon2id turns across real API processes (real clock): several `api/server.ts` on one temporary database share
 * ARGON2_MAX_CONCURRENT, a third instance doesn't add capacity, a turn of a dead process expires, a restart of every
 * instance starts clean, and an exhausted limiter pool refuses (503) without Argon2id. Real clock because the MariaDB
 * driver measures its acquire timeout with Date, which the fixed-clock harness freezes.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { argon2Stats, localDateTime, sha256 } from './auth.ts';
import { createApp, createPool } from './server.ts';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
const running = new Set<ChildProcess>();
before(async () => {
  t = await openTestDb('ef_s02i', { realClock: true });
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

/** `node api/server.ts` on the test database with the given Argon2id settings, as a separate process. */
async function instance(limit: number, waitMs: number) {
  const port = await freePort();
  const child = spawn(process.execPath, ['api/server.ts'], {
    cwd: new URL('../', import.meta.url),
    env: {
      ...process.env,
      DB_NAME: t.name,
      PORT: String(port),
      TRUSTED_PROXIES: '',
      ARGON2_MAX_CONCURRENT: String(limit),
      ARGON2_WAIT_MS: String(waitMs),
    },
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
const login = (base: string, email: string, password = 'demo1234') =>
  fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
const turns = () => t.count('SELECT COUNT(*) AS n FROM turnos_argon2');
const ACCOUNTS = ['admin', 'secretaria', 'coach', 'tutor', 'marta'].map((u) => `${u}@example.com`);

test('S-02: two instances share one limit — never more than 1 turn at once in MariaDB, a third adds no capacity', async () => {
  const a = await instance(1, 5000);
  const b = await instance(1, 5000);
  // sample the live turns while 10 simultaneous logins are split between the two processes
  let most = 0;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      most = Math.max(most, await turns());
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  })();
  const responses = await Promise.all(
    ACCOUNTS.flatMap((email) => [login(a.base, email), login(b.base, email)]),
  );
  sampling = false;
  await sampler;
  assert.deepEqual(
    responses.map((r) => r.status),
    Array(10).fill(200),
  );
  assert.equal(most, 1, 'the limit is for the deployment, not per process');
  assert.equal(await turns(), 0);
  // all turns taken (as by another instance): every instance, a new third one too, answers 503 at once
  await t.db.query('INSERT INTO turnos_argon2 (vence_en) VALUES (NOW(3) + INTERVAL 600 SECOND)');
  const c = await instance(1, 0);
  const a0 = await instance(1, 0);
  for (const base of [a0.base, c.base])
    assert.equal((await login(base, 'marta@example.com')).status, 503);
  await t.db.query('DELETE FROM turnos_argon2');
  assert.equal((await login(c.base, 'marta@example.com')).status, 200);
  for (const i of [a, b, c, a0]) await i.stop();
});

test('S-02: a turn of a process that died expires on its own, and a restart of every instance starts clean', async () => {
  const a = await instance(1, 0);
  // a turn nobody will free, that expires in 1 s (as a crashed process would leave it; the API uses 30 s)
  await t.db.query('INSERT INTO turnos_argon2 (vence_en) VALUES (NOW(3) + INTERVAL 1 SECOND)');
  assert.equal((await login(a.base, 'coach@example.com')).status, 503);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal((await login(a.base, 'coach@example.com')).status, 200);
  assert.equal(await turns(), 0, 'the expired turn was removed when the next one was taken');
  await a.stop();
  const fresh = await instance(1, 0); // every instance restarted
  assert.equal((await login(fresh.base, 'coach@example.com')).status, 200);
  await fresh.stop();
});

test('S-02: with the limiter pool exhausted, a recovery is refused (503) without Argon2id and its token stays usable', async () => {
  const limiterDb = createPool(
    { ...process.env, DB_NAME: t.name },
    { connectionLimit: 1, acquireTimeout: 500 },
  );
  const server: Server = createApp(t.db, {
    secureCookie: false,
    limiterDb,
    argon2: { limit: 3, waitMs: 0 },
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const token = crypto.randomBytes(32).toString('base64url');
  const [{ id }]: { id: number }[] = await t.db.query(
    "SELECT id FROM usuarios WHERE email = 'tutor@example.com'",
  );
  await t.db.query(
    `INSERT INTO tokens_recuperacion (usuario_id, finalidad, token_hash, creado_en, expira_en)
     VALUES (?, 'RECUPERACION', ?, ?, ?)`,
    [id, sha256(token), localDateTime(), localDateTime(Date.now() + 3_600_000)],
  );
  const confirm = () =>
    fetch(`${base}/auth/password-reset/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: 'Nueva2026segura' }),
    });
  const held = await limiterDb.getConnection();
  try {
    const before = argon2Stats().runs;
    const res = await confirm();
    assert.equal(res.status, 503);
    assert.equal(argon2Stats().runs - before, 0);
  } finally {
    await held.release();
  }
  assert.equal(
    await t.count(
      'SELECT COUNT(*) AS n FROM tokens_recuperacion WHERE token_hash = ? AND usado_en IS NULL',
      [sha256(token)],
    ),
    1,
  );
  assert.equal((await confirm()).status, 204, 'usable once the pool is back');
  server.close();
  await limiterDb.end();
});

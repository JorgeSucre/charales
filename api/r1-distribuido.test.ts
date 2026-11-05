/**
 * R-1 (audit Fase 5, F5-03): guessing one account from many addresses. Limits are counted per network (an IPv4 address
 * or the /64 of an IPv6 one) and, for networks the account has not logged in from, per account across all of them.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { argon2Gate } from './argon2-guard.ts';
import { argon2Stats } from './auth.ts';
import { LOGIN_LIMITS, LOGIN_WINDOW_MS, forgetRefusals } from './login-limit.ts';
import { createApp } from './server.ts';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
let server: Server;
let base: string;
const WRONG = 'incorrecta-1';
const OWNER = 'marta@example.com';
const RIGHT = 'demo1234';

before(async () => {
  t = await openTestDb('ef_r1');
  server = createApp(t.db, {
    secureCookie: false,
    trustedProxies: ['127.0.0.1'],
    mailer: (to, subject, text) => void t.mail.push({ to, subject, text }),
    argon2: argon2Gate({ limit: 64, waitMs: 10_000 }),
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server?.close();
  await t?.close();
});
beforeEach(async () => {
  forgetRefusals();
  await t.db.query('DELETE FROM limite_acceso');
  await t.db.query('DELETE FROM origen_conocido');
});

const login = (email: string, password: string, client: string) =>
  fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': client },
    body: JSON.stringify({ email, password }),
  }).then(async (r) => {
    await r.arrayBuffer();
    return r.status;
  });
const tally = (statuses: number[]) =>
  statuses.reduce<Record<number, number>>((m, s) => ((m[s] = (m[s] ?? 0) + 1), m), {});
async function verified<T>(work: () => Promise<T>): Promise<[T, number]> {
  const runs = argon2Stats().runs;
  const result = await work();
  return [result, argon2Stats().runs - runs];
}
async function sequence(n: number, client: (i: number) => string, email = OWNER) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(await login(email, WRONG, client(i)));
  return out;
}

test('R-1: 150 wrong passwords, one account, 30 addresses of one /64 → the /64 is one client: 5 guesses', async () => {
  const [statuses, runs] = await verified(() =>
    sequence(150, (i) => `2001:db8:1:2::${((i % 30) + 1).toString(16)}`),
  );
  assert.deepEqual(tally(statuses), { 401: 5, 429: 145 });
  assert.equal(statuses.indexOf(429), 5);
  assert.equal(runs, 5, 'Argon2id ran only for the 5 admitted');
});

test('R-1: 150 wrong passwords from 150 different /64 → the account takes 20 and no more', async () => {
  const [statuses, runs] = await verified(() =>
    sequence(150, (i) => `2001:db8:${(i + 1).toString(16)}::1`),
  );
  assert.deepEqual(tally(statuses), { 401: LOGIN_LIMITS.CUENTA, 429: 150 - LOGIN_LIMITS.CUENTA });
  assert.equal(runs, LOGIN_LIMITS.CUENTA);
});

test('R-1: IPv4 too — 60 addresses, one account: 20 guesses', async () => {
  const statuses = await sequence(60, (i) => `198.51.100.${i + 1}`);
  assert.deepEqual(tally(statuses), { 401: 20, 429: 40 });
});

test('R-1: under concurrency the account-wide limit is exact — 60 at once from 60 networks', async () => {
  const [statuses, runs] = await verified(() =>
    Promise.all(
      Array.from({ length: 60 }, (_, i) => login(OWNER, WRONG, `2001:db8:c:${i + 1}::1`)),
    ),
  );
  assert.deepEqual(tally(statuses), { 401: 20, 429: 40 });
  assert.equal(runs, 20);
});

test('one client, whatever its spelling: IPv4-mapped forms and IPv6 text variants share their limits', async () => {
  const v4 = ['203.0.113.7', '::ffff:203.0.113.7', '::ffff:cb00:7107'];
  assert.deepEqual(tally(await sequence(9, (i) => v4[i % 3]!)), { 401: 5, 429: 4 });
  forgetRefusals();
  await t.db.query('DELETE FROM limite_acceso');
  const v6 = ['2001:db8:7::1', '2001:0db8:0007:0000::1', '2001:DB8:7::2'];
  assert.deepEqual(tally(await sequence(9, (i) => v6[i % 3]!)), { 401: 5, 429: 4 });
});

test('R-1: different networks are different clients: a neighbouring /64 keeps its own allowance', async () => {
  assert.deepEqual(tally(await sequence(6, () => '2001:db8:a:1::1')), { 401: 5, 429: 1 });
  assert.equal(await login(OWNER, WRONG, '2001:db8:a:2::1'), 401);
});

test('no unjustified lockout: the owner on a known network logs in during the attack, unaffected', async () => {
  assert.equal(await login(OWNER, RIGHT, '203.0.113.50'), 200);
  await sequence(60, (i) => `2001:db8:e:${i + 1}::1`);
  const [status, runs] = await verified(() => login(OWNER, RIGHT, '203.0.113.50'));
  assert.equal(status, 200);
  assert.equal(runs, 1);
});

test('the right password from a NEW network during an attack is refused unverified: the limit is no oracle', async () => {
  await sequence(20, (i) => `2001:db8:f:${i + 1}::1`);
  const [status, runs] = await verified(() => login(OWNER, RIGHT, '203.0.113.60'));
  assert.equal(status, 429);
  assert.equal(runs, 0);
});

test('a recovery proves the account: its network is known from then on, so the attack can not stop that person', async () => {
  await sequence(20, (i) => `2001:db8:f:${i + 1}::1`);
  const client = '203.0.113.61';
  assert.equal(await login(OWNER, RIGHT, client), 429);
  const asked = await fetch(`${base}/auth/password-reset/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': client },
    body: JSON.stringify({ email: OWNER }),
  });
  assert.equal(asked.status, 204);
  const token = /token=([\w-]+)/.exec(t.mail.at(-1)!.text)![1];
  const done = await fetch(`${base}/auth/password-reset/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': client },
    body: JSON.stringify({ token, newPassword: 'Recuperada123' }),
  });
  assert.equal(done.status, 204);
  assert.equal(await login(OWNER, 'Recuperada123', client), 200);
  // Leave the seed as the other tests expect it.
  const restored = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': client },
    body: JSON.stringify({ email: OWNER, password: 'Recuperada123' }),
  });
  const cookie = restored.headers.get('set-cookie')!.split(';')[0]!;
  const back = await fetch(`${base}/auth/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ currentPassword: 'Recuperada123', newPassword: 'demo1234' }),
  });
  assert.equal(back.status, 204);
});

test('a guess from a known network is still limited (5), and does not use the account-wide counter', async () => {
  assert.equal(await login(OWNER, RIGHT, '203.0.113.70'), 200);
  assert.deepEqual(tally(await sequence(7, () => '203.0.113.70')), { 401: 5, 429: 2 });
  const rows = await t.db.query("SELECT intentos FROM limite_acceso WHERE ambito = 'CUENTA'");
  assert.deepEqual(
    rows.map((r: { intentos: number }) => Number(r.intentos)),
    [0],
    'only the first, unknown-network login touched it, and it gave its attempt back',
  );
});

test('the owner logging in gives back one attempt, it does not reset an attack from elsewhere', async () => {
  await sequence(15, (i) => `2001:db8:d:${i + 1}::1`);
  assert.equal(await login(OWNER, RIGHT, '203.0.113.71'), 200);
  const [{ intentos }] = await t.db.query(
    "SELECT intentos FROM limite_acceso WHERE ambito = 'CUENTA'",
  );
  assert.equal(Number(intentos), 15);
});

test('no enumeration: an unknown e-mail goes through the same limits with the same answers', async () => {
  const existing = await sequence(25, (i) => `2001:db8:1a:${i + 1}::1`);
  forgetRefusals();
  await t.db.query('DELETE FROM limite_acceso');
  const unknown = await sequence(25, (i) => `2001:db8:1a:${i + 1}::1`, 'nadie.aqui@example.com');
  assert.deepEqual(unknown, existing);
});

test('the account-wide window expires, and a known network is forgotten after 90 days without use', async () => {
  await sequence(20, (i) => `2001:db8:b:${i + 1}::1`);
  assert.equal(await login(OWNER, RIGHT, '203.0.113.80'), 429);
  await t.advance(LOGIN_WINDOW_MS + 11_000);
  forgetRefusals();
  assert.equal(await login(OWNER, RIGHT, '203.0.113.80'), 200, 'known from now on');
  await t.advance(91 * 24 * 3_600_000);
  forgetRefusals();
  await sequence(20, (i) => `2001:db8:b:${i + 1}::1`);
  assert.equal(await login(OWNER, RIGHT, '203.0.113.80'), 429, 'no longer known');
});

test('the tables hold no e-mail or IP: only SHA-256 keys', async () => {
  await login(OWNER, RIGHT, '203.0.113.90');
  for (const table of ['limite_acceso', 'origen_conocido']) {
    const rows: { clave: string }[] = await t.db.query(`SELECT clave FROM ${table}`);
    assert.ok(rows.length);
    for (const r of rows) assert.match(r.clave, /^[0-9a-f]{64}$/);
  }
});

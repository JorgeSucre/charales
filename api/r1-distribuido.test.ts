/**
 * R-1 (audit Fase 5, F5-03): guessing one account from many addresses. Limits count per network (an IPv4 address or the /64
 * of an IPv6 one) and, across networks, per account with a budget that refills slowly. The owner's way in: api/dispositivo.test.ts.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { passwordVerifications } from './auth.ts';
import { ACCOUNT_REFILL_MS, LOGIN_LIMITS, forgetRefusals } from './login-limit.ts';
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
  await t.db.query('DELETE FROM dispositivo_confiable');
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
  const runs = passwordVerifications();
  const result = await work();
  return [result, passwordVerifications() - runs];
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
  assert.equal(runs, 5, 'hash verification ran only for the 5 admitted');
});

test('R-1: 150 wrong passwords from 150 different /64 → the account takes its budget and no more', async () => {
  const [statuses, runs] = await verified(() =>
    sequence(150, (i) => `2001:db8:${(i + 1).toString(16)}::1`),
  );
  assert.deepEqual(tally(statuses), { 401: LOGIN_LIMITS.CUENTA, 429: 150 - LOGIN_LIMITS.CUENTA });
  assert.equal(runs, LOGIN_LIMITS.CUENTA);
});

test('R-1: IPv4 too — 60 addresses, one account: the same budget', async () => {
  const statuses = await sequence(60, (i) => `198.51.${i + 1}.1`);
  assert.deepEqual(tally(statuses), { 401: LOGIN_LIMITS.CUENTA, 429: 60 - LOGIN_LIMITS.CUENTA });
});

test('R-1: under concurrency the account-wide budget is exact — 60 at once from 60 networks', async () => {
  const [statuses, runs] = await verified(() =>
    Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        login(OWNER, WRONG, `2001:db8:${(i + 0xc00).toString(16)}::1`),
      ),
    ),
  );
  assert.deepEqual(tally(statuses), { 401: LOGIN_LIMITS.CUENTA, 429: 60 - LOGIN_LIMITS.CUENTA });
  assert.equal(runs, LOGIN_LIMITS.CUENTA);
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

test('the owner logging in gives back one attempt, it does not reset an attack from elsewhere', async () => {
  await sequence(8, (i) => `2001:db8:${(0xd00 + i).toString(16)}::1`);
  assert.equal(await login(OWNER, RIGHT, '203.0.113.71'), 200);
  const [{ intentos }] = await t.db.query(
    "SELECT intentos FROM limite_acceso WHERE ambito = 'CUENTA'",
  );
  assert.equal(Number(intentos), 8);
});

test('no enumeration: an unknown e-mail goes through the same limits with the same answers', async () => {
  const existing = await sequence(25, (i) => `2001:db8:1a:${i + 1}::1`);
  forgetRefusals();
  await t.db.query('DELETE FROM limite_acceso');
  const unknown = await sequence(25, (i) => `2001:db8:1a:${i + 1}::1`, 'nadie.aqui@example.com');
  assert.deepEqual(unknown, existing);
});

test('R-1: a whole day of attack from new networks: 58 verified guesses at most, however many addresses', async () => {
  let verified = 0;
  let prefix = 0;
  for (let step = 0; step < 96; step++) {
    const statuses = await sequence(12, () => `2001:db8:${(prefix++ & 0xffff).toString(16)}::1`);
    verified += statuses.filter((s) => s === 401).length;
    await t.advance(ACCOUNT_REFILL_MS / 2);
    forgetRefusals();
    await t.db.query(
      "DELETE FROM limite_acceso WHERE ambito <> 'CUENTA'", // only the account's budget is under test
    );
  }
  assert.ok(verified >= 48 && verified <= LOGIN_LIMITS.CUENTA + 48, `${verified} in 24 h`);
});

test('the budget recovers one attempt per interval, and never more than it holds', async () => {
  await sequence(LOGIN_LIMITS.CUENTA, (i) => `2001:db8:${(0xe00 + i).toString(16)}::1`);
  assert.equal(await login(OWNER, WRONG, '2001:db8:e1::1'), 429);
  await t.advance(ACCOUNT_REFILL_MS + 1000);
  forgetRefusals();
  assert.equal(await login(OWNER, WRONG, '2001:db8:e2::1'), 401, 'one back');
  forgetRefusals();
  assert.equal(await login(OWNER, WRONG, '2001:db8:e3::1'), 429, 'only one');
  await t.advance(LOGIN_LIMITS.CUENTA * ACCOUNT_REFILL_MS * 3);
  forgetRefusals();
  const statuses = await sequence(
    LOGIN_LIMITS.CUENTA + 2,
    (i) => `2001:db8:${(0xe40 + i).toString(16)}::1`,
  );
  assert.deepEqual(tally(statuses), { 401: LOGIN_LIMITS.CUENTA, 429: 2 });
});

test('a row of an idle account is purged once its budget is whole again, not before', async () => {
  await login(OWNER, WRONG, '2001:db8:e5::1');
  const accountRows = () =>
    t.count("SELECT COUNT(*) AS n FROM limite_acceso WHERE ambito = 'CUENTA'");
  await t.advance(LOGIN_LIMITS.CUENTA * ACCOUNT_REFILL_MS - 60_000);
  await login('otro1@example.com', WRONG, '2001:db8:e6::1');
  assert.equal(await accountRows(), 2, 'the first is still within its idle time');
  await t.advance(120_000);
  await login('otro2@example.com', WRONG, '2001:db8:e7::1');
  assert.equal(await accountRows(), 2, 'the first went, otro2 came');
});

test('the tables hold no e-mail or IP: only SHA-256 keys', async () => {
  await login(OWNER, RIGHT, '203.0.113.90');
  for (const table of ['limite_acceso', 'dispositivo_confiable']) {
    const rows: { clave: string }[] = await t.db.query(`SELECT clave FROM ${table}`);
    assert.ok(rows.length, table);
    for (const r of rows) assert.match(r.clave, /^[0-9a-f]{64}$/);
  }
});

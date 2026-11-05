/**
 * F5-07: public password recovery. Its limits live in MariaDB (shared by every process, nothing per request in memory):
 * per network and per account across networks, counted whether the account exists or not.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  CHANGE_LIMIT,
  LOGIN_WINDOW_MS,
  RESET_ACCOUNT_REFILL_MS,
  RESET_LIMITS,
  forgetRefusals,
} from './login-limit.ts';
import { recoveriesSettled } from './password.ts';
import { createApp } from './server.ts';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
const servers: Server[] = [];
let a: string;
let b: string;

async function instance(): Promise<string> {
  const s = createApp(t.db, {
    secureCookie: false,
    trustedProxies: ['127.0.0.1'],
    mailer: (to, subject, text) => void t.mail.push({ to, subject, text }),
  }).listen(0, '127.0.0.1');
  servers.push(s);
  await new Promise((resolve) => s.once('listening', resolve));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
before(async () => {
  t = await openTestDb('ef_rlim');
  a = await instance();
  b = await instance();
});
after(async () => {
  for (const s of servers) s.close();
  await t?.close();
});
beforeEach(async () => {
  forgetRefusals();
  await t.db.query('DELETE FROM limite_acceso');
  t.mail.length = 0;
});

const ask = (email: string, client: string, base = a) =>
  fetch(`${base}/auth/password-reset/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': client },
    body: JSON.stringify({ email }),
  }).then(async (r) => {
    await r.arrayBuffer();
    await recoveriesSettled(); // the work runs after the answer (S-06)
    return r.status;
  });
const tally = (s: number[]) =>
  s.reduce<Record<number, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});

test('one network: the limit holds across e-mails, and a refusal writes nothing', async () => {
  const statuses: number[] = [];
  for (let i = 0; i < RESET_LIMITS.RECUP_IP + 10; i++)
    statuses.push(await ask(`x${i}@nobody.example`, '203.0.113.1'));
  assert.deepEqual(tally(statuses), { 204: RESET_LIMITS.RECUP_IP, 429: 10 });
  const rows = await t.count('SELECT COUNT(*) AS n FROM limite_acceso');
  assert.equal(rows, RESET_LIMITS.RECUP_IP + 1, 'one network row and one per admitted e-mail');
});

test('a whole /64 is one network', async () => {
  const statuses: number[] = [];
  for (let i = 0; i < RESET_LIMITS.RECUP_IP + 5; i++)
    statuses.push(await ask(`y${i}@nobody.example`, `2001:db8:1:1::${(i + 1).toString(16)}`));
  assert.deepEqual(tally(statuses), { 204: RESET_LIMITS.RECUP_IP, 429: 5 });
});

test('one account from 30 networks gets 5 e-mails, not 30 (no mail bombing)', async () => {
  const before = await t.count('SELECT COUNT(*) AS n FROM tokens_recuperacion');
  const statuses: number[] = [];
  for (let i = 0; i < 30; i++) statuses.push(await ask('coach@example.com', `198.51.100.${i + 1}`));
  assert.deepEqual(tally(statuses), { 204: 30 }); // in silence: others can't show its owner a refusal
  assert.equal(t.mail.filter((m) => m.to === 'coach@example.com').length, 5);
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM tokens_recuperacion'), before + 5);
});

test('an unknown e-mail answers exactly like an existing one, under the same limits', async () => {
  const existing: number[] = [];
  for (let i = 0; i < 8; i++) existing.push(await ask('tutor@example.com', '192.0.2.10'));
  forgetRefusals();
  await t.db.query('DELETE FROM limite_acceso');
  const unknown: number[] = [];
  for (let i = 0; i < 8; i++) unknown.push(await ask('nadie.aqui@example.com', '192.0.2.10'));
  assert.deepEqual(unknown, existing);
});

test('under concurrency the limit is exact: 40 at once for one account → 5 e-mails', async () => {
  const statuses = await Promise.all(
    Array.from({ length: 40 }, (_, i) => ask('secretaria@example.com', `198.51.100.${i + 1}`)),
  );
  assert.deepEqual(tally(statuses), { 204: 40 });
  await recoveriesSettled();
  assert.equal(t.mail.length, 5);
});

test('two processes share the limits', async () => {
  for (let i = 0; i < 8; i++) await ask('admin@example.com', '192.0.2.20', i % 2 ? a : b);
  assert.equal(t.mail.length, 5);
});

test('the budget recovers one e-mail an hour; a row whole again is purged', async () => {
  for (let i = 0; i < 6; i++) await ask('marta@example.com', '192.0.2.30');
  assert.equal(t.mail.length, 5);
  await t.advance(RESET_ACCOUNT_REFILL_MS + 11_000);
  forgetRefusals();
  assert.equal(await ask('marta@example.com', '192.0.2.30'), 204);
  assert.equal(t.mail.length, 6);
  await t.advance(RESET_LIMITS.RECUP_CUENTA * RESET_ACCOUNT_REFILL_MS + 1000);
  await ask('tercera@nobody.example', '192.0.2.32');
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM limite_acceso'), 2);
});

test('password change: the limit of wrong current passwords is shared by every process (C1)', async () => {
  const login = await fetch(`${a}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '192.0.2.40' },
    body: JSON.stringify({ email: 'baja@example.com', password: 'demo1234' }),
  });
  const cookie =
    login.status === 200
      ? login.headers.get('set-cookie')!.split(';')[0]!
      : await t.login('secretaria@example.com');
  const change = (base: string, currentPassword: string) =>
    fetch(`${base}/auth/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ currentPassword, newPassword: 'Nueva12345' }),
    }).then(async (r) => {
      await r.arrayBuffer();
      return r.status;
    });
  const statuses: number[] = [];
  for (let i = 0; i < CHANGE_LIMIT + 2; i++) statuses.push(await change(i % 2 ? a : b, 'mala-1'));
  assert.deepEqual(tally(statuses), { 400: CHANGE_LIMIT, 429: 2 });
  await t.advance(LOGIN_WINDOW_MS + 11_000);
  // After the window a wrong one counts again, and a right one would give its attempt back.
  const parallel = await Promise.all(Array.from({ length: 12 }, () => change(a, 'mala-1')));
  assert.deepEqual(tally(parallel), { 400: CHANGE_LIMIT, 429: 12 - CHANGE_LIMIT });
});

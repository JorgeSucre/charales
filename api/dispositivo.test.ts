/**
 * The legitimate owner under attack: a browser that already logged in is not subject to the shared limits, with limits of
 * its own, so it is neither a way past them for an attacker nor a way to guess passwords.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { argon2Gate } from './argon2-guard.ts';
import { argon2Stats } from './auth.ts';
import { DEVICE_DAYS, DEVICE_MAX_FAILURES } from './device-trust.ts';
import { LOGIN_LIMITS, forgetRefusals } from './login-limit.ts';
import { recoveriesSettled } from './password.ts';
import { createApp } from './server.ts';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
const servers: Server[] = [];
let base: string;
let second: string;
const OWNER = 'tutor@example.com';
const RIGHT = 'demo1234';
const WRONG = 'incorrecta-1';

async function instance(secureCookie = false): Promise<string> {
  const s = createApp(t.db, {
    secureCookie,
    trustedProxies: ['127.0.0.1'],
    mailer: (to, subject, text) => void t.mail.push({ to, subject, text }),
    argon2: argon2Gate({ limit: 64, waitMs: 10_000 }),
  }).listen(0, '127.0.0.1');
  servers.push(s);
  await new Promise((resolve) => s.once('listening', resolve));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
before(async () => {
  t = await openTestDb('ef_disp');
  base = await instance();
  second = await instance();
});
after(async () => {
  for (const s of servers) s.close();
  await t?.close();
});
beforeEach(async () => {
  forgetRefusals();
  await t.db.query('DELETE FROM limite_acceso');
  await t.db.query('DELETE FROM dispositivo_confiable');
});

type Jar = Map<string, string>;
const keep = (jar: Jar | undefined, r: Response) => {
  if (!jar) return;
  for (const c of r.headers.getSetCookie()) {
    const [kv = ''] = c.split(';');
    const i = kv.indexOf('=');
    if (kv.startsWith('charales_disp_')) jar.set(kv.slice(0, i), kv.slice(i + 1));
  }
};
const send = (url: string, body: unknown, client: string, jar?: Jar) =>
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': client,
      ...(jar?.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
    },
    body: JSON.stringify(body),
  });
async function login(email: string, password: string, client: string, jar?: Jar, at = base) {
  const r = await send(`${at}/auth/login`, { email, password }, client, jar);
  await r.arrayBuffer();
  keep(jar, r);
  return r.status;
}
let attacker = 1;
const nextPrefix = () =>
  `2001:db8:${(attacker >> 8).toString(16)}:${(attacker++ & 255).toString(16)}::1`;
async function attack(n: number, email = OWNER) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(await login(email, WRONG, nextPrefix()));
  return out;
}
const tally = (s: number[]) =>
  s.reduce<Record<number, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
async function trusted(email = OWNER): Promise<Jar> {
  const jar: Jar = new Map();
  assert.equal(await login(email, RIGHT, '198.51.100.200', jar), 200);
  assert.equal(jar.size, 1, 'a login trusts its browser');
  return jar;
}

test('the cookie: HttpOnly, SameSite=Strict, only for /auth, 90 days, Secure in production; only a hash in MariaDB', async () => {
  const secure = await instance(true);
  const r = await send(`${secure}/auth/login`, { email: OWNER, password: RIGHT }, '198.51.100.1');
  const cookie = r.headers.getSetCookie().find((c) => c.startsWith('charales_disp_'))!;
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; SameSite=Strict/);
  assert.match(cookie, /; Path=\/auth/);
  assert.match(cookie, new RegExp(`; Max-Age=${DEVICE_DAYS * 86_400}`));
  assert.match(cookie, /; Secure/);
  const secret = cookie.split(';')[0]!.split('=')[1]!;
  const rows = await t.db.query('SELECT clave, cuenta FROM dispositivo_confiable');
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].clave, secret);
  assert.doesNotMatch(JSON.stringify(rows), new RegExp(`${secret}|tutor|example`));
});

test('a known browser logs in during an attack, on its usual network, on a new one, and on another API process', async () => {
  const jar = await trusted();
  assert.deepEqual(tally(await attack(60)), {
    401: LOGIN_LIMITS.CUENTA,
    429: 60 - LOGIN_LIMITS.CUENTA,
  });
  assert.equal(await login(OWNER, RIGHT, '198.51.100.200', jar), 200);
  assert.equal(await login(OWNER, RIGHT, '203.0.113.5', jar), 200);
  assert.equal(await login(OWNER, RIGHT, '2001:db8:ffff::1', jar, second), 200);
});

test('during a concurrent attack too: 15 logins of the owner, all 200', async () => {
  const jar = await trusted();
  const flood = Promise.all(Array.from({ length: 60 }, () => login(OWNER, WRONG, nextPrefix())));
  const statuses: number[] = [];
  for (let i = 0; i < 15; i++) statuses.push(await login(OWNER, RIGHT, '203.0.113.6', jar));
  await flood;
  assert.deepEqual(tally(statuses), { 200: 15 });
});

test('with its own network at the limit too: a shared office, or a proxy misconfigured for a while', async () => {
  const jar = await trusted();
  const office = '203.0.113.50';
  for (let i = 0; i < LOGIN_LIMITS.IP + 5; i++) await login(`nadie${i}@example.com`, WRONG, office);
  assert.equal(await login(`otra@example.com`, WRONG, office), 429, 'the network is at its limit');
  assert.equal(await login(OWNER, RIGHT, office, jar), 200);
});

test('a NEW browser during an attack: refused, unverified, right password or not — the limit is no oracle', async () => {
  await attack(LOGIN_LIMITS.CUENTA);
  forgetRefusals();
  const runs = argon2Stats().runs;
  assert.equal(await login(OWNER, RIGHT, '203.0.113.7'), 429);
  assert.equal(await login(OWNER, WRONG, '203.0.113.8'), 429);
  assert.equal(argon2Stats().runs, runs, 'no Argon2id ran');
});

test('a NEW browser after the attack: the budget refills, within 30 minutes one attempt fits, and it is trusted', async () => {
  await attack(30);
  assert.equal(await login(OWNER, RIGHT, '203.0.113.9'), 429);
  await t.advance(29 * 60_000);
  forgetRefusals();
  assert.equal(await login(OWNER, RIGHT, '203.0.113.9'), 429, 'not yet');
  await t.advance(2 * 60_000);
  forgetRefusals();
  const jar: Jar = new Map();
  assert.equal(await login(OWNER, RIGHT, '203.0.113.9', jar), 200);
  assert.equal(jar.size, 1);
});

test('recovery proves the account: that browser gets in during an attack, on any network; a known password stays out', async () => {
  await attack(30);
  const client = '203.0.113.10';
  const jar: Jar = new Map();
  assert.equal(await login(OWNER, RIGHT, client, jar), 429);
  const asked = await send(`${base}/auth/password-reset/request`, { email: OWNER }, client, jar);
  assert.equal(asked.status, 204);
  await recoveriesSettled();
  const token = /token=([\w-]+)/.exec(t.mail.at(-1)!.text)![1];
  const done = await send(
    `${base}/auth/password-reset/confirm`,
    { token, newPassword: 'Recuperada-2847' },
    client,
    jar,
  );
  assert.equal(done.status, 204);
  keep(jar, done);
  assert.equal(await login(OWNER, 'Recuperada-2847', '203.0.113.11', jar), 200);
  assert.equal(await login(OWNER, 'Recuperada-2847', '203.0.113.12'), 429, 'a new browser: not');
  const again = await send(
    `${base}/auth/password`,
    { currentPassword: 'Recuperada-2847', newPassword: RIGHT },
    '203.0.113.11',
  );
  await again.arrayBuffer();
  await t.db.query(
    "UPDATE usuarios u JOIN usuarios a ON a.email = 'admin@example.com' SET u.password_hash = a.password_hash WHERE u.email = ?",
    [OWNER],
  );
});

test('a stolen cookie is worth at most 5 guesses, then it trusts nothing; the right password does not bring it back', async () => {
  const stolen = await trusted();
  const before = new Map(stolen);
  const guesses: number[] = [];
  for (let i = 0; i < DEVICE_MAX_FAILURES; i++)
    guesses.push(await login(OWNER, WRONG, nextPrefix(), stolen));
  assert.deepEqual(tally(guesses), { 401: DEVICE_MAX_FAILURES });
  assert.deepEqual(stolen, before, 'failures issue nothing');
  await attack(LOGIN_LIMITS.CUENTA);
  forgetRefusals();
  assert.equal(
    await login(OWNER, RIGHT, nextPrefix(), stolen),
    429,
    'now it is an unknown browser',
  );
});

test('concurrent guesses with a stolen cookie can not pass the 5: each one reserves atomically', async () => {
  const stolen = await trusted();
  await attack(LOGIN_LIMITS.CUENTA); // the shared budget is spent: only the cookie could let anything through
  forgetRefusals();
  const runs = argon2Stats().runs;
  const statuses = await Promise.all(
    Array.from({ length: 40 }, () => login(OWNER, WRONG, nextPrefix(), stolen)),
  );
  assert.deepEqual(tally(statuses), { 401: DEVICE_MAX_FAILURES, 429: 40 - DEVICE_MAX_FAILURES });
  assert.equal(argon2Stats().runs - runs, DEVICE_MAX_FAILURES);
});

test('a success starts the count over, and replaces the secret: the older copy stops working', async () => {
  const jar = await trusted();
  const old = new Map(jar);
  for (let i = 0; i < DEVICE_MAX_FAILURES - 1; i++) await login(OWNER, WRONG, '203.0.113.13', jar);
  assert.equal(await login(OWNER, RIGHT, '203.0.113.14', jar), 200);
  assert.notDeepEqual([...jar.values()], [...old.values()], 'rotated');
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM dispositivo_confiable'), 1);
  await attack(LOGIN_LIMITS.CUENTA);
  forgetRefusals();
  assert.equal(await login(OWNER, RIGHT, '203.0.113.15', old), 429, 'the stolen copy is dead');
  assert.equal(await login(OWNER, RIGHT, '203.0.113.15', jar), 200);
});

test('a password change revokes every other browser and keeps this one', async () => {
  const phone = await trusted();
  const laptop = await trusted();
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.9' },
    body: JSON.stringify({ email: OWNER, password: RIGHT }),
  });
  const session = res.headers
    .getSetCookie()
    .find((c) => c.startsWith('charales_sid'))!
    .split(';')[0]!;
  const changed = await fetch(`${base}/auth/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: session },
    body: JSON.stringify({ currentPassword: RIGHT, newPassword: 'Cambiada-2847' }),
  });
  assert.equal(changed.status, 204);
  const fresh: Jar = new Map();
  keep(fresh, changed);
  assert.equal(fresh.size, 1);
  await attack(LOGIN_LIMITS.CUENTA);
  forgetRefusals();
  assert.equal(await login(OWNER, 'Cambiada-2847', '203.0.113.16', phone), 429);
  assert.equal(await login(OWNER, 'Cambiada-2847', '203.0.113.16', laptop), 429);
  assert.equal(await login(OWNER, 'Cambiada-2847', '203.0.113.16', fresh), 200);
  await t.db.query(
    "UPDATE usuarios u JOIN usuarios a ON a.email = 'admin@example.com' SET u.password_hash = a.password_hash WHERE u.email = ?",
    [OWNER],
  );
});

test('it expires after 90 days, and only a login renews it', async () => {
  const jar = await trusted();
  await t.advance((DEVICE_DAYS + 1) * 86_400_000);
  forgetRefusals();
  await attack(LOGIN_LIMITS.CUENTA);
  forgetRefusals();
  assert.equal(await login(OWNER, RIGHT, '203.0.113.17', jar), 429);
  await t.advance(11 * 3_600_000);
  forgetRefusals();
  await login('nadie@example.com', WRONG, '203.0.113.18'); // an admitted attempt purges what expired
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM dispositivo_confiable'), 0, 'purged');
});

test('bound to its account: worthless for another one, and a forged or malformed cookie is just no cookie', async () => {
  const jar = await trusted();
  await attack(LOGIN_LIMITS.CUENTA, 'coach@example.com');
  forgetRefusals();
  // Under the other account's cookie name.
  const { deviceCookieName } = await import('./device-trust.ts');
  const secret = [...jar.values()][0]!;
  const misused: Jar = new Map([[deviceCookieName('coach@example.com'), secret]]);
  assert.equal(await login('coach@example.com', RIGHT, '203.0.113.19', misused), 429);
  for (const bad of ['x', 'a'.repeat(43), `${secret}x`, "' OR 1=1 -- "]) {
    const forged: Jar = new Map([[deviceCookieName('coach@example.com'), bad]]);
    forgetRefusals();
    assert.equal(await login('coach@example.com', RIGHT, '203.0.113.20', forged), 429, bad);
  }
});

test('a network at its limit that keeps sending bad cookies does not reach MariaDB for each one', async () => {
  const { deviceCookieName } = await import('./device-trust.ts');
  const client = '203.0.113.21';
  for (let i = 0; i < LOGIN_LIMITS.IP + 1; i++) await login(`nadie${i}@example.com`, WRONG, client);
  let queries = 0;
  const original = t.db.query.bind(t.db);
  (t.db as { query: unknown }).query = (...a: Parameters<typeof original>) => {
    if (/UPDATE dispositivo_confiable/.test(String(a[0]))) queries++;
    return original(...a);
  };
  try {
    for (let i = 0; i < 20; i++) {
      const forged: Jar = new Map([[deviceCookieName(`x${i}@example.com`), 'a'.repeat(43)]]);
      assert.equal(await login(`x${i}@example.com`, WRONG, client, forged), 429);
    }
  } finally {
    (t.db as { query: unknown }).query = original;
  }
  assert.equal(queries, 1);
});

test('at most 10 browsers per account', async () => {
  for (let i = 0; i < 14; i++)
    assert.equal(await login(OWNER, RIGHT, '198.51.100.30', new Map()), 200);
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM dispositivo_confiable'), 10);
});

test('no enumeration: an existing and an unknown e-mail answer the same under attack, with no cookie either way', async () => {
  const existing = await attack(25, 'coach@example.com');
  forgetRefusals();
  await t.db.query('DELETE FROM limite_acceso');
  const unknown = await attack(25, 'nadie.aqui@example.com');
  assert.deepEqual(unknown, existing);
  const r = await send(
    `${base}/auth/login`,
    { email: 'otro.mas@example.com', password: WRONG },
    '192.0.2.77',
  );
  assert.deepEqual(
    r.headers.getSetCookie().filter((c) => c.startsWith('charales_disp_')),
    [],
  );
});

test('a 503 from the gate gives the browser its attempt back', async () => {
  const gate = argon2Gate({ limit: 1, waitMs: 10 });
  const hold = await gate.acquire();
  const s = createApp(t.db, {
    secureCookie: false,
    trustedProxies: ['127.0.0.1'],
    argon2: gate,
  }).listen(0, '127.0.0.1');
  servers.push(s);
  await new Promise((resolve) => s.once('listening', resolve));
  const at = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  const jar = await trusted();
  for (let i = 0; i < DEVICE_MAX_FAILURES + 2; i++)
    assert.equal(await login(OWNER, RIGHT, '203.0.113.22', jar, at), 503);
  hold!();
  assert.equal(await login(OWNER, RIGHT, '203.0.113.22', jar, at), 200);
});

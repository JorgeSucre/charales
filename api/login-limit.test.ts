/**
 * S-01 · login attempt limits shared through MariaDB (api/login-limit.ts, migration 005). Every case counts the Argon2id
 * verifications that really ran (`passwordVerifications`), not just the status codes: a refused attempt must never
 * reach one. Fixed clock (api/test-db.ts), so the 15-minute window is moved with `advance`, never waited for.
 * Several instances and a restart, with real processes: api/login-limit-instances.test.ts.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { passwordVerifications } from './auth.ts';
import { LOGIN_LIMITS, LOGIN_WINDOW_MS, loginKeys } from './login-limit.ts';
import { clientIp, createApp } from './server.ts';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
/** A second instance on the same database, behind a trusted proxy at 127.0.0.1 (so X-Forwarded-For is believed). */
let proxied: Server;
let proxiedBase: string;
before(async () => {
  t = await openTestDb('ef_s01');
  proxied = createApp(t.db, { secureCookie: false, trustedProxies: ['127.0.0.1'] }).listen(0);
  await new Promise((resolve) => proxied.once('listening', resolve));
  proxiedBase = `http://127.0.0.1:${(proxied.address() as AddressInfo).port}`;
});
after(async () => {
  proxied?.close();
  await t?.close();
});
beforeEach(() => t.db.query('DELETE FROM limite_acceso'));

const login = (email: string, password: string, from?: { base?: string; client?: string }) =>
  fetch(`${from?.base ?? t.base}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(from?.client ? { 'X-Forwarded-For': from.client } : {}),
    },
    body: JSON.stringify({ email, password }),
  });
const statuses = (responses: Response[]) =>
  responses.reduce<Record<number, number>>(
    (n, r) => ({ ...n, [r.status]: (n[r.status] ?? 0) + 1 }),
    {},
  );
/** Argon2id verifications run by `work`. */
async function verified<T>(work: () => Promise<T>): Promise<[T, number]> {
  const before = passwordVerifications();
  const result = await work();
  return [result, passwordVerifications() - before];
}
const counters = async (ip: string, email: string) => {
  const keys = loginKeys(ip, email);
  const rows: { clave: string; intentos: number }[] = await t.db.query(
    'SELECT clave, intentos FROM limite_acceso WHERE clave IN (?)',
    [keys.map((k) => k.key)],
  );
  return Object.fromEntries(
    keys.map((k) => [k.scope, rows.find((r) => r.clave === k.key)?.intentos ?? 0]),
  );
};
const WRONG = 'no-es-la-contraseña-1';

test('S-01: five simultaneous wrong passwords use the whole allowance; a sixth gets 429 without running Argon2id', async () => {
  const [first, n] = await verified(() =>
    Promise.all(Array.from({ length: 5 }, () => login('marta@example.com', WRONG))),
  );
  assert.deepEqual(statuses(first), { 401: 5 });
  assert.equal(n, 5);
  const [sixth, m] = await verified(() => login('marta@example.com', 'demo1234')); // even the right password
  assert.equal(sixth.status, 429);
  assert.deepEqual(await sixth.json(), {
    error: 'Demasiados intentos. Intenta de nuevo más tarde.',
  });
  assert.equal(m, 0, 'a refused attempt never verifies');
});

test('S-01: 25 simultaneous wrong passwords → exactly 5 verified (401), 20 refused before Argon2id (429)', async () => {
  const [responses, n] = await verified(() =>
    Promise.all(Array.from({ length: 25 }, () => login('marta@example.com', WRONG))),
  );
  assert.deepEqual(statuses(responses), { 401: LOGIN_LIMITS.CUENTA_IP, 429: 20 });
  assert.equal(n, LOGIN_LIMITS.CUENTA_IP);
  assert.deepEqual(await counters('127.0.0.1', 'marta@example.com'), {
    CUENTA_IP: 5,
    CUENTA: 5,
    IP: 5,
  });
});

test('S-01: the account limit holds across IPs — 4 addresses × 5 wrong passwords, then a fifth address gets 429', async () => {
  const [responses, n] = await verified(() =>
    Promise.all(
      ['198.51.100.1', '198.51.100.2', '198.51.100.3', '198.51.100.4'].flatMap((client) =>
        Array.from({ length: 5 }, () =>
          login('marta@example.com', WRONG, { base: proxiedBase, client }),
        ),
      ),
    ),
  );
  assert.deepEqual(statuses(responses), { 401: LOGIN_LIMITS.CUENTA });
  assert.equal(n, 20);
  const [fifth, m] = await verified(
    () => login('MARTA@example.com', WRONG, { base: proxiedBase, client: '198.51.100.5' }), // case doesn't matter
  );
  assert.equal(fifth.status, 429);
  assert.equal(m, 0);
});

test('S-01: the IP limit holds across e-mails — 60 simultaneous unknown accounts from one address → 50 verified, 10 refused', async () => {
  const [responses, n] = await verified(() =>
    Promise.all(Array.from({ length: 60 }, (_, i) => login(`nadie${i}@example.com`, WRONG))),
  );
  assert.deepEqual(statuses(responses), { 401: LOGIN_LIMITS.IP, 429: 10 });
  assert.equal(n, 50);
  // unknown and existing accounts are limited alike: the next one, real, is refused too and never verified
  const [real, m] = await verified(() => login('admin@example.com', 'demo1234'));
  assert.equal(real.status, 429);
  assert.equal(m, 0);
});

test('S-01: a successful login clears the e-mail counters and gives the IP back only its own attempt', async () => {
  for (let i = 0; i < 4; i++) assert.equal((await login('marta@example.com', WRONG)).status, 401);
  assert.equal((await login('marta@example.com', 'demo1234')).status, 200);
  assert.deepEqual(await counters('127.0.0.1', 'marta@example.com'), {
    CUENTA_IP: 0,
    CUENTA: 0,
    IP: 4,
  });
  for (let i = 0; i < 5; i++) assert.equal((await login('marta@example.com', WRONG)).status, 401);
  assert.equal((await login('marta@example.com', WRONG)).status, 429);
  assert.deepEqual(await counters('127.0.0.1', 'marta@example.com'), {
    CUENTA_IP: 5,
    CUENTA: 5,
    IP: 9,
  });
});

test('S-01: a right password on a disabled account is not a guess — its reservation is given back, nothing cleared', async () => {
  await t.db.query("UPDATE usuarios SET activo = FALSE WHERE email = 'tutor@example.com'");
  try {
    assert.equal((await login('tutor@example.com', WRONG)).status, 401);
    const off = await login('tutor@example.com', 'demo1234');
    assert.equal(off.status, 401); // same answer as a wrong password (no enumeration)
    assert.deepEqual(await counters('127.0.0.1', 'tutor@example.com'), {
      CUENTA_IP: 1,
      CUENTA: 1,
      IP: 1,
    });
  } finally {
    await t.db.query("UPDATE usuarios SET activo = TRUE WHERE email = 'tutor@example.com'");
  }
});

test('S-01: the window expires — after 15 minutes the account can be tried again', async () => {
  for (let i = 0; i < 5; i++) await login('marta@example.com', WRONG);
  assert.equal((await login('marta@example.com', 'demo1234')).status, 429);
  await t.advance(LOGIN_WINDOW_MS - 1000);
  assert.equal(
    (await login('marta@example.com', 'demo1234')).status,
    429,
    'still inside the window',
  );
  await t.advance(1000);
  const [res, n] = await verified(() => login('marta@example.com', 'demo1234'));
  assert.equal(res.status, 200);
  assert.equal(n, 1);
  // expired rows are purged on the next attempts: only the fresh window of marta and this IP remain
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM limite_acceso'), 3);
});

test('S-01: without a trusted proxy, X-Forwarded-For is ignored — a client cannot pick a new address per attempt', async () => {
  const [responses, n] = await verified(async () => {
    const out: Response[] = [];
    for (let i = 1; i <= 6; i++)
      out.push(await login('marta@example.com', WRONG, { client: `203.0.113.${i}` }));
    return out;
  });
  assert.deepEqual(
    responses.map((r) => r.status),
    [401, 401, 401, 401, 401, 429],
  );
  assert.equal(n, 5);
  const [row]: { ip: string }[] = await t.db.query(
    "SELECT ip FROM auditoria WHERE descripcion = 'Intento de acceso fallido' ORDER BY id DESC LIMIT 1",
  );
  assert.equal(row!.ip, '127.0.0.1');
});

test('S-01: behind a trusted proxy the client address comes from X-Forwarded-For (rightmost hop not ours)', async () => {
  for (let i = 0; i < 5; i++)
    await login('marta@example.com', WRONG, { base: proxiedBase, client: '203.0.113.7' });
  assert.equal(
    (await login('marta@example.com', WRONG, { base: proxiedBase, client: '203.0.113.7' })).status,
    429,
  );
  // another client of the same proxy is another person: its own allowance (the account still has 15 left)
  const other = await login('marta@example.com', WRONG, {
    base: proxiedBase,
    client: '10.9.9.9, 203.0.113.8', // a spoofed first hop is ignored: the proxy appended the real one last
  });
  assert.equal(other.status, 401);
  const [row]: { ip: string }[] = await t.db.query(
    "SELECT ip FROM auditoria WHERE descripcion = 'Intento de acceso fallido' ORDER BY id DESC LIMIT 1",
  );
  assert.equal(row!.ip, '203.0.113.8');
});

test('S-01: clientIp — peer unless it is a trusted proxy; skips trusted hops; malformed hop → peer', () => {
  const req = (peer: string, xff?: string) =>
    ({
      socket: { remoteAddress: peer },
      headers: xff ? { 'x-forwarded-for': xff } : {},
    }) as unknown as IncomingMessage;
  const none = new Set<string>();
  const proxies = new Set(['10.0.0.1', '10.0.0.2']);
  assert.equal(clientIp(req('::ffff:198.51.100.9', '1.2.3.4'), none), '198.51.100.9');
  assert.equal(clientIp(req('10.0.0.1', '1.2.3.4, 198.51.100.9'), proxies), '198.51.100.9');
  assert.equal(clientIp(req('10.0.0.1', '198.51.100.9, 10.0.0.2'), proxies), '198.51.100.9');
  assert.equal(clientIp(req('10.0.0.1', '1.2.3.4, not-an-ip'), proxies), '10.0.0.1');
  assert.equal(clientIp(req('10.0.0.1'), proxies), '10.0.0.1');
  assert.equal(clientIp(req('2001:db8::1', '1.2.3.4'), new Set(['2001:db8::1'])), '1.2.3.4');
  assert.throws(
    () => createApp(t.db, { secureCookie: false, trustedProxies: ['10.0.0.0/8'] }),
    /TRUSTED_PROXIES/,
  );
});

test('S-01: malformed logins are answered before any query or Argon2id', async () => {
  const [responses, n] = await verified(() =>
    Promise.all([
      fetch(`${t.base}/auth/login`, { method: 'POST' }),
      login('', 'x'),
      login('marta@example.com', ''),
      fetch(`${t.base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ['marta@example.com'], password: 1 }),
      }),
      login(`${'a'.repeat(150)}@example.com`, WRONG),
      login('marta@example.com', 'x'.repeat(201)),
    ]),
  );
  assert.deepEqual(
    responses.map((r) => r.status),
    [400, 400, 400, 400, 401, 401],
  );
  assert.equal(n, 0);
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM limite_acceso'), 0);
});

test('S-01: if the limiter fails, the login is refused (503) — never verified without a reservation', async () => {
  await t.db.query('RENAME TABLE limite_acceso TO limite_acceso_fuera');
  try {
    const [responses, n] = await verified(() =>
      Promise.all(Array.from({ length: 10 }, () => login('marta@example.com', 'demo1234'))),
    );
    assert.deepEqual(statuses(responses), { 503: 10 });
    assert.deepEqual(await responses[0]!.json(), {
      error: 'El inicio de sesión no está disponible. Intenta de nuevo en unos minutos.',
    });
    assert.equal(n, 0);
  } finally {
    await t.db.query('RENAME TABLE limite_acceso_fuera TO limite_acceso');
  }
  assert.equal((await login('marta@example.com', 'demo1234')).status, 200);
});

test('S-01: the table stores no e-mail, IP, password or token — only SHA-256 keys', async () => {
  await login('marta@example.com', WRONG);
  const rows: { clave: string; ambito: string }[] = await t.db.query(
    'SELECT clave, ambito FROM limite_acceso',
  );
  assert.equal(rows.length, 3);
  for (const r of rows) assert.match(r.clave, /^[0-9a-f]{64}$/);
  assert.deepEqual(rows.map((r) => r.ambito).sort(), ['CUENTA', 'CUENTA_IP', 'IP']);
});

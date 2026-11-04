/**
 * S-01 · login attempt limits shared through MariaDB (api/login-limit.ts, migration 005), with the corrections of the
 * PR #26 audit: H-1 (the account is identified as MariaDB compares e-mails), H-2 (no counter per account alone, so
 * nobody can lock another user out) and M-1 (a refusal writes nothing; the limiter can have its own pool). Every case
 * counts the Argon2id verifications that really ran (`passwordVerifications`), not just the status codes, and reads the
 * counters stored in MariaDB. Fixed clock (api/test-db.ts): the 15-minute window is moved with `advance`, never waited
 * for. Several instances and a restart, with real processes: api/login-limit-instances.test.ts.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Pool } from 'mariadb';
import { passwordVerifications } from './auth.ts';
import {
  EMAIL_COLLATION,
  LOGIN_LIMITS,
  LOGIN_WINDOW_MS,
  accountIdentity,
  forgetRefusals,
  loginKeys,
} from './login-limit.ts';
import { argon2Gate } from './argon2-guard.ts';
import { clientIp, createApp } from './server.ts';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
const servers: Server[] = [];
/**
 * These cases measure S-01 alone, with up to 60 simultaneous logins: their instances get an Argon2id gate with room for
 * that many (api/argon2-guard.ts; production keeps 3 per process), so S-02 never answers 503 here. How S-01 and S-02
 * interact at the default limits is tested in api/argon2-guard.test.ts.
 */
const ARGON2_ROOM = { limit: 64, waitMs: 10_000 };
/** The instance of these cases (the harness one keeps the defaults). */
let s01Base: string;
/** Another instance on the same database, behind a trusted proxy at 127.0.0.1 (so X-Forwarded-For is believed). */
let proxiedBase: string;
async function listen(server: Server): Promise<string> {
  servers.push(server.listen(0));
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
before(async () => {
  t = await openTestDb('ef_s01');
  s01Base = await listen(createApp(t.db, { secureCookie: false, argon2: argon2Gate(ARGON2_ROOM) }));
  proxiedBase = await listen(
    createApp(t.db, {
      secureCookie: false,
      trustedProxies: ['127.0.0.1'],
      argon2: argon2Gate(ARGON2_ROOM),
    }),
  );
});
after(async () => {
  for (const s of servers) s.close();
  await t?.close();
});
beforeEach(async () => {
  forgetRefusals();
  await t.db.query('DELETE FROM limite_acceso');
});

const login = (email: string, password: string, from?: { base?: string; client?: string }) =>
  fetch(`${from?.base ?? s01Base}/auth/login`, {
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
/** The stored counters of one account from one address. */
const counters = async (ip: string, email: string) => {
  const keys = await loginKeys(t.db, ip, email);
  const rows: { clave: string; intentos: number }[] = await t.db.query(
    'SELECT clave, intentos FROM limite_acceso WHERE clave IN (?)',
    [keys.map((k) => k.key)],
  );
  return Object.fromEntries(
    keys.map((k) => [k.scope, rows.find((r) => r.clave === k.key)?.intentos ?? 0]),
  );
};
const rowCount = () => t.count('SELECT COUNT(*) AS n FROM limite_acceso');
const WRONG = 'no-es-la-contraseña-1';
const ZWSP = '​';

// ------------------------------------------------------------------ S-01: reservation before Argon2id

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
  assert.deepEqual(await counters('127.0.0.1', 'marta@example.com'), { IP: 5, CUENTA_IP: 5 });
});

test('S-01: the IP limit holds across e-mails — 60 simultaneous unknown accounts from one address → 50 verified, 10 refused', async () => {
  const [responses, n] = await verified(() =>
    Promise.all(Array.from({ length: 60 }, (_, i) => login(`nadie${i}@example.com`, WRONG))),
  );
  assert.deepEqual(statuses(responses), { 401: LOGIN_LIMITS.IP, 429: 10 });
  assert.equal(n, 50);
  const [real, m] = await verified(() => login('admin@example.com', 'demo1234'));
  assert.equal(real.status, 429);
  assert.equal(m, 0);
});

test('S-01: a successful login clears the account counter of that address and gives the address back its own attempt', async () => {
  for (let i = 0; i < 4; i++) assert.equal((await login('marta@example.com', WRONG)).status, 401);
  assert.equal((await login('marta@example.com', 'demo1234')).status, 200);
  assert.deepEqual(await counters('127.0.0.1', 'marta@example.com'), { IP: 4, CUENTA_IP: 0 });
  for (let i = 0; i < 5; i++) assert.equal((await login('marta@example.com', WRONG)).status, 401);
  assert.equal((await login('marta@example.com', WRONG)).status, 429);
  assert.deepEqual(await counters('127.0.0.1', 'marta@example.com'), { IP: 9, CUENTA_IP: 5 });
});

test('S-01: a right password on a disabled account is not a guess — its reservation is given back, nothing cleared', async () => {
  await t.db.query("UPDATE usuarios SET activo = FALSE WHERE email = 'tutor@example.com'");
  try {
    assert.equal((await login('tutor@example.com', WRONG)).status, 401);
    assert.equal((await login('tutor@example.com', 'demo1234')).status, 401); // same answer (no enumeration)
    assert.deepEqual(await counters('127.0.0.1', 'tutor@example.com'), { IP: 1, CUENTA_IP: 1 });
  } finally {
    await t.db.query("UPDATE usuarios SET activo = TRUE WHERE email = 'tutor@example.com'");
  }
});

test('S-01: the window expires — after 15 minutes the account can be tried again; expired rows are purged', async () => {
  for (let i = 0; i < 5; i++) await login('marta@example.com', WRONG);
  assert.equal((await login('marta@example.com', 'demo1234')).status, 429);
  await t.advance(LOGIN_WINDOW_MS - 1000);
  forgetRefusals(); // ask MariaDB, not the few-seconds memory of this process
  assert.equal(
    (await login('marta@example.com', 'demo1234')).status,
    429,
    'still inside the window',
  );
  await t.advance(1000 + 10_000); // also past the refusal memory
  const [res, n] = await verified(() => login('marta@example.com', 'demo1234'));
  assert.equal(res.status, 200);
  assert.equal(n, 1);
  // the old rows were rewritten in place (same keys): only marta's two counters remain
  assert.equal(await rowCount(), 2);
  await login('otra@example.com', WRONG); // an admitted attempt purges what has expired
  await t.advance(LOGIN_WINDOW_MS);
  await login('nadie@example.com', WRONG);
  assert.equal(await rowCount(), 2, 'only the counters of the last attempt are left');
});

// ------------------------------------------------------------------ H-1: one identity per account, as MariaDB sees it

test('H-1: the e-mail column collation is the one the limiter reproduces', async () => {
  const [col]: { c: string }[] = await t.db.query(
    "SELECT COLLATION_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'email'",
  );
  assert.equal(col!.c, EMAIL_COLLATION);
});

test('H-1: two e-mails share an identity exactly when `usuarios.email = ?` treats them as equal', async () => {
  const base = 'admin@example.com';
  const pairs: [string, string][] = [
    [base, 'ADMIN@EXAMPLE.COM'],
    [base, 'admín@example.com'],
    [base, 'ＡＤＭＩＮ@example.com'],
    [base, `ad${ZWSP}min@example.com`],
    [base, `${base} ${ZWSP}`],
    [base, `   ${base}   `],
    [base, `${base} `],
    ['straße@x.com', 'strasse@x.com'],
    ['ﬁ@x.com', 'fi@x.com'],
    [base, 'admin @example.com'],
    [base, 'admin@example.co'],
    [base, 'admim@example.com'],
  ];
  for (const [a, b] of pairs) {
    const [row]: { eq: number }[] = await t.db.query(
      `SELECT CONVERT(? USING utf8mb4) COLLATE ${EMAIL_COLLATION} = CONVERT(? USING utf8mb4) AS eq`,
      [a.trim(), b.trim()], // the login looks the account up with the trimmed e-mail
    );
    assert.equal(
      (await accountIdentity(t.db, a)) === (await accountIdentity(t.db, b)),
      !!row!.eq,
      `${JSON.stringify(a)} / ${JSON.stringify(b)}`,
    );
  }
});

test('H-1: variants of one e-mail (accents, full width, zero width, spaces, case) share its limit — 5 guesses in all', async () => {
  const variants = [
    'admín@example.com',
    'ＡＤＭＩＮ@example.com',
    `ad${ZWSP}min@example.com`,
    '  admin@example.com  ',
    'Admin@Example.com',
  ];
  const [responses, n] = await verified(async () => {
    const out: Response[] = [];
    for (const v of variants) out.push(await login(v, WRONG));
    out.push(await login('admin@example.com', 'demo1234')); // the real account, right password
    out.push(await login(`admi${ZWSP}${ZWSP}n@example.com`, WRONG)); // yet another variant
    return out;
  });
  assert.deepEqual(
    responses.map((r) => r.status),
    [401, 401, 401, 401, 401, 429, 429],
  );
  assert.equal(n, 5, 'only the allowance reached Argon2id');
  assert.deepEqual(await counters('127.0.0.1', 'admin@example.com'), { IP: 5, CUENTA_IP: 5 });
});

test('H-1: a variant really reaches the account (the right password through a variant logs in)', async () => {
  assert.equal((await login('ＡＤＭÍＮ@example.com', 'demo1234')).status, 200);
});

test('H-1: no enumeration — an unknown account and its variants behave exactly like an existing one', async () => {
  const run = async (email: string, variant: string) => {
    const out: number[] = [];
    for (let i = 0; i < 5; i++) out.push((await login(i % 2 ? variant : email, WRONG)).status);
    out.push((await login(email, WRONG)).status);
    return out;
  };
  const existing = await run('marta@example.com', 'MÁRTA@example.com');
  const unknown = await run('nadie-aqui@example.com', 'NÁDIE-AQUI@example.com');
  assert.deepEqual(existing, [401, 401, 401, 401, 401, 429]);
  assert.deepEqual(unknown, existing);
});

// ------------------------------------------------------------------ H-2: nobody can lock another user out

test('H-2: 10 attacking addresses × 5 wrong passwords do not stop the owner logging in from their own address', async () => {
  const attackers = Array.from({ length: 10 }, (_, i) => `198.51.100.${i + 1}`);
  const [responses, n] = await verified(() =>
    Promise.all(
      attackers.flatMap((client) =>
        Array.from({ length: 5 }, () =>
          login('secretaria@example.com', WRONG, { base: proxiedBase, client }),
        ),
      ),
    ),
  );
  assert.deepEqual(statuses(responses), { 401: 50 });
  assert.equal(n, 50);
  // the failed attempts are still limited: each attacking address is out of guesses for this account
  for (const client of attackers.slice(0, 3)) {
    const [again, m] = await verified(() =>
      login('secretaria@example.com', 'demo1234', { base: proxiedBase, client }),
    );
    assert.equal(again.status, 429);
    assert.equal(m, 0);
  }
  // the owner, from an address of their own, is not affected
  const [owner, k] = await verified(() =>
    login('secretaria@example.com', 'demo1234', { base: proxiedBase, client: '203.0.113.50' }),
  );
  assert.equal(owner.status, 200);
  assert.equal(k, 1);
});

test('H-2: an attacker who keeps trying across windows never locks the owner out', async () => {
  for (let w = 0; w < 3; w++) {
    for (let i = 0; i < 6; i++)
      await login('marta@example.com', WRONG, { base: proxiedBase, client: '198.51.100.77' });
    assert.equal(
      (await login('marta@example.com', 'demo1234', { base: proxiedBase, client: '203.0.113.9' }))
        .status,
      200,
      `window ${w}`,
    );
    await t.advance(LOGIN_WINDOW_MS);
  }
});

test('H-2: the per-address limits still hold under concurrency (25 at once from one attacker → 5 verified)', async () => {
  const [responses, n] = await verified(() =>
    Promise.all(
      Array.from({ length: 25 }, () =>
        login('marta@example.com', WRONG, { base: proxiedBase, client: '198.51.100.200' }),
      ),
    ),
  );
  assert.deepEqual(statuses(responses), { 401: 5, 429: 20 });
  assert.equal(n, 5);
});

// ------------------------------------------------------------------ M-1: a refusal writes nothing

test('M-1: a 429 writes nothing — neither when MariaDB decides it nor when this process remembers it', async () => {
  for (let i = 0; i < 5; i++) await login('marta@example.com', WRONG);
  forgetRefusals();
  const first = await t.unchanged(() => login('marta@example.com', WRONG), []); // decided by MariaDB
  assert.equal(first.status, 429);
  const second = await t.unchanged(() => login('marta@example.com', WRONG), []); // remembered
  assert.equal(second.status, 429);
});

test('M-1: random e-mails from an address at its limit add no rows', async () => {
  await Promise.all(Array.from({ length: 50 }, (_, i) => login(`azar${i}@example.com`, WRONG)));
  const rows = await rowCount();
  forgetRefusals();
  const responses = await Promise.all(
    Array.from({ length: 100 }, (_, i) => login(`otro-azar-${i}@example.com`, WRONG)),
  );
  assert.deepEqual(statuses(responses), { 429: 100 });
  assert.equal(await rowCount(), rows);
});

test('M-1: a refusal remembered by the process does not reach MariaDB at all', async () => {
  let queries = 0;
  const counting = new Proxy(t.db, {
    get(target, prop, receiver) {
      if (prop === 'query' || prop === 'getConnection') queries++;
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as Pool;
  const base = await listen(
    createApp(t.db, { secureCookie: false, limiterDb: counting, argon2: argon2Gate(ARGON2_ROOM) }),
  );
  await Promise.all(
    Array.from({ length: 50 }, (_, i) => login(`m${i}@example.com`, WRONG, { base })),
  );
  assert.equal((await login('m-extra@example.com', WRONG, { base })).status, 429); // MariaDB decides, remembered
  const before = queries;
  // 100 at once: more simultaneous new connections than the OS accept queue (128 on macOS) get reset by the OS itself
  const flood = await Promise.all(
    Array.from({ length: 100 }, (_, i) => login(`flood${i}@example.com`, WRONG, { base })),
  );
  assert.deepEqual(statuses(flood), { 429: 100 });
  assert.equal(queries - before, 0, 'the limiter pool was not used');
});

// ------------------------------------------------------------------ client address and failures

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
  assert.equal(await rowCount(), 0);
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
  assert.equal(rows.length, 2);
  for (const r of rows) assert.match(r.clave, /^[0-9a-f]{64}$/);
  assert.deepEqual(rows.map((r) => r.ambito).sort(), ['CUENTA_IP', 'IP']);
});

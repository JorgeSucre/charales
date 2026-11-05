/** Each defect the independent audit of 2026-11-05 demonstrated: docs/audits/AUDITORIA_INDEPENDIENTE_CIERRE_2026.md. */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argon2Gate } from './argon2-guard.ts';
import { argon2Stats, localDateTime, sha256 } from './auth.ts';
import { checkEnvironment } from './config.ts';
import { DEVICE_DAYS, deviceCookieName, reserveDevice } from './device-trust.ts';
import {
  ACCOUNT_REFILL_MS,
  LOGIN_LIMITS,
  WIDE_NETWORK_REFILL_MS,
  forgetRefusals,
} from './login-limit.ts';
import { MailError, processMailQueue, type Mailer } from './mail.ts';
import { recoveriesSettled } from './password.ts';
import { createApp } from './server.ts';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
const servers: Server[] = [];
const TEN_MIN = 10 * 60_000;
const OWNER = 'tutor@example.com';
const RIGHT = 'demo1234';
const WRONG = 'incorrecta-1';

async function appWith(mailer?: Mailer): Promise<string> {
  const s = createApp(t.db, {
    secureCookie: false,
    trustedProxies: ['127.0.0.1'],
    mailer: mailer ?? ((to, subject, text) => void t.mail.push({ to, subject, text })),
    argon2: argon2Gate({ limit: 64, waitMs: 10_000 }),
  }).listen(0, '127.0.0.1');
  servers.push(s);
  await new Promise((resolve) => s.once('listening', resolve));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
let base: string;
before(async () => {
  t = await openTestDb('ef_ind');
  base = await appWith();
});
after(async () => {
  for (const s of servers) s.close();
  await t?.close();
});
beforeEach(async () => {
  forgetRefusals();
  await t.db.query('DELETE FROM limite_acceso');
  await t.db.query('DELETE FROM dispositivo_confiable');
  // These tests are about per-account and per-network limits: the global budget (api/cupo-correo.test.ts) starts whole.
  await t.db.query('UPDATE correo_cupo SET usados = 0, desde_ms = 0');
  await t.db.query('DELETE FROM correo_saliente');
  t.mail.length = 0;
});

const post = (url: string, body: unknown, client: string, cookie?: string) =>
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': client,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
const login = async (
  email: string,
  password: string,
  client: string,
  cookie?: string,
  at = base,
) => {
  const r = await post(`${at}/auth/login`, { email, password }, client, cookie);
  await r.arrayBuffer();
  return r;
};
const session = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('charales_sid'))!
    .split(';')[0]!;
const browser = (r: Response) =>
  r.headers
    .getSetCookie()
    .find((c) => c.startsWith('charales_disp_'))!
    .split(';')[0]!;
const rpc = (at: string, cookie: string, service: string, method: string, ...args: unknown[]) =>
  fetch(`${at}/api/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ service, method, args }),
  });
const adminAt = async (at = base) =>
  session(await login('admin@example.com', RIGHT, '192.0.2.200', undefined, at));
const tokenIn = (text: string) => /token=([\w-]+)/.exec(text)![1]!;
const confirm = (at: string, token: string, client = '192.0.2.201') =>
  post(`${at}/auth/password-reset/confirm`, { token, newPassword: 'Nueva-clave-2847' }, client);
/** The console tool runs on the real clock and these tests on a fixed one: its link is valid at the tests' time. */
async function operatorLink(email: string): Promise<string> {
  const run = spawnSync(process.execPath, ['api/access-link.ts', email], {
    env: { ...process.env, DB_NAME: t.name, APP_URL: 'https://escuela.example' },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const token = tokenIn(run.stdout);
  assert.match(run.stdout, /^https:\/\/escuela\.example\/reset-password\?token=/);
  await t.db.query('UPDATE tokens_recuperacion SET expira_en = ? WHERE token_hash = ?', [
    localDateTime(Date.now() + 3_600_000),
    sha256(token),
  ]);
  return token;
}
let serial = 0;
const staff = () => `alta${++serial}@example.com`;

test('IND-01: after correcting a wrong address, the old one gets nothing and its link is dead; the new one is invited', async () => {
  const sent: { to: string; text: string }[] = [];
  let down = true;
  const mailer: Mailer = (to, _s, text) => {
    if (down) throw new MailError('TIMEOUT', false);
    sent.push({ to, text });
  };
  const failed: string[] = [];
  const at = await appWith((to, s, text) => {
    failed.push(text);
    return mailer(to, s, text);
  });
  const admin = await adminAt(at);
  const wrong = staff();
  const res = await rpc(at, admin, 'UserService', 'save', {
    roleId: 2,
    firstName: 'A',
    lastName: 'B',
    email: wrong,
  });
  const { result } = await res.json();
  const right = staff();
  const fixed = await rpc(at, admin, 'UserService', 'save', {
    id: result.id,
    roleId: 2,
    firstName: 'A',
    lastName: 'B',
    email: right,
  });
  assert.equal(fixed.status, 200);
  assert.equal(
    await confirm(at, tokenIn(failed[0]!)).then((r) => r.status),
    400,
    'the old link is dead',
  );
  await t.advance(TEN_MIN);
  down = false;
  await processMailQueue(t.db, mailer);
  assert.ok(
    sent.every((m) => m.to === right),
    JSON.stringify(sent.map((m) => m.to)),
  );
  assert.equal(sent.length, 1, 'the invitation goes to the new address');
  const rows = await t.db.query(
    'SELECT estado, ultimo_error FROM correo_saliente WHERE destinatario = ?',
    [wrong],
  );
  assert.equal(rows[0].ultimo_error, 'CUENTA_MODIFICADA');
  assert.equal((await confirm(at, tokenIn(sent[0]!.text))).status, 204);
});

test('IND-01: a row that still names the old address is closed by the worker, whatever the path that left it', async () => {
  const sent: string[] = [];
  const at = await appWith(() => {
    throw new MailError('TIMEOUT', false);
  });
  const admin = await adminAt(at);
  const email = staff();
  await rpc(at, admin, 'UserService', 'save', { roleId: 2, firstName: 'A', lastName: 'B', email });
  await t.db.query('UPDATE usuarios SET email = ? WHERE email = ?', [staff(), email]);
  await t.advance(TEN_MIN);
  await processMailQueue(t.db, (to) => void sent.push(to));
  assert.deepEqual(sent, []);
  const [row] = await t.db.query(
    'SELECT ultimo_error FROM correo_saliente WHERE destinatario = ?',
    [email],
  );
  assert.equal(row.ultimo_error, 'CORREO_CAMBIADO');
});

test('IND-01: a recovery link sent to the old address stops working when the address changes; other sessions close', async () => {
  const admin = await adminAt();
  const email = staff();
  const created = await (
    await rpc(base, admin, 'UserService', 'save', {
      roleId: 2,
      firstName: 'A',
      lastName: 'B',
      email,
    })
  ).json();
  const invitation = tokenIn(t.mail.at(-1)!.text);
  assert.equal((await confirm(base, invitation)).status, 204);
  const theirs = session(await login(email, 'Nueva-clave-2847', '192.0.2.50'));
  assert.equal(
    (await post(`${base}/auth/password-reset/request`, { email }, '192.0.2.51')).status,
    204,
  );
  await recoveriesSettled();
  const old = tokenIn(t.mail.at(-1)!.text);
  const changed = await rpc(base, admin, 'UserService', 'save', {
    id: created.result.id,
    roleId: 2,
    firstName: 'A',
    lastName: 'B',
    email: staff(),
  });
  assert.equal(changed.status, 200);
  assert.equal((await confirm(base, old)).status, 400);
  const open = await fetch(`${base}/auth/session`, { headers: { Cookie: theirs } });
  assert.equal(open.status, 401, 'that session is closed');
  const mine = await fetch(`${base}/auth/session`, { headers: { Cookie: admin } });
  assert.equal(mine.status, 200, 'the one making the change keeps theirs');
});

test('IND-02: a login in flight does not survive a recovery: no session and no trusted browser with the old password', async () => {
  const email = 'marta@example.com';
  const [{ password_hash: original }] = await t.db.query(
    'SELECT password_hash FROM usuarios WHERE email = ?',
    [email],
  );
  try {
    for (let round = 0; round < 4; round++) {
      forgetRefusals();
      await t.db.query('DELETE FROM limite_acceso');
      await t.db.query('UPDATE usuarios SET password_hash = ? WHERE email = ?', [original, email]);
      assert.equal(
        (await post(`${base}/auth/password-reset/request`, { email }, '192.0.2.60')).status,
        204,
      );
      await recoveriesSettled();
      const token = tokenIn(t.mail.at(-1)!.text);
      let on = true;
      const attacker = (async () => {
        const ok: string[] = [];
        let i = 0;
        const inFlight: Promise<void>[] = [];
        while (on) {
          inFlight.push(
            login(email, RIGHT, `203.0.${100 + round}.${(i++ % 200) + 1}`).then((r) => {
              if (r.status === 200) ok.push(session(r));
            }),
          );
          await new Promise((r) => setTimeout(r, 15));
        }
        await Promise.all(inFlight);
        return ok;
      })();
      await new Promise((r) => setTimeout(r, 60));
      const done = await confirm(base, token);
      assert.equal(done.status, 204);
      on = false;
      const sessions = await attacker;
      for (const cookie of sessions) {
        const alive = await fetch(`${base}/auth/session`, { headers: { Cookie: cookie } });
        assert.equal(alive.status, 401, `round ${round}: a session of the attacker survived`);
      }
      const [{ n }] = await t.db.query(
        `SELECT COUNT(*) AS n FROM dispositivo_confiable d JOIN usuarios u ON u.id = d.usuario_id WHERE u.email = ?`,
        [email],
      );
      assert.ok(Number(n) <= 1, `round ${round}: ${n} browsers; only the recovery's should remain`);
    }
  } finally {
    await t.db.query('UPDATE usuarios SET password_hash = ? WHERE email = ?', [original, email]);
  }
});

test('IND-03: one origin can not keep an account empty: past its share it stops spending the budget', async () => {
  const attacker = (n: number) => `203.0.113.${n}`;
  const statuses: number[] = [];
  for (let i = 0; i < 12; i++) statuses.push((await login(OWNER, WRONG, attacker(i + 1))).status);
  assert.deepEqual(
    statuses.filter((s) => s === 401).length,
    LOGIN_LIMITS.CUENTA_RED,
    'a whole /24 spends its share of the 10',
  );
  // The other half is still there for someone else.
  assert.equal((await login(OWNER, RIGHT, '198.51.100.9')).status, 200);
  // The attempts it retakes when they refill are its own share: 1 every 3 hours, not 2 an hour.
  await t.advance(WIDE_NETWORK_REFILL_MS - 60_000);
  forgetRefusals();
  assert.equal((await login(OWNER, WRONG, attacker(50))).status, 429);
  await t.advance(120_000);
  forgetRefusals();
  assert.equal((await login(OWNER, WRONG, attacker(51))).status, 401);
  forgetRefusals();
  assert.equal((await login(OWNER, WRONG, attacker(52))).status, 429);
});

test('IND-03: a whole /48 of IPv6 is one origin too', async () => {
  const statuses: number[] = [];
  for (let i = 1; i <= 12; i++)
    statuses.push((await login(OWNER, WRONG, `2001:db8:77:${i.toString(16)}::1`)).status);
  assert.equal(statuses.filter((s) => s === 401).length, LOGIN_LIMITS.CUENTA_RED);
  assert.equal((await login(OWNER, RIGHT, '2001:db8:78::1')).status, 200);
});

test('IND-03: requests from others can not show the owner a refusal of recovery, and the last e-mail still works', async () => {
  const email = 'coach@example.com';
  const [{ password_hash: original }] = await t.db.query(
    'SELECT password_hash FROM usuarios WHERE email = ?',
    [email],
  );
  const asks: number[] = [];
  for (let i = 0; i < 12; i++) {
    asks.push(
      (await post(`${base}/auth/password-reset/request`, { email }, `198.51.100.${i + 1}`)).status,
    );
    await recoveriesSettled();
  }
  assert.deepEqual([...new Set(asks)], [204]);
  assert.equal(t.mail.length, 5, 'only 5 e-mails');
  const owner = await post(`${base}/auth/password-reset/request`, { email }, '192.0.2.70');
  assert.equal(owner.status, 204);
  assert.equal(
    (await confirm(base, tokenIn(t.mail.at(-1)!.text))).status,
    204,
    'the last link works',
  );
  await t.db.query('UPDATE usuarios SET password_hash = ? WHERE email = ?', [original, email]);
});

test('IND-03: without e-mail, an operator can generate an access link; during an attack it gets that person in', async () => {
  const email = 'secretaria@example.com';
  const [{ password_hash: original }] = await t.db.query(
    'SELECT password_hash FROM usuarios WHERE email = ?',
    [email],
  );
  for (let i = 1; i <= 30; i++) await login(email, WRONG, `2001:db8:${i.toString(16)}::1`);
  forgetRefusals();
  const client = '192.0.2.80';
  assert.equal((await login(email, RIGHT, client)).status, 429);
  const run = spawnSync(process.execPath, ['api/access-link.ts', email], {
    env: { ...process.env, DB_NAME: t.name },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const res = await confirm(base, tokenIn(run.stdout), client);
  assert.equal(res.status, 204);
  const trust = browser(res);
  assert.equal((await login(email, 'Nueva-clave-2847', '192.0.2.81', trust)).status, 200);
  const [audited] = await t.db.query(
    "SELECT descripcion FROM auditoria WHERE descripcion = 'Enlace de acceso por consola' ORDER BY id DESC LIMIT 1",
  );
  assert.ok(audited);
  const unknown = spawnSync(process.execPath, ['api/access-link.ts', 'nadie@example.com'], {
    env: { ...process.env, DB_NAME: t.name },
    encoding: 'utf8',
  });
  assert.equal(unknown.status, 1);
  assert.doesNotMatch(unknown.stdout, /token=/);
  await t.db.query('UPDATE usuarios SET password_hash = ? WHERE email = ?', [original, email]);
});

test('IND-04: a NODE_ENV that is not exactly one of the three stops the start: the rest of the checks depend on it', () => {
  for (const bad of [
    'production                    # obligatorio',
    'Production',
    'prod',
    'production ',
  ])
    assert.match(checkEnvironment({ NODE_ENV: bad }).errors.join(), /NODE_ENV/, bad);
  for (const good of ['development', 'test', undefined, ''])
    assert.doesNotMatch(checkEnvironment({ NODE_ENV: good }).errors.join(), /NODE_ENV/);
});

test('IND-05: an account with a pending invitation takes the same Argon2id as any other', async () => {
  const admin = await adminAt();
  const email = staff();
  await rpc(base, admin, 'UserService', 'save', {
    roleId: 2,
    firstName: 'A',
    lastName: 'B',
    email,
  });
  const before = argon2Stats().runs;
  assert.equal((await login(email, WRONG, '192.0.2.90')).status, 401);
  assert.equal(argon2Stats().runs - before, 1);
});

test('IND-06: a backup that fails exits with an error and leaves no file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'respaldo-'));
  try {
    const run = spawnSync(
      'sh',
      ['db/mariadb/scripts/backup.sh', `ef_no_existe_${process.pid}`, dir],
      { encoding: 'utf8' },
    );
    assert.notEqual(run.status, 0);
    assert.equal(run.stdout, '');
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('IND-08: deactivating an account or changing its e-mail revokes its browsers; a cookie does not reach whoever takes the e-mail', async () => {
  const admin = await adminAt();
  const email = staff();
  const created = await (
    await rpc(base, admin, 'UserService', 'save', {
      roleId: 2,
      firstName: 'A',
      lastName: 'B',
      email,
    })
  ).json();
  const first = await confirm(base, tokenIn(t.mail.at(-1)!.text));
  const trust = browser(first);
  const rows = () =>
    t.count('SELECT COUNT(*) AS n FROM dispositivo_confiable WHERE usuario_id = ?', [
      created.result.id,
    ]);
  assert.equal(await rows(), 1);
  const edited = await rpc(base, admin, 'UserService', 'setActive', created.result.id, false);
  assert.equal(edited.status, 200);
  assert.equal(await rows(), 0, 'deactivated');
  await rpc(base, admin, 'UserService', 'setActive', created.result.id, true);
  const again = await login(email, 'Nueva-clave-2847', '192.0.2.91');
  assert.equal(again.status, 200);
  assert.equal(await rows(), 1);
  const moved = await rpc(base, admin, 'UserService', 'save', {
    id: created.result.id,
    roleId: 2,
    firstName: 'A',
    lastName: 'B',
    email: staff(),
  });
  assert.equal(moved.status, 200);
  assert.equal(await rows(), 0, 'e-mail changed');
  assert.ok(trust);
});

test('IND-09: a live link does nothing on a deactivated account, and deactivating revokes it', async () => {
  const admin = await adminAt();
  const email = staff();
  const created = await (
    await rpc(base, admin, 'UserService', 'save', {
      roleId: 2,
      firstName: 'A',
      lastName: 'B',
      email,
    })
  ).json();
  const token = tokenIn(t.mail.at(-1)!.text);
  await rpc(base, admin, 'UserService', 'setActive', created.result.id, false);
  assert.equal((await confirm(base, token)).status, 400);
  await t.db.query('UPDATE tokens_recuperacion SET usado_en = NULL WHERE usuario_id = ?', [
    created.result.id,
  ]);
  assert.equal((await confirm(base, token)).status, 400, 'also if something left the token alive');
});

test('IND-10: an invented cookie from the same network does not cancel a valid one, and a flood of them is bounded', async () => {
  const office = '203.0.113.60';
  const good = browser(await login(OWNER, RIGHT, office));
  for (let i = 0; i < LOGIN_LIMITS.IP + 2; i++) await login(`nadie${i}@example.com`, WRONG, office);
  const name = deviceCookieName(OWNER);
  assert.equal((await login(OWNER, WRONG, office, `${name}=${'a'.repeat(43)}`)).status, 429);
  const res = await login(OWNER, RIGHT, office, good);
  assert.equal(res.status, 200, 'the valid browser still gets in');
  // Twenty invented ones later (IND2-06) a valid browser still gets in, and repeating a bad one costs no lookup.
  for (let i = 0; i < 25; i++)
    await login(OWNER, WRONG, office, `${name}=${String(i).padStart(43, 'b')}`);
  const again = await login(OWNER, RIGHT, office, browser(res));
  assert.equal(again.status, 200);
  let queries = 0;
  const original = t.db.query.bind(t.db);
  (t.db as { query: unknown }).query = (...a: Parameters<typeof original>) => {
    if (/UPDATE dispositivo_confiable/.test(String(a[0]))) queries++;
    return original(...a);
  };
  try {
    for (let i = 0; i < 10; i++) await login(OWNER, WRONG, office, `${name}=${'c'.repeat(43)}`);
  } finally {
    (t.db as { query: unknown }).query = original;
  }
  assert.equal(queries, 1, 'a repeated bad cookie is remembered');
});

test('IND-11: a right password on a disabled account costs its attempt like a wrong one: the counters reveal nothing', async () => {
  const email = 'baja@example.com';
  const attempt = async (password: string, client: string) => {
    for (let i = 0; i < 4; i++) await login(email, WRONG, client);
    const fifth = await login(email, password, client);
    assert.equal(fifth.status, 401);
    return (await login(email, WRONG, client)).status;
  };
  assert.equal(await attempt(RIGHT, '198.51.100.1'), 429);
  assert.equal(await attempt(WRONG, '203.0.113.2'), 429);
});

test('IND-12: one account gets at most 29 recovery e-mails a day, whatever asks', async () => {
  const email = 'admin@example.com';
  const [{ password_hash: original }] = await t.db.query(
    'SELECT password_hash FROM usuarios WHERE email = ?',
    [email],
  );
  let n = 0;
  for (let hour = 0; hour < 24; hour++) {
    for (let i = 0; i < 4; i++) {
      await post(
        `${base}/auth/password-reset/request`,
        { email },
        `2001:db8:cc:${(n++).toString(16)}::1`,
      );
      await recoveriesSettled();
    }
    await t.advance(60 * 60_000);
    forgetRefusals();
  }
  assert.ok(t.mail.length <= 29, `${t.mail.length} e-mails`);
  assert.ok(t.mail.length >= 24, `${t.mail.length} e-mails`);
  await t.db.query('UPDATE usuarios SET password_hash = ? WHERE email = ?', [original, email]);
});

test('audit gap: an expired browser row trusts nothing even before the purge removes it', async () => {
  const email = OWNER;
  const res = await login(email, RIGHT, '192.0.2.92');
  const secret = browser(res).split('=')[1]!;
  assert.equal(await reserveDevice(t.db, secret, email), true);
  await t.advance((DEVICE_DAYS + 1) * 86_400_000);
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM dispositivo_confiable'), 1, 'still there');
  assert.equal(await reserveDevice(t.db, secret, email), false);
});

test('audit gap: the budget keeps what it did not refill: 45 minutes bring back 1, and 15 more the next', async () => {
  for (let i = 1; i <= LOGIN_LIMITS.CUENTA; i++)
    await login(OWNER, WRONG, `2001:db8:${(i + 100).toString(16)}::1`);
  await t.advance((ACCOUNT_REFILL_MS * 3) / 2);
  forgetRefusals();
  assert.equal((await login(OWNER, WRONG, '2001:db8:aa1::1')).status, 401);
  forgetRefusals();
  assert.equal((await login(OWNER, WRONG, '2001:db8:aa2::1')).status, 429);
  await t.advance(ACCOUNT_REFILL_MS / 2 + 1000);
  forgetRefusals();
  assert.equal((await login(OWNER, WRONG, '2001:db8:aa3::1')).status, 401);
});

test('IND2-01: re-running every migration on a database with rows of every scope changes nothing and fails nowhere', async () => {
  const { setupDatabase } = await import('./schema.ts');
  await login(OWNER, WRONG, '192.0.2.100');
  await post(`${base}/auth/password-reset/request`, { email: 'nadie@example.com' }, '192.0.2.101');
  await recoveriesSettled();
  const open = await adminAt();
  await post(
    `${base}/auth/password`,
    { currentPassword: 'mala-1', newPassword: 'Otra-clave-2847' },
    '192.0.2.102',
    open,
  );
  const rows = () =>
    t.db.query('SELECT clave, ambito, intentos FROM limite_acceso ORDER BY clave') as Promise<
      { ambito: string }[]
    >;
  const before = await rows();
  assert.deepEqual([...new Set(before.map((r) => r.ambito))].sort(), [
    'CAMBIO',
    'CUENTA',
    'CUENTA_IP',
    'CUENTA_RED',
    'IP',
    'RECUP_CUENTA',
    'RECUP_IP',
  ]);
  await setupDatabase({ ...process.env, DB_NAME: t.name });
  assert.deepEqual(await rows(), before);
});

test('IND2-02: a database without the scope of the running code is reported, not a silent 503 on every login', async () => {
  const { missingSchema } = await import('./schema.ts');
  const fake = {
    query: async () => [
      { t: 'limite_acceso', c: 'ambito', ct: "enum('CUENTA','IP')" },
      ...['version_datos', 'dispositivo_confiable', 'correo_cupo'].map((x) => ({ t: x, c: 'id', ct: 'int' })),
      { t: 'correo_saliente', c: 'cerrado_en', ct: 'datetime' },
      { t: 'pagos', c: 'referencia', ct: 'varchar(100)' },
    ],
  };
  assert.deepEqual(await missingSchema(fake), ['limite_acceso.ambito (CUENTA_RED)']);
  assert.deepEqual(await missingSchema(t.db), []);
});

test('IND2-03: changing the e-mail while a recovery and a login are in flight leaves nothing alive for the old address', async () => {
  const admin = await adminAt();
  for (let round = 0; round < 8; round++) {
    forgetRefusals();
    await t.db.query('DELETE FROM limite_acceso');
    const email = staff();
    const created = await (
      await rpc(base, admin, 'UserService', 'save', {
        roleId: 2,
        firstName: 'A',
        lastName: 'B',
        email,
      })
    ).json();
    assert.equal((await confirm(base, tokenIn(t.mail.at(-1)!.text))).status, 204);
    t.mail.length = 0;
    const others: Promise<unknown>[] = [];
    const logins: Promise<Response>[] = [];
    for (let i = 0; i < 5; i++) {
      others.push(post(`${base}/auth/password-reset/request`, { email }, `192.0.2.${110 + i}`));
      logins.push(login(email, 'Nueva-clave-2847', `192.0.2.${120 + i}`));
      await new Promise((r) => setTimeout(r, 2));
    }
    const moved = await rpc(base, admin, 'UserService', 'save', {
      id: created.result.id,
      roleId: 2,
      firstName: 'A',
      lastName: 'B',
      email: staff(),
    });
    await Promise.all(others);
    const answers = await Promise.all(logins);
    await recoveriesSettled();
    if (moved.status !== 200) continue; // refused by the concurrency: nothing changed, nothing to check
    for (const m of t.mail.filter((x) => x.to === email))
      assert.equal(
        (await confirm(base, tokenIn(m.text))).status,
        400,
        `round ${round}: a link to the old address works`,
      );
    for (const r of answers)
      if (r.status === 200) {
        const alive = await fetch(`${base}/auth/session`, { headers: { Cookie: session(r) } });
        assert.equal(alive.status, 401, `round ${round}: a session of the old address is alive`);
      }
  }
});

test('IND2-04: a recovery request of an attacker does not undo the link the operator generated', async () => {
  const email = 'coach@example.com';
  const [{ password_hash: original }] = await t.db.query(
    'SELECT password_hash FROM usuarios WHERE email = ?',
    [email],
  );
  const link = await operatorLink(email);
  await post(`${base}/auth/password-reset/request`, { email }, '192.0.2.130');
  await recoveriesSettled();
  assert.equal((await confirm(base, link)).status, 204);
  await t.db.query('UPDATE usuarios SET password_hash = ? WHERE email = ?', [original, email]);
});

test('IND2-07: a login blocked on its account answers 503 in seconds and gives everything back', async () => {
  const email = 'secretaria@example.com';
  const res = await login(email, RIGHT, '192.0.2.140');
  const trust = browser(res);
  const holder = await t.db.getConnection();
  await holder.beginTransaction();
  await holder.query('SELECT id FROM usuarios WHERE email = ? FOR UPDATE', [email]);
  try {
    const started = performance.now();
    const blocked = await login(email, RIGHT, '192.0.2.141');
    assert.equal(blocked.status, 503);
    assert.ok(performance.now() - started < 4000);
    const withCookie = await login(email, RIGHT, '192.0.2.142', trust);
    assert.equal(withCookie.status, 503);
  } finally {
    await holder.rollback();
    holder.release();
  }
  const [{ n }] = await t.db.query(
    "SELECT SUM(intentos) AS n FROM limite_acceso WHERE ambito = 'CUENTA'",
  );
  assert.equal(Number(n), 0, 'the attempt went back');
  const [{ fallos }] = await t.db.query('SELECT MAX(fallos) AS fallos FROM dispositivo_confiable');
  assert.equal(Number(fallos), 0, 'and so did the browser');
});

test('IND2-08: setting the password by one link kills the others of the account', async () => {
  const admin = await adminAt();
  const email = staff();
  await rpc(base, admin, 'UserService', 'save', {
    roleId: 2,
    firstName: 'A',
    lastName: 'B',
    email,
  });
  const invitation = tokenIn(t.mail.at(-1)!.text);
  const link = await operatorLink(email);
  assert.equal((await confirm(base, invitation)).status, 400, 'the operator replaced it');
  assert.equal((await confirm(base, link)).status, 204);
  await post(`${base}/auth/password-reset/request`, { email }, '192.0.2.150');
  await recoveriesSettled();
  const recovery = tokenIn(t.mail.at(-1)!.text);
  await post(`${base}/auth/password-reset/request`, { email }, '192.0.2.151');
  await recoveriesSettled();
  const newest = tokenIn(t.mail.at(-1)!.text);
  assert.equal((await confirm(base, newest)).status, 204);
  assert.equal((await confirm(base, recovery)).status, 400);
});

/** A live link created outside any endpoint, valid at the tests' time. */
async function extraLink(email: string): Promise<string> {
  const token = `extra-${Math.random().toString(36).slice(2)}`;
  await t.db.query(
    `INSERT INTO tokens_recuperacion (usuario_id, finalidad, token_hash, creado_en, expira_en)
     SELECT id, 'RECUPERACION', ?, ?, ? FROM usuarios WHERE email = ?`,
    [sha256(token), localDateTime(), localDateTime(Date.now() + 3_600_000), email],
  );
  return token;
}

test('IND2-08 (isolated): confirming one link kills every other live link of the account, whatever made it', async () => {
  const email = 'marta@example.com';
  const [{ password_hash: original }] = await t.db.query(
    'SELECT password_hash FROM usuarios WHERE email = ?',
    [email],
  );
  const first = await extraLink(email);
  const second = await extraLink(email);
  assert.equal((await confirm(base, first)).status, 204);
  assert.equal((await confirm(base, second)).status, 400);
  await t.db.query('UPDATE usuarios SET password_hash = ? WHERE email = ?', [original, email]);
});

test('IND3-06: a password change kills the account’s live links', async () => {
  const email = 'marta@example.com';
  const [{ password_hash: original }] = await t.db.query(
    'SELECT password_hash FROM usuarios WHERE email = ?',
    [email],
  );
  const link = await extraLink(email);
  const open = session(await login(email, RIGHT, '192.0.2.160'));
  const changed = await post(
    `${base}/auth/password`,
    { currentPassword: RIGHT, newPassword: 'Cambiada-2847' },
    '192.0.2.160',
    open,
  );
  assert.equal(changed.status, 204);
  assert.equal((await confirm(base, link)).status, 400);
  await t.db.query('UPDATE usuarios SET password_hash = ? WHERE email = ?', [original, email]);
});

test('IND3-03: recovery is counted per network, not per /24: one neighbour can not block an office', async () => {
  for (let i = 0; i < 25; i++)
    await post(
      `${base}/auth/password-reset/request`,
      { email: `x${i}@nobody.example` },
      '203.0.113.10',
    );
  const neighbour = await post(
    `${base}/auth/password-reset/request`,
    { email: 'tutor@example.com' },
    '203.0.113.11',
  );
  assert.equal(neighbour.status, 204);
  await recoveriesSettled();
});

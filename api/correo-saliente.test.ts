/**
 * F5-08 / F5-02: the outbox and the provider. A provider failure after COMMIT neither reports the committed operation
 * as failed nor loses the notice, and no secret, host or provider message reaches the client or the table.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from './server.ts';
import { sha256 } from './auth.ts';
import {
  MAX_MAIL_ATTEMPTS,
  MailError,
  mailerFromEnv,
  processMailQueue,
  resendMailer,
  type Mailer,
} from './mail.ts';
import { forgetRefusals } from './login-limit.ts';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
let admin: string;
const open: Server[] = [];
const TEN_MIN = 10 * 60_000;

before(async () => {
  t = await openTestDb('ef_mail');
});
after(async () => {
  for (const s of open) s.close();
  await t?.close();
});
beforeEach(async () => {
  forgetRefusals();
  await t.db.query('DELETE FROM limite_acceso');
  await t.db.query('DELETE FROM correo_saliente');
});

async function appWith(mailer: Mailer): Promise<string> {
  const s = createApp(t.db, { secureCookie: false, mailer }).listen(0);
  open.push(s);
  await new Promise((resolve) => s.once('listening', resolve));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
async function invite(base: string, email: string) {
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'demo1234' }),
  });
  admin = login.headers.get('set-cookie')!.split(';')[0]!;
  return fetch(`${base}/api/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: admin },
    body: JSON.stringify({
      service: 'UserService',
      method: 'save',
      args: [{ roleId: 2, firstName: 'Alta', lastName: 'Prueba', email }],
    }),
  });
}
const outbox = async (email: string) =>
  (await t.db.query('SELECT * FROM correo_saliente WHERE destinatario = ? ORDER BY id', [
    email,
  ])) as {
    id: number;
    estado: string;
    intentos: number;
    ultimo_error: string | null;
    proveedor_id: string | null;
    token_id: number;
  }[];
const SECRET = /SENTINEL|smtp\.internal|ECONNRESET|10\.0\.0\.9/;
const confirm = (base: string, token: string) =>
  fetch(`${base}/auth/password-reset/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, newPassword: 'Acceso12345' }),
  }).then((r) => r.status);

for (const [mode, fail] of [
  ['the provider rejects (permanent)', () => new MailError('HTTP_422', true)],
  ['a timeout', () => new MailError('TIMEOUT', false)],
  [
    'a dropped connection with a raw error',
    () => Object.assign(new Error('read ECONNRESET 10.0.0.9 key=re_SENTINEL'), { code: 'X' }),
  ],
] as const)
  test(`after COMMIT, ${mode}: 200 with the account, a notice for the user, nothing internal, nothing duplicated`, async () => {
    const email = `alta-${mode.length}@example.com`;
    const base = await appWith(() => {
      throw fail();
    });
    const res = await invite(base, email);
    const text = await res.text();
    assert.equal(res.status, 200, text);
    assert.doesNotMatch(text, SECRET);
    const body = JSON.parse(text);
    assert.equal(body.mailPending, true);
    assert.equal(body.result.email, email);
    const [row] = await outbox(email);
    assert.equal(row!.intentos, 1);
    assert.equal(row!.estado, mode.includes('permanent') ? 'FALLIDO' : 'PENDIENTE');
    assert.doesNotMatch(String(row!.ultimo_error), SECRET);
    // Repeating the operation: refused as a duplicate, one account, one invitation, one row.
    const again = await invite(base, email);
    assert.equal(again.status, 400);
    assert.equal(await t.count('SELECT COUNT(*) AS n FROM usuarios WHERE email = ?', [email]), 1);
    assert.equal((await outbox(email)).length, 1);
  });

test('a successful send is recorded with the provider reference, and the answer has no notice', async () => {
  const base = await appWith(() => ({ id: 'proveedor-123' }));
  const res = await invite(base, 'alta-ok@example.com');
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.mailPending, undefined);
  const [row] = await outbox('alta-ok@example.com');
  assert.equal(row!.estado, 'ENVIADO');
  assert.equal(row!.proveedor_id, 'proveedor-123');
  assert.equal(row!.intentos, 1);
});

test('the outbox holds no body and no token', async () => {
  let link = '';
  const base = await appWith((_to, _s, text) => void (link = text));
  await invite(base, 'alta-sin-token@example.com');
  const token = /token=([\w-]+)/.exec(link)![1]!;
  const rows = await outbox('alta-sin-token@example.com');
  assert.doesNotMatch(JSON.stringify(rows), new RegExp(token));
  assert.doesNotMatch(JSON.stringify(rows), new RegExp(sha256(token)));
});

test('an operation that rolls back leaves no message behind', async () => {
  const base = await appWith(() => undefined);
  await invite(base, 'duplicada@example.com');
  const before = await t.count('SELECT COUNT(*) AS n FROM correo_saliente');
  const res = await invite(base, 'duplicada@example.com');
  assert.equal(res.status, 400);
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM correo_saliente'), before);
});

test('a retry issues a new link, revokes the old one, and the new one works', async () => {
  let sent = '';
  let down = true;
  const mailer: Mailer = (_to, _s, text) => {
    if (down) throw new MailError('TIMEOUT', false);
    sent = text;
  };
  const failing: string[] = [];
  const base = await appWith((to, s, text) => {
    failing.push(text);
    return mailer(to, s, text);
  });
  const email = 'alta-reintento@example.com';
  await invite(base, email);
  const firstToken = /token=([\w-]+)/.exec(failing[0]!)![1]!;
  const [row] = await outbox(email);
  assert.equal(row!.estado, 'PENDIENTE');
  // Not due yet: the worker leaves it alone.
  assert.equal(await processMailQueue(t.db, mailer), 0);
  await t.advance(TEN_MIN);
  down = false;
  assert.equal(await processMailQueue(t.db, mailer), 1);
  const [done] = await outbox(email);
  assert.equal(done!.estado, 'ENVIADO');
  assert.equal(done!.intentos, 2);
  const newToken = /token=([\w-]+)/.exec(sent)![1]!;
  assert.notEqual(newToken, firstToken);
  assert.equal(await confirm(base, firstToken), 400, 'the old link no longer works');
  assert.equal(await confirm(base, newToken), 204);
  assert.equal(await processMailQueue(t.db, mailer), 0, 'nothing left');
});

test('retries back off and stop: after the maximum attempts the message is closed as failed', async () => {
  const failing: Mailer = () => {
    throw new MailError('HTTP_500', false);
  };
  const base = await appWith(failing);
  const email = 'alta-agotada@example.com';
  await invite(base, email);
  // Inside the 24 h of an invitation, the backoff (2, 4, 8… minutes, at most 60) allows every attempt.
  for (let i = 0; i < MAX_MAIL_ATTEMPTS + 2; i++) {
    await t.advance(61 * 60_000);
    await processMailQueue(t.db, failing);
  }
  const [row] = await outbox(email);
  assert.equal(row!.estado, 'FALLIDO');
  assert.equal(row!.intentos, MAX_MAIL_ATTEMPTS);
});

test('a message past its validity is closed, not sent', async () => {
  let calls = 0;
  const base = await appWith(() => {
    calls++;
    throw new MailError('TIMEOUT', false);
  });
  await invite(base, 'alta-vencida@example.com');
  await t.advance(25 * 3_600_000);
  await processMailQueue(t.db, () => {
    calls++;
  });
  assert.equal(calls, 1, 'only the first attempt');
  const [row] = await outbox('alta-vencida@example.com');
  assert.equal(row!.estado, 'FALLIDO');
  assert.equal(row!.ultimo_error, 'VENCIDO');
});

test('a link already used closes the pending message: no second e-mail, no new token', async () => {
  const sent: string[] = [];
  const base = await appWith((_to, _s, text) => {
    sent.push(text);
    throw new MailError('TIMEOUT', false); // ambiguous: the provider may have delivered it
  });
  const email = 'alta-usada@example.com';
  await invite(base, email);
  assert.equal(await confirm(base, /token=([\w-]+)/.exec(sent[0]!)![1]!), 204);
  await t.advance(TEN_MIN);
  await processMailQueue(t.db, () => assert.fail('must not send'));
  const [row] = await outbox(email);
  assert.equal(row!.estado, 'FALLIDO');
  assert.equal(row!.ultimo_error, 'TOKEN_YA_USADO');
});

test('a deactivated account gets no retry', async () => {
  const base = await appWith(() => {
    throw new MailError('TIMEOUT', false);
  });
  const email = 'alta-inactiva@example.com';
  await invite(base, email);
  await t.db.query('UPDATE usuarios SET activo = 0 WHERE email = ?', [email]);
  await t.advance(TEN_MIN);
  await processMailQueue(t.db, () => assert.fail('must not send'));
  const [row] = await outbox(email);
  assert.equal(row!.ultimo_error, 'CUENTA_INACTIVA');
});

test('a crash after COMMIT: the row is picked up; two workers never take the same row', async () => {
  const email = 'alta-caida@example.com';
  const base = await appWith(() => undefined);
  await invite(base, email);
  await t.db.query(
    "UPDATE correo_saliente SET estado = 'PENDIENTE', enviado_en = NULL WHERE destinatario = ?",
    [email],
  );
  await t.advance(TEN_MIN);
  const sent: string[] = [];
  const mailer: Mailer = async (to) => {
    await new Promise((r) => setTimeout(r, 20));
    sent.push(to);
  };
  const handled = await Promise.all([
    processMailQueue(t.db, mailer),
    processMailQueue(t.db, mailer),
  ]);
  assert.equal(handled[0]! + handled[1]!, 1);
  assert.deepEqual(sent, [email]);
  // A worker that died holding the lease: it comes back when the lease ends.
  await t.db.query(
    "UPDATE correo_saliente SET estado = 'ENVIANDO', bloqueado_hasta = ? WHERE destinatario = ?",
    [
      new Date(Date.now() + 60_000).toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' }),
      email,
    ],
  );
  assert.equal(await processMailQueue(t.db, mailer), 0);
  await t.advance(120_000);
  assert.equal(await processMailQueue(t.db, mailer), 1);
});

test('password recovery: a provider failure answers the same 204 and is retried', async () => {
  const base = await appWith(() => {
    throw new MailError('TIMEOUT', false);
  });
  const res = await fetch(`${base}/auth/password-reset/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'tutor@example.com' }),
  });
  assert.equal(res.status, 204);
  await new Promise((r) => setTimeout(r, 100)); // the send is not awaited by the answer (S-06)
  const [row] = await outbox('tutor@example.com');
  assert.equal(row!.estado, 'PENDIENTE');
  await t.advance(TEN_MIN);
  const sent: string[] = [];
  assert.equal(await processMailQueue(t.db, (_to, _s, text) => void sent.push(text)), 1);
  assert.match(sent[0]!, /válido 60 min/);
  assert.equal(await confirm(base, /token=([\w-]+)/.exec(sent[0]!)![1]!), 204);
  // Restore the seed's password for the rest of the file.
  await t.db.query(
    "UPDATE usuarios u JOIN usuarios a ON a.email = 'admin@example.com' SET u.password_hash = a.password_hash WHERE u.email = 'tutor@example.com'",
  );
});

test('the answer of a recovery request does not wait for the provider (S-06)', async () => {
  const base = await appWith(() => new Promise((r) => setTimeout(r, 1500)));
  const started = performance.now();
  const res = await fetch(`${base}/auth/password-reset/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'coach@example.com' }),
  });
  assert.equal(res.status, 204);
  assert.ok(performance.now() - started < 1000, 'answered before the provider did');
});

// ------------------------------------------------------------------ the Resend transport, against a simulator

async function simulator(
  answer: (res: import('node:http').ServerResponse, body: string) => void,
): Promise<{ url: string; requests: { auth: string; body: Record<string, unknown> }[] }> {
  const requests: { auth: string; body: Record<string, unknown> }[] = [];
  const s = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      requests.push({ auth: req.headers.authorization ?? '', body: JSON.parse(raw) });
      answer(res, raw);
    });
  }).listen(0, '127.0.0.1');
  open.push(s);
  await new Promise((resolve) => s.once('listening', resolve));
  return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, requests };
}
const KEY = 're_SENTINEL_clave';

test('Resend: accepted → its id; the key only travels in the header', async () => {
  const sim = await simulator((res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"id":"abc-123"}');
  });
  const mailer = resendMailer({
    apiKey: KEY,
    from: 'Charales <no-reply@example.com>',
    baseUrl: sim.url,
  });
  assert.deepEqual(await mailer('a@example.com', 'Asunto', 'Texto'), { id: 'abc-123' });
  assert.equal(sim.requests[0]!.auth, `Bearer ${KEY}`);
  assert.deepEqual(sim.requests[0]!.body, {
    from: 'Charales <no-reply@example.com>',
    to: ['a@example.com'],
    subject: 'Asunto',
    text: 'Texto',
  });
});

for (const [status, permanent] of [
  [401, true],
  [403, true],
  [422, true],
  [408, false],
  [429, false],
  [500, false],
  [503, false],
] as const)
  test(`Resend: HTTP ${status} is ${permanent ? 'permanent' : 'retried'}; the error carries only its code`, async () => {
    const sim = await simulator((res) => {
      res.writeHead(status).end(`{"message":"secreto del proveedor ${KEY}"}`);
    });
    const mailer = resendMailer({ apiKey: KEY, from: 'x@example.com', baseUrl: sim.url });
    await assert.rejects(Promise.resolve(mailer('a@example.com', 's', 't')), (e: MailError) => {
      assert.equal(e.code, `HTTP_${status}`);
      assert.equal(e.permanent, permanent);
      assert.doesNotMatch(e.message, /SENTINEL|secreto/);
      return true;
    });
  });

test('Resend: a timeout and a dropped connection are retried, without details', async () => {
  const slow = await simulator(() => undefined); // never answers
  await assert.rejects(
    Promise.resolve(
      resendMailer({ apiKey: KEY, from: 'x@e.com', baseUrl: slow.url, timeoutMs: 100 })(
        'a@e.com',
        's',
        't',
      ),
    ),
    (e: MailError) => e.code === 'TIMEOUT' && !e.permanent,
  );
  const drop = await simulator((res) => res.destroy());
  await assert.rejects(
    Promise.resolve(
      resendMailer({ apiKey: KEY, from: 'x@e.com', baseUrl: drop.url })('a@e.com', 's', 't'),
    ),
    (e: MailError) => e.code === 'RED' && !e.permanent && !/127\.0\.0\.1/.test(e.message),
  );
});

test('Which transport: each environment gets its own, and links become absolute', async () => {
  assert.equal(mailerFromEnv({}), null);
  assert.equal(mailerFromEnv({ MAIL_PROVIDER: 'none', MAIL_CONSOLE: 'true' }), null);
  assert.equal(mailerFromEnv({ NODE_ENV: 'production', MAIL_CONSOLE: 'true' }), null);
  assert.equal(mailerFromEnv({ MAIL_PROVIDER: 'resend' }), null, 'without its settings');
  assert.equal(typeof mailerFromEnv({ MAIL_CONSOLE: 'true' }), 'function');
  const sim = await simulator((res) => res.writeHead(200).end('{"id":"1"}'));
  const mailer = mailerFromEnv({
    NODE_ENV: 'production',
    MAIL_PROVIDER: 'resend',
    RESEND_API_KEY: KEY,
    MAIL_FROM: 'x@example.com',
    RESEND_BASE_URL: sim.url,
    APP_URL: 'https://escuela.example/',
  })!;
  await mailer('a@example.com', 's', 'Enlace: /reset-password?token=abc');
  assert.equal(
    sim.requests[0]!.body['text'],
    'Enlace: https://escuela.example/reset-password?token=abc',
  );
});

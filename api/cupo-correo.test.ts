/**
 * Cierre funcional 2026: the global sending budget (correo_cupo, migration 009). It is one budget for the whole API —
 * every account, network, instance and process — kept in MariaDB, so it survives a restart. A message without a slot
 * waits (PENDIENTE, no attempt spent) and the worker sends it once a slot comes back; nothing is lost or duplicated.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import type { Pool } from 'mariadb';
import { checkEnvironment } from './config.ts';
import { forgetRefusals } from './login-limit.ts';
import {
  MAIL_QUOTA_DEFAULTS,
  MailError,
  deliverMail,
  mailQuotaFrom,
  processMailQueue,
  setMailQuota,
  takeMailSlot,
  type Mailer,
} from './mail.ts';
import { recoveriesSettled } from './password.ts';
import { createApp, createPool } from './server.ts';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
const servers: Server[] = [];
const sent: { to: string; subject: string }[] = [];
let failing = false;
const mailer: Mailer = (to, subject) => {
  if (failing) throw new MailError('TIMEOUT', false);
  sent.push({ to, subject });
};
// 4 an hour (one every 15 min), 2 of them at most for recoveries (one every 30 min).
const QUOTA = { perHour: 4, recoveryPerHour: 2 };
const MIN = 60_000;
let admin = '';

async function instance(): Promise<string> {
  const s = createApp(t.db, { secureCookie: false, trustedProxies: ['127.0.0.1'], mailer });
  s.listen(0, '127.0.0.1');
  servers.push(s);
  await new Promise((resolve) => s.once('listening', resolve));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
let a: string;
let b: string;
before(async () => {
  t = await openTestDb('ef_cupo');
  setMailQuota(QUOTA);
  a = await instance();
  b = await instance();
});
after(async () => {
  setMailQuota(MAIL_QUOTA_DEFAULTS);
  for (const s of servers) s.close();
  await t?.close();
});
beforeEach(async () => {
  forgetRefusals();
  failing = false;
  admin = ''; // the fixed clock moves: log in again
  sent.length = 0;
  await t.db.query('DELETE FROM limite_acceso');
  await t.db.query('DELETE FROM correo_saliente');
  await t.db.query('UPDATE correo_cupo SET usados = 0, desde_ms = 0');
});

const recover = (base: string, email: string, ip: string) =>
  fetch(`${base}/auth/password-reset/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ email }),
  }).then(async (r) => {
    await r.arrayBuffer();
    await recoveriesSettled();
    return r.status;
  });
async function invite(base: string, email: string): Promise<{ mailPending?: boolean }> {
  if (!admin) admin = await t.login('admin@example.com');
  const r = await fetch(`${base}/api/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: admin },
    body: JSON.stringify({
      service: 'UserService',
      method: 'save',
      args: [{ roleId: 2, firstName: 'Cupo', lastName: 'Prueba', email }],
    }),
  });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  return body;
}
type Row = {
  id: number;
  finalidad: string;
  destinatario: string;
  estado: string;
  intentos: number;
};
const rows = async (): Promise<Row[]> =>
  t.db.query(
    'SELECT id, finalidad, destinatario, estado, intentos FROM correo_saliente ORDER BY id',
  );
const byState = (rs: Row[]) =>
  rs.reduce<Record<string, number>>((m, r) => ((m[r.estado] = (m[r.estado] ?? 0) + 1), m), {});

test('one budget for every account, network and instance: recoveries take at most their share', async () => {
  // Three accounts, three networks, two instances: a per-account or per-network limit would let all through.
  assert.equal(await recover(a, 'marta@example.com', '198.51.100.1'), 204);
  assert.equal(await recover(b, 'tutor@example.com', '203.0.113.7'), 204);
  assert.equal(await recover(a, 'coach@example.com', '2001:db8:9::1'), 204);
  // The same account again, from yet another network.
  assert.equal(await recover(b, 'marta@example.com', '192.0.2.44'), 204);
  assert.equal(sent.length, QUOTA.recoveryPerHour, 'only the recovery share went out');
  const rs = await rows();
  assert.equal(rs.length, 4, 'every request has its message: none lost');
  assert.deepEqual(byState(rs), { ENVIADO: 2, PENDIENTE: 2 });
  for (const r of rs.filter((r) => r.estado === 'PENDIENTE'))
    assert.equal(r.intentos, 0, 'waiting for a slot costs no attempt');
});

test('IND4-01: one /48 (many /64) asking for many accounts sends no more than the recovery share', async () => {
  const accounts = ['marta', 'tutor', 'coach', 'secretaria', 'admin'];
  let answered = 0;
  for (let i = 0; i < 25; i++)
    if (
      (await recover(a, `${accounts[i % 5]}@example.com`, `2001:db8:4801:${i.toString(16)}::1`)) ===
      204
    )
      answered++;
  assert.equal(answered, 25, 'every /64 is its own network for the per-network limit (IND3-03)');
  assert.equal(sent.length, QUOTA.recoveryPerHour, 'but the provider gets only the global share');
});

test('a flood of recoveries never leaves invitations without slots', async () => {
  for (let i = 0; i < 10; i++)
    await recover(
      a,
      ['marta', 'tutor', 'coach', 'secretaria'][i % 4] + '@example.com',
      `10.${i}.0.1`,
    );
  assert.equal(sent.length, QUOTA.recoveryPerHour);
  // The rest of the budget is still there for operational mail.
  assert.notEqual((await invite(a, 'cupo-1@example.com')).mailPending, true);
  assert.notEqual((await invite(b, 'cupo-2@example.com')).mailPending, true);
  // Now the whole budget is spent: an invitation waits, but the operation itself succeeded.
  assert.equal((await invite(a, 'cupo-3@example.com')).mailPending, true);
  assert.equal(sent.length, QUOTA.perHour);
});

test('after the limit: the worker sends what waited, invitations first, each message once', async () => {
  await recover(a, 'marta@example.com', '198.51.100.1');
  await recover(a, 'tutor@example.com', '198.51.100.2');
  await recover(a, 'coach@example.com', '198.51.100.3'); // waits: recovery share spent
  await invite(a, 'cupo-4@example.com');
  await invite(a, 'cupo-5@example.com');
  await invite(a, 'cupo-6@example.com'); // waits: whole budget spent
  assert.equal(sent.length, 4);
  // Nothing is due yet: the worker leaves both alone and sends nothing.
  await processMailQueue(t.db, mailer);
  assert.equal(sent.length, 4);
  // 15 minutes: one slot back in TOTAL. The invitation goes; the recovery waits for its own share.
  await t.advance(15 * MIN);
  await processMailQueue(t.db, mailer);
  assert.deepEqual(
    sent.slice(4).map((m) => m.to),
    ['cupo-6@example.com'],
  );
  // 30 minutes: both budgets have room again, and the recovery goes too.
  await t.advance(15 * MIN);
  await processMailQueue(t.db, mailer);
  assert.deepEqual(
    sent.slice(5).map((m) => m.to),
    ['coach@example.com'],
  );
  const rs = await rows();
  assert.deepEqual(byState(rs), { ENVIADO: 6 }, 'nothing lost');
  assert.ok(
    rs.every((r) => r.intentos === 1),
    'each sent once',
  );
  assert.equal(new Set(sent.map((m) => m.to)).size, sent.length, 'no duplicates');
});

test('a provider failure spends its slot and is retried, within the budget, without duplicates', async () => {
  failing = true;
  await invite(a, 'cupo-7@example.com');
  let [row] = await rows();
  assert.equal(row!.estado, 'PENDIENTE');
  assert.equal(row!.intentos, 1, 'the failed attempt counts');
  const [total] = await t.db.query("SELECT usados FROM correo_cupo WHERE ambito = 'TOTAL'");
  assert.equal(Number(total.usados), 1, 'the provider was called: a slot was spent');
  failing = false;
  await t.advance(60 * MIN);
  await processMailQueue(t.db, mailer);
  [row] = await rows();
  assert.equal(row!.estado, 'ENVIADO');
  assert.equal(row!.intentos, 2);
  assert.equal(sent.length, 1);
});

test('concurrency: many requests at once never take more slots than the budget', async () => {
  const pools = [t.db, createPool({ ...process.env, DB_NAME: t.name })];
  try {
    const waits = await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        takeMailSlot(pools[i % 2]!, i % 3 ? 'INVITACION' : 'RECUPERACION'),
      ),
    );
    assert.equal(waits.filter((w) => w === 0).length, QUOTA.perHour);
    const [total] = await t.db.query("SELECT usados FROM correo_cupo WHERE ambito = 'TOTAL'");
    assert.equal(Number(total.usados), QUOTA.perHour);
  } finally {
    await pools[1]!.end();
  }
});

test('several processes share the budget (it lives in MariaDB, not in memory)', async () => {
  // Three separate Node processes, each trying 5 slots at once against the same database, on the real clock.
  const script = `
    import { setMailQuota, takeMailSlot } from './api/mail.ts';
    import { createPool } from './api/server.ts';
    setMailQuota(${JSON.stringify(QUOTA)});
    const db = createPool({ ...process.env, DB_NAME: ${JSON.stringify(t.name)} });
    const waits = await Promise.all(Array.from({ length: 5 }, () => takeMailSlot(db, 'INVITACION')));
    await db.end();
    console.log(waits.filter((w) => w === 0).length);`;
  const run = promisify(execFile);
  const outs = await Promise.all(
    [0, 1, 2].map(() => run(process.execPath, ['--input-type=module', '-e', script])),
  );
  const taken = outs.map((o) => Number(o.stdout.trim()));
  assert.equal(
    taken.reduce((x, y) => x + y, 0),
    QUOTA.perHour,
    `slots per process: ${taken.join(', ')}`,
  );
});

test('a restart keeps the spent budget and the waiting messages', async () => {
  for (let i = 0; i < 5; i++) await invite(a, `cupo-r${i}@example.com`);
  assert.equal(sent.length, QUOTA.perHour);
  // A "restarted" API: new pool, new server, nothing in memory.
  const fresh = createPool({ ...process.env, DB_NAME: t.name });
  try {
    assert.ok((await takeMailSlot(fresh, 'INVITACION')) > 0, 'still no slot after the restart');
    assert.deepEqual(byState(await rows()), { ENVIADO: 4, PENDIENTE: 1 });
    await t.advance(15 * MIN);
    await processMailQueue(fresh, mailer);
    assert.deepEqual(byState(await rows()), { ENVIADO: 5 });
  } finally {
    await fresh.end();
  }
});

test('if MariaDB fails while taking a slot, nothing is sent and the message waits', async () => {
  await invite(a, 'cupo-db@example.com'); // one row, sent
  const [row] = await rows();
  await t.db.query("UPDATE correo_saliente SET estado = 'PENDIENTE' WHERE id = ?", [row!.id]);
  sent.length = 0;
  // A pool whose budget table is unreachable (the rest of the database works).
  const broken = new Proxy(t.db, {
    get(target, key) {
      if (key === 'getConnection')
        return () =>
          Promise.reject(Object.assign(new Error('down'), { code: 'ER_GET_CONNECTION_TIMEOUT' }));
      const v = Reflect.get(target, key);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as Pool;
  const state = await deliverMail(broken, mailer, row!.id, row!.destinatario, 's', 'x');
  assert.equal(state, 'PENDIENTE');
  assert.equal(sent.length, 0, 'never sent without a slot');
  const [after] = await rows();
  assert.equal(after!.intentos, 1, 'no attempt spent');
  assert.equal(after!.estado, 'PENDIENTE');
});

test('configuration: defaults, overrides and invalid values', () => {
  assert.deepEqual(mailQuotaFrom({}), { perHour: 60, recoveryPerHour: 20 });
  assert.deepEqual(mailQuotaFrom({ CORREO_MAX_POR_HORA: '4' }), { perHour: 4, recoveryPerHour: 4 });
  assert.deepEqual(
    mailQuotaFrom({ CORREO_MAX_POR_HORA: '100', CORREO_MAX_RECUPERACION_POR_HORA: '10' }),
    { perHour: 100, recoveryPerHour: 10 },
  );
  for (const env of [
    { CORREO_MAX_POR_HORA: '0' },
    { CORREO_MAX_POR_HORA: 'muchos' },
    { CORREO_MAX_POR_HORA: '2.5' },
    { CORREO_MAX_POR_HORA: '5', CORREO_MAX_RECUPERACION_POR_HORA: '6' },
  ])
    assert.throws(() => mailQuotaFrom(env), /CORREO_MAX/);
  assert.ok(
    checkEnvironment({ NODE_ENV: 'test', CORREO_MAX_POR_HORA: '-1' }).errors.some((e) =>
      e.includes('CORREO_MAX_POR_HORA'),
    ),
  );
});

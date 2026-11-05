/** F5-01, F5-06, F5-10, F5-12, F5-17, F5-18: what the API exposes, and what it refuses at startup. */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, createPool } from './server.ts';
import {
  dropTestDatabase,
  missingSchema,
  runSqlFile,
  setupDatabase,
  uniqueTestDatabase,
} from './schema.ts';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
const open: Server[] = [];
async function appWith(options: Parameters<typeof createApp>[1], db = t.db): Promise<string> {
  const s = createApp(db, options).listen(0, '127.0.0.1');
  open.push(s);
  await new Promise((resolve) => s.once('listening', resolve));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
before(async () => {
  t = await openTestDb('ef_hard', { realClock: true });
});
after(async () => {
  for (const s of open) s.close();
  await t?.close();
});

test('every answer forbids framing, sniffing, caching and referrers', async () => {
  for (const path of ['/health', '/no-existe']) {
    const r = await fetch(`${t.base}${path}`);
    assert.equal(
      r.headers.get('content-security-policy'),
      "default-src 'none'; frame-ancestors 'none'",
    );
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  }
});

test('F5-18: the course endpoints exist only outside production', async () => {
  const cookie = await t.login('secretaria@example.com');
  const headers = { Cookie: cookie };
  assert.equal((await fetch(`${t.base}/api/jugadores`, { headers })).status, 200);
  assert.equal((await fetch(`${t.base}/api/categorias`, { headers })).status, 200);
  const production = await appWith({ secureCookie: true, labApi: false });
  assert.equal((await fetch(`${production}/api/jugadores`, { headers })).status, 404);
  assert.equal((await fetch(`${production}/api/categorias`, { headers })).status, 404);
  const ok = await fetch(`${production}/auth/session`, { headers });
  assert.equal(ok.status, 200, 'the rest of the API is there');
});

test('F5-10: one session runs 3 operations at once and queues 32; the rest are refused without a query; others are not affected', async () => {
  const tutor = await t.login('tutor@example.com');
  const secretaria = await t.login('secretaria@example.com');
  const call = (cookie: string) =>
    fetch(`${t.base}/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ service: 'PortalService', method: 'overview', args: [] }),
    });
  // The global lock taken from outside, so the operations of the flood pile up instead of finishing one by one.
  const holder = await t.db.getConnection();
  await holder.query("SELECT GET_LOCK(CONCAT('charales_domain:', DATABASE()), 5)");
  try {
    const flood = Array.from({ length: 60 }, () => call(tutor));
    // Those over the cap are answered at once, while the lock is still held.
    const refused = await Promise.all(
      flood.map((p) =>
        Promise.race([
          p.then((r) => r.status),
          new Promise((r) => setTimeout(() => r('waiting'), 1000)),
        ]),
      ),
    );
    assert.equal(refused.filter((s) => s === 429).length, 60 - 35);
    assert.equal(refused.filter((s) => s === 'waiting').length, 35);
    const other = call(secretaria); // another account has its own allowance
    await holder.query("SELECT RELEASE_LOCK(CONCAT('charales_domain:', DATABASE()))");
    assert.notEqual((await other).status, 429);
    const first429 = await Promise.all(flood);
    const statuses = first429.map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 200).length, 35);
    assert.match(
      (await first429.find((r) => r.status === 429)!.json()).error,
      /Demasiadas solicitudes/,
    );
  } finally {
    holder.release();
  }
  // It frees itself: the slots are given back.
  assert.equal((await call(tutor)).status, 200);
});

// ------------------------------------------------------------------ a database behind the code

test('F5-06 / F5-17: a database without the migrations: said by name, never to the client', async () => {
  const name = uniqueTestDatabase('ef_old');
  const env = { ...process.env, DB_NAME: name };
  await setupDatabase(env);
  try {
    const db = createPool(env);
    try {
      assert.deepEqual(await missingSchema(db), []);
      await db.query('DROP TABLE correo_saliente, origen_conocido');
      await db.query('ALTER TABLE pagos DROP COLUMN referencia');
      assert.deepEqual(await missingSchema(db), [
        'origen_conocido',
        'correo_saliente',
        'pagos.referencia',
      ]);
      await runSqlFile(env, name, 'db/mariadb/020_dev_seed.sql');
      const base = await appWith({ secureCookie: false }, db);
      // Login refuses to run without its table (fails closed).
      const login = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', password: 'demo1234' }),
      });
      assert.equal(login.status, 503);
      // RPC: a generic 500, no table or column name.
      const [u] = await db.query(
        'SELECT id FROM usuarios WHERE rol_id IS NOT NULL ORDER BY id LIMIT 1',
      );
      const { createHash } = await import('node:crypto');
      const now = new Date().toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' });
      await db.query(
        `INSERT INTO sesiones (usuario_id, token_hash, inicio_en, expira_en, ultimo_uso_en, ip, user_agent)
         VALUES (?, ?, ?, DATE_ADD(?, INTERVAL 8 HOUR), ?, '127.0.0.1', 'prueba')`,
        [u.id, createHash('sha256').update('tok').digest('hex'), now, now, now],
      );
      const rpc = await fetch(`${base}/api/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: 'charales_sid=tok' },
        body: JSON.stringify({ service: 'SeasonService', method: 'list', args: [] }),
      });
      const text = await rpc.text();
      assert.equal(rpc.status, 500);
      assert.doesNotMatch(text, /pagos|referencia|Columna|migrations/);
    } finally {
      await db.end();
    }
  } finally {
    await dropTestDatabase(process.env, name);
  }
});

// ------------------------------------------------------------------ startup

function start(env: Record<string, string>): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['api/server.ts'], {
      env: {
        PATH: process.env['PATH'] ?? '',
        DB_SOCKET: process.env['DB_SOCKET'] ?? '',
        DB_HOST: process.env['DB_HOST'] ?? '',
        DB_PORT: process.env['DB_PORT'] ?? '',
        DB_USER: process.env['DB_USER'] ?? '',
        DB_PASSWORD: process.env['DB_PASSWORD'] ?? '',
        DB_NAME: t.name,
        PORT: '0',
        ...env,
      },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => {
      out += d;
    });
    const timer = setTimeout(() => {
      child.kill();
    }, 2500);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}
const good = {
  NODE_ENV: 'production',
  TRUSTED_PROXIES: '127.0.0.1',
  APP_URL: 'https://escuela.example',
  MAIL_PROVIDER: 'none',
};

test('F5-04 / F5-12: production refuses to start with a dangerous configuration', async () => {
  for (const [over, message] of [
    [{ TRUSTED_PROXIES: '' }, /TRUSTED_PROXIES es obligatorio/],
    [{ TRUSTED_PROXIES: 'proxy.local' }, /no es una dirección IP/],
    [{ APP_URL: 'http://escuela.example' }, /APP_URL/],
    [{ MAIL_CONSOLE: 'true' }, /MAIL_CONSOLE/],
    [{ MAIL_PROVIDER: '' }, /MAIL_PROVIDER/],
  ] as const) {
    const r = await start({ ...good, ...over });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, message);
    assert.doesNotMatch(r.out, /Charales API en/);
  }
});

test('F5-12: a good production configuration starts and says what is off', async () => {
  const r = await start(good);
  assert.match(r.out, /Charales API en/, r.out);
  assert.match(r.out, /MAIL_PROVIDER=none/);
});

test('F5-06: production refuses a database without the migrations; development only says so', async () => {
  const name = uniqueTestDatabase('ef_oldb');
  const env = { ...process.env, DB_NAME: name };
  await setupDatabase(env);
  const db = createPool(env);
  await db.query('DROP TABLE correo_saliente');
  await db.end();
  try {
    const refused = await start({ ...good, DB_NAME: name });
    assert.equal(refused.code, 1, refused.out);
    assert.match(refused.out, /falta: correo_saliente/);
    const dev = await start({ DB_NAME: name });
    assert.match(dev.out, /falta: correo_saliente/);
    assert.match(dev.out, /Charales API en/);
  } finally {
    await dropTestDatabase(process.env, name);
  }
});

test('a proxy we do not trust is reported once, and its header is still ignored', async () => {
  const warnings: string[] = [];
  const { mock } = await import('node:test');
  const spy = mock.method(console, 'warn', (m: string) => void warnings.push(m));
  try {
    const base = await appWith({ secureCookie: false });
    for (let i = 0; i < 3; i++)
      await fetch(`${base}/health`, { headers: { 'X-Forwarded-For': '203.0.113.9' } });
  } finally {
    spy.mock.restore();
  }
  assert.equal(warnings.filter((m) => /TRUSTED_PROXIES/.test(m)).length, 1);
});

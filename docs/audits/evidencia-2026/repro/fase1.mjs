/**
 * Reproduces the Fase 5 findings against a checkout of the code (`--code <dir>`), on a NEW temporary database that this
 * script creates. Only the scenarios' own fictitious data; nothing external. Usage:
 *   DB_SOCKET=/tmp/mysql.sock DB_USER=$(whoami) node fase1.mjs --code <dir> --label before --out <file.json> [--only a,b]
 * Safety: the database name is generated here, must not exist beforehand, and every write goes through `tmp`, which
 * refuses any other name. The database is kept afterwards (evidence) and its name is written to the output.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const CODE = resolve(arg('code', '.'));
const LABEL = arg('label', 'run').replace(/\W/g, '');
const OUT = arg('out');
const ONLY = arg('only')?.split(',');
const ROUNDS = (arg('reset-rounds') ?? '10000,10000,20000').split(',').map(Number);
const conn = {
  DB_SOCKET: process.env.DB_SOCKET ?? '/tmp/mysql.sock',
  DB_USER: process.env.DB_USER,
};
const { createPool, createApp } = await import(join(CODE, 'api/server.ts'));
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const tally = (a) => a.reduce((m, c) => ((m[c] = (m[c] ?? 0) + 1), m), {});
const percent = (a, p) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * p)];

/** A database name no one has used; refuses to go on if it exists. */
async function newDatabase(kind) {
  const name = `ef_rem26_${LABEL}_${kind}_${randomBytes(3).toString('hex')}`;
  const admin = createPool({ ...conn, DB_NAME: 'information_schema' });
  const rows = await admin.query('SELECT 1 FROM SCHEMATA WHERE SCHEMA_NAME = ?', [name]);
  await admin.end();
  if (rows.length) throw new Error(`refusing to reuse ${name}`);
  created.push(name);
  return name;
}
const created = [];
const tmp = (db) => {
  if (!created.includes(db)) throw new Error(`not a database of this run: ${db}`);
  return createPool({ ...conn, DB_NAME: db });
};
async function demoDatabase(kind) {
  const name = await newDatabase(kind);
  const r = spawnSync(process.execPath, ['api/setup.ts', '--demo'], {
    cwd: CODE,
    env: { ...process.env, ...conn, DB_NAME: name },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return name;
}
const freePort = () =>
  new Promise((res) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
async function api(db, env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['api/server.ts'], {
    cwd: CODE,
    env: { PATH: process.env.PATH, ...conn, DB_NAME: db, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = { out: '', err: '' };
  child.stdout.on('data', (d) => (logs.out += d));
  child.stderr.on('data', (d) => (logs.err += d));
  let exit = null;
  child.on('exit', (c) => (exit = c));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100 && exit === null; i++) {
    try {
      if ((await fetch(`${base}/health`)).status === 200) break;
    } catch {}
    await sleep(100);
  }
  return {
    base,
    child,
    logs,
    get exit() {
      return exit;
    },
    rss: () =>
      Number(spawnSync('ps', ['-o', 'rss=', '-p', String(child.pid)], { encoding: 'utf8' }).stdout),
    stop: () => {
      child.kill();
      return new Promise((r) => (exit === null ? child.once('exit', r) : r()));
    },
  };
}
const post = (base, path, body, headers = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const login = async (base, email, password, xff) => {
  const t = performance.now();
  const r = await post(
    base,
    '/auth/login',
    { email, password },
    xff ? { 'x-forwarded-for': xff } : {},
  );
  await r.arrayBuffer();
  return { s: r.status, ms: performance.now() - t, cookie: r.headers.get('set-cookie') };
};
const WRONG = 'incorrecta-1';
const RIGHT = 'demo1234';
const proxied = { TRUSTED_PROXIES: '127.0.0.1' };
async function clearCounters(db) {
  const p = tmp(db);
  await p.query('DELETE FROM limite_acceso');
  await p.end();
}

const out = { code: CODE, label: LABEL, at: new Date().toISOString(), node: process.version };
const scenarios = {
  /** 4.1 — R-1 */
  async r1() {
    const db = await demoDatabase('r1');
    const res = {};
    const fresh = async (env = proxied) => {
      await clearCounters(db);
      return api(db, env);
    };
    let a = await fresh();
    // The audit's scenario: 150 wrong passwords, one account, 30 addresses of one /64.
    const seq = [];
    for (let i = 1; i <= 30; i++)
      for (let k = 0; k < 5; k++)
        seq.push(
          (await login(a.base, 'tutor@example.com', WRONG, `2001:db8:1:2::${i.toString(16)}`)).s,
        );
    res.same64_150_sequential = tally(seq);
    res.first429_same64 = seq.indexOf(429) + 1 || null;
    // Right password from the attacked prefix and from elsewhere, right after.
    res.right_password_same64 = (
      await login(a.base, 'tutor@example.com', RIGHT, '2001:db8:1:2::ff')
    ).s;
    res.right_password_new_prefix = (
      await login(a.base, 'tutor@example.com', RIGHT, '2001:db8:9:9::1')
    ).s;
    await a.stop();

    // 150 attempts, each from its own /64 (a distributed attack on one account).
    a = await fresh();
    const dist = [];
    for (let i = 1; i <= 150; i++)
      dist.push(
        (await login(a.base, 'tutor@example.com', WRONG, `2001:db8:${i.toString(16)}::1`)).s,
      );
    res.distributed_150_prefixes = tally(dist);
    res.distributed_argon_runs_upper_bound = dist.filter((s) => s === 401).length;
    await a.stop();

    // IPv4: one address, then many.
    a = await fresh();
    const v4 = [];
    for (let k = 0; k < 7; k++)
      v4.push((await login(a.base, 'coach@example.com', WRONG, '203.0.113.5')).s);
    res.ipv4_same_address_7 = v4;
    const v4many = [];
    for (let i = 1; i <= 60; i++)
      v4many.push((await login(a.base, 'secretaria@example.com', WRONG, `198.51.100.${i}`)).s);
    res.ipv4_60_addresses_one_account = tally(v4many);
    await a.stop();

    // IPv4-mapped and textual variants of one address must be one client.
    a = await fresh();
    const mapped = [];
    for (const ip of ['203.0.113.7', '::ffff:203.0.113.7', '203.0.113.7', '::ffff:cb00:7107'])
      for (let k = 0; k < 2; k++)
        mapped.push((await login(a.base, 'coach@example.com', WRONG, ip)).s);
    res.ipv4_mapped_8_attempts = tally(mapped);
    const text = [];
    for (const ip of [
      '2001:db8:7::1',
      '2001:0db8:0007:0000:0000:0000:0000:0001',
      '2001:DB8:7::1',
      '2001:db8:7:0::1',
    ])
      for (let k = 0; k < 5; k++)
        text.push((await login(a.base, 'secretaria@example.com', WRONG, ip)).s);
    res.ipv6_text_variants_20_attempts = tally(text);
    await a.stop();

    // Concurrency: 25 at once, same pair; 25 at once, one /64 with rotating addresses.
    a = await fresh();
    res.concurrent_same_pair_25 = tally(
      (
        await Promise.all(
          Array.from({ length: 25 }, () =>
            login(a.base, 'coach@example.com', WRONG, '203.0.113.9'),
          ),
        )
      ).map((r) => r.s),
    );
    res.concurrent_same64_rotating_25 = tally(
      (
        await Promise.all(
          Array.from({ length: 25 }, (_, i) =>
            login(a.base, 'tutor@example.com', WRONG, `2001:db8:5:5::${(i + 1).toString(16)}`),
          ),
        )
      ).map((r) => r.s),
    );
    await a.stop();

    // The owner, from their usual address, while the account is under attack (no unjustified lockout).
    a = await fresh();
    res.owner_first_login = (await login(a.base, 'tutor@example.com', RIGHT, '198.51.100.200')).s;
    const attack = [];
    for (let i = 1; i <= 60; i++)
      attack.push(
        (await login(a.base, 'tutor@example.com', WRONG, `2001:db8:a:${i.toString(16)}::1`)).s,
      );
    res.attack_on_owner_account = tally(attack);
    res.owner_during_attack_known_address = (
      await login(a.base, 'tutor@example.com', RIGHT, '198.51.100.200')
    ).s;
    res.owner_during_attack_new_address = (
      await login(a.base, 'tutor@example.com', RIGHT, '198.51.100.201')
    ).s;
    await a.stop();

    // Headers from a client that is not a trusted proxy.
    a = await fresh({ TRUSTED_PROXIES: '' });
    const spoof = [];
    for (let i = 0; i < 7; i++)
      spoof.push((await login(a.base, 'coach@example.com', WRONG, `203.0.113.${i + 20}`)).s);
    res.spoofed_xff_untrusted_peer_7 = spoof;
    await a.stop();

    // Enumeration: same status? time of an existing vs an unknown account, wrong password, a new address each.
    a = await fresh();
    const known = [];
    const unknown = [];
    for (let i = 1; i <= 30; i++) {
      const k = await login(a.base, 'coach@example.com', WRONG, `192.0.2.${i}`);
      const u = await login(a.base, `nadie${i}@example.com`, WRONG, `198.18.0.${i}`);
      known.push(k);
      unknown.push(u);
    }
    res.enum_status_existing = tally(known.map((r) => r.s));
    res.enum_status_unknown = tally(unknown.map((r) => r.s));
    const ok = (l) => l.filter((r) => r.s === 401).map((r) => r.ms);
    res.enum_median_ms = {
      existing: +median(ok(known)).toFixed(1),
      unknown: +median(ok(unknown)).toFixed(1),
    };
    await a.stop();
    res.db = db;
    return res;
  },

  /** 4.2 — TRUSTED_PROXIES */
  async proxies() {
    const db = await demoDatabase('tp');
    const res = {};
    const startup = async (env) => {
      const a = await api(db, env);
      const r = {
        exit: a.exit,
        started: a.exit === null,
        log: (a.logs.err + a.logs.out)
          .split('\n')
          .filter((l) => /TRUSTED|proxy|Error:/i.test(l))
          .slice(0, 3)
          .map((l) => l.slice(0, 200)),
      };
      await a.stop();
      return r;
    };
    res.empty_dev = await startup({ TRUSTED_PROXIES: '' });
    res.unset_dev = await startup({});
    res.ip_valid = await startup({ TRUSTED_PROXIES: '10.0.0.1' });
    res.cidr_v4 = await startup({ TRUSTED_PROXIES: '10.0.0.0/8' });
    res.cidr_v6 = await startup({ TRUSTED_PROXIES: 'fd00::/8' });
    res.invalid_name = await startup({ TRUSTED_PROXIES: 'proxy.example.com' });
    res.invalid_cidr = await startup({ TRUSTED_PROXIES: '10.0.0.0/99' });
    res.all_internet_v4 = await startup({ TRUSTED_PROXIES: '0.0.0.0/0' });
    res.empty_production = await startup({ NODE_ENV: 'production', TRUSTED_PROXIES: '' });
    res.none_production = await startup({
      NODE_ENV: 'production',
      TRUSTED_PROXIES: 'none',
      APP_URL: 'https://escuela.example',
      MAIL_PROVIDER: 'none',
    });
    res.ip_production = await startup({
      NODE_ENV: 'production',
      TRUSTED_PROXIES: '127.0.0.1',
      APP_URL: 'https://escuela.example',
      MAIL_PROVIDER: 'none',
    });

    // The audit's scenario: behind a proxy, TRUSTED_PROXIES empty, 60 failures of different clients and accounts.
    await clearCounters(db);
    let a = await api(db, { TRUSTED_PROXIES: '' });
    const codes = [];
    for (let i = 0; i < 60; i++)
      codes.push((await login(a.base, `nadie${i}@example.com`, WRONG, `203.0.113.${i + 1}`)).s);
    res.empty_60_failures = tally(codes);
    res.empty_first429 = codes.indexOf(429) + 1 || null;
    res.empty_right_password_after = (
      await login(a.base, 'secretaria@example.com', RIGHT, '203.0.113.200')
    ).s;
    res.empty_logged_warning = /X-Forwarded-For|TRUSTED_PROXIES/.test(a.logs.err + a.logs.out);
    await a.stop();

    // Configured: the same flood only stops its own client.
    for (const [label, cfg] of [
      ['ip', '127.0.0.1'],
      ['cidr', '127.0.0.0/8'],
    ]) {
      await clearCounters(db);
      a = await api(db, { TRUSTED_PROXIES: cfg });
      if (a.exit !== null) {
        res[`configured_${label}`] = { started: false };
        continue;
      }
      const c = [];
      for (let i = 0; i < 60; i++)
        c.push((await login(a.base, `nadie${i}@example.com`, WRONG, '203.0.113.50')).s);
      res[`configured_${label}`] = {
        attacker: tally(c),
        other_client_right_password: (
          await login(a.base, 'secretaria@example.com', RIGHT, '203.0.113.60')
        ).s,
      };
      await a.stop();
    }
    // Hops: a client-supplied left value must not count; the rightmost untrusted hop does.
    await clearCounters(db);
    a = await api(db, { TRUSTED_PROXIES: '127.0.0.1,10.0.0.0/8' });
    if (a.exit === null) {
      const c = [];
      for (let i = 0; i < 7; i++)
        c.push(
          (await login(a.base, 'coach@example.com', WRONG, `9.9.9.${i}, 203.0.113.77, 10.1.2.3`)).s,
        );
      res.hops_forged_left_rotating_7 = c;
    } else res.hops_forged_left_rotating_7 = 'config refused';
    await a.stop();
    res.db = db;
    return res;
  },

  /** 4.3 — public password recovery: memory and limits */
  async reset() {
    const db = await demoDatabase('rs');
    const res = { rounds: [] };
    await clearCounters(db);
    const a = await api(db, { MAIL_CONSOLE: 'true', ...proxied });
    res.rss_start_kb = a.rss();
    let peak = res.rss_start_kb;
    const sampler = setInterval(() => (peak = Math.max(peak, a.rss())), 200);
    let sent = 0;
    for (const n of ROUNDS) {
      const codes = {};
      let i = 0;
      const t = Date.now();
      const worker = async () => {
        while (i < n) {
          const k = i++ + sent;
          const r = await post(
            a.base,
            '/auth/password-reset/request',
            { email: `x${k}-${'p'.repeat(100)}@nobody.example` },
            { 'x-forwarded-for': '203.0.113.99' },
          );
          codes[r.status] = (codes[r.status] ?? 0) + 1;
          await r.arrayBuffer();
        }
      };
      await Promise.all(Array.from({ length: 40 }, worker));
      sent += n;
      await sleep(500);
      res.rounds.push({ requests: sent, ms: Date.now() - t, codes, rss_kb: a.rss() });
    }
    clearInterval(sampler);
    res.rss_peak_kb = peak;
    res.rss_end_kb = a.rss();
    // Per account: one address, then many, same existing account.
    const one = [];
    for (let i = 0; i < 8; i++)
      one.push(
        (
          await post(
            a.base,
            '/auth/password-reset/request',
            { email: 'marta@example.com' },
            { 'x-forwarded-for': '198.51.100.1' },
          )
        ).status,
      );
    res.same_account_same_ip_8 = one;
    const many = [];
    for (let i = 0; i < 30; i++)
      many.push(
        (
          await post(
            a.base,
            '/auth/password-reset/request',
            { email: 'coach@example.com' },
            { 'x-forwarded-for': `198.51.100.${i + 10}` },
          )
        ).status,
      );
    res.same_account_30_ips = tally(many);
    const p = tmp(db);
    const [{ n }] = await p.query(
      "SELECT COUNT(*) AS n FROM tokens_recuperacion t JOIN usuarios u ON u.id = t.usuario_id WHERE u.email = 'coach@example.com'",
    );
    await p.end();
    res.tokens_issued_for_victim = Number(n);
    res.mail_sent_to_victim = (a.logs.out.match(/para coach@example\.com/g) ?? []).length;
    // Timing of the answer: an existing account vs an unknown one (S-06). A new address each time; limits cleared.
    const timed = async (email, i) => {
      const t = performance.now();
      const r = await post(
        a.base,
        '/auth/password-reset/request',
        { email },
        { 'x-forwarded-for': `192.0.2.${(i % 250) + 1}` },
      );
      await r.arrayBuffer();
      return [r.status, performance.now() - t];
    };
    const existing = [];
    const nobody = [];
    const accounts = ['marta', 'coach', 'tutor', 'secretaria', 'admin'].map(
      (u) => `${u}@example.com`,
    );
    await clearCounters(db);
    await sleep(11000);
    for (let i = 0; i < 20; i++) {
      existing.push(await timed(accounts[i % 5], i));
      nobody.push(await timed(`nadie-t${i}@example.com`, i + 100));
    }
    const ms = (l) => l.filter((x) => x[0] === 204).map((x) => x[1]);
    res.reset_timing_ms = {
      existing_median: +median(ms(existing)).toFixed(2),
      unknown_median: +median(ms(nobody)).toFixed(2),
      n: [ms(existing).length, ms(nobody).length],
    };
    await a.stop();
    res.db = db;
    return res;
  },

  /** 4.4 — mail failure after COMMIT */
  async mail() {
    const db = await demoDatabase('ml');
    const res = {};
    const modes = {
      ok: () => undefined,
      rejected: () => {
        throw Object.assign(new Error('provider 422 key=re_SENTINEL host=smtp.internal'), {
          permanent: true,
        });
      },
      timeout: () =>
        new Promise((_, rej) =>
          setTimeout(
            () =>
              rej(Object.assign(new Error('timeout host=smtp.internal'), { name: 'TimeoutError' })),
            300,
          ),
        ),
      connreset: () => {
        throw Object.assign(new Error('read ECONNRESET 10.0.0.9:443'), { code: 'ECONNRESET' });
      },
    };
    const pool = tmp(db);
    for (const [mode, mailer] of Object.entries(modes)) {
      const app = createApp(pool, { secureCookie: false, mailer, trustedProxies: ['127.0.0.1'] });
      await new Promise((r) => app.listen(0, '127.0.0.1', r));
      const base = `http://127.0.0.1:${app.address().port}`;
      const l = await login(
        base,
        'admin@example.com',
        RIGHT,
        `192.0.2.${Object.keys(modes).indexOf(mode) + 1}`,
      );
      const cookie = l.cookie.split(';')[0];
      const email = `alta-${mode}@example.com`;
      const send = () =>
        post(
          base,
          '/api/rpc',
          {
            service: 'UserService',
            method: 'save',
            args: [{ roleId: 2, firstName: 'Alta', lastName: mode, email }],
          },
          { cookie },
        );
      const first = await send();
      const firstBody = await first.text();
      const [u] = await pool.query('SELECT id, activo FROM usuarios WHERE email = ?', [email]);
      const second = await send();
      const secondBody = await second.text();
      const [{ n }] = await pool.query('SELECT COUNT(*) AS n FROM usuarios WHERE email = ?', [
        email,
      ]);
      const tokens = u
        ? await pool.query(
            "SELECT COUNT(*) AS n FROM tokens_recuperacion WHERE usuario_id = ? AND finalidad = 'INVITACION'",
            [u.id],
          )
        : [{ n: 0 }];
      const outbox = await pool.query(
        "SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'correo_saliente'",
      );
      const pending =
        outbox.length && u
          ? await pool.query(
              'SELECT estado, intentos, ultimo_error FROM correo_saliente WHERE destinatario = ? ORDER BY id',
              [email],
            )
          : [];
      res[mode] = {
        first: first.status,
        first_body: firstBody.slice(0, 160),
        leaks_internal: /SENTINEL|smtp\.internal|ECONNRESET|10\.0\.0\.9/.test(firstBody),
        account_created: !!u,
        second: second.status,
        second_body: secondBody.slice(0, 120),
        accounts: Number(n),
        invitation_tokens: Number(tokens[0].n),
        outbox: pending.map((r) => ({
          estado: r.estado,
          intentos: Number(r.intentos),
          error: r.ultimo_error,
        })),
      };
      await new Promise((r) => {
        app.close(r);
        app.closeAllConnections?.();
      });
    }
    await pool.end();
    res.db = db;
    return res;
  },

  /** F5-06, F5-17, F5-18, F5-12, F5-01: unmigrated base, internal messages, production surface, headers */
  async surface() {
    const res = {};
    const old = await newDatabase('old');
    const q = (sql, db) =>
      spawnSync('mariadb', ['--socket', conn.DB_SOCKET, ...(db ? [db] : [])], {
        input: sql,
        encoding: 'utf8',
      });
    if (!created.includes(old)) throw new Error('guard');
    q(
      readFileSync(join(CODE, 'docs/escuela_futbol_mariadb.sql'), 'utf8').replaceAll(
        'escuela_futbol',
        old,
      ),
    );
    for (const f of ['001_token_finalidad', '002_cargos_vencidos', '003_version_datos'])
      q(readFileSync(join(CODE, `db/mariadb/migrations/${f}.sql`), 'utf8'), old);
    q(readFileSync(join(CODE, 'db/mariadb/010_permisos_app.sql'), 'utf8'), old);
    q(readFileSync(join(CODE, 'db/mariadb/020_dev_seed.sql'), 'utf8'), old);
    let a = await api(old, {});
    res.unmigrated_started = a.exit === null;
    res.unmigrated_start_log = (a.logs.err + a.logs.out)
      .split('\n')
      .filter((l) => /migraci|falta|Error/i.test(l))
      .slice(0, 2)
      .map((l) => l.slice(0, 200));
    if (a.exit === null) {
      const l = await login(a.base, 'admin@example.com', RIGHT);
      res.unmigrated_login = l.s;
      const p = tmp(old);
      const { createHash } = await import('node:crypto');
      const [u] = await p.query(
        'SELECT id FROM usuarios WHERE rol_id IS NOT NULL ORDER BY id LIMIT 1',
      );
      const now = new Date().toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' });
      await p.query(
        'INSERT INTO sesiones (usuario_id, token_hash, inicio_en, expira_en, ultimo_uso_en, ip, user_agent) VALUES (?, ?, ?, DATE_ADD(?, INTERVAL 8 HOUR), ?, ?, ?)',
        [
          u.id,
          createHash('sha256').update('reprotoken').digest('hex'),
          now,
          now,
          now,
          '127.0.0.1',
          'repro',
        ],
      );
      await p.end();
      const r = await post(
        a.base,
        '/api/rpc',
        { service: 'SeasonService', method: 'list', args: [] },
        { cookie: 'charales_sid=reprotoken' },
      );
      res.unmigrated_rpc = [r.status, (await r.text()).slice(0, 160)];
    }
    await a.stop();

    const db = await demoDatabase('sf');
    a = await api(db, {});
    const h = await fetch(`${a.base}/health`);
    res.headers_health = Object.fromEntries(
      [
        'cache-control',
        'x-content-type-options',
        'content-security-policy',
        'referrer-policy',
        'x-frame-options',
        'strict-transport-security',
      ].map((k) => [k, h.headers.get(k)]),
    );
    res.cookie_dev = (await login(a.base, 'admin@example.com', RIGHT)).cookie?.replace(
      /=[^;]+/,
      '=<v>',
    );
    res.dev_start_warns_insecure_cookie = /Secure|COOKIE_SECURE/.test(a.logs.err + a.logs.out);
    await a.stop();
    a = await api(db, {
      NODE_ENV: 'production',
      TRUSTED_PROXIES: '127.0.0.1',
      APP_URL: 'https://escuela.example',
      MAIL_PROVIDER: 'none',
    });
    res.production_started = a.exit === null;
    if (a.exit === null) {
      const l = await login(a.base, 'secretaria@example.com', RIGHT, '192.0.2.77');
      res.cookie_production = l.cookie?.replace(/=[^;]+/, '=<v>');
      const cookie = l.cookie?.split(';')[0];
      res.lab_jugadores_production = (
        await fetch(`${a.base}/api/jugadores`, { headers: { cookie } })
      ).status;
      res.lab_categorias_production = (
        await fetch(`${a.base}/api/categorias`, { headers: { cookie } })
      ).status;
      res.reset_production_no_mail = (
        await post(
          a.base,
          '/auth/password-reset/request',
          { email: 'marta@example.com' },
          { 'x-forwarded-for': '192.0.2.78' },
        )
      ).status;
    }
    await a.stop();
    a = await api(db, {
      NODE_ENV: 'production',
      TRUSTED_PROXIES: '127.0.0.1',
      APP_URL: 'http://escuela.example',
      MAIL_PROVIDER: 'none',
    });
    res.production_http_app_url_started = a.exit === null;
    await a.stop();
    a = await api(db, {
      NODE_ENV: 'production',
      TRUSTED_PROXIES: '127.0.0.1',
      APP_URL: 'https://escuela.example',
      MAIL_CONSOLE: 'true',
    });
    res.production_mail_console_started = a.exit === null;
    await a.stop();
    const dist = join(CODE, 'dist/project/browser');
    if (existsSync(dist)) {
      const grep = (p) =>
        spawnSync('grep', ['-rlE', p, dist], { encoding: 'utf8' })
          .stdout.trim()
          .split('\n')
          .filter(Boolean).length;
      res.bundle_files_with_demo1234 = grep('demo1234');
      res.bundle_files_with_example_accounts = grep('[a-z]+@example\\.com');
      res.bundle_files_with_zod = grep('ZodError|zod');
    }
    res.db = [old, db];
    return res;
  },

  /** F5-10: one authenticated user flooding the RPC bridge, a second user's latency */
  async flood() {
    const db = await demoDatabase('fl');
    await clearCounters(db);
    const a = await api(db, proxied);
    const tutor = (await login(a.base, 'tutor@example.com', RIGHT, '192.0.2.1')).cookie.split(
      ';',
    )[0];
    const sec = (await login(a.base, 'secretaria@example.com', RIGHT, '192.0.2.2')).cookie.split(
      ';',
    )[0];
    const victim = async (n) => {
      const l = [];
      const codes = [];
      for (let i = 0; i < n; i++) {
        const t = performance.now();
        const r = await post(
          a.base,
          '/api/rpc',
          { service: 'SeasonService', method: 'list', args: [] },
          { cookie: sec },
        );
        await r.arrayBuffer();
        codes.push(r.status);
        l.push(performance.now() - t);
        await sleep(20);
      }
      return {
        p50: +median(l).toFixed(1),
        p95: +percent(l, 0.95).toFixed(1),
        max: +Math.max(...l).toFixed(1),
        codes: tally(codes),
      };
    };
    const res = { idle: await victim(40) };
    let stop = false;
    const floodCodes = {};
    const worker = async () => {
      while (!stop) {
        const r = await post(
          a.base,
          '/api/rpc',
          { service: 'PortalService', method: 'overview', args: [] },
          { cookie: tutor },
        );
        floodCodes[r.status] = (floodCodes[r.status] ?? 0) + 1;
        await r.arrayBuffer();
      }
    };
    const w = Array.from({ length: 100 }, worker);
    await sleep(1000);
    res.during_flood = await victim(40);
    stop = true;
    await Promise.all(w);
    res.flood_codes = floodCodes;
    await a.stop();
    res.db = db;
    return res;
  },

  /** 4.8: authorization sweep, SQL injection and stored XSS payloads, CSRF/CORS */
  async sweep() {
    const db = await demoDatabase('sw');
    await clearCounters(db);
    const a = await api(db, proxied);
    const res = {};
    const src = readFileSync(join(CODE, 'src/app/core/api/rpc-methods.ts'), 'utf8');
    const methods = [...src.matchAll(/(\w+Service): \[(.*?)\]/gs)].flatMap((m) =>
      [...m[2].matchAll(/'(\w+)'/g)].map((x) => [m[1], x[1]]),
    );
    res.methods = methods.length;
    const call = async (cookie, service, method, args) => {
      const r = await post(a.base, '/api/rpc', { service, method, args }, cookie ? { cookie } : {});
      const b = await r.json().catch(() => ({}));
      return { s: r.status, e: b.error };
    };
    res.anonymous = tally(
      await Promise.all(methods.map(async ([s, m]) => (await call(null, s, m, [])).s)),
    );
    const admin = (await login(a.base, 'admin@example.com', RIGHT, '192.0.2.3')).cookie.split(
      ';',
    )[0];
    res.not_allowlisted = {};
    for (const [s, m] of [
      ['Object', 'constructor'],
      ['UserService', '__proto__'],
      ['UserService', 'profileAccount'],
      ['AuthService', 'login'],
      ['PaymentsGatewayService', 'crearPreferencia'],
    ])
      res.not_allowlisted[`${s}.${m}`] = (await call(admin, s, m, [])).s;
    const session = { tutor: '192.0.2.4', coach: '192.0.2.5' };
    for (const role of Object.keys(session)) {
      const c = (await login(a.base, `${role}@example.com`, RIGHT, session[role])).cookie.split(
        ';',
      )[0];
      const r = { ok: [], leak: [], err500: [] };
      for (const [s, m] of methods) {
        const shapes = [[], [{}], [{ id: 1 }], [1, {}], [1, 1], [1, 'x']];
        for (const args of shapes) {
          const x = await call(c, s, m, args);
          if (x.s === 200 && !r.ok.includes(`${s}.${m}`)) r.ok.push(`${s}.${m}`);
          if (x.s >= 500 && x.s !== 503) r.err500.push(`${s}.${m}`);
        }
        const existing = await call(c, s, m, [1]);
        const missing = await call(c, s, m, [999999]);
        if (existing.s === 403 && missing.s === 400) r.leak.push(`${s}.${m}`);
      }
      res[role] = r;
    }
    // A session owned by nobody the coach/tutor may see, compared with a missing one (S-03).
    const p = tmp(db);
    const [{ id: foreign }] = await p
      .query(
        "SELECT s.id FROM sesiones_entrenamiento s JOIN entrenadores e ON e.id = s.entrenador_id JOIN usuarios u ON u.id = e.usuario_id WHERE u.email <> 'coach@example.com' ORDER BY s.id LIMIT 1",
      )
      .catch(() => [{ id: 1 }]);
    const coach = (await login(a.base, 'coach@example.com', RIGHT, '192.0.2.5')).cookie.split(
      ';',
    )[0];
    res.s03_coach = {
      foreign_session: await call(coach, 'TrainingService', 'get', [foreign]),
      missing_session: await call(coach, 'TrainingService', 'get', [999999]),
    };
    // SQL injection: login and search.
    const sqli = "' OR '1'='1' -- ";
    res.sqli_login = (await login(a.base, `admin@example.com${sqli}`, sqli, '192.0.2.6')).s;
    const sec = (await login(a.base, 'secretaria@example.com', RIGHT, '192.0.2.7')).cookie.split(
      ';',
    )[0];
    const search = await post(
      a.base,
      '/api/rpc',
      { service: 'PlayerService', method: 'search', args: [{ query: sqli }] },
      { cookie: sec },
    );
    res.sqli_search = [search.status, ((await search.json()).result?.items ?? []).length];
    const [{ n: tables }] = await p.query(
      'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()',
    );
    res.tables_after_sqli = Number(tables);
    await p.end();
    // CSRF and CORS.
    const form = await fetch(`${a.base}/api/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', cookie: sec, origin: 'https://evil.example' },
      body: '{"service":"SeasonService","method":"list","args":[]}',
    });
    res.csrf_text_plain = form.status;
    const pre = await fetch(`${a.base}/api/rpc`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    res.cors_preflight = [pre.status, pre.headers.get('access-control-allow-origin')];
    // Sessions: logout closes, a forged cookie does nothing.
    await post(a.base, '/auth/logout', {}, { cookie: sec });
    res.reuse_after_logout = (
      await fetch(`${a.base}/auth/session`, { headers: { cookie: sec } })
    ).status;
    res.forged_cookie = (
      await fetch(`${a.base}/auth/session`, { headers: { cookie: 'charales_sid=forged' } })
    ).status;
    res.stderr_has_sql_params = /demo1234|incorrecta-1/.test(a.logs.err);
    await a.stop();
    res.db = db;
    return res;
  },
};

for (const [name, fn] of Object.entries(scenarios)) {
  if (ONLY && !ONLY.includes(name)) continue;
  const t = Date.now();
  log('start', name);
  try {
    out[name] = await fn();
  } catch (e) {
    out[name] = { error: String(e?.stack ?? e).slice(0, 800) };
  }
  out[name].seconds = Math.round((Date.now() - t) / 1000);
  log('done', name, out[name].seconds + 's');
  if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 1));
}
out.databases = created;
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
process.exit(0);

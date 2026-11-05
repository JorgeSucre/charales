/**
 * Cierre 2026: brute force across networks and the legitimate owner, on a NEW temporary database created here (the
 * name is generated, must not exist, and every write goes through `tmp`). Fictitious data only. Usage:
 *   DB_SOCKET=/tmp/mysql.sock DB_USER=$(whoami) node cierre.mjs --code <dir> --label before --out <file.json> [--only a,b]
 * Time is simulated by moving `limite_acceso` back in the temporary database and restarting the API (its refusal memory).
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
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
const conn = {
  DB_SOCKET: process.env.DB_SOCKET ?? '/tmp/mysql.sock',
  DB_USER: process.env.DB_USER,
};
const { createPool } = await import(join(CODE, 'api/server.ts'));
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) =>
  a.length ? +[...a].sort((x, y) => x - y)[Math.floor(a.length / 2)].toFixed(1) : null;
const tally = (a) => a.reduce((m, c) => ((m[c] = (m[c] ?? 0) + 1), m), {});
const created = [];
async function demoDatabase(kind) {
  const name = `ef_cier26_${LABEL}_${kind}_${randomBytes(3).toString('hex')}`;
  const admin = createPool({ ...conn, DB_NAME: 'information_schema' });
  const rows = await admin.query('SELECT 1 FROM SCHEMATA WHERE SCHEMA_NAME = ?', [name]);
  await admin.end();
  if (rows.length) throw new Error(`refusing to reuse ${name}`);
  created.push(name);
  const r = spawnSync(process.execPath, ['api/setup.ts', '--demo'], {
    cwd: CODE,
    env: { ...process.env, ...conn, DB_NAME: name },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return name;
}
const tmp = (db) => {
  if (!created.includes(db)) throw new Error(`not a database of this run: ${db}`);
  return createPool({ ...conn, DB_NAME: db, connectionLimit: 2 });
};
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
    env: {
      PATH: process.env.PATH,
      ...conn,
      DB_NAME: db,
      PORT: String(port),
      TRUSTED_PROXIES: '127.0.0.1',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = { out: '', err: '' };
  child.stdout.on('data', (d) => (logs.out += d));
  child.stderr.on('data', (d) => (logs.err += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/health`)).status === 200) break;
    } catch {}
    await sleep(50);
  }
  return {
    base,
    logs,
    stop: () =>
      new Promise((r) => {
        child.once('exit', r);
        child.kill();
      }),
  };
}
/** One browser: keeps every cookie but the session's. */
const browser = () => new Map();
async function login(base, email, password, ip, jar) {
  const t = performance.now();
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
      ...(jar?.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
    },
    body: JSON.stringify({ email, password }),
  });
  await r.arrayBuffer();
  if (jar)
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      if (!kv.startsWith('charales_sid')) jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
  return { s: r.status, ms: performance.now() - t };
}
const WRONG = 'incorrecta-1';
const RIGHT = 'demo1234';
const OWNER = 'marta@example.com';
const ip6 = (i) => `2001:db8:${(i >> 8).toString(16)}:${(i & 255).toString(16)}::1`;
async function clear(db) {
  const p = tmp(db);
  await p.query('DELETE FROM limite_acceso');
  await p.end();
}
async function shift(db, minutes) {
  const p = tmp(db);
  await p.query(
    `UPDATE limite_acceso SET ventana_inicio = ventana_inicio - INTERVAL ${Number(minutes)} MINUTE`,
  );
  await p.end();
}
const summary = (rows) => ({
  statuses: tally(rows.map((r) => r.s)),
  first429: rows.findIndex((r) => r.s === 429) + 1 || null,
  median_401_ms: median(rows.filter((r) => r.s === 401).map((r) => r.ms)),
  median_429_ms: median(rows.filter((r) => r.s === 429).map((r) => r.ms)),
});
async function seq(base, n, ip, email = OWNER, password = WRONG) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await login(base, email, password, ip(i)));
  return out;
}
/** Connections of this database while `work` runs (server view). */
async function peakConnections(db, work) {
  const p = tmp(db);
  let peak = 0;
  let on = true;
  const sampler = (async () => {
    while (on) {
      const [{ n }] = await p.query(
        'SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE DB = ?',
        [db],
      );
      peak = Math.max(peak, Number(n) - 1);
      await sleep(20);
    }
  })();
  const out = await work();
  on = false;
  await sampler;
  await p.end();
  return [out, peak];
}

const scenarios = {
  async fuerza() {
    const db = await demoDatabase('fb');
    const res = {};
    let a = await api(db);
    const fresh = async () => {
      await a.stop();
      await clear(db);
      a = await api(db);
    };
    const t0 = performance.now();
    res.prefijos_150 = summary(await seq(a.base, 150, ip6));
    res.prefijos_150.total_ms = Math.round(performance.now() - t0);
    await fresh();
    res.un_64_150 = summary(
      await seq(a.base, 150, (i) => `2001:db8:1:2::${((i % 30) + 1).toString(16)}`),
    );
    await fresh();
    res.ipv4_60 = summary(await seq(a.base, 60, (i) => `198.51.100.${i + 1}`));
    await fresh();
    const mapped = ['203.0.113.7', '::ffff:203.0.113.7', '::ffff:cb00:7107'];
    res.mapeadas_9 = summary(await seq(a.base, 9, (i) => mapped[i % 3]));
    await fresh();
    const [conc, peak] = await peakConnections(db, () =>
      Promise.all(Array.from({ length: 60 }, (_, i) => login(a.base, OWNER, WRONG, ip6(i + 1000)))),
    );
    res.concurrentes_60 = { ...summary(conc), conexiones_pico: peak };
    await fresh();
    // Two API processes, one database.
    const b = await api(db);
    const two = [];
    for (let i = 0; i < 150; i++)
      two.push(await login(i % 2 ? a.base : b.base, OWNER, WRONG, ip6(i + 2000)));
    res.dos_procesos_150 = summary(two);
    await b.stop();
    await fresh();
    // A restart in the middle keeps the count.
    const before = await seq(a.base, 8, (i) => ip6(i + 3000));
    await a.stop();
    a = await api(db);
    const after = await seq(a.base, 40, (i) => ip6(i + 3100));
    res.reinicio = { antes: tally(before.map((r) => r.s)), despues: tally(after.map((r) => r.s)) };
    await fresh();
    // Database connections cut in the middle (only those of this temporary database).
    const first = await seq(a.base, 6, (i) => ip6(i + 4000));
    const p = tmp(db);
    const threads = await p.query(
      'SELECT ID FROM information_schema.PROCESSLIST WHERE DB = ? AND ID <> CONNECTION_ID()',
      [db],
    );
    for (const { ID } of threads) await p.query(`KILL ${Number(ID)}`).catch(() => undefined);
    await p.end();
    const later = await seq(a.base, 40, (i) => ip6(i + 4100));
    res.conexiones_cortadas = {
      cortadas: threads.length,
      antes: tally(first.map((r) => r.s)),
      despues: tally(later.map((r) => r.s)),
    };
    await fresh();
    // Other accounts and unknown ones.
    const accounts = ['coach', 'tutor', 'secretaria', 'admin'].map((u) => `${u}@example.com`);
    res.varias_cuentas = {};
    let n = 5000;
    for (const email of [...accounts, 'nadie.aqui@example.com'])
      res.varias_cuentas[email] = tally(
        (await seq(a.base, 40, () => ip6(n++), email)).map((r) => r.s),
      );
    await a.stop();
    res.db = db;
    return res;
  },

  /** A whole day of attack, 25 attempts each 15 simulated minutes, each from its own /64. */
  async dia() {
    const db = await demoDatabase('dia');
    const res = { pasos: 96, intentos_por_paso: 25 };
    let verified = 0;
    let refused = 0;
    let n = 0;
    const firstHour = [];
    for (let step = 0; step < 96; step++) {
      const a = await api(db);
      const rows = await seq(a.base, 25, () => ip6(n++));
      const ok = rows.filter((r) => r.s === 401).length;
      verified += ok;
      refused += rows.filter((r) => r.s === 429).length;
      if (step < 4) firstHour.push(ok);
      await a.stop();
      await shift(db, 15);
    }
    res.adivinanzas_verificadas_24h = verified;
    res.rechazadas_24h = refused;
    res.primera_hora_por_paso = firstHour;
    res.db = db;
    return res;
  },

  /** The owner. */
  async dueno() {
    const db = await demoDatabase('dn');
    const res = {};
    let a = await api(db, { MAIL_CONSOLE: 'true' });
    const fresh = async () => {
      await a.stop();
      await clear(db);
      a = await api(db, { MAIL_CONSOLE: 'true' });
    };
    let n = 0;
    const attack = (count) => seq(a.base, count, () => ip6(n++));
    // Owner's browser after a normal login at home.
    const phone = browser();
    res.login_inicial = (await login(a.base, OWNER, RIGHT, '198.51.100.200', phone)).s;
    res.cookies_del_navegador = [...phone.keys()].map((k) => k.replace(/_[0-9a-f]+$/, '_<hash>'));
    res.ataque = tally((await attack(60)).map((r) => r.s));
    res.mismo_navegador_misma_red = (await login(a.base, OWNER, RIGHT, '198.51.100.200', phone)).s;
    res.mismo_navegador_red_nueva = (await login(a.base, OWNER, RIGHT, '203.0.113.210', phone)).s;
    res.navegador_nuevo_red_conocida = (
      await login(a.base, OWNER, RIGHT, '198.51.100.200', browser())
    ).s;
    res.navegador_nuevo_red_nueva = (
      await login(a.base, OWNER, RIGHT, '203.0.113.211', browser())
    ).s;
    res.atacante_con_contrasena_correcta_red_nueva = (
      await login(a.base, OWNER, RIGHT, '203.0.113.212')
    ).s;
    // Multi-instance: the browser's trust works on another process.
    const other = await api(db);
    res.mismo_navegador_otra_instancia = (
      await login(other.base, OWNER, RIGHT, '203.0.113.213', phone)
    ).s;
    await other.stop();
    // Latency for the owner under a concurrent attack.
    await fresh();
    const home = browser();
    await login(a.base, OWNER, RIGHT, '198.51.100.200', home);
    let on = true;
    const flood = (async () => {
      while (on)
        await Promise.all(Array.from({ length: 10 }, () => login(a.base, OWNER, WRONG, ip6(n++))));
    })();
    await sleep(300);
    const during = [];
    for (let i = 0; i < 15; i++)
      during.push(await login(a.base, OWNER, RIGHT, '203.0.113.214', home));
    on = false;
    await flood;
    res.dueno_durante_ataque_concurrente = {
      ...tally(during.map((r) => r.s)),
      mediana_ms: median(during.map((r) => r.ms)),
    };
    // Network at its own limit.
    await fresh();
    const office = browser();
    await login(a.base, OWNER, RIGHT, '203.0.113.50', office);
    const flooded = [];
    for (let i = 0; i < 60; i++)
      flooded.push((await login(a.base, `nadie${i}@example.com`, WRONG, '203.0.113.50')).s);
    res.red_agotada = tally(flooded);
    res.red_agotada_mismo_navegador = (await login(a.base, OWNER, RIGHT, '203.0.113.50', office)).s;
    res.red_agotada_navegador_nuevo = (
      await login(a.base, OWNER, RIGHT, '203.0.113.50', browser())
    ).s;
    // After the attack ends: how long until a new browser on a new network gets in (simulated minutes).
    await fresh();
    await attack(60);
    let waited = null;
    for (let m = 0; m <= 1500; m += 15) {
      const s = (await login(a.base, OWNER, RIGHT, ip6(n++), browser())).s;
      if (s === 200) {
        waited = m;
        break;
      }
      await a.stop();
      await shift(db, 15);
      a = await api(db, { MAIL_CONSOLE: 'true' });
    }
    res.minutos_hasta_entrar_tras_el_ataque = waited;
    // Stolen browser cookie: guesses it allows, from another network.
    await fresh();
    const stolen = browser();
    await login(a.base, OWNER, RIGHT, '198.51.100.201', stolen);
    const guesses = [];
    for (let i = 0; i < 12; i++)
      guesses.push((await login(a.base, OWNER, WRONG, ip6(n++), stolen)).s);
    res.cookie_robada_12_adivinanzas = guesses;
    // Same cookie for another account.
    res.cookie_de_otra_cuenta_contra_coach = tally(
      (
        await Promise.all(
          Array.from({ length: 1 }, () =>
            login(a.base, 'coach@example.com', WRONG, ip6(n++), stolen),
          ),
        )
      ).map((r) => r.s),
    );
    // Recovery from a new browser during an attack.
    await fresh();
    await attack(60);
    const fresh2 = browser();
    const client = '203.0.113.220';
    res.recuperacion_antes = (await login(a.base, OWNER, RIGHT, client, fresh2)).s;
    const asked = await fetch(`${a.base}/auth/password-reset/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': client },
      body: JSON.stringify({ email: OWNER }),
    });
    res.recuperacion_solicitud = asked.status;
    await sleep(500);
    const token = /token=([\w-]+)/.exec(a.logs.out.split('para marta@example.com').at(-1))?.[1];
    const done = await fetch(`${a.base}/auth/password-reset/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': client },
      body: JSON.stringify({ token, newPassword: 'Recuperada-2847' }),
    });
    res.recuperacion_confirmacion = done.status;
    for (const c of done.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      if (!kv.startsWith('charales_sid')) fresh2.set(kv.slice(0, i), kv.slice(i + 1));
    }
    res.recuperacion_despues_misma_red = (
      await login(a.base, OWNER, 'Recuperada-2847', client, fresh2)
    ).s;
    res.recuperacion_despues_otra_red_mismo_navegador = (
      await login(a.base, OWNER, 'Recuperada-2847', '203.0.113.221', fresh2)
    ).s;
    await a.stop();
    res.db = db;
    return res;
  },
};

const out = { code: CODE, label: LABEL, at: new Date().toISOString(), node: process.version };
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
process.exit(0);

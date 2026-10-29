/**
 * Extended demo data (api/demo-extended.ts) and its guards. Temporary databases only: `ef_demox_<pid>` (the test-db
 * harness) and `ef_<pid>_demo` for the CLI, which also satisfies the *_demo rule; both are dropped at the end.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadExtendedDemo, type ExtendedDemoSummary } from './demo-extended.ts';
import {
  DEMO_DATABASE,
  DEMO_DATABASE_NAME,
  SetupError,
  assertDemoAllowed,
  dropDemoDatabase,
  dropTestDatabase,
  setupDatabase,
} from './schema.ts';
import { openTestDb, type TestDb } from './test-db.ts';
import { createPool } from './server.ts';

let t: TestDb;
let summary: ExtendedDemoSummary;
const CLI_DB = `ef_${process.pid}_demo`;

before(async () => {
  t = await openTestDb('ef_demox'); // demo base + fixed clock (2026-10-13, inside the demo season)
  summary = await loadExtendedDemo(t.db);
});
after(async () => {
  await t?.close();
  await dropTestDatabase(process.env, CLI_DB);
});

test('loads a school with data in every module, through the domain rules', async () => {
  assert.deepEqual(summary, {
    players: 48,
    tutors: summary.tutors,
    sessions: summary.sessions,
    attendance: summary.attendance,
    matches: 15,
    payments: summary.payments,
  });
  assert.ok(summary.tutors >= 38 && summary.tutors < 48, 'some families have two children');
  assert.ok(summary.attendance > 200 && summary.sessions > 20);
  const n = (sql: string) => t.count(sql);
  assert.ok((await n('SELECT COUNT(*) AS n FROM jugadores')) > 20, 'more than one page of players');
  assert.equal(
    (await n("SELECT COUNT(*) AS n FROM jugadores WHERE estatus <> 'ACTIVO'")) >= 5,
    true,
  );
  assert.equal(await n('SELECT COUNT(*) AS n FROM sedes WHERE NOT activo'), 1);
  assert.equal(await n('SELECT COUNT(*) AS n FROM categorias WHERE NOT activo'), 1);
  assert.equal(await n('SELECT COUNT(*) AS n FROM entrenadores WHERE NOT activo'), 1);
  assert.ok(
    (await n("SELECT COUNT(*) AS n FROM sesiones_entrenamiento WHERE estado = 'CANCELADO'")) >= 2,
  );
  for (const estado of ['PRESENTE', 'AUSENTE', 'JUSTIFICADO'])
    assert.ok(
      (await n(`SELECT COUNT(*) AS n FROM asistencias WHERE estado = '${estado}'`)) > 0,
      estado,
    );
  for (const estado of ['JUGADO', 'PROGRAMADO', 'REPROGRAMADO', 'CANCELADO'])
    assert.ok(
      (await n(`SELECT COUNT(*) AS n FROM partidos WHERE estado = '${estado}'`)) > 0,
      estado,
    );
  assert.equal(await n("SELECT COUNT(*) AS n FROM competencias WHERE estado = 'FINALIZADA'"), 1);
  for (const estado of ['PAGADO', 'PARCIAL', 'VENCIDO'])
    assert.ok((await n(`SELECT COUNT(*) AS n FROM cargos WHERE estado = '${estado}'`)) > 0, estado);
  assert.ok((await n("SELECT COUNT(*) AS n FROM pagos WHERE estado = 'CANCELADO'")) >= 2);
  for (const tipo of ['BECA', 'DESCUENTO'])
    assert.ok((await n(`SELECT COUNT(*) AS n FROM descuentos WHERE tipo = '${tipo}'`)) > 0, tipo);
  for (const estado of ['SOLICITADO', 'PAGADO', 'ENTREGADO', 'CANCELADO'])
    assert.ok(
      (await n(`SELECT COUNT(*) AS n FROM pedidos_uniforme WHERE estado = '${estado}'`)) > 0,
      estado,
    );
  assert.ok((await n('SELECT COUNT(*) AS n FROM avisos')) >= 10);
  // Written by the services, so the audit log has the history of the load.
  assert.ok((await n('SELECT COUNT(*) AS n FROM auditoria')) > 300);
  // Fictitious contacts only.
  assert.equal(
    await n("SELECT COUNT(*) AS n FROM tutores WHERE email NOT LIKE '%@example.com'"),
    0,
  );
});

test('the module pages read it through the API (admin and secretaría)', async () => {
  for (const email of ['admin@example.com', 'secretaria@example.com']) {
    const s = await t.login(email);
    const players = await t.ok<{ total: number }>(
      t.call(s, 'PlayerService', 'search', { page: 2 }),
    );
    assert.ok(players.total > 20, 'page 2 of players exists');
    await t.ok(t.call(s, 'ReportService', 'dashboard'));
    await t.ok(t.call(s, 'BillingService', 'debts'));
    await t.ok(t.call(s, 'AttendanceService', 'report', { from: '2026-09-01', to: '2026-10-13' }));
    await t.ok(t.call(s, 'ReportService', 'agenda', '2026-10-01', '2026-10-31'));
  }
});

test('a second load is refused and writes nothing', async () => {
  const before = await t.count('SELECT COUNT(*) AS n FROM jugadores');
  await assert.rejects(loadExtendedDemo(t.db), /ya está cargada/);
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM jugadores'), before);
});

test('guards: never with NODE_ENV=production; the extended demo and its reset only on *_demo databases', async () => {
  const prod = { ...process.env, NODE_ENV: 'production', DB_NAME: 'escuela_futbol_demo' };
  assert.throws(() => assertDemoAllowed(prod, { demoDatabase: false }), SetupError);
  assert.throws(
    () => assertDemoAllowed({ ...process.env, DB_NAME: 'escuela_futbol' }, { demoDatabase: true }),
    /sólo va en una base \*_demo/,
  );
  assert.doesNotThrow(() =>
    assertDemoAllowed(
      { ...process.env, NODE_ENV: 'development', DB_NAME: 'escuela_futbol_demo' },
      { demoDatabase: true },
    ),
  );
  assert.equal(DEMO_DATABASE_NAME, 'escuela_futbol_demo');
  assert.match(DEMO_DATABASE_NAME, DEMO_DATABASE);
  // Refused before connecting: with an unreachable socket, trying to connect would fail with a connection error,
  // not a SetupError. So a real database cannot be dropped by mistake, and nothing is even contacted.
  const offline = { ...process.env, DB_SOCKET: '/nonexistent/charales.sock' };
  for (const env of [
    { ...offline, DB_NAME: 'escuela_futbol' },
    { ...offline, DB_NAME: 'escuela_futbol_demo_copia' },
    { ...offline, DB_NAME: 'demo' },
    { ...offline, NODE_ENV: 'production', DB_NAME: 'escuela_futbol_demo' },
  ])
    await assert.rejects(dropDemoDatabase(env), SetupError, env.DB_NAME);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['db:demo:reset'], 'npm run db:setup -- --demo --ampliada --reset');
});

/** `api/setup.ts` as `npm run db:setup -- …` runs it, in its own process (real clock), on `name`. */
const cli = (name: string, ...args: string[]) =>
  spawnSync(process.execPath, ['api/setup.ts', ...args], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, NODE_ENV: 'development', DB_NAME: name },
    encoding: 'utf8',
  });

test('CLI: --ampliada refuses a non-*_demo database before touching it; on *_demo it loads once, --reset rebuilds', async () => {
  const refused = cli(`ef_${process.pid}_nodemo`, '--demo', '--ampliada');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /sólo va en una base \*_demo/);
  const dbs = createPool({ ...process.env, DB_NAME: 'information_schema' });
  try {
    const [row] = await dbs.query('SELECT COUNT(*) AS n FROM SCHEMATA WHERE SCHEMA_NAME = ?', [
      `ef_${process.pid}_nodemo`,
    ]);
    assert.equal(Number(row.n), 0, 'refused before creating anything');
  } finally {
    await dbs.end();
  }

  await dropTestDatabase(process.env, CLI_DB);
  const first = cli(CLI_DB, '--demo', '--ampliada');
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /demostración ampliada: 48 jugadores/);
  const again = cli(CLI_DB, '--demo', '--ampliada');
  assert.equal(again.status, 1, 'a loaded demo database is not loaded twice');
  const reset = cli(CLI_DB, '--demo', '--ampliada', '--reset');
  assert.equal(reset.status, 0, reset.stderr);
  assert.match(reset.stdout, /borrada para rehacerla[\s\S]*demostración ampliada: 48 jugadores/);
  const db = createPool({ ...process.env, DB_NAME: CLI_DB });
  try {
    const [row] = await db.query('SELECT COUNT(*) AS n FROM jugadores');
    assert.equal(Number(row.n), 54, 'rebuilt, not duplicated: 6 base + 48');
  } finally {
    await db.end();
  }
  assert.equal(cli(CLI_DB, '--reset').status, 1, '--reset alone is refused');
  const prodReset = spawnSync(
    process.execPath,
    ['api/setup.ts', '--demo', '--ampliada', '--reset'],
    {
      cwd: new URL('../', import.meta.url),
      env: { ...process.env, NODE_ENV: 'production', DB_NAME: CLI_DB },
      encoding: 'utf8',
    },
  );
  assert.equal(prodReset.status, 1);
  assert.match(prodReset.stderr, /NODE_ENV=production/);
  const kept = createPool({ ...process.env, DB_NAME: CLI_DB });
  try {
    const [row] = await kept.query('SELECT COUNT(*) AS n FROM jugadores');
    assert.equal(Number(row.n), 54, 'a reset refused in production leaves the database as it was');
  } finally {
    await kept.end();
  }
});

/** COUNT + CHECKSUM of every table of `name`: any write anywhere changes it. */
async function fingerprint(name: string): Promise<string> {
  const db = createPool({ ...process.env, DB_NAME: name });
  try {
    const tables: { t: string }[] = await db.query(
      `SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME`,
      [name],
    );
    const out: string[] = [];
    for (const { t } of tables) {
      const [c] = await db.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
      const [k] = await db.query(`CHECKSUM TABLE \`${t}\``);
      out.push(`${t}:${c.n}:${k.Checksum}`);
    }
    return out.join('\n');
  } finally {
    await db.end();
  }
}

const REAL = `ef_${process.pid}_real`; // stands in for escuela_futbol: a prepared database with people in it
const PROD = `ef_${process.pid}_prod`;
after(async () => {
  await dropTestDatabase(process.env, REAL);
  await dropTestDatabase(process.env, PROD);
});

test('no demo or seed command modifies or drops a database that already has data', async () => {
  await dropTestDatabase(process.env, REAL);
  await setupDatabase({ ...process.env, DB_NAME: REAL });
  const db = createPool({ ...process.env, DB_NAME: REAL });
  try {
    await db.query(
      `INSERT INTO jugadores (identificador, nombre, apellido_paterno, fecha_nacimiento) VALUES ('J-0001', 'Real', 'X', '2016-01-01')`,
    );
  } finally {
    await db.end();
  }
  const before = await fingerprint(REAL);
  const run = (env: Record<string, string>, ...args: string[]) =>
    spawnSync(process.execPath, args, {
      cwd: new URL('../', import.meta.url),
      env: { ...process.env, NODE_ENV: 'development', DB_NAME: REAL, ...env },
      encoding: 'utf8',
    });
  const cases: [string, ReturnType<typeof run>, RegExp][] = [
    ['--demo', run({}, 'api/setup.ts', '--demo'), /la demostración sólo se carga/],
    ['--dev-seed', run({}, 'api/setup.ts', '--dev-seed'), /semilla de desarrollo sólo se carga/],
    [
      '--demo --ampliada',
      run({}, 'api/setup.ts', '--demo', '--ampliada'),
      /sólo va en una base \*_demo/,
    ],
    [
      '--demo --ampliada --reset',
      run({}, 'api/setup.ts', '--demo', '--ampliada', '--reset'),
      /sólo va en una base \*_demo/,
    ],
    ['--reset', run({}, 'api/setup.ts', '--reset'), /van junto con --demo/],
    ['--dev-seed --demo', run({}, 'api/setup.ts', '--dev-seed', '--demo'), /no se combinan/],
    ['db:mariadb:demo', run({}, 'api/demo.ts'), /La base ya tiene datos/],
    [
      'NODE_ENV=production --demo',
      run({ NODE_ENV: 'production' }, 'api/setup.ts', '--demo'),
      /NODE_ENV=production/,
    ],
  ];
  for (const [label, r, message] of cases) {
    assert.notEqual(r.status, 0, label);
    assert.match(r.stderr, message, label);
    assert.equal(await fingerprint(REAL), before, `${label}: the database is exactly as it was`);
  }

  // Production on a database that does not exist yet: refused before creating it.
  const prod = run({ NODE_ENV: 'production', DB_NAME: PROD }, 'api/setup.ts', '--demo');
  assert.equal(prod.status, 1);
  const info = createPool({ ...process.env, DB_NAME: 'information_schema' });
  try {
    const [row] = await info.query('SELECT COUNT(*) AS n FROM SCHEMATA WHERE SCHEMA_NAME = ?', [
      PROD,
    ]);
    assert.equal(Number(row.n), 0);
  } finally {
    await info.end();
  }
});

test('database selection: DB_NAME on the command line wins over .env; without it, .env’s working base is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'charales-env-'));
  try {
    const file = join(dir, '.env');
    // A .env like a developer's: the working database, and a socket that does not exist (no connection possible).
    writeFileSync(file, 'DB_NAME=escuela_futbol\nDB_SOCKET=/nonexistent/charales.sock\n');
    const { DB_NAME: _ignored, ...withoutName } = process.env;
    const shown = spawnSync(
      process.execPath,
      [`--env-file=${file}`, '-e', 'process.stdout.write(String(process.env.DB_NAME))'],
      { env: { ...withoutName, DB_NAME: 'escuela_futbol_demo' }, encoding: 'utf8' },
    );
    assert.equal(shown.stdout, 'escuela_futbol_demo', 'the command line wins over .env');
    const reset = spawnSync(
      process.execPath,
      [`--env-file=${file}`, 'api/setup.ts', '--demo', '--ampliada', '--reset'],
      {
        cwd: new URL('../', import.meta.url),
        env: { ...withoutName, NODE_ENV: 'development' },
        encoding: 'utf8',
      },
    );
    assert.equal(reset.status, 1);
    // A name refusal, not a connection error: nothing was contacted, let alone dropped.
    assert.match(
      reset.stderr,
      /sólo va en una base \*_demo \(escuela_futbol_demo\), no en «escuela_futbol»/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

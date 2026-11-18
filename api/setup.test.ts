/**
 * The local installation commands (docs/SETUP.md): `npm run db:setup` (api/schema.ts) and `npm run db:admin`
 * (api/create-admin.ts). They must be idempotent and never destroy data. Temporary databases ef_setup_* only.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import mariadb from 'mariadb';
import { createAdmin } from './create-admin.ts';
import {
  SetupError,
  baseSchema,
  dropTestDatabase,
  loadDevSeed,
  serverOptions,
  setupDatabase,
  sqlBatches,
} from './schema.ts';
import { cachedTables, unitOfWork } from './rpc.ts';
import { createApp, createPool } from './server.ts';

const FRESH = `ef_setup_${process.pid}_a`;
const FOREIGN = `ef_setup_${process.pid}_b`;
const SEED = `ef_setup_${process.pid}_c`;
const env = (name: string) => ({ ...process.env, DB_NAME: name });

after(async () => {
  await dropTestDatabase(process.env, FRESH);
  await dropTestDatabase(process.env, FOREIGN);
  await dropTestDatabase(process.env, SEED);
});

test('db:setup creates and prepares a new database; a second run changes nothing', async () => {
  await dropTestDatabase(process.env, FRESH);
  const first = await setupDatabase(env(FRESH));
  assert.equal(first.created, true);
  assert.equal(first.schemaApplied, true);
  assert.deepEqual(first.migrations, [
    '001_token_finalidad.sql',
    '002_cargos_vencidos.sql',
    '003_version_datos.sql',
    '004_pago_referencia.sql',
  ]);
  assert.deepEqual(first.counts, { usuarios: 0, jugadores: 0, rol_permiso: 106 });
  const second = await setupDatabase(env(FRESH));
  assert.equal(second.created, false);
  assert.equal(second.schemaApplied, false);
  assert.deepEqual(second.counts, first.counts);
  assert.deepEqual([first.matrixApplied, second.matrixApplied], [true, false]);
});

test("db:setup on a database with data keeps every row and the administrator's permission matrix", async () => {
  const db = createPool(env(FRESH));
  try {
    await db.query(
      `INSERT INTO jugadores (identificador, nombre, apellido_paterno, fecha_nacimiento) VALUES ('J-0001', 'Conservado', 'X', '2016-01-01')`,
    );
    await db.query('DELETE FROM rol_permiso WHERE rol_id = 2 LIMIT 1'); // a permission removed by the admin…
    const before = await db.query('SELECT COUNT(*) AS n FROM rol_permiso');
    await setupDatabase(env(FRESH));
    const [{ n }] = await db.query(
      "SELECT COUNT(*) AS n FROM jugadores WHERE nombre = 'Conservado'",
    );
    assert.equal(Number(n), 1);
    // …stays removed: the initial matrix is applied only on a first install (HU-006 decisions are kept).
    const after_ = await db.query('SELECT COUNT(*) AS n FROM rol_permiso');
    assert.equal(Number(after_[0].n), Number(before[0].n));
  } finally {
    await db.end();
  }
});

// ---------------------------------------------------------------- npm run db:mariadb:dev-seed (020, legacy)

/** Rows + CHECKSUM TABLE of every table of a temporary database: equal snapshots = nothing changed at all. */
async function snapshot(name: string): Promise<string> {
  assert.match(name, /^ef_[A-Za-z0-9_]+$/); // never a personal database
  const conn = await mariadb.createConnection(serverOptions(process.env));
  try {
    const tables: { t: string }[] = await conn.query(
      `SELECT TABLE_NAME AS t FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
      [name],
    );
    const sums: string[] = [];
    for (const { t } of tables) {
      const [row] = await conn.query(`CHECKSUM TABLE \`${name}\`.\`${t}\``);
      sums.push(`${t}=${row.Checksum}`);
    }
    return sums.join(' ');
  } finally {
    await conn.end();
  }
}

/** `npm run db:mariadb:dev-seed` as the CLI runs it: `api/setup.ts --dev-seed` in its own process, on `name`. */
const devSeedCli = (name: string) =>
  spawnSync(process.execPath, ['api/setup.ts', '--dev-seed'], {
    cwd: new URL('../', import.meta.url),
    env: env(name),
    encoding: 'utf8',
  });

test('db:mariadb:dev-seed is db:setup -- --dev-seed; these tests only use ef_* databases', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  // The old script piped all of 010 (initial matrix included, INSERT IGNORE) and 020 with `sh`, on any database.
  assert.equal(pkg.scripts['db:mariadb:dev-seed'], 'npm run db:setup -- --dev-seed');
  for (const name of [FRESH, FOREIGN, SEED]) assert.match(name, /^ef_setup_\d+_[a-z]$/);
});

test('dev-seed: a seed that cannot land whole is refused and leaves nothing behind', async () => {
  await dropTestDatabase(process.env, SEED);
  await setupDatabase(env(SEED));
  const db = createPool(env(SEED));
  try {
    // Another current season: 020's INSERT IGNORE would silently skip its season and categories.
    await db.query(
      `INSERT INTO temporadas (nombre, fecha_inicio, fecha_fin, activa, es_actual)
       VALUES ('Otra', '2026-01-01', '2026-12-31', TRUE, TRUE)`,
    );
    const before = await snapshot(SEED);
    await assert.rejects(
      loadDevSeed(env(SEED)),
      (e) => e instanceof SetupError && /no se aplicó completa/.test(e.message),
    );
    assert.equal(await snapshot(SEED), before, 'ROLLBACK: no user, player nor version bump left');
    await db.query("DELETE FROM temporadas WHERE nombre = 'Otra'");
  } finally {
    await db.end();
  }
});

test('dev-seed loads 020 on a database without users or players and invalidates the API cache', async () => {
  const db = createPool(env(SEED));
  try {
    const version = async () =>
      Number((await db.query('SELECT version FROM version_datos WHERE id = 1'))[0].version);
    const grants = async () =>
      Number((await db.query('SELECT COUNT(*) AS n FROM rol_permiso'))[0].n);
    // An API instance with its cache already filled (no players yet).
    await unitOfWork(db, async (tables) => ({ tables }));
    assert.equal(cachedTables(db)!['players']!.length, 0);
    const [v0, g0] = [await version(), await grants()];
    await loadDevSeed(env(SEED));
    assert.equal(await version(), v0 + 1);
    assert.equal(await grants(), g0, 'rol_permiso is never touched');
    const [c] = await db.query(
      `SELECT (SELECT COUNT(*) FROM usuarios WHERE email LIKE '%@example.com') AS usuarios,
              (SELECT COUNT(*) FROM jugadores) AS jugadores`,
    );
    assert.deepEqual([Number(c.usuarios), Number(c.jugadores)], [6, 6]);
    // Next operation of that API: the version changed, so it re-reads instead of serving the stale copy.
    await unitOfWork(db, async (tables) => ({ tables }));
    assert.equal(cachedTables(db)!['players']!.length, 6);
  } finally {
    await db.end();
  }
});

test('dev-seed never restores admin changes: on a database with data it is refused before any write', async () => {
  const db = createPool(env(SEED));
  try {
    await db.query("UPDATE usuarios SET activo = FALSE WHERE email = 'secretaria@example.com'");
    await db.query(
      "UPDATE usuarios SET email = 'direccion@escuela.example' WHERE email = 'admin@example.com'",
    );
    await db.query("UPDATE entrenadores SET usuario_id = NULL WHERE email = 'coach@example.com'");
    // A permission the administrator removed from SECRETARIA (HU-006).
    const [g] = await db.query(
      `SELECT rp.rol_id, rp.permiso_id FROM rol_permiso rp JOIN roles r ON r.id = rp.rol_id
        WHERE r.nombre = 'SECRETARIA' LIMIT 1`,
    );
    await db.query('DELETE FROM rol_permiso WHERE rol_id = ? AND permiso_id = ?', [
      g.rol_id,
      g.permiso_id,
    ]);
    const before = await snapshot(SEED);

    const cli = devSeedCli(SEED);
    assert.equal(cli.status, 1, cli.stdout + cli.stderr);
    assert.match(cli.stderr, /ya tiene usuarios o jugadores/);
    await assert.rejects(loadDevSeed(env(SEED)), /ya tiene usuarios o jugadores/);

    // Not one row changed — not even version_datos or the permission catalog (db:setup never ran).
    assert.equal(await snapshot(SEED), before);
    const [r] = await db.query(
      `SELECT (SELECT COUNT(*) FROM usuarios WHERE email = 'admin@example.com') AS renamed,
              (SELECT activo FROM usuarios WHERE email = 'secretaria@example.com') AS secretaria,
              (SELECT COUNT(*) FROM entrenadores e JOIN usuarios u ON u.id = e.usuario_id
                WHERE u.email = 'coach@example.com') AS coach`,
    );
    assert.deepEqual([Number(r.renamed), Number(r.secretaria), Number(r.coach)], [0, 0, 0]);
  } finally {
    await db.end();
  }
});

test('dev-seed is refused on a database with players but no users', async () => {
  // FRESH has the player «Conservado» and no accounts (tests above).
  const before = await snapshot(FRESH);
  const cli = devSeedCli(FRESH);
  assert.equal(cli.status, 1, cli.stdout + cli.stderr);
  await assert.rejects(loadDevSeed(env(FRESH)), /ya tiene usuarios o jugadores/);
  assert.equal(await snapshot(FRESH), before);
});

test('db:setup refuses a non-empty database that is not Charales, without touching it', async () => {
  await dropTestDatabase(process.env, FOREIGN);
  const conn = await mariadb.createConnection(serverOptions(process.env));
  try {
    await conn.query(`CREATE DATABASE \`${FOREIGN}\``);
    await conn.query(`CREATE TABLE \`${FOREIGN}\`.ajena (id INT PRIMARY KEY)`);
    await conn.query(`INSERT INTO \`${FOREIGN}\`.ajena VALUES (1)`);
    await assert.rejects(
      setupDatabase(env(FOREIGN)),
      (e) => e instanceof SetupError && /no son del esquema/.test(e.message),
    );
    const tables = await conn.query(
      'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
      [FOREIGN],
    );
    assert.deepEqual(
      tables.map((r: { t: string }) => r.t),
      ['ajena'],
    );
  } finally {
    await conn.end();
  }
});

test('db:setup fails clearly on a bad name or an unreachable server; the schema it applies has no DROP', async () => {
  await assert.rejects(setupDatabase({ ...process.env, DB_NAME: 'mala;base' }), /DB_NAME/);
  await assert.rejects(
    setupDatabase({ DB_HOST: '127.0.0.1', DB_PORT: '1', DB_USER: 'nadie', DB_NAME: 'ef_x' }),
    (e) => e instanceof SetupError && /No se pudo conectar a MariaDB/.test(e.message),
  );
  assert.doesNotMatch(baseSchema(), /\bDROP\s+(TABLE|DATABASE)\b/i);
  assert.doesNotMatch(baseSchema(), /CREATE DATABASE|USE escuela_futbol/);
});

test('test databases are the only ones the harness may drop', async () => {
  for (const name of ['escuela_futbol', 'charales_dev', 'ef', 'x_ef_1'])
    await assert.rejects(dropTestDatabase(process.env, name), SetupError);
});

test('SQL files with DELIMITER blocks are split the way the server needs', () => {
  const batches = sqlBatches(
    'CREATE TABLE a (x INT);\nDELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END//\nDELIMITER ;\nSELECT 3;',
  );
  assert.deepEqual(batches, [
    'CREATE TABLE a (x INT);',
    'CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END',
    'SELECT 3;',
  ]);
});

test('db:admin creates the first administrator (argon2id) and never overwrites an existing account', async () => {
  const db = createPool(env(FRESH));
  const server = createApp(db, { secureCookie: false }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const login = (password: string) =>
    fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'direccion@escuela.example', password }),
    });
  try {
    await assert.rejects(
      createAdmin(db, {
        email: 'direccion@escuela.example',
        firstName: 'Dirección',
        lastName: null,
        password: 'corta',
      }),
      /al menos 8/,
    );
    const id = await createAdmin(db, {
      email: ' Direccion@Escuela.example ',
      firstName: 'Dirección',
      lastName: 'General',
      password: 'Inicial2026',
    });
    const [row] = await db.query('SELECT email, rol_id, password_hash FROM usuarios WHERE id = ?', [
      id,
    ]);
    assert.equal(row.email, 'direccion@escuela.example');
    assert.match(row.password_hash, /^\$argon2id\$/);
    const res = await login('Inicial2026');
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).roles, ['ADMINISTRADOR']);
    await assert.rejects(
      createAdmin(db, {
        email: 'direccion@escuela.example',
        firstName: 'Otro',
        lastName: null,
        password: 'Otra12345x',
      }),
      /Ya existe/,
    );
    assert.equal((await login('Inicial2026')).status, 200, 'the original password still works');
    assert.equal((await login('Otra12345x')).status, 401);
  } finally {
    server.close();
    await db.end();
  }
});

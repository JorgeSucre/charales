/**
 * The local installation commands (docs/SETUP.md): `npm run db:setup` (api/schema.ts) and `npm run db:admin`
 * (api/create-admin.ts). They must be idempotent and never destroy data. Temporary databases ef_setup_* only.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import mariadb from 'mariadb';
import { createAdmin } from './create-admin.ts';
import {
  SetupError,
  baseSchema,
  dropTestDatabase,
  serverOptions,
  setupDatabase,
  sqlBatches,
} from './schema.ts';
import { createApp, createPool } from './server.ts';

const FRESH = `ef_setup_${process.pid}_a`;
const FOREIGN = `ef_setup_${process.pid}_b`;
const env = (name: string) => ({ ...process.env, DB_NAME: name });

after(async () => {
  await dropTestDatabase(process.env, FRESH);
  await dropTestDatabase(process.env, FOREIGN);
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

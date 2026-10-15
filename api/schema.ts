/**
 * Database preparation in Node, with the API's own driver and connection settings (no `mariadb` CLI nor `sh`, so it
 * works the same on macOS, Linux and Windows). Used by `npm run db:setup` (api/setup.ts) and by the test harnesses.
 *
 * Safety: it never drops or empties anything. The base schema (docs/escuela_futbol_mariadb.sql) is applied only to a
 * database with no tables, and without its DROP TABLE lines; a database that already has Charales' tables only gets
 * the idempotent migrations and the permission catalog (its role matrix only on a first install, so an administrator's
 * changes are kept); any other non-empty database is refused.
 */
import { readFileSync, readdirSync } from 'node:fs';
import mariadb, { type Connection, type ConnectionConfig } from 'mariadb';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
export const MIN_VERSION = [10, 6] as const;

/** Server connection from the same variables as the API (DB_SOCKET or DB_HOST/DB_PORT, DB_USER, DB_PASSWORD). */
export function serverOptions(env: Record<string, string | undefined>): ConnectionConfig {
  return {
    ...(env['DB_SOCKET']
      ? { socketPath: env['DB_SOCKET'] }
      : { host: env['DB_HOST'] ?? '127.0.0.1', port: Number(env['DB_PORT'] ?? 3306) }),
    user: env['DB_USER'],
    password: env['DB_PASSWORD'],
    multipleStatements: true,
    dateStrings: true,
    bigIntAsNumber: true,
    logParam: false,
  };
}

export function databaseName(env: Record<string, string | undefined>): string {
  const name = env['DB_NAME'] ?? 'escuela_futbol';
  if (!/^[A-Za-z0-9_]{1,64}$/.test(name))
    throw new SetupError(`DB_NAME «${name}» no es válido: sólo letras, números y guion bajo.`);
  return name;
}

export class SetupError extends Error {}

/**
 * What the server can run from a SQL file: the parts between `DELIMITER` directives (a client-side syntax). With the
 * default `;` a part goes as one multi-statement batch (the server parses comments and strings); with another
 * delimiter (procedures) each statement goes on its own.
 */
export function sqlBatches(text: string): string[] {
  const batches: string[] = [];
  let delimiter = ';';
  let buffer: string[] = [];
  const flush = () => {
    const body = buffer.join('\n').trim();
    buffer = [];
    if (!body) return;
    if (delimiter === ';') batches.push(body);
    else
      for (const statement of body.split(delimiter))
        if (statement.trim()) batches.push(statement.trim());
  };
  for (const line of text.split('\n')) {
    const directive = /^\s*DELIMITER\s+(\S+)\s*$/i.exec(line);
    if (directive) {
      flush();
      delimiter = directive[1]!;
    } else buffer.push(line);
  }
  flush();
  return batches;
}

export async function runSql(conn: Connection, text: string): Promise<void> {
  for (const batch of sqlBatches(text)) await conn.query(batch);
}

/** The base schema for an EMPTY database: without its CREATE DATABASE/USE header and without DROP TABLE. */
export function baseSchema(): string {
  const ddl = read('docs/escuela_futbol_mariadb.sql');
  const header = /CREATE DATABASE IF NOT EXISTS escuela_futbol[\s\S]*?;\s*USE escuela_futbol;/;
  if (!header.test(ddl)) throw new SetupError('El esquema base no tiene la cabecera esperada.');
  return ddl.replace(header, '').replace(/^DROP TABLE IF EXISTS \w+;\s*$/gm, '');
}

export function migrationFiles(): string[] {
  return readdirSync(new URL('db/mariadb/migrations/', root))
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();
}

export interface SetupReport {
  database: string;
  version: string;
  created: boolean;
  schemaApplied: boolean;
  migrations: string[];
  /** The initial role → permission matrix was applied (first install); otherwise the existing one was kept. */
  matrixApplied: boolean;
  eventScheduler: string;
  counts: Record<string, number>;
}

/**
 * Prepares `DB_NAME` for the API, idempotently: creates it if missing, applies the base schema only if it has no
 * tables, then every migration (idempotent) and the app permissions (INSERT IGNORE). Never drops nor resets data or
 * passwords. Fails with a clear message on a bad connection, an old server or a foreign non-empty database.
 */
export async function setupDatabase(env: Record<string, string | undefined>): Promise<SetupReport> {
  const name = databaseName(env);
  let conn: Connection;
  try {
    conn = await mariadb.createConnection(serverOptions(env));
  } catch (e) {
    throw new SetupError(
      `No se pudo conectar a MariaDB (${(e as Error).message}). Revisa DB_HOST/DB_PORT o DB_SOCKET, DB_USER y ` +
        `DB_PASSWORD en .env, y que el servidor esté iniciado (docs/SETUP.md).`,
    );
  }
  try {
    const [{ v }] = await conn.query('SELECT VERSION() AS v');
    const [major, minor] = String(v).split(/[.-]/).map(Number);
    if (!/mariadb/i.test(String(v)))
      throw new SetupError(
        `El servidor es «${v}»: Charales necesita MariaDB ${MIN_VERSION.join('.')}+.`,
      );
    if (major! < MIN_VERSION[0] || (major === MIN_VERSION[0] && minor! < MIN_VERSION[1]))
      throw new SetupError(
        `MariaDB ${v} es demasiado antiguo: se necesita ${MIN_VERSION.join('.')} o superior.`,
      );

    const [exists] = await conn.query(
      'SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
      [name],
    );
    const created = Number(exists.n) === 0;
    if (created)
      await conn
        .query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
        .catch((e) => {
          throw new SetupError(
            `No se pudo crear la base «${name}» (${(e as Error).message}). Créala con un usuario administrador ` +
              `(docs/SETUP.md, paso 3) y vuelve a ejecutar el comando.`,
          );
        });
    await conn.query(`USE \`${name}\``);

    const tables: { t: string }[] = await conn.query(
      'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
      [name],
    );
    const names = new Set(tables.map((r) => r.t));
    let schemaApplied = false;
    if (names.size === 0) {
      await runSql(conn, baseSchema());
      schemaApplied = true;
    } else if (!['usuarios', 'jugadores', 'cargos', 'rol_permiso'].every((t) => names.has(t))) {
      throw new SetupError(
        `La base «${name}» ya tiene ${names.size} tabla(s) que no son del esquema de Charales. No se modificó nada: ` +
          `usa otra DB_NAME o revisa esa base a mano.`,
      );
    }

    const migrations = migrationFiles();
    for (const file of migrations) await runSql(conn, read(`db/mariadb/migrations/${file}`));
    // 010: the permission catalog always (it only adds keys); the initial role matrix only on a first install, so a
    // re-run never gives back a permission the administrator removed (HU-006). Later grants go in a migration.
    const perms = read('db/mariadb/010_permisos_app.sql');
    const cut = perms.indexOf('-- rol_permiso inicial');
    if (cut < 0)
      throw new SetupError('010_permisos_app.sql no tiene la sección «rol_permiso inicial».');
    await runSql(conn, perms.slice(0, cut));
    const [{ grants }] = await conn.query('SELECT COUNT(*) AS grants FROM rol_permiso');
    const matrixApplied = Number(grants) === 0;
    if (matrixApplied) await runSql(conn, perms.slice(cut));
    // An API already running re-reads its in-memory tables (D13).
    await conn.query('UPDATE version_datos SET version = version + 1 WHERE id = 1');

    const [{ scheduler }] = await conn.query('SELECT @@event_scheduler AS scheduler');
    const [counts] = await conn.query(
      `SELECT (SELECT COUNT(*) FROM usuarios) AS usuarios, (SELECT COUNT(*) FROM jugadores) AS jugadores,
              (SELECT COUNT(*) FROM rol_permiso) AS rol_permiso`,
    );
    return {
      database: name,
      version: String(v),
      created,
      schemaApplied,
      migrations,
      matrixApplied,
      eventScheduler: String(scheduler),
      counts: Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, Number(n)])),
    };
  } finally {
    await conn.end();
  }
}

/** Runs a project SQL file (path from the repo root) on database `name`. Tests and seeds. */
export async function runSqlFile(
  env: Record<string, string | undefined>,
  name: string,
  path: string,
): Promise<void> {
  const conn = await mariadb.createConnection({ ...serverOptions(env), database: name });
  try {
    await runSql(conn, read(path));
  } finally {
    await conn.end();
  }
}

/**
 * Drops a TEMPORARY test database. Refuses any name not starting with `ef_` (the prefix of every test database), so a
 * mistake can never drop escuela_futbol or another real database.
 */
export async function dropTestDatabase(
  env: Record<string, string | undefined>,
  name: string,
): Promise<void> {
  if (!/^ef_[A-Za-z0-9_]+$/.test(name))
    throw new SetupError(`Sólo se borran bases de prueba ef_*, no «${name}».`);
  const conn = await mariadb.createConnection(serverOptions(env));
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
  } finally {
    await conn.end();
  }
}

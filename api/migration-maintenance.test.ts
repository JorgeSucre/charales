/** Optional cleanup SQL is exercised only on a disposable ef_* MariaDB schema. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from './server.ts';
import { releaseTestDatabase, runSqlFile, setupDatabase, uniqueTestDatabase } from './schema.ts';

const DB = uniqueTestDatabase('ef_maint');
const env = { ...process.env, DB_NAME: DB };

after(() => releaseTestDatabase(DB));

test('optional Argon turn cleanup is repeatable with empty and populated legacy tables', async () => {
  await setupDatabase(env);
  const db = createPool(env);
  try {
    const cleanup = 'db/mariadb/maintenance/010_eliminar_turnos_hash_antiguo.sql';
    const oldSchema = 'db/mariadb/migrations/006_turnos_argon2.sql';

    // Missing tables are harmless, including a second execution.
    await runSqlFile(env, DB, cleanup);
    await runSqlFile(env, DB, cleanup);

    // Existing but empty tables are removed safely too.
    await runSqlFile(env, DB, oldSchema);
    assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM turnos_argon2'))[0].n), 0);
    await runSqlFile(env, DB, cleanup);
    await runSqlFile(env, DB, cleanup);

    // Recreate the historical schema with live transient rows to confirm their exact effect.
    await runSqlFile(env, DB, oldSchema);
    await db.query('INSERT INTO turnos_argon2 (vence_en) VALUES (NOW(3))');
    assert.equal(
      Number((await db.query('SELECT COUNT(*) AS n FROM turnos_argon2_guarda'))[0].n),
      1,
      'the second legacy table contains its singleton guard row',
    );
    const foreignKeys = await db.query(
      `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ?
          AND (TABLE_NAME IN ('turnos_argon2', 'turnos_argon2_guarda')
            OR REFERENCED_TABLE_NAME IN ('turnos_argon2', 'turnos_argon2_guarda'))
          AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [DB],
    );
    assert.deepEqual(foreignKeys, [], 'historical DDL has no foreign-key dependents');
    assert.equal(
      Number((await db.query('SELECT COUNT(*) AS n FROM turnos_argon2'))[0].n),
      1,
      'fixture includes transient data before cleanup',
    );

    await runSqlFile(env, DB, cleanup);
    await runSqlFile(env, DB, cleanup);
    const remaining = await db.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('turnos_argon2', 'turnos_argon2_guarda')`,
      [DB],
    );
    assert.deepEqual(remaining, [], 'cleanup removes both tables and is idempotent');
  } finally {
    await db.end();
  }
});

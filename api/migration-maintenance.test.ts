/** Optional cleanup SQL is exercised only on a disposable ef_* MariaDB schema. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from './server.ts';
import { releaseTestDatabase, runSqlFile, setupDatabase, uniqueTestDatabase } from './schema.ts';

const DB = uniqueTestDatabase('ef_maint');
const env = { ...process.env, DB_NAME: DB };

after(() => releaseTestDatabase(DB));

test('migration 010 removes obsolete Argon turn tables from upgraded schemas', async () => {
  await setupDatabase(env);
  const db = createPool(env);
  try {
    const oldSchema = 'db/mariadb/migrations/006_turnos_argon2.sql';
    const cleanup = 'db/mariadb/migrations/010_eliminar_turnos_hash_antiguo.sql';

    // Simulate a database upgraded through 009 where 006 left its transient tables behind.
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

    // Migration is idempotent and removes only these two obsolete transient tables.
    await runSqlFile(env, DB, cleanup);
    await runSqlFile(env, DB, cleanup);
    const remaining = await db.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('turnos_argon2', 'turnos_argon2_guarda')`,
      [DB],
    );
    assert.deepEqual(remaining, [], 'migration removes both legacy tables and is idempotent');
  } finally {
    await db.end();
  }
});

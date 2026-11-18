/**
 * The personal data inventory (docs/policies/POLITICA_CONSERVACION_DATOS.md): every table of the schema is classified,
 * the inventory writes nothing and its output carries counts, never a person's data.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DATA_MAP, personalDataInventory } from './datos-personales.ts';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
before(async () => {
  t = await openTestDb('ef_datos');
});
after(async () => {
  await t?.close();
});

test('every table of the schema is classified, and every listed column exists', async () => {
  const rows: { t: string; c: string }[] = await t.db.query(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN
        (SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE')`,
  );
  const schema = new Map<string, Set<string>>();
  for (const r of rows) schema.set(r.t, (schema.get(r.t) ?? new Set()).add(r.c));
  assert.deepEqual(
    [...schema.keys()].sort(),
    Object.keys(DATA_MAP).sort(),
    'a table is missing from DATA_MAP (classify it) or DATA_MAP names one that no longer exists',
  );
  for (const [table, { columns }] of Object.entries(DATA_MAP))
    for (const c of columns) assert.ok(schema.get(table)!.has(c), `${table}.${c}`);
});

test('the inventory writes nothing and counts right', async () => {
  const inv = await t.unchanged(() => personalDataInventory(t.db), []);
  const minors = await t.count(
    'SELECT COUNT(*) AS n FROM jugadores WHERE fecha_nacimiento > CURDATE() - INTERVAL 18 YEAR',
  );
  assert.ok(minors > 0, 'the demo has minors');
  assert.equal(inv.indicators['jugadores menores de 18 años'], minors);
  assert.equal(
    inv.tables.find((x) => x.table === 'jugadores')!.rows,
    await t.count('SELECT COUNT(*) AS n FROM jugadores'),
  );
  assert.ok(!inv.tables.some((x) => x.category === 'SIN_DATOS_PERSONALES'));
});

test('the command prints counts, not personal data', async () => {
  const [player] = await t.db.query(
    'SELECT nombre, apellido_paterno, email FROM jugadores LIMIT 1',
  );
  const [tutor] = await t.db.query('SELECT email, telefono FROM tutores LIMIT 1');
  const run = spawnSync(process.execPath, ['api/datos-personales.ts'], {
    env: { ...process.env, DB_NAME: t.name },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /MENORES\s+jugadores\s+\d+/);
  for (const v of [
    player.nombre,
    player.apellido_paterno,
    player.email,
    tutor.email,
    tutor.telefono,
  ])
    if (v) assert.ok(!run.stdout.includes(String(v)), 'a value reached the output');
});

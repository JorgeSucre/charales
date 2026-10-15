/**
 * `npm run db:setup` — prepares the database of `.env` (DB_NAME) for the API, safely and idempotently: creates it if
 * missing, applies the base schema only if it is empty, then the migrations and the app permissions. Never drops,
 * empties nor resets passwords: run it again after every `git pull` that brings migrations.
 *
 *   npm run db:setup              # schema + migrations + permissions
 *   npm run db:setup -- --demo    # …and the fictitious demo data (only on a database without users or players)
 *
 * Then create the first administrator with `npm run db:admin`. Guide: docs/SETUP.md.
 */
import { loadDemo } from './demo.ts';
import { SetupError, setupDatabase } from './schema.ts';
import { createPool } from './server.ts';

if (import.meta.main) {
  try {
    const r = await setupDatabase(process.env);
    console.log(`MariaDB ${r.version} · base «${r.database}»${r.created ? ' (creada)' : ''}`);
    console.log(
      r.schemaApplied ? '· esquema base aplicado' : '· esquema existente: se conservaron sus datos',
    );
    console.log(`· migraciones: ${r.migrations.join(', ')}`);
    console.log(
      r.matrixApplied
        ? `· permisos: matriz inicial de roles aplicada (${r.counts['rol_permiso']} filas)`
        : `· permisos: catálogo al día; se conservó la matriz de roles existente (${r.counts['rol_permiso']} filas)`,
    );
    if (process.argv.includes('--demo')) {
      const db = createPool({ ...process.env, DB_NAME: r.database });
      try {
        await loadDemo(db);
        console.log('· datos de demostración cargados (cuentas @example.com, contraseña demo1234)');
      } finally {
        await db.end();
      }
    }
    console.log(`· usuarios: ${r.counts['usuarios']} · jugadores: ${r.counts['jugadores']}`);
    if (r.eventScheduler !== 'ON')
      console.warn(
        `Aviso: event_scheduler=${r.eventScheduler}. El trabajo diario de cargos VENCIDO no correrá; la app los ` +
          'recalcula igual en cada operación de cobranza (docs/SETUP.md, «Planificador de eventos»).',
      );
    if (!r.counts['usuarios'] && !process.argv.includes('--demo'))
      console.log('Siguiente paso: npm run db:admin (crea el primer administrador).');
  } catch (e) {
    console.error(e instanceof SetupError ? `Error: ${e.message}` : e);
    process.exitCode = 1;
  }
}

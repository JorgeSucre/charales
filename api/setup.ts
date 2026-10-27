/**
 * `npm run db:setup` — prepares the database of `.env` (DB_NAME) for the API, safely and idempotently: creates it if
 * missing, applies the base schema only if it is empty, then the migrations and the app permissions. Never drops,
 * empties nor resets passwords: run it again after every `git pull` that brings migrations.
 *
 *   npm run db:setup              # schema + migrations + permissions
 *   npm run db:setup -- --demo    # …and the fictitious demo data (only on a database without users or players)
 *   DB_NAME=escuela_futbol_demo npm run db:setup -- --demo --ampliada
 *                                 # …plus the extended demo (api/demo-extended.ts), only in a *_demo database
 *   DB_NAME=escuela_futbol_demo npm run db:demo:reset   # = --demo --ampliada --reset: drops that *_demo database
 *                                 # and builds it again (the only way to remove demo rows)
 * No demo data is ever loaded with NODE_ENV=production.
 *   npm run db:mariadb:dev-seed   # (obsolete, use --demo) = db:setup -- --dev-seed: …and the small 020 seed,
 *                                 # also only on a database without users or players (checked before any write)
 *
 * Then create the first administrator with `npm run db:admin`. Guide: docs/SETUP.md.
 */
import { loadDemo } from './demo.ts';
import { loadExtendedDemo } from './demo-extended.ts';
import {
  DEMO_NOT_EMPTY,
  NOT_EMPTY,
  SetupError,
  databaseName,
  assertDemoAllowed,
  dropDemoDatabase,
  existingRows,
  loadDevSeed,
  setupDatabase,
} from './schema.ts';
import { createPool } from './server.ts';

if (import.meta.main) {
  try {
    const devSeed = process.argv.includes('--dev-seed');
    const demo = process.argv.includes('--demo');
    const extended = process.argv.includes('--ampliada');
    const reset = process.argv.includes('--reset');
    if ((extended || reset) && !demo)
      throw new SetupError(
        '--ampliada y --reset van junto con --demo (npm run db:setup -- --demo --ampliada).',
      );
    if (devSeed && demo)
      throw new SetupError('--dev-seed (obsoleto) y --demo no se combinan: usa sólo --demo.');
    if (reset && !extended)
      throw new SetupError(
        '--reset sólo rehace la demostración ampliada: --demo --ampliada --reset.',
      );
    // Before any connection: NODE_ENV=production and, for the extended demo, a database not named *_demo.
    if (demo || devSeed) assertDemoAllowed(process.env, { demoDatabase: extended });
    if (reset) {
      await dropDemoDatabase(process.env);
      console.log(`· base de demostración «${databaseName(process.env)}» borrada para rehacerla`);
    }
    // Refused before setupDatabase: a database with users or players is left exactly as it was, not even migrated
    // (loadDevSeed and loadDemo check again, under lock, inside their own transaction).
    if ((devSeed || demo) && (await existingRows(process.env)) > 0)
      throw new SetupError(devSeed ? NOT_EMPTY : DEMO_NOT_EMPTY);
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
    if (devSeed) {
      await loadDevSeed({ ...process.env, DB_NAME: r.database });
      console.warn(
        '· semilla 020 cargada (obsoleta: usa npm run db:setup -- --demo). Cuentas @example.com: nunca en producción.',
      );
    }
    if (demo) {
      const db = createPool({ ...process.env, DB_NAME: r.database });
      try {
        await loadDemo(db);
        console.log('· datos de demostración cargados (cuentas @example.com, contraseña demo1234)');
        if (extended) {
          const s = await loadExtendedDemo(db).catch((e) => {
            throw new SetupError(
              `La demostración ampliada no se cargó (${e instanceof Error ? e.message : e}); la base quedó con la ` +
                'demostración básica. Rehazla con npm run db:demo:reset.',
            );
          });
          console.log(
            `· demostración ampliada: ${s.players} jugadores, ${s.tutors} familias, ${s.sessions} sesiones pasadas ` +
              `(${s.attendance} asistencias), ${s.matches} partidos, ${s.payments} pagos`,
          );
        }
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

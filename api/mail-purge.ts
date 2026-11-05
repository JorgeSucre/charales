/**
 * `npm run db:mail-purge`: applies the retention of `correo_saliente` once (N-06). The API already does it every hour; this
 * is for a database no API is running on, and for a one-off after changing CORREO_RETENCION_DIAS. Safe to repeat or
 * interrupt: docs/deployment/PROCEDIMIENTO_PRODUCCION.md.
 */
import { mailRetentionFrom, purgeMailOutbox } from './mail.ts';
import { createPool } from './server.ts';

if (import.meta.main) {
  const db = createPool(process.env);
  try {
    const r = await purgeMailOutbox(db, { retentionDays: mailRetentionFrom(process.env) });
    console.log(
      `correo_saliente: ${r.abandoned} cerrados por abandono, ${r.anonymized} anonimizados, ${r.deleted} borrados${r.more ? ' (quedan más: repite)' : ''}.`,
    );
  } finally {
    await db.end();
  }
}

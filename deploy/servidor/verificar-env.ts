/**
 * Comprueba el .env del servidor ANTES de `pm2 start`, con las mismas reglas con que arranca la API (api/config.ts),
 * más los datos de MariaDB y la conexión real. Sólo lee: no crea ni migra nada.
 *   node --env-file=.env deploy/servidor/verificar-env.ts
 */
import { checkEnvironment } from '../../api/config.ts';
import { missingSchema } from '../../api/schema.ts';
import { appOrigin, createPool } from '../../api/server.ts';

const env = process.env;
let failed = false;
const pass = (m: string) => console.log(`PASS  ${m}`);
const fail = (m: string) => {
  failed = true;
  console.log(`FAIL  ${m}`);
};

const report = checkEnvironment(env);
for (const e of report.errors) fail(e);
for (const w of report.warnings) console.log(`AVISO ${w}`);
if (!report.errors.length) pass('configuración aceptada por la API (api/config.ts)');

if (env['NODE_ENV'] === 'production') pass('NODE_ENV=production');
else fail('NODE_ENV debe ser production en el servidor.');
for (const name of ['HOST', 'PORT', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'])
  if (env[name]?.trim()) pass(`${name} definido`);
  else
    fail(`${name} vacío${/^DB_(HOST|PORT)$/.test(name) ? ' (dato pendiente del profesor)' : ''}.`);
if (env['DB_PORT'] && !/^\d+$/.test(env['DB_PORT'])) fail('DB_PORT no es un número.');
console.log(`INFO  CORS acepta el origen: ${appOrigin(env['APP_URL']) ?? '(ninguno)'}`);

if (!failed) {
  const db = createPool(env, { connectionLimit: 1, acquireTimeout: 5000 });
  try {
    const [{ v }] = await db.query('SELECT VERSION() AS v');
    pass(`conexión a MariaDB ${v} en ${env['DB_HOST']}:${env['DB_PORT']}, base ${env['DB_NAME']}`);
    const missing = await missingSchema(db);
    if (missing.length)
      fail(`la base no está al día, falta: ${missing.join(', ')} (npm run db:setup).`);
    else pass('esquema y migraciones al día');
  } catch (e) {
    fail(`no se pudo conectar a MariaDB: ${(e as Error).message}`);
  } finally {
    await db.end();
  }
}
console.log(failed ? '\nResultado: FAIL' : '\nResultado: PASS');
process.exitCode = failed ? 1 : 0;

/**
 * Demo data for development: loads the frontend's MockDb seed (the people, categories, payments… the frontend tests
 * use) into an EMPTY schema through the same domain bridge as the API (api/rpc.ts). Fictitious data, example.com
 * accounts with the public demo password «demo1234» (argon2id here). NEVER on a production database.
 *
 * Roles, permissions and rol_permiso are not copied: they come from the schema + db/mariadb/010_permisos_app.sql, the
 * production source; the seed only checks that both say the same (permissions.ts and 010 must stay in sync).
 *
 *   npm run db:mariadb:demo          # DB_NAME (escuela_futbol): docs/escuela_futbol_mariadb.sql + migrate.sh + 010 first
 */
import type { Pool } from 'mariadb';
import { hashPassword } from './auth.ts';
import { domain, unitOfWork, type Tables } from './rpc.ts';
import { createPool } from './server.ts';

const SECURITY = ['roles', 'permissions', 'rolePermissions'];

/** «ROLE module.action» of every grant, to compare the matrix of two datasets whatever their ids. */
export function grantsOf(tables: Tables): string[] {
  const role = new Map(tables['roles']!.map((r) => [r['id'], r['name']]));
  const perm = new Map(
    tables['permissions']!.map((p) => [p['id'], `${p['module']}.${p['action']}`]),
  );
  return tables['rolePermissions']!.map(
    (rp) => `${role.get(rp['roleId'])} ${perm.get(rp['permissionId'])}`,
  ).sort();
}

export async function loadDemo(db: Pool): Promise<void> {
  const seed = (await domain).seedTables();
  const hash = await hashPassword('demo1234');
  await unitOfWork(db, async (tables) => {
    if (tables['users']!.length || tables['players']!.length)
      throw new Error('La base ya tiene datos: la demostración sólo se carga en un esquema vacío.');
    const seedGrants = grantsOf(seed);
    const dbGrants = grantsOf(tables);
    if (JSON.stringify(seedGrants) !== JSON.stringify(dbGrants))
      throw new Error(
        'permissions.ts y db/mariadb/010_permisos_app.sql no coinciden: sincronízalos antes.',
      );
    // Seed users point at roles by id; the database's ids are the ones that count.
    const roleId = new Map(
      seed['roles']!.map((r) => [
        r['id'],
        tables['roles']!.find((x) => x['name'] === r['name'])!['id'],
      ]),
    );
    const out: Tables = { ...tables };
    for (const [key, rows] of Object.entries(seed))
      if (!SECURITY.includes(key) && key in tables) out[key] = structuredClone(rows);
    out['users'] = seed['users']!.map((u) => ({
      ...u,
      roleId: u['roleId'] === null ? null : roleId.get(u['roleId']),
      passwordHash: hash,
    }));
    return { tables: out };
  });
}

if (import.meta.main) {
  const db = createPool();
  try {
    await loadDemo(db);
    console.log(
      `Datos de demostración cargados en ${process.env['DB_NAME'] ?? 'escuela_futbol'} (contraseña demo1234).`,
    );
  } finally {
    await db.end();
  }
}

import { BaseRole, PermissionAction } from '../models';

/**
 * Permission catalog = rows of `permisos` (modulo, accion). The first block is the schema's own seed; the second adds
 * modules the backlog needs (tutores, sedes, cobranza…). They are data, not schema: db/mariadb/010_permisos_app.sql
 * inserts the same rows. Routes and menus check permissions, never role names.
 */
export const PERMISSION_CATALOG = [
  // escuela_futbol_mariadb.sql seed
  'usuarios.consultar',
  'usuarios.crear',
  'usuarios.editar',
  'usuarios.cancelar',
  'jugadores.consultar',
  'jugadores.crear',
  'jugadores.editar',
  'categorias.consultar',
  'categorias.crear',
  'categorias.editar',
  'inscripciones.consultar',
  'inscripciones.crear',
  'inscripciones.editar',
  'entrenamientos.consultar',
  'entrenamientos.crear',
  'entrenamientos.editar',
  'asistencias.consultar',
  'asistencias.crear',
  'asistencias.editar',
  'competencias.consultar',
  'competencias.crear',
  'competencias.editar',
  'partidos.consultar',
  'partidos.crear',
  'partidos.editar',
  'pagos.consultar',
  'pagos.crear',
  'pagos.cancelar',
  'uniformes.consultar',
  'uniformes.crear',
  'uniformes.editar',
  'avisos.consultar',
  'avisos.crear',
  'avisos.editar',
  'auditoria.consultar',
  // app modules (db/mariadb/010_permisos_app.sql)
  'roles.consultar',
  'roles.editar',
  'tutores.consultar',
  'tutores.crear',
  'tutores.editar',
  'entrenadores.consultar',
  'entrenadores.crear',
  'entrenadores.editar',
  'temporadas.consultar',
  'temporadas.crear',
  'temporadas.editar',
  'sedes.consultar',
  'sedes.crear',
  'sedes.editar',
  'cobranza.consultar',
  'cobranza.crear',
  'cobranza.editar',
  'cobranza.cancelar',
  'descuentos.consultar',
  'descuentos.crear',
  'reportes.consultar',
  'portal.consultar',
  'portal.editar',
  'panel_entrenador.consultar',
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number];

export function splitPermission(key: PermissionKey): { module: string; action: PermissionAction } {
  const [module, action] = key.split('.') as [string, PermissionAction];
  return { module, action };
}

/** Modules granted by a profile (TUTOR / ENTRENADOR), not by office roles. */
export const PROFILE_MODULES: readonly string[] = ['portal', 'panel_entrenador'];

const all = PERMISSION_CATALOG.filter((p) => !PROFILE_MODULES.includes(p.split('.')[0]));

/**
 * Initial rol_permiso (Matriz Roles of the backlog). Editable afterwards from the permissions screen (HU-006).
 * Secretaría: no users/roles/audit, no payment cancellation or discounts, attendance read-only, seasons read-only.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<BaseRole, readonly PermissionKey[]> = {
  ADMINISTRADOR: all,
  SECRETARIA: all.filter(
    (p) =>
      !p.startsWith('usuarios.') &&
      !p.startsWith('roles.') &&
      !p.startsWith('auditoria.') &&
      !p.startsWith('descuentos.') &&
      !['pagos.cancelar', 'asistencias.crear', 'asistencias.editar'].includes(p) &&
      !['temporadas.crear', 'temporadas.editar'].includes(p),
  ),
  ENTRENADOR: ['panel_entrenador.consultar', 'asistencias.crear', 'asistencias.editar'],
  TUTOR: ['portal.consultar', 'portal.editar'],
};

/** Permissions the permissions screen refuses to remove, so base roles never lock themselves out (HU-006). */
export const PROTECTED_PERMISSIONS: Partial<Record<BaseRole, readonly PermissionKey[]>> = {
  ADMINISTRADOR: ['roles.consultar', 'roles.editar', 'usuarios.consultar', 'usuarios.editar'],
  ENTRENADOR: ['panel_entrenador.consultar'],
  TUTOR: ['portal.consultar'],
};

export const ROLE_LABELS: Record<string, string> = {
  ADMINISTRADOR: 'Administrador',
  SECRETARIA: 'Secretaría',
  ENTRENADOR: 'Entrenador',
  TUTOR: 'Padre/Tutor',
};

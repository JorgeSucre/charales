import { DateTime, Id } from './common';

/** roles. SEGURIDAD is assigned to an account (usuarios.rol_id); PERFIL (TUTOR/ENTRENADOR) is granted by a linked profile. */
export type RoleKind = 'SEGURIDAD' | 'PERFIL';
/** Base roles seeded by the schema. Role names are data; these four are the ones the app relies on. */
export type BaseRole = 'ADMINISTRADOR' | 'SECRETARIA' | 'ENTRENADOR' | 'TUTOR';

export interface Role {
  id: Id;
  name: string;
  kind: RoleKind;
  description: string | null;
  active: boolean;
  createdAt: DateTime;
}

/** permisos.accion */
export type PermissionAction = 'consultar' | 'crear' | 'editar' | 'cancelar';

export interface Permission {
  id: Id;
  module: string;
  action: PermissionAction;
  description: string | null;
}

/** rol_permiso */
export interface RolePermission {
  roleId: Id;
  permissionId: Id;
  createdAt: DateTime;
}

/**
 * usuarios (without password_hash: the API never returns it).
 * firstName/lastName only exist for staff accounts (roleId set); tutor/coach accounts take their name from the profile.
 */
export interface User {
  id: Id;
  roleId: Id | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
  active: boolean;
  createdAt: DateTime;
  updatedAt: DateTime;
}

/** sesiones. Only the token hash is stored. */
export interface Session {
  id: Id;
  userId: Id;
  tokenHash: string;
  startedAt: DateTime;
  expiresAt: DateTime;
  lastUsedAt: DateTime | null;
  closedAt: DateTime | null;
  ip: string | null;
  userAgent: string | null;
}

/** tokens_recuperacion */
export interface PasswordResetToken {
  id: Id;
  userId: Id;
  tokenHash: string;
  expiresAt: DateTime;
  usedAt: DateTime | null;
  createdAt: DateTime;
}

/** auditoria.accion */
export type AuditAction =
  'CREAR' | 'EDITAR' | 'ELIMINAR' | 'CANCELAR' | 'LOGIN' | 'LOGOUT' | 'OTRO';

/** auditoria. Append-only: no UI edits it (HU-007). */
export interface AuditEntry {
  id: Id;
  userId: Id | null;
  action: AuditAction;
  module: string | null;
  entity: string | null;
  entityId: Id | null;
  description: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: DateTime;
}

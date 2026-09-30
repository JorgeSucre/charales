import { Role } from '../models';

/** Add permissions here; routes and navigation check permissions, never roles. */
export type Permission =
  | 'users.manage'
  | 'seasons.manage'
  | 'tutors.manage'
  | 'categories.view'
  | 'enrollments.manage'
  | 'coaches.manage'
  | 'billing.manage'
  | 'uniforms.manage'
  | 'reports.view'
  | 'agenda.view'
  | 'portal.view';

const OFFICE: Permission[] = [
  'tutors.manage',
  'categories.view',
  'enrollments.manage',
  'coaches.manage',
  'billing.manage',
  'uniforms.manage',
  'reports.view',
  'agenda.view',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: [...OFFICE, 'users.manage', 'seasons.manage'],
  secretary: OFFICE,
  coach: ['categories.view', 'agenda.view'],
  tutor: ['portal.view'],
};

export function roleCan(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  secretary: 'Secretaría',
  coach: 'Entrenador',
  tutor: 'Padre/Tutor',
};

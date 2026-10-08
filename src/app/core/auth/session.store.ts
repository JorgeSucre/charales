import { Injectable, signal } from '@angular/core';
import { DateTime, Id } from '../models';
import { PROFILE_MODULES, PermissionKey } from './permissions';

/**
 * What the app knows about the logged-in user. Built at login from usuarios + roles + profiles + rol_permiso;
 * permissions are a snapshot, so permission changes apply to NEW sessions (HU-006).
 */
export interface AuthUser {
  userId: Id;
  sessionId: Id;
  email: string;
  displayName: string;
  /** Security role (if any) + profile roles: e.g. ['SECRETARIA', 'TUTOR']. */
  roles: string[];
  /** Security role + profiles: menus and profile areas. Office-wide checks use `grants`, not this list. */
  permissions: PermissionKey[];
  /** Only those of the SEGURIDAD role. A profile never widens the office scope (D12, no lateral escalation). */
  officePermissions: PermissionKey[];
  tutorId: Id | null;
  coachId: Id | null;
  /** Has a SEGURIDAD role (office staff); coaches/tutors without one are scoped to their own data. */
  isStaff: boolean;
  expiresAt: DateTime;
  lastUsedAt: DateTime;
}

/**
 * Whether the session holds a permission office-wide. Profile modules (portal, panel_entrenador) come from the
 * profile; any other module counts only if the security role grants it. Permissions a profile adds on office
 * modules (ENTRENADOR → asistencias.*) apply only inside that profile's own scope, checked where it is used.
 */
export function grants(user: AuthUser | null, permission: PermissionKey): boolean {
  if (!user) return false;
  return PROFILE_MODULES.includes(permission.split('.')[0])
    ? user.permissions.includes(permission)
    : user.officePermissions.includes(permission);
}

const KEY = 'charales.session';

/** Holds the current session. Separate from AuthService so AuditService can read it without a DI cycle. */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly state = signal<{ user: AuthUser; token: string } | null>(this.restore());
  readonly user = () => this.state()?.user ?? null;
  readonly token = () => this.state()?.token ?? null;

  set(value: { user: AuthUser; token: string } | null): void {
    this.state.set(value);
    try {
      if (value) sessionStorage.setItem(KEY, JSON.stringify(value));
      else sessionStorage.removeItem(KEY);
    } catch {
      /* storage unavailable: the session just won't survive a reload */
    }
  }

  private restore(): { user: AuthUser; token: string } | null {
    try {
      const raw = sessionStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}

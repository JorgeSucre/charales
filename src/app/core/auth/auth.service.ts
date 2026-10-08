import { Injectable, computed, inject } from '@angular/core';
import { MockDb, UserRow } from '../data/mock-db';
import { fullName } from '../models';
import { AuditService } from '../services/audit.service';
import { MailerService } from '../services/mailer.service';
import { dateTimeIn, nowDateTime } from '../../shared/dates';
import { hashPassword, passwordProblem, randomToken, sha256Hex, verifyPassword } from './password';
import { PERMISSION_CATALOG, PermissionKey } from './permissions';
import { AuthUser, SessionStore, grants } from './session.store';

/** Session policy (HU-002): absolute lifetime and idle timeout. */
export const SESSION_HOURS = 8;
export const IDLE_MINUTES = 30;
export const RESET_TOKEN_MINUTES = 60;

const INVALID = 'Correo o contraseña incorrectos.';

/**
 * Authentication against the mock backend (HU-001..003, HU-005, HU-072): verifies salted password hashes, creates
 * a `sesiones` row (only the token hash is stored), enforces expiry and audits LOGIN/LOGOUT.
 * Roles are NOT a single field: a SEGURIDAD role on the account plus TUTOR/ENTRENADOR from linked profiles.
 * With a real API: login/logout/reset become HTTP calls; the API returns the same AuthUser and an HttpOnly cookie.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private db = inject(MockDb);
  private store = inject(SessionStore);
  private audit = inject(AuditService);
  private mailer = inject(MailerService);

  readonly user = this.store.user;
  readonly isLoggedIn = computed(() => this.store.user() !== null);

  constructor() {
    // A restored browser session is only kept if the server-side session still exists and is open.
    const restored = this.store.user();
    if (!restored) return;
    // ponytail: the in-memory mock is rebuilt on every page load, so a reload loses the sessions table.
    // Re-register the row from the snapshot; the real API simply validates the cookie.
    if (!this.db.sessions.some((s) => s.id === restored.sessionId)) {
      this.db.sessions.push({
        id: restored.sessionId,
        userId: restored.userId,
        tokenHash: '',
        startedAt: restored.lastUsedAt,
        expiresAt: restored.expiresAt,
        lastUsedAt: restored.lastUsedAt,
        closedAt: null,
        ip: null,
        userAgent: null,
      });
    }
    // Snapshots from before officePermissions existed are dropped: the user logs in again.
    if (!restored.officePermissions || !this.sessionRowValid(restored)) this.store.set(null);
  }

  /** Same rule as the services (`grants`), so routes and menus never promise what the service refuses. */
  can(permission: PermissionKey): boolean {
    return grants(this.store.user(), permission);
  }

  hasRole(role: string): boolean {
    return !!this.store.user()?.roles.includes(role);
  }

  /** Landing page by role: tutors go to the portal, coaches to their panel, staff to the home page. */
  homeUrl(): string {
    const u = this.store.user();
    if (!u || u.isStaff) return '/';
    if (u.coachId && this.can('panel_entrenador.consultar')) return '/coach';
    if (u.tutorId && this.can('portal.consultar')) return '/portal';
    return '/';
  }

  async login(email: string, password: string): Promise<AuthUser> {
    const row = this.findByEmail(email);
    const valid = !!row && row.active && (await verifyPassword(password, row.passwordHash));
    if (!row || !valid) {
      // Same message for unknown, inactive and wrong password: nothing to enumerate (HU-001.2).
      this.audit.log(
        'OTRO',
        'auth',
        'usuarios',
        row?.id ?? null,
        'Intento de acceso fallido',
        null,
        null,
        row?.id ?? null,
      );
      await this.db.respond(null);
      throw new Error(INVALID);
    }
    const access = this.accessOf(row);
    if (!access.roles.length) {
      await this.db.respond(null);
      throw new Error('Tu cuenta no tiene un rol o perfil activo. Contacta a la escuela.');
    }
    const token = randomToken();
    const now = nowDateTime();
    const session = this.db.insert(this.db.sessions, {
      userId: row.id,
      tokenHash: await sha256Hex(token),
      startedAt: now,
      expiresAt: dateTimeIn(SESSION_HOURS * 60),
      lastUsedAt: now,
      closedAt: null,
      ip: null,
      userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent.slice(0, 500),
    });
    const user: AuthUser = {
      ...access,
      userId: row.id,
      sessionId: session.id,
      email: row.email,
      expiresAt: session.expiresAt,
      lastUsedAt: now,
    };
    this.audit.log(
      'LOGIN',
      'auth',
      'sesiones',
      session.id,
      `Inicio de sesión (${user.roles.join(', ')})`,
      null,
      null,
      row.id,
    );
    this.store.set({ user, token });
    return this.db.respond(user);
  }

  logout(reason: 'LOGOUT' | 'EXPIRADA' = 'LOGOUT'): void {
    const user = this.store.user();
    if (user) {
      const session = this.db.sessions.find((s) => s.id === user.sessionId);
      if (session && !session.closedAt)
        this.db.update(this.db.sessions, session.id, { closedAt: nowDateTime() });
      this.audit.log(
        'LOGOUT',
        'auth',
        'sesiones',
        user.sessionId,
        reason === 'EXPIRADA' ? 'Sesión expirada' : 'Cierre de sesión',
        null,
        null,
        user.userId,
      );
    }
    this.store.set(null);
  }

  /**
   * Called on every protected navigation (guards). Expires the session after SESSION_HOURS or IDLE_MINUTES
   * without use, or if the server closed it (e.g. password reset, account deactivated). Returns whether it's valid.
   */
  checkSession(): boolean {
    const user = this.store.user();
    if (!user) return false;
    const now = nowDateTime();
    if (
      now >= user.expiresAt ||
      now >= dateTimeIn(IDLE_MINUTES, new Date(user.lastUsedAt)) ||
      !this.sessionRowValid(user)
    ) {
      this.logout('EXPIRADA');
      return false;
    }
    this.db.update(this.db.sessions, user.sessionId, { lastUsedAt: now });
    this.store.set({ user: { ...user, lastUsedAt: now }, token: this.store.token()! });
    return true;
  }

  /** HU-005: requires the current password; the new one must follow the policy and differ. */
  async changePassword(current: string, next: string): Promise<void> {
    const user = this.store.user();
    if (!user) throw new Error('Sesión no iniciada.');
    const row = this.db.get(this.db.users, user.userId, 'Usuario');
    if (!(await verifyPassword(current, row.passwordHash)))
      throw new Error('La contraseña actual no es correcta.');
    if (current === next) throw new Error('La nueva contraseña debe ser distinta a la actual.');
    const problem = passwordProblem(next);
    if (problem) throw new Error(problem);
    this.db.update(this.db.users, row.id, {
      passwordHash: await hashPassword(next),
      updatedAt: nowDateTime(),
    });
    this.audit.log('EDITAR', 'usuarios', 'usuarios', row.id, 'Cambio de contraseña');
    await this.db.respond(null);
  }

  /** Always resolves the same way, so the UI doesn't reveal whether an account exists. */
  async requestPasswordReset(email: string): Promise<void> {
    const row = this.findByEmail(email);
    if (row?.active) await this.issueResetToken(row, 'Recupera tu contraseña');
    await this.db.respond(null);
  }

  /** Creates a single-use reset token and e-mails the link. Also used for the initial access of linked accounts (HU-012). */
  async issueResetToken(row: UserRow, subject: string): Promise<void> {
    const token = randomToken();
    this.db.insert(this.db.resetTokens, {
      userId: row.id,
      tokenHash: await sha256Hex(token),
      expiresAt: dateTimeIn(RESET_TOKEN_MINUTES),
      usedAt: null,
      createdAt: nowDateTime(),
    });
    this.mailer.send(
      row.email,
      subject,
      `Abre este enlace para definir tu contraseña (válido ${RESET_TOKEN_MINUTES} min): /reset-password?token=${token}`,
    );
  }

  /** HU-005: a valid, unused, unexpired token sets the password once; it then closes every open session. */
  async resetPassword(token: string, next: string): Promise<void> {
    const problem = passwordProblem(next);
    if (problem) throw new Error(problem);
    const hash = await sha256Hex(token);
    const passwordHash = await hashPassword(next);
    const now = nowDateTime();
    this.db.transaction(() => {
      const row = this.db.resetTokens.find((t) => t.tokenHash === hash);
      if (!row || row.usedAt || row.expiresAt <= now)
        throw new Error('El enlace no es válido o ya expiró.');
      this.db.update(this.db.resetTokens, row.id, { usedAt: now });
      this.db.update(this.db.users, row.userId, { passwordHash, updatedAt: now });
      for (const s of this.db.sessions.filter((s) => s.userId === row.userId && !s.closedAt))
        this.db.update(this.db.sessions, s.id, { closedAt: now });
      this.audit.log(
        'EDITAR',
        'usuarios',
        'usuarios',
        row.userId,
        'Restablecimiento de contraseña',
        null,
        null,
        row.userId,
      );
    });
    await this.db.respond(null);
  }

  /** Roles and permissions an account gets right now (security role + active profiles). */
  accessOf(
    row: UserRow,
  ): Pick<
    AuthUser,
    | 'roles'
    | 'permissions'
    | 'officePermissions'
    | 'tutorId'
    | 'coachId'
    | 'isStaff'
    | 'displayName'
  > {
    const roleByName = (name: string) => this.db.roles.find((r) => r.name === name && r.active);
    const security = this.db.roles.find(
      (r) => r.id === row.roleId && r.active && r.kind === 'SEGURIDAD',
    );
    const tutor = this.db.tutors.find((t) => t.userId === row.id);
    const coach = this.db.coaches.find((c) => c.userId === row.id && c.active);
    const roles = [
      security,
      tutor && roleByName('TUTOR'),
      coach && roleByName('ENTRENADOR'),
    ].filter((r) => !!r);
    const permissionsOf = (roleIds: Set<number>): PermissionKey[] => {
      const permissionIds = new Set(
        this.db.rolePermissions.filter((rp) => roleIds.has(rp.roleId)).map((rp) => rp.permissionId),
      );
      return this.db.permissions
        .filter((p) => permissionIds.has(p.id))
        .map((p) => `${p.module}.${p.action}`)
        .filter((k): k is PermissionKey => (PERMISSION_CATALOG as readonly string[]).includes(k));
    };
    const profile = coach ?? tutor;
    return {
      roles: roles.map((r) => r.name),
      permissions: permissionsOf(new Set(roles.map((r) => r.id))),
      officePermissions: security ? permissionsOf(new Set([security.id])) : [],
      tutorId: tutor?.id ?? null,
      coachId: coach?.id ?? null,
      isStaff: !!security,
      displayName: security
        ? `${row.firstName} ${row.lastName ?? ''}`.trim()
        : profile
          ? fullName(profile)
          : row.email,
    };
  }

  private findByEmail(email: string): UserRow | undefined {
    const normalized = email.trim().toLowerCase();
    return this.db.users.find((u) => u.email.toLowerCase() === normalized);
  }

  private sessionRowValid(user: AuthUser): boolean {
    const session = this.db.sessions.find(
      (s) => s.id === user.sessionId && s.userId === user.userId,
    );
    const account = this.db.users.find((u) => u.id === user.userId);
    return !!session && !session.closedAt && !!account?.active;
  }
}

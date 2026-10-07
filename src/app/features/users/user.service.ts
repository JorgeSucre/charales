import { Injectable, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { randomToken, hashPassword } from '../../core/auth/password';
import { SessionStore } from '../../core/auth/session.store';
import { MockDb, UserRow } from '../../core/data/mock-db';
import { DateTime, Id, Role, User, fullName } from '../../core/models';
import { AuditService } from '../../core/services/audit.service';
import { nowDateTime } from '../../shared/dates';
import { matches } from '../../shared/page';
import { EMAIL_PATTERN, required } from '../../shared/validate';

export interface UserView extends User {
  displayName: string;
  roleName: string | null;
  /** Profiles linked to the account: 'Tutor: Teresa López', 'Entrenador: Carlos Pérez'. */
  profiles: string[];
  lastAccess: DateTime | null;
}

/** Staff account draft. Tutor/coach accounts are created by linking their profile (HU-012, HU-022). */
export interface StaffDraft {
  id?: Id;
  roleId: Id;
  firstName: string;
  lastName: string;
  email: string;
}

/** Strips password_hash: the API never returns it. */
export function publicUser({ passwordHash: _, ...user }: UserRow): User {
  return user;
}

/** HU-004: accounts are created, edited, activated and deactivated — never deleted. */
@Injectable({ providedIn: 'root' })
export class UserService {
  private db = inject(MockDb);
  private auth = inject(AuthService);
  private audit = inject(AuditService);
  private session = inject(SessionStore);

  list(filter: { query?: string; active?: boolean } = {}): Promise<UserView[]> {
    const rows = this.db.users
      .map((u) => this.view(u))
      .filter(
        (u) =>
          (filter.active === undefined || u.active === filter.active) &&
          (!filter.query || matches(`${u.displayName} ${u.email}`, filter.query)),
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    return this.db.respond(rows);
  }

  securityRoles(): Promise<Role[]> {
    return this.db.respond(this.db.roles.filter((r) => r.kind === 'SEGURIDAD' && r.active));
  }

  /** Creates or edits a staff account. New accounts get an e-mail to set their password (no password typed here). */
  async save(draft: StaffDraft): Promise<UserView> {
    const email = required(draft.email, 'El correo', 150).toLowerCase();
    if (!EMAIL_PATTERN.test(email)) throw new Error('Correo inválido.');
    const firstName = required(draft.firstName, 'El nombre', 100);
    const lastName = draft.lastName.trim() || null;
    const role = this.db.roles.find(
      (r) => r.id === draft.roleId && r.kind === 'SEGURIDAD' && r.active,
    );
    if (!role) throw new Error('Selecciona un rol de seguridad válido.');
    if (this.db.users.some((u) => u.email.toLowerCase() === email && u.id !== draft.id))
      throw new Error('Ya existe un usuario con ese correo.');
    const now = nowDateTime();
    let row: UserRow;
    if (draft.id) {
      const before = publicUser(this.db.get(this.db.users, draft.id, 'Usuario'));
      if (before.roleId !== role.id) this.assertNotLastAdmin(before.id);
      row = this.db.update(this.db.users, draft.id, {
        roleId: role.id,
        firstName,
        lastName,
        email,
        updatedAt: now,
      });
      this.audit.log(
        'EDITAR',
        'usuarios',
        'usuarios',
        row.id,
        `Edición de ${email}`,
        before,
        publicUser(row),
      );
    } else {
      row = this.db.insert<UserRow>(this.db.users, {
        roleId: role.id,
        firstName,
        lastName,
        email,
        passwordHash: await hashPassword(randomToken()), // unusable until the invitation link is used
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      await this.auth.issueResetToken(row, 'Tu cuenta en Charales');
      this.audit.log(
        'CREAR',
        'usuarios',
        'usuarios',
        row.id,
        `Alta de ${email} (${role.name})`,
        null,
        publicUser(row),
      );
    }
    return this.db.respond(this.view(row));
  }

  /** HU-004.3: a deactivated account can't log in; its open sessions are closed. */
  async setActive(id: Id, active: boolean): Promise<void> {
    const before = this.db.get(this.db.users, id, 'Usuario');
    if (!active) {
      if (id === this.session.user()?.userId)
        throw new Error('No puedes desactivar tu propia cuenta.');
      this.assertNotLastAdmin(id);
    }
    const now = nowDateTime();
    this.db.transaction(() => {
      this.db.update(this.db.users, id, { active, updatedAt: now });
      if (!active)
        for (const s of this.db.sessions.filter((s) => s.userId === id && !s.closedAt))
          this.db.update(this.db.sessions, s.id, { closedAt: now });
      this.audit.log(
        active ? 'EDITAR' : 'CANCELAR',
        'usuarios',
        'usuarios',
        id,
        active ? 'Activación' : 'Desactivación',
        { active: before.active },
        { active },
      );
    });
    await this.db.respond(null);
  }

  /**
   * HU-012 / HU-022.3: login account for a tutor or coach profile. Reuses the account that already has that
   * e-mail (one person = one login, e.g. a coach who is also a tutor) or creates one without role or name
   * (chk_usuario_nombre_personal) and e-mails the initial-access link. Never sets a password here.
   */
  async profileAccount(email: string): Promise<{ user: UserRow; created: boolean }> {
    const normalized = required(email, 'El correo', 150).toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) throw new Error('Correo inválido.');
    const existing = this.db.users.find((u) => u.email.toLowerCase() === normalized);
    if (existing) {
      if (!existing.active) throw new Error('La cuenta con ese correo está desactivada.');
      return { user: existing, created: false };
    }
    const now = nowDateTime();
    const user = this.db.insert<UserRow>(this.db.users, {
      roleId: null,
      firstName: null,
      lastName: null,
      email: normalized,
      passwordHash: await hashPassword(randomToken()),
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    this.audit.log(
      'CREAR',
      'usuarios',
      'usuarios',
      user.id,
      `Alta de cuenta de perfil ${normalized}`,
      null,
      publicUser(user),
    );
    await this.auth.issueResetToken(user, 'Acceso a Charales');
    return { user, created: true };
  }

  /** At least one active administrator must remain (HU-006.3 "roles base no quedan sin acceso"). */
  private assertNotLastAdmin(userId: Id): void {
    const admin = this.db.roles.find((r) => r.name === 'ADMINISTRADOR');
    const target = this.db.users.find((u) => u.id === userId);
    if (!admin || target?.roleId !== admin.id || !target.active) return;
    const others = this.db.users.filter(
      (u) => u.roleId === admin.id && u.active && u.id !== userId,
    );
    if (!others.length) throw new Error('Debe quedar al menos un administrador activo.');
  }

  private view(row: UserRow): UserView {
    const tutor = this.db.tutors.find((t) => t.userId === row.id);
    const coach = this.db.coaches.find((c) => c.userId === row.id);
    const profiles = [
      tutor && `Tutor: ${fullName(tutor)}`,
      coach && `Entrenador: ${fullName(coach)}`,
    ].filter((p): p is string => !!p);
    const lastAccess =
      this.db.sessions
        .filter((s) => s.userId === row.id)
        .map((s) => s.startedAt)
        .sort()
        .at(-1) ?? null;
    return {
      ...publicUser(row),
      displayName: this.auth.accessOf(row).displayName,
      roleName: this.db.roles.find((r) => r.id === row.roleId)?.name ?? null,
      profiles,
      lastAccess,
    };
  }
}

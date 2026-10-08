import { Injectable, inject } from '@angular/core';
import { MockDb } from '../data/mock-db';
import { Id } from '../models';
import { isCurrentAssignment } from '../../shared/dates';
import { PermissionKey } from './permissions';
import { AuthUser, SessionStore, grants } from './session.store';

/** Thrown when the session may not perform an operation. Same message whatever the reason (nothing to enumerate). */
export class ForbiddenError extends Error {
  constructor(message = 'No tienes permiso para esta operación.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Domain authorization (the second barrier after route guards; the API will be the third and final one).
 * Every public async service method that becomes an API endpoint starts with one of these checks. They read the
 * identity ONLY from the session (never from ids sent by the caller) and resolve ownership through the relations:
 *   tutor → tutor_jugador → jugador
 *   entrenador → entrenador_categoria (vigente) → categoría → jugadores / sesiones / participaciones
 *   entrenador → entrenador_competencia_categoria (vigente) → participación
 * Synchronous helpers that services compose internally (`views`, `insertCharge`…) are not endpoints and are
 * only called after one of these checks.
 */
@Injectable({ providedIn: 'root' })
export class AuthorizationService {
  private session = inject(SessionStore);
  private db = inject(MockDb);

  user(): AuthUser {
    const user = this.session.user();
    if (!user) throw new ForbiddenError('Sesión no iniciada.');
    return user;
  }

  /** Office modules count only from the security role; profile modules from the profile (see `grants`). */
  has(permission: PermissionKey): boolean {
    return grants(this.session.user(), permission);
  }

  /** Requires at least one of the permissions. */
  require(...anyOf: PermissionKey[]): AuthUser {
    const user = this.user();
    if (!anyOf.some((p) => grants(user, p))) throw new ForbiddenError();
    return user;
  }

  /**
   * Shared office catalogs (categories, seasons, venues, coaches, concepts…) used as selects across office pages:
   * any permission of the security role is enough; tutor/coach profiles are not, not even the office-module
   * permissions a profile carries (ENTRENADOR → asistencias.*): their areas compose their own data.
   */
  requireOffice(): AuthUser {
    const user = this.user();
    if (!user.officePermissions.length) throw new ForbiddenError();
    return user;
  }

  // ── relations ──────────────────────────────────────────────────────────

  /** Players linked to the logged-in tutor (empty when the session has no tutor profile). */
  tutorChildren(): Id[] {
    const tutorId = this.session.user()?.tutorId;
    return tutorId
      ? this.db.tutorPlayers.filter((tp) => tp.tutorId === tutorId).map((tp) => tp.playerId)
      : [];
  }

  /** Categories the logged-in coach currently coaches. */
  coachCategories(on?: string): Id[] {
    const coachId = this.session.user()?.coachId;
    if (!coachId) return [];
    return this.db.coachCategories
      .filter((a) => a.coachId === coachId && isCurrentAssignment(a, on))
      .map((a) => a.categoryId);
  }

  /** Participations (competencia_categoria) of the coach: assigned directly (HU-026) or of their categories (HU-038). */
  coachParticipations(): Id[] {
    const coachId = this.session.user()?.coachId;
    if (!coachId) return [];
    const categories = new Set(this.coachCategories());
    const assigned = new Set(
      this.db.coachCompetitions
        .filter((a) => a.coachId === coachId && isCurrentAssignment(a))
        .map((a) => a.competitionCategoryId),
    );
    return this.db.competitionCategories
      .filter((cc) => categories.has(cc.categoryId) || assigned.has(cc.id))
      .map((cc) => cc.id);
  }

  /** Players currently in the coach's categories. */
  coachPlayers(): Id[] {
    const categories = new Set(this.coachCategories());
    return this.db.playerCategories
      .filter((pc) => !pc.endDate && categories.has(pc.categoryId))
      .map((pc) => pc.playerId);
  }

  // ── ownership assertions ──────────────────────────────────────────────

  /**
   * Access to one player's data: the office permission, OR (if allowed for the operation) being their tutor with
   * portal access, OR their coach with panel access.
   */
  assertPlayer(
    playerId: Id,
    officePermission: PermissionKey,
    relations: { tutor?: boolean; coach?: boolean } = {},
  ): AuthUser {
    const user = this.user();
    if (grants(user, officePermission)) return user;
    if (relations.tutor && this.has('portal.consultar') && this.tutorChildren().includes(playerId))
      return user;
    if (
      relations.coach &&
      this.has('panel_entrenador.consultar') &&
      this.coachPlayers().includes(playerId)
    )
      return user;
    throw new ForbiddenError('No tienes acceso a la información de este jugador.');
  }

  /** Office permission, or a coach currently assigned to the category. */
  assertCategory(categoryId: Id, officePermission: PermissionKey): AuthUser {
    const user = this.user();
    if (grants(user, officePermission)) return user;
    if (this.has('panel_entrenador.consultar') && this.coachCategories().includes(categoryId))
      return user;
    throw new ForbiddenError('No tienes acceso a esta categoría.');
  }

  /**
   * Privilege-escalation guard: an actor may only give or manage a role whose permissions they already hold
   * (a secretary can never create or edit an administrator, even with usuarios.* granted).
   */
  assertCanGrantRole(roleId: Id): void {
    const user = this.user();
    const permissionIds = this.db.rolePermissions
      .filter((rp) => rp.roleId === roleId)
      .map((rp) => rp.permissionId);
    const keys = this.db.permissions
      .filter((p) => permissionIds.includes(p.id))
      .map((p) => `${p.module}.${p.action}`);
    // Only the actor's security role counts: a linked profile never helps grant a role.
    if (!keys.every((k) => user.officePermissions.includes(k as PermissionKey)))
      throw new ForbiddenError('No puedes asignar un rol con más permisos que los tuyos.');
  }

  /** Managing an account (edit, activate, deactivate) requires being able to grant its current role. */
  assertCanManageAccount(userId: Id): void {
    const target = this.db.users.find((u) => u.id === userId);
    if (target?.roleId) this.assertCanGrantRole(target.roleId);
  }
}

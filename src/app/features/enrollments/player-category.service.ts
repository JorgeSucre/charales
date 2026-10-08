import { Injectable, inject } from '@angular/core';
import { AuthorizationService } from '../../core/auth/authorization.service';
import { MockDb } from '../../core/data/mock-db';
import { Category, Id, ISODate, Player, PlayerCategory, fullName } from '../../core/models';
import { AuditService } from '../../core/services/audit.service';
import { CategoryService } from '../../core/services/category.service';
import { addDays, ageOn, isISODate, nowDateTime } from '../../shared/dates';
import { optional, required } from '../../shared/validate';

export interface Eligibility {
  age: number;
  ageOk: boolean;
  occupancy: number;
  capacity: number | null;
  full: boolean;
}

export interface MembershipDraft {
  playerId: Id;
  categoryId: Id;
  /** Start date of the membership (HU-017.4); for a change, the day the new category starts. */
  date: ISODate;
  /** Authorized exception (age out of range and/or full category). Requires inscripciones.editar. */
  exceptionReason: string | null;
}

/**
 * Sporting membership (jugador_categoria + historial_categoria): HU-017 (join), HU-019 (change), HU-021 (capacity).
 * Distinct from the administrative enrollment (inscripciones).
 */
@Injectable({ providedIn: 'root' })
export class PlayerCategoryService {
  private db = inject(MockDb);
  private authz = inject(AuthorizationService);
  private audit = inject(AuditService);
  private categories = inject(CategoryService);

  async current(playerId: Id): Promise<(PlayerCategory & { categoryName: string }) | null> {
    this.authz.require('inscripciones.consultar', 'jugadores.consultar');
    const pc = this.db.playerCategories.find((r) => r.playerId === playerId && !r.endDate);
    return this.db.respond(
      pc
        ? { ...pc, categoryName: this.db.get(this.db.categories, pc.categoryId, 'Categoría').name }
        : null,
    );
  }

  /** Age and capacity check for the UI before saving (HU-017.2, HU-021.2). */
  async eligibility(playerId: Id, categoryId: Id, date: ISODate): Promise<Eligibility> {
    this.authz.require('inscripciones.crear');
    const player = this.db.get(this.db.players, playerId, 'Jugador');
    const category = this.db.get(this.db.categories, categoryId, 'Categoría');
    return this.db.respond(this.check(player, category, date));
  }

  /** HU-017: active player, no current category, age in range (or authorized exception), capacity respected. */
  async assign(draft: MembershipDraft): Promise<PlayerCategory> {
    this.authz.require('inscripciones.crear');
    const { player, category, exception } = this.validate(draft);
    if (this.db.playerCategories.some((pc) => pc.playerId === player.id && !pc.endDate))
      throw new Error(
        `${fullName(player)} ya tiene una categoría vigente; usa «Cambiar de categoría».`,
      );
    const row = this.db.transaction(() => {
      const created = this.open(player, category, draft.date, exception);
      this.history(player.id, null, category.id, exception ?? 'Inscripción a categoría');
      this.audit.log(
        'CREAR',
        'inscripciones',
        'jugador_categoria',
        created.id,
        `${fullName(player)} → ${category.name}`,
        null,
        created,
      );
      return created;
    });
    return this.db.respond(row);
  }

  /**
   * HU-019: closes the current membership (fecha_fin = day before, activo = false), opens the new one and records
   * the reason in historial_categoria — one transaction, nothing deleted. Active competition rosters of the old
   * category are closed too, since a roster only admits players of its category (HU-036.1).
   */
  async change(draft: MembershipDraft & { reason: string }): Promise<PlayerCategory> {
    this.authz.require('inscripciones.editar');
    const reason = required(draft.reason, 'El motivo del cambio');
    const { player, category, exception } = this.validate(draft);
    const current = this.db.playerCategories.find((pc) => pc.playerId === player.id && !pc.endDate);
    if (!current)
      throw new Error(
        `${fullName(player)} no tiene categoría vigente; usa «Inscribir a categoría».`,
      );
    if (current.categoryId === category.id) throw new Error('El jugador ya está en esa categoría.');
    if (draft.date <= current.startDate)
      throw new Error(
        `El cambio debe ser posterior al inicio de la categoría actual (${current.startDate}).`,
      );
    const row = this.db.transaction(() => {
      const end = addDays(draft.date, -1);
      this.db.update(this.db.playerCategories, current.id, { endDate: end, active: false });
      const oldParticipations = new Set(
        this.db.competitionCategories
          .filter((cc) => cc.categoryId === current.categoryId)
          .map((cc) => cc.id),
      );
      for (const r of this.db.rosters.filter(
        (r) =>
          r.playerId === player.id && r.active && oldParticipations.has(r.competitionCategoryId),
      ))
        this.db.update(this.db.rosters, r.id, {
          active: false,
          leftOn: r.joinedOn > end ? r.joinedOn : end,
        });
      const created = this.open(player, category, draft.date, exception);
      this.history(player.id, current.categoryId, category.id, reason);
      this.audit.log(
        'EDITAR',
        'inscripciones',
        'jugador_categoria',
        created.id,
        `Cambio de categoría de ${fullName(player)}: ${reason}`,
        current,
        created,
      );
      return created;
    });
    return this.db.respond(row);
  }

  private validate(draft: MembershipDraft): {
    player: Player;
    category: Category;
    exception: string | null;
  } {
    const player = this.db.get(this.db.players, draft.playerId, 'Jugador');
    const category = this.db.get(this.db.categories, draft.categoryId, 'Categoría');
    if (player.status !== 'ACTIVO')
      throw new Error('Sólo jugadores activos pueden inscribirse a una categoría.');
    if (!category.active) throw new Error('La categoría está inactiva.');
    if (!isISODate(draft.date)) throw new Error('Fecha inválida.');
    const exception = optional(draft.exceptionReason, 'El motivo de la excepción');
    const check = this.check(player, category, draft.date);
    if ((!check.ageOk || check.full) && !exception)
      throw new Error(
        !check.ageOk
          ? `La edad (${check.age}) está fuera del rango ${category.minAge}–${category.maxAge}; registra una excepción autorizada.`
          : `La categoría está llena (${check.occupancy}/${check.capacity}); registra una excepción autorizada.`,
      );
    if (exception && !this.authz.has('inscripciones.editar'))
      throw new Error('No tienes permiso para autorizar excepciones.');
    return { player, category, exception: !check.ageOk || check.full ? exception : null };
  }

  private check(player: Player, category: Category, date: ISODate): Eligibility {
    const age = ageOn(player.birthDate, date);
    const occupancy = this.categories.occupancy(category.id);
    return {
      age,
      ageOk: age >= category.minAge && age <= category.maxAge,
      occupancy,
      capacity: category.maxCapacity,
      full: category.maxCapacity !== null && occupancy >= category.maxCapacity,
    };
  }

  private open(
    player: Player,
    category: Category,
    date: ISODate,
    exception: string | null,
  ): PlayerCategory {
    const age = ageOn(player.birthDate, date);
    return this.db.insert(this.db.playerCategories, {
      playerId: player.id,
      categoryId: category.id,
      startDate: date,
      endDate: null,
      isAgeException: age < category.minAge || age > category.maxAge,
      exceptionReason: exception,
      active: true,
      createdAt: nowDateTime(),
    });
  }

  private history(playerId: Id, from: Id | null, to: Id, reason: string): void {
    this.db.insert(this.db.categoryHistory, {
      playerId,
      previousCategoryId: from,
      newCategoryId: to,
      reason,
      changedBy: this.audit.currentUserId(),
      changedAt: nowDateTime(),
    });
  }
}

import { Injectable, inject } from '@angular/core';
import { AuthorizationService } from '../../core/auth/authorization.service';
import { MockDb } from '../../core/data/mock-db';
import { Coach, CoachCategory, CoachCompetition, Id, ISODate, fullName } from '../../core/models';
import { AuditService } from '../../core/services/audit.service';
import {
  isCurrentAssignment as isCurrent,
  isISODate,
  nowDateTime,
  today,
} from '../../shared/dates';
import { matches } from '../../shared/page';
import { optional, optionalEmail, optionalPhone, required, sameName } from '../../shared/validate';
import { UserService } from '../users/user.service';

export type CoachDraft = Pick<Coach, 'firstName' | 'lastName1' | 'lastName2' | 'phone' | 'email'>;

export interface CoachView extends Coach {
  name: string;
  accountEmail: string | null;
  categories: string[];
}

export interface CoachCategoryView extends CoachCategory {
  coachName: string;
  categoryName: string;
  current: boolean;
}

export interface CoachCompetitionView extends CoachCompetition {
  coachName: string;
  competitionName: string;
  categoryName: string;
  current: boolean;
}

/**
 * Coaches (entrenadores) and their assignments:
 * - HU-022: CRUD, sporting status, optional login account.
 * - HU-023: entrenador_categoria (N:M with responsibility and validity).
 * - HU-026: entrenador_competencia_categoria — points to the participation (competencia_categoria), not to a loose
 *   competition/category pair, and keeps validity dates.
 */
@Injectable({ providedIn: 'root' })
export class CoachService {
  private db = inject(MockDb);
  private authz = inject(AuthorizationService);
  private audit = inject(AuditService);
  private users = inject(UserService);

  async list(filter: { query?: string; onlyActive?: boolean } = {}): Promise<CoachView[]> {
    this.authz.requireOffice();
    return this.db.respond(
      this.db.coaches
        .filter((c) => !filter.onlyActive || c.active)
        .map((c) => this.view(c))
        .filter((c) => !filter.query || matches(`${c.name} ${c.email ?? ''}`, filter.query))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  /** HU-022: name + contact; evident duplicates (same full name or same e-mail) are rejected. */
  async save(draft: CoachDraft & { id?: Id }): Promise<Coach> {
    this.authz.require(draft.id ? 'entrenadores.editar' : 'entrenadores.crear');
    const data = {
      firstName: required(draft.firstName, 'El nombre', 100),
      lastName1: required(draft.lastName1, 'El apellido paterno', 100),
      lastName2: optional(draft.lastName2, 'El apellido materno', 100),
      phone: optionalPhone(draft.phone),
      email: optionalEmail(draft.email),
    };
    if (!data.phone && !data.email) throw new Error('Captura al menos un teléfono o correo.');
    const dup = this.db.coaches.find(
      (c) =>
        c.id !== draft.id &&
        (sameName(fullName(c), fullName(data)) || (!!data.email && c.email === data.email)),
    );
    if (dup) throw new Error(`Posible duplicado de ${fullName(dup)}.`);
    const now = nowDateTime();
    let coach: Coach;
    if (draft.id) {
      const before = this.db.get(this.db.coaches, draft.id, 'Entrenador');
      coach = this.db.update(this.db.coaches, draft.id, { ...data, updatedAt: now });
      this.audit.log(
        'EDITAR',
        'entrenadores',
        'entrenadores',
        coach.id,
        `Edición de ${fullName(coach)}`,
        before,
        coach,
      );
    } else {
      coach = this.db.insert(this.db.coaches, {
        ...data,
        userId: null,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      this.audit.log(
        'CREAR',
        'entrenadores',
        'entrenadores',
        coach.id,
        `Alta de ${fullName(coach)}`,
        null,
        coach,
      );
    }
    return this.db.respond(coach);
  }

  /** Sporting status. An inactive coach loses the ENTRENADOR profile at next login but keeps history. */
  async setActive(id: Id, active: boolean): Promise<void> {
    this.authz.require('entrenadores.editar');
    const before = this.db.get(this.db.coaches, id, 'Entrenador');
    this.db.update(this.db.coaches, id, { active, updatedAt: nowDateTime() });
    this.audit.log(
      'EDITAR',
      'entrenadores',
      'entrenadores',
      id,
      active ? 'Activación' : 'Baja',
      { active: before.active },
      { active },
    );
    await this.db.respond(null);
  }

  /** HU-022.3: link a login account (reused if the e-mail already logs in, e.g. a tutor). */
  async linkAccount(coachId: Id, email: string): Promise<{ email: string; created: boolean }> {
    this.authz.require('entrenadores.editar');
    const coach = this.db.get(this.db.coaches, coachId, 'Entrenador');
    if (coach.userId) throw new Error('El entrenador ya tiene una cuenta vinculada.');
    const { user, created } = await this.users.profileAccount(email);
    if (this.db.coaches.some((c) => c.userId === user.id))
      throw new Error('Esa cuenta ya está vinculada a otro entrenador.');
    this.db.update(this.db.coaches, coachId, { userId: user.id, updatedAt: nowDateTime() });
    this.audit.log(
      'EDITAR',
      'entrenadores',
      'entrenadores',
      coachId,
      `Cuenta ${user.email} vinculada`,
      { userId: null },
      { userId: user.id },
    );
    return this.db.respond({ email: user.email, created });
  }

  async unlinkAccount(coachId: Id): Promise<void> {
    this.authz.require('entrenadores.editar');
    const coach = this.db.get(this.db.coaches, coachId, 'Entrenador');
    if (!coach.userId) return;
    this.db.update(this.db.coaches, coachId, { userId: null, updatedAt: nowDateTime() });
    this.audit.log(
      'EDITAR',
      'entrenadores',
      'entrenadores',
      coachId,
      'Cuenta desvinculada',
      { userId: coach.userId },
      { userId: null },
    );
    await this.db.respond(null);
  }

  // ── HU-023 coach ↔ category ───────────────────────────────────────────

  async categoryAssignments(
    filter: { categoryId?: Id | null; onlyCurrent?: boolean } = {},
  ): Promise<CoachCategoryView[]> {
    this.authz.require('entrenadores.consultar');
    return this.db.respond(
      this.db.coachCategories
        .filter(
          (a) =>
            (filter.categoryId == null || a.categoryId === filter.categoryId) &&
            (!filter.onlyCurrent || isCurrent(a)),
        )
        .map((a) => ({
          ...a,
          coachName: fullName(this.db.get(this.db.coaches, a.coachId, 'Entrenador')),
          categoryName: this.db.get(this.db.categories, a.categoryId, 'Categoría').name,
          current: isCurrent(a),
        }))
        .sort(
          (a, b) =>
            Number(b.current) - Number(a.current) || a.categoryName.localeCompare(b.categoryName),
        ),
    );
  }

  /** Several coaches per category; no duplicate current assignment; unique (coach, category, start). */
  async assignCategory(draft: {
    coachId: Id;
    categoryId: Id;
    responsibility: string | null;
    startDate: ISODate;
  }): Promise<CoachCategory> {
    this.authz.require('entrenadores.editar');
    const coach = this.db.get(this.db.coaches, draft.coachId, 'Entrenador');
    const category = this.db.get(this.db.categories, draft.categoryId, 'Categoría');
    if (!coach.active) throw new Error('El entrenador está inactivo.');
    if (!category.active) throw new Error('La categoría está inactiva.');
    if (!isISODate(draft.startDate)) throw new Error('Fecha de inicio inválida.');
    const same = this.db.coachCategories.filter(
      (a) => a.coachId === coach.id && a.categoryId === category.id,
    );
    if (same.some((a) => isCurrent(a)))
      throw new Error(`${fullName(coach)} ya está asignado a ${category.name}.`);
    if (same.some((a) => a.startDate === draft.startDate))
      throw new Error('Ya hubo una asignación con esa fecha de inicio.');
    const row = this.db.insert(this.db.coachCategories, {
      coachId: coach.id,
      categoryId: category.id,
      responsibility: optional(draft.responsibility, 'La responsabilidad', 100),
      startDate: draft.startDate,
      endDate: null,
      active: true,
      createdAt: nowDateTime(),
    });
    this.audit.log(
      'CREAR',
      'entrenadores',
      'entrenador_categoria',
      row.id,
      `${fullName(coach)} → ${category.name}`,
      null,
      row,
    );
    return this.db.respond(row);
  }

  /** Ends an assignment (validity), keeping it as history (chk_ent_cat_activo: inactive ⇒ fecha_fin). */
  async endCategoryAssignment(id: Id, endDate: ISODate = today()): Promise<void> {
    this.authz.require('entrenadores.editar');
    const row = this.db.get(this.db.coachCategories, id, 'Asignación');
    if (!isISODate(endDate) || endDate < row.startDate)
      throw new Error('La fecha de fin no puede ser anterior al inicio.');
    const updated = this.db.update(this.db.coachCategories, id, { endDate, active: false });
    this.audit.log(
      'EDITAR',
      'entrenadores',
      'entrenador_categoria',
      id,
      'Fin de asignación a categoría',
      row,
      updated,
    );
    await this.db.respond(null);
  }

  // ── HU-026 coach ↔ participation (competition + category) ────────────

  async competitionAssignments(
    filter: { competitionId?: Id | null } = {},
  ): Promise<CoachCompetitionView[]> {
    this.authz.require('competencias.consultar');
    return this.db.respond(
      this.db.coachCompetitions
        .map((a) => {
          const cc = this.db.get(
            this.db.competitionCategories,
            a.competitionCategoryId,
            'Participación',
          );
          return { a, cc };
        })
        .filter(
          ({ cc }) => filter.competitionId == null || cc.competitionId === filter.competitionId,
        )
        .map(({ a, cc }) => ({
          ...a,
          coachName: fullName(this.db.get(this.db.coaches, a.coachId, 'Entrenador')),
          competitionName: this.db.get(this.db.competitions, cc.competitionId, 'Competencia').name,
          categoryName: this.db.get(this.db.categories, cc.categoryId, 'Categoría').name,
          current: isCurrent(a),
        }))
        .sort(
          (a, b) =>
            Number(b.current) - Number(a.current) ||
            a.competitionName.localeCompare(b.competitionName),
        ),
    );
  }

  /**
   * Requires: an active participation (not BAJA/FINALIZADA), an active coach, and a CURRENT assignment of that coach
   * to the participation's category (HU-026.2 "solo usa asignaciones vigentes"). uq (coach, participation): an ended
   * row is reopened instead of duplicated; the previous dates stay in the audit log.
   */
  async assignCompetition(draft: {
    coachId: Id;
    competitionCategoryId: Id;
    startDate: ISODate;
  }): Promise<CoachCompetition> {
    this.authz.require('competencias.editar');
    const coach = this.db.get(this.db.coaches, draft.coachId, 'Entrenador');
    const cc = this.db.get(
      this.db.competitionCategories,
      draft.competitionCategoryId,
      'Participación',
    );
    const category = this.db.get(this.db.categories, cc.categoryId, 'Categoría');
    if (!coach.active) throw new Error('El entrenador está inactivo.');
    if (cc.status === 'BAJA' || cc.status === 'FINALIZADA')
      throw new Error('La participación no está vigente.');
    if (!isISODate(draft.startDate)) throw new Error('Fecha de inicio inválida.');
    if (
      !this.db.coachCategories.some(
        (a) =>
          a.coachId === coach.id && a.categoryId === cc.categoryId && isCurrent(a, draft.startDate),
      )
    )
      throw new Error(
        `${fullName(coach)} no tiene asignación vigente a ${category.name} (HU-023).`,
      );
    const existing = this.db.coachCompetitions.find(
      (a) => a.coachId === coach.id && a.competitionCategoryId === cc.id,
    );
    if (existing && isCurrent(existing)) throw new Error('Esa asignación ya existe.');
    let row: CoachCompetition;
    if (existing) {
      row = this.db.update(this.db.coachCompetitions, existing.id, {
        startDate: draft.startDate,
        endDate: null,
        active: true,
      });
      this.audit.log(
        'EDITAR',
        'competencias',
        'entrenador_competencia_categoria',
        row.id,
        `Reasignación de ${fullName(coach)}`,
        existing,
        row,
      );
    } else {
      row = this.db.insert(this.db.coachCompetitions, {
        coachId: coach.id,
        competitionCategoryId: cc.id,
        startDate: draft.startDate,
        endDate: null,
        active: true,
        createdAt: nowDateTime(),
      });
      this.audit.log(
        'CREAR',
        'competencias',
        'entrenador_competencia_categoria',
        row.id,
        `${fullName(coach)} → participación ${cc.id}`,
        null,
        row,
      );
    }
    return this.db.respond(row);
  }

  async endCompetitionAssignment(id: Id, endDate: ISODate = today()): Promise<void> {
    this.authz.require('competencias.editar');
    const row = this.db.get(this.db.coachCompetitions, id, 'Asignación');
    if (!isISODate(endDate) || endDate < row.startDate)
      throw new Error('La fecha de fin no puede ser anterior al inicio.');
    const updated = this.db.update(this.db.coachCompetitions, id, { endDate, active: false });
    this.audit.log(
      'EDITAR',
      'competencias',
      'entrenador_competencia_categoria',
      id,
      'Fin de asignación a competencia',
      row,
      updated,
    );
    await this.db.respond(null);
  }

  private view(c: Coach): CoachView {
    return {
      ...c,
      name: fullName(c),
      accountEmail: this.db.users.find((u) => u.id === c.userId)?.email ?? null,
      categories: this.db.coachCategories
        .filter((a) => a.coachId === c.id && isCurrent(a))
        .map((a) => this.db.categories.find((cat) => cat.id === a.categoryId)?.name ?? '—'),
    };
  }
}

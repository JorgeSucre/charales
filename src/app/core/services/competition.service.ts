import { Injectable, inject } from '@angular/core';
import { MockDb } from '../data/mock-db';
import {
  Cents,
  Competition,
  CompetitionCategory,
  CompetitionStatus,
  CompetitionType,
  Id,
  ISODate,
  ParticipationStatus,
  RosterEntry,
  fullName,
} from '../models';
import { AuditService } from './audit.service';
import { isISODate, nowDateTime, today } from '../../shared/dates';
import { assertCents } from '../../shared/money';
import { optional, required } from '../../shared/validate';

export type CompetitionDraft = Pick<
  Competition,
  | 'seasonId'
  | 'name'
  | 'type'
  | 'organizer'
  | 'contact'
  | 'startDate'
  | 'endDate'
  | 'status'
  | 'notes'
>;

export interface CompetitionView extends Competition {
  seasonName: string | null;
  participations: number;
  matches: number;
}

export interface ParticipationView extends CompetitionCategory {
  competitionName: string;
  competitionType: CompetitionType;
  categoryName: string;
  rosterSize: number;
  coaches: string[];
}

export interface RosterView extends RosterEntry {
  playerName: string;
  identifier: string;
  playerStatus: string;
}

export const TYPE_LABELS: Record<CompetitionType, string> = {
  TORNEO: 'Torneo',
  LIGA: 'Liga',
  OTRO: 'Otro',
};
export const COMPETITION_STATUS_LABELS: Record<CompetitionStatus, string> = {
  PLANIFICADA: 'Planificada',
  ACTIVA: 'Activa',
  FINALIZADA: 'Finalizada',
  CANCELADA: 'Cancelada',
};
export const PARTICIPATION_LABELS: Record<ParticipationStatus, string> = {
  PENDIENTE: 'Pendiente',
  INSCRITA: 'Inscrita',
  BAJA: 'Baja',
  FINALIZADA: 'Finalizada',
};

/**
 * Competitions (competencias: TORNEO/LIGA/OTRO — no separate tournament entity), participations
 * (competencia_categoria, HU-035) and rosters (jugador_competencia_categoria, HU-036).
 */
@Injectable({ providedIn: 'root' })
export class CompetitionService {
  private db = inject(MockDb);
  private audit = inject(AuditService);

  list(
    filter: { seasonId?: Id | null; status?: CompetitionStatus | '' } = {},
  ): Promise<CompetitionView[]> {
    return this.db.respond(
      this.db.competitions
        .filter(
          (c) =>
            (filter.seasonId == null || c.seasonId === filter.seasonId) &&
            (!filter.status || c.status === filter.status),
        )
        .map((c) => this.view(c))
        .sort(
          (a, b) =>
            (b.startDate ?? '').localeCompare(a.startDate ?? '') || a.name.localeCompare(b.name),
        ),
    );
  }

  get(id: Id): Promise<CompetitionView> {
    return this.db.respond(this.view(this.db.get(this.db.competitions, id, 'Competencia')));
  }

  /** HU-034: name, type, season, organizer, status, valid dates, contact/notes. Never deleted (cancel instead). */
  async save(draft: CompetitionDraft & { id?: Id }): Promise<Competition> {
    const data: CompetitionDraft = {
      seasonId: draft.seasonId,
      name: required(draft.name, 'El nombre', 150),
      type: draft.type,
      organizer: optional(draft.organizer, 'El organizador', 150),
      contact: optional(draft.contact, 'El contacto', 150),
      startDate: draft.startDate || null,
      endDate: draft.endDate || null,
      status: draft.status,
      notes: optional(draft.notes, 'Las observaciones', 2000),
    };
    if (!TYPE_LABELS[data.type]) throw new Error('Tipo inválido.');
    if (!COMPETITION_STATUS_LABELS[data.status]) throw new Error('Estatus inválido.');
    if (
      (data.startDate && !isISODate(data.startDate)) ||
      (data.endDate && !isISODate(data.endDate))
    )
      throw new Error('Fechas inválidas.');
    if (data.startDate && data.endDate && data.endDate < data.startDate)
      throw new Error('La fecha de fin no puede ser anterior al inicio.');
    if (data.seasonId !== null) this.db.get(this.db.seasons, data.seasonId, 'Temporada');
    let competition: Competition;
    if (draft.id) {
      const before = this.db.get(this.db.competitions, draft.id, 'Competencia');
      competition = this.db.update(this.db.competitions, draft.id, data);
      this.audit.log(
        'EDITAR',
        'competencias',
        'competencias',
        competition.id,
        `Edición de ${competition.name}`,
        before,
        competition,
      );
    } else {
      competition = this.db.insert(this.db.competitions, { ...data, createdAt: nowDateTime() });
      this.audit.log(
        'CREAR',
        'competencias',
        'competencias',
        competition.id,
        `Alta de ${competition.name}`,
        null,
        competition,
      );
    }
    return this.db.respond(competition);
  }

  // ── HU-035 participations ─────────────────────────────────────────────

  participations(
    filter: { competitionId?: Id | null; categoryId?: Id | null } = {},
  ): Promise<ParticipationView[]> {
    return this.db.respond(this.participationViews(filter));
  }

  participationViews(
    filter: { competitionId?: Id | null; categoryId?: Id | null; ids?: Id[] } = {},
  ): ParticipationView[] {
    const on = today();
    return this.db.competitionCategories
      .filter(
        (cc) =>
          (filter.competitionId == null || cc.competitionId === filter.competitionId) &&
          (filter.categoryId == null || cc.categoryId === filter.categoryId) &&
          (!filter.ids || filter.ids.includes(cc.id)),
      )
      .map((cc) => {
        const competition = this.db.get(this.db.competitions, cc.competitionId, 'Competencia');
        return {
          ...cc,
          competitionName: competition.name,
          competitionType: competition.type,
          categoryName: this.db.get(this.db.categories, cc.categoryId, 'Categoría').name,
          rosterSize: this.db.rosters.filter((r) => r.competitionCategoryId === cc.id && r.active)
            .length,
          coaches: this.db.coachCompetitions
            .filter(
              (a) =>
                a.competitionCategoryId === cc.id && a.active && (!a.endDate || a.endDate >= on),
            )
            .map((a) => fullName(this.db.get(this.db.coaches, a.coachId, 'Entrenador'))),
        };
      })
      .sort(
        (a, b) =>
          a.competitionName.localeCompare(b.competitionName) ||
          a.categoryName.localeCompare(b.categoryName),
      );
  }

  /**
   * Registers a category in a competition (unique pair). A pair that was dropped (BAJA) is re-registered by updating
   * the same row, as uq_competencia_categoria requires.
   */
  async register(draft: {
    competitionId: Id;
    categoryId: Id;
    registeredOn: ISODate;
    costCents: Cents | null;
    status: ParticipationStatus;
  }): Promise<CompetitionCategory> {
    const competition = this.db.get(this.db.competitions, draft.competitionId, 'Competencia');
    const category = this.db.get(this.db.categories, draft.categoryId, 'Categoría');
    if (competition.status === 'CANCELADA' || competition.status === 'FINALIZADA')
      throw new Error('La competencia ya no admite inscripciones.');
    if (!category.active) throw new Error('La categoría está inactiva.');
    if (competition.seasonId && category.seasonId && competition.seasonId !== category.seasonId)
      throw new Error('La categoría pertenece a otra temporada.');
    if (!isISODate(draft.registeredOn)) throw new Error('Fecha de inscripción inválida.');
    if (draft.costCents !== null) {
      assertCents(draft.costCents);
      if (draft.costCents < 0) throw new Error('El costo no puede ser negativo.');
    }
    const existing = this.db.competitionCategories.find(
      (cc) => cc.competitionId === competition.id && cc.categoryId === category.id,
    );
    if (existing && existing.status !== 'BAJA')
      throw new Error(`${category.name} ya está inscrita en ${competition.name}.`);
    const data = {
      registeredOn: draft.registeredOn,
      costCents: draft.costCents,
      status: draft.status,
    };
    const row = existing
      ? this.db.update(this.db.competitionCategories, existing.id, data)
      : this.db.insert(this.db.competitionCategories, {
          ...data,
          competitionId: competition.id,
          categoryId: category.id,
          createdAt: nowDateTime(),
        });
    this.audit.log(
      existing ? 'EDITAR' : 'CREAR',
      'competencias',
      'competencia_categoria',
      row.id,
      `${category.name} inscrita en ${competition.name}`,
      existing ?? null,
      row,
    );
    return this.db.respond(row);
  }

  async setParticipationStatus(id: Id, status: ParticipationStatus): Promise<void> {
    const before = this.db.get(this.db.competitionCategories, id, 'Participación');
    this.db.update(this.db.competitionCategories, id, { status });
    this.audit.log(
      'EDITAR',
      'competencias',
      'competencia_categoria',
      id,
      `Estatus ${before.status} → ${status}`,
      { status: before.status },
      { status },
    );
    await this.db.respond(null);
  }

  // ── HU-036 roster ─────────────────────────────────────────────────────

  roster(competitionCategoryId: Id): Promise<RosterView[]> {
    return this.db.respond(
      this.db.rosters
        .filter((r) => r.competitionCategoryId === competitionCategoryId)
        .map((r) => {
          const p = this.db.get(this.db.players, r.playerId, 'Jugador');
          return {
            ...r,
            playerName: fullName(p),
            identifier: p.identifier,
            playerStatus: p.status,
          };
        })
        .sort(
          (a, b) => Number(b.active) - Number(a.active) || a.playerName.localeCompare(b.playerName),
        ),
    );
  }

  /** Players that can join: active and currently in the participation's category, not already in the roster. */
  eligiblePlayers(competitionCategoryId: Id): Promise<{ id: Id; name: string }[]> {
    const cc = this.db.get(this.db.competitionCategories, competitionCategoryId, 'Participación');
    const inRoster = new Set(
      this.db.rosters
        .filter((r) => r.competitionCategoryId === cc.id && r.active)
        .map((r) => r.playerId),
    );
    return this.db.respond(
      this.db.playerCategories
        .filter(
          (pc) => pc.categoryId === cc.categoryId && !pc.endDate && !inRoster.has(pc.playerId),
        )
        .map((pc) => this.db.get(this.db.players, pc.playerId, 'Jugador'))
        .filter((p) => p.status === 'ACTIVO')
        .map((p) => ({ id: p.id, name: fullName(p) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  /**
   * HU-036: only active players of the selected category; no duplicates. uq (player, participation) means a player
   * who left and returns reuses the row (joinedOn updated); the previous stint stays in the audit log.
   */
  async addToRoster(
    competitionCategoryId: Id,
    playerId: Id,
    joinedOn: ISODate = today(),
  ): Promise<RosterEntry> {
    const cc = this.db.get(this.db.competitionCategories, competitionCategoryId, 'Participación');
    const player = this.db.get(this.db.players, playerId, 'Jugador');
    if (cc.status === 'BAJA' || cc.status === 'FINALIZADA')
      throw new Error('La participación no está vigente.');
    if (player.status !== 'ACTIVO')
      throw new Error('Sólo jugadores activos pueden integrarse al plantel.');
    if (
      !this.db.playerCategories.some(
        (pc) => pc.playerId === playerId && pc.categoryId === cc.categoryId && !pc.endDate,
      )
    )
      throw new Error(`${fullName(player)} no pertenece a la categoría de esta participación.`);
    if (!isISODate(joinedOn)) throw new Error('Fecha de alta inválida.');
    const existing = this.db.rosters.find(
      (r) => r.playerId === playerId && r.competitionCategoryId === cc.id,
    );
    if (existing?.active) throw new Error(`${fullName(player)} ya está en el plantel.`);
    const row = existing
      ? this.db.update(this.db.rosters, existing.id, { joinedOn, leftOn: null, active: true })
      : this.db.insert(this.db.rosters, {
          playerId,
          competitionCategoryId: cc.id,
          joinedOn,
          leftOn: null,
          active: true,
          createdAt: nowDateTime(),
        });
    this.audit.log(
      existing ? 'EDITAR' : 'CREAR',
      'competencias',
      'jugador_competencia_categoria',
      row.id,
      `Alta de ${fullName(player)} al plantel`,
      existing ?? null,
      row,
    );
    return this.db.respond(row);
  }

  /** Leaves the roster (fecha_baja, activo = false); the row is kept as history. */
  async removeFromRoster(entryId: Id, leftOn: ISODate = today()): Promise<void> {
    const row = this.db.get(this.db.rosters, entryId, 'Registro de plantel');
    if (!row.active) throw new Error('El jugador ya fue dado de baja del plantel.');
    if (!isISODate(leftOn) || leftOn < row.joinedOn)
      throw new Error('La baja no puede ser anterior al alta.');
    const updated = this.db.update(this.db.rosters, entryId, { leftOn, active: false });
    this.audit.log(
      'EDITAR',
      'competencias',
      'jugador_competencia_categoria',
      entryId,
      'Baja del plantel',
      row,
      updated,
    );
    await this.db.respond(null);
  }

  private view(c: Competition): CompetitionView {
    const ccIds = new Set(
      this.db.competitionCategories.filter((cc) => cc.competitionId === c.id).map((cc) => cc.id),
    );
    return {
      ...c,
      seasonName: this.db.seasons.find((s) => s.id === c.seasonId)?.name ?? null,
      participations: ccIds.size,
      matches: this.db.matches.filter((m) => ccIds.has(m.competitionCategoryId)).length,
    };
  }
}

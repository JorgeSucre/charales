import { Injectable, inject } from '@angular/core';
import { MockDb } from '../../core/data/mock-db';
import {
  CompetitionType,
  Id,
  ISODate,
  Match,
  MatchStatus,
  Opponent,
  Time,
} from '../../core/models';
import { AuditService } from '../../core/services/audit.service';
import { isISODate, isTime, nowDateTime, today } from '../../shared/dates';
import { optional, required } from '../../shared/validate';

export interface MatchView extends Match {
  competitionId: Id;
  competitionName: string;
  competitionType: CompetitionType;
  categoryId: Id;
  categoryName: string;
  opponentName: string | null;
  venueName: string | null;
  upcoming: boolean;
}

export interface MatchFilter {
  competitionId?: Id | null;
  categoryId?: Id | null;
  status?: MatchStatus | '';
  from?: ISODate;
  to?: ISODate;
  /** Restrict to these participations (coach panel, portal). */
  participationIds?: Id[];
  /** 'asc' (default, calendar) or 'desc' (results history). HU-041.4 */
  order?: 'asc' | 'desc';
}

export type MatchDraft = Pick<
  Match,
  'competitionCategoryId' | 'opponentId' | 'venueId' | 'date' | 'time' | 'homeAway' | 'notes'
>;

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  PROGRAMADO: 'Programado',
  JUGADO: 'Jugado',
  CANCELADO: 'Cancelado',
  REPROGRAMADO: 'Reprogramado',
};

/** Matches (partidos) and opponents (rivales). HU-037, HU-040; the views feed HU-038/039/041/042. */
@Injectable({ providedIn: 'root' })
export class MatchService {
  private db = inject(MockDb);
  private audit = inject(AuditService);

  list(filter: MatchFilter = {}): Promise<MatchView[]> {
    return this.db.respond(this.views(filter));
  }

  /** Synchronous variant for composing services (coach panel, portal, reports). */
  views(filter: MatchFilter = {}): MatchView[] {
    const on = today();
    const rows = this.db.matches
      .filter(
        (m) =>
          !filter.participationIds || filter.participationIds.includes(m.competitionCategoryId),
      )
      .map((m) => this.view(m, on))
      .filter(
        (m) =>
          (filter.competitionId == null || m.competitionId === filter.competitionId) &&
          (filter.categoryId == null || m.categoryId === filter.categoryId) &&
          (!filter.status || m.status === filter.status) &&
          (!filter.from || m.date >= filter.from) &&
          (!filter.to || m.date <= filter.to),
      );
    const dir = filter.order === 'desc' ? -1 : 1;
    return rows.sort((a, b) => dir * `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  }

  /** HU-037: competition + registered category, opponent, date, time and venue are validated. */
  async schedule(draft: MatchDraft): Promise<Match> {
    this.validate(draft);
    const now = nowDateTime();
    const match = this.db.insert(this.db.matches, {
      ...draft,
      notes: optional(draft.notes, 'Las observaciones', 2000),
      goalsFor: null,
      goalsAgainst: null,
      status: 'PROGRAMADO',
      rescheduleReason: null,
      createdAt: now,
      updatedAt: now,
    });
    this.audit.log(
      'CREAR',
      'partidos',
      'partidos',
      match.id,
      `Partido ${match.date} ${match.time}`,
      null,
      match,
    );
    return this.db.respond(match);
  }

  /** Reschedule: new date/time/venue with a reason; status REPROGRAMADO (visible to coaches and families). */
  async reschedule(
    id: Id,
    change: { date: ISODate; time: Time; venueId: Id | null; reason: string },
  ): Promise<Match> {
    const before = this.db.get(this.db.matches, id, 'Partido');
    if (before.status === 'JUGADO' || before.status === 'CANCELADO')
      throw new Error('Ese partido ya no se puede reprogramar.');
    const reason = required(change.reason, 'El motivo', 255);
    this.validate({ ...before, date: change.date, time: change.time, venueId: change.venueId });
    const match = this.db.update(this.db.matches, id, {
      date: change.date,
      time: change.time,
      venueId: change.venueId,
      status: 'REPROGRAMADO',
      rescheduleReason: reason,
      updatedAt: nowDateTime(),
    });
    this.audit.log('EDITAR', 'partidos', 'partidos', id, `Reprogramado: ${reason}`, before, match);
    return this.db.respond(match);
  }

  async cancel(id: Id, reason: string): Promise<void> {
    const before = this.db.get(this.db.matches, id, 'Partido');
    if (before.status === 'JUGADO')
      throw new Error('Un partido con resultado no se cancela (chk_partido_goles).');
    if (before.status === 'CANCELADO') throw new Error('El partido ya está cancelado.');
    const motive = required(reason, 'El motivo');
    const match = this.db.update(this.db.matches, id, {
      status: 'CANCELADO',
      notes: [before.notes, `Cancelado: ${motive}`].filter(Boolean).join('\n'),
      updatedAt: nowDateTime(),
    });
    this.audit.log('CANCELAR', 'partidos', 'partidos', id, `Cancelado: ${motive}`, before, match);
    await this.db.respond(null);
  }

  /** HU-040: only matches already played (date ≤ today, not cancelled); whole, non-negative score. */
  async recordResult(
    id: Id,
    result: { goalsFor: number; goalsAgainst: number; notes: string | null },
  ): Promise<Match> {
    const before = this.db.get(this.db.matches, id, 'Partido');
    if (before.status === 'CANCELADO') throw new Error('El partido está cancelado.');
    if (before.date > today()) throw new Error('No se registra resultado de un partido futuro.');
    for (const g of [result.goalsFor, result.goalsAgainst])
      if (!Number.isInteger(g) || g < 0 || g > 99)
        throw new Error('El marcador debe ser un entero entre 0 y 99.');
    const match = this.db.update(this.db.matches, id, {
      goalsFor: result.goalsFor,
      goalsAgainst: result.goalsAgainst,
      status: 'JUGADO',
      notes: optional(result.notes, 'Las observaciones', 2000) ?? before.notes,
      updatedAt: nowDateTime(),
    });
    this.audit.log(
      'EDITAR',
      'partidos',
      'partidos',
      id,
      `Resultado ${result.goalsFor}-${result.goalsAgainst}`,
      before,
      match,
    );
    return this.db.respond(match);
  }

  // ── opponents ─────────────────────────────────────────────────────────

  opponents(onlyActive = false): Promise<Opponent[]> {
    return this.db.respond(
      this.db.opponents
        .filter((o) => !onlyActive || o.active)
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  async saveOpponent(
    draft: Pick<Opponent, 'name' | 'contact' | 'notes'> & { id?: Id },
  ): Promise<Opponent> {
    const data = {
      name: required(draft.name, 'El nombre', 150),
      contact: optional(draft.contact, 'El contacto', 150),
      notes: optional(draft.notes, 'Las observaciones'),
    };
    if (
      this.db.opponents.some(
        (o) => o.id !== draft.id && o.name.toLowerCase() === data.name.toLowerCase(),
      )
    )
      throw new Error('Ya existe un rival con ese nombre.');
    const row = draft.id
      ? this.db.update(this.db.opponents, draft.id, data)
      : this.db.insert(this.db.opponents, { ...data, active: true });
    this.audit.log(
      draft.id ? 'EDITAR' : 'CREAR',
      'partidos',
      'rivales',
      row.id,
      `Rival ${row.name}`,
    );
    return this.db.respond(row);
  }

  async setOpponentActive(id: Id, active: boolean): Promise<void> {
    this.db.update(this.db.opponents, id, { active });
    await this.db.respond(null);
  }

  private validate(draft: MatchDraft): void {
    const cc = this.db.get(
      this.db.competitionCategories,
      draft.competitionCategoryId,
      'Participación',
    );
    if (cc.status !== 'INSCRITA')
      throw new Error('La categoría no está inscrita en esa competencia.');
    const competition = this.db.get(this.db.competitions, cc.competitionId, 'Competencia');
    if (competition.status === 'CANCELADA' || competition.status === 'FINALIZADA')
      throw new Error('La competencia no está vigente.');
    if (draft.opponentId === null) throw new Error('Selecciona el rival.');
    this.db.get(this.db.opponents, draft.opponentId, 'Rival');
    if (draft.venueId !== null && !this.db.get(this.db.venues, draft.venueId, 'Sede').active)
      throw new Error('La sede está inactiva.');
    if (!isISODate(draft.date)) throw new Error('Fecha inválida.');
    if (!isTime(draft.time)) throw new Error('Hora inválida.');
    if (draft.homeAway !== 'LOCAL' && draft.homeAway !== 'VISITANTE')
      throw new Error('Indica si es local o visitante.');
  }

  private view(m: Match, on: ISODate): MatchView {
    const cc = this.db.get(this.db.competitionCategories, m.competitionCategoryId, 'Participación');
    const competition = this.db.get(this.db.competitions, cc.competitionId, 'Competencia');
    return {
      ...m,
      competitionId: competition.id,
      competitionName: competition.name,
      competitionType: competition.type,
      categoryId: cc.categoryId,
      categoryName: this.db.get(this.db.categories, cc.categoryId, 'Categoría').name,
      opponentName: this.db.opponents.find((o) => o.id === m.opponentId)?.name ?? null,
      venueName: this.db.venues.find((v) => v.id === m.venueId)?.name ?? null,
      upcoming: m.date >= on && (m.status === 'PROGRAMADO' || m.status === 'REPROGRAMADO'),
    };
  }
}

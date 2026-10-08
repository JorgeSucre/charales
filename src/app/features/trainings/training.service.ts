import { Injectable, inject } from '@angular/core';
import { AuthorizationService, ForbiddenError } from '../../core/auth/authorization.service';
import { SessionStore } from '../../core/auth/session.store';
import { MockDb } from '../../core/data/mock-db';
import {
  AttendanceStatus,
  Id,
  ISODate,
  Time,
  TrainingSession,
  TrainingStatus,
  fullName,
} from '../../core/models';
import { AuditService } from '../../core/services/audit.service';
import {
  addDays,
  isISODate,
  isTime,
  nowDateTime,
  today,
  weekday,
  isCurrentAssignment,
} from '../../shared/dates';
import { optional, required } from '../../shared/validate';

export interface SessionView extends TrainingSession {
  categoryName: string;
  venueName: string;
  coachName: string | null;
  recorded: number;
}

export interface SessionDetail extends SessionView {
  players: { playerId: Id; name: string; status: AttendanceStatus | null; notes: string | null }[];
  /** The logged-in user may record attendance (HU-030) / edit objective and notes (HU-031). */
  canRecord: boolean;
}

export interface SessionDraft {
  categoryId: Id;
  venueId: Id;
  coachId: Id | null;
  scheduleId: Id | null;
  date: ISODate;
  startTime: Time;
  endTime: Time;
  objective: string | null;
}

export const TRAINING_STATUS_LABELS: Record<TrainingStatus, string> = {
  PROGRAMADO: 'Programado',
  REALIZADO: 'Realizado',
  CANCELADO: 'Cancelado',
};

/**
 * Training sessions (sesiones_entrenamiento): HU-028 programming (also from recurring schedules), HU-029 coach agenda,
 * HU-031 objective/notes. Coaches without a staff role only reach sessions they lead or of categories they currently
 * coach — checked here, not only in the route.
 */
@Injectable({ providedIn: 'root' })
export class TrainingService {
  private db = inject(MockDb);
  private authz = inject(AuthorizationService);
  private audit = inject(AuditService);
  private session = inject(SessionStore);

  async list(
    filter: {
      from?: ISODate;
      to?: ISODate;
      categoryId?: Id | null;
      coachId?: Id | null;
      status?: TrainingStatus | '';
    } = {},
  ): Promise<SessionView[]> {
    this.authz.require('entrenamientos.consultar');
    return this.db.respond(this.views(filter));
  }

  views(
    filter: {
      from?: ISODate;
      to?: ISODate;
      categoryId?: Id | null;
      coachId?: Id | null;
      status?: TrainingStatus | '';
    } = {},
  ): SessionView[] {
    return this.db.trainingSessions
      .filter(
        (s) =>
          this.inScope(s) &&
          (!filter.from || s.date >= filter.from) &&
          (!filter.to || s.date <= filter.to) &&
          (filter.categoryId == null || s.categoryId === filter.categoryId) &&
          (filter.coachId == null || s.coachId === filter.coachId) &&
          (!filter.status || s.status === filter.status),
      )
      .map((s) => this.view(s))
      .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
  }

  /** HU-029/HU-030: the session with its group (active members of the category on that date) and their attendance. */
  async get(id: Id): Promise<SessionDetail> {
    const s = this.db.get(this.db.trainingSessions, id, 'Sesión');
    if (!this.inScope(s)) throw new ForbiddenError('No tienes acceso a esta sesión.');
    const recorded = new Map(
      this.db.attendance.filter((a) => a.sessionId === id).map((a) => [a.playerId, a]),
    );
    const members = this.groupOn(s.categoryId, s.date);
    const ids = [...new Set([...members, ...recorded.keys()])];
    return this.db.respond({
      ...this.view(s),
      players: ids
        .map((playerId) => {
          const a = recorded.get(playerId);
          return {
            playerId,
            name: fullName(this.db.get(this.db.players, playerId, 'Jugador')),
            status: a?.status ?? null,
            notes: a?.notes ?? null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
      canRecord: this.canRecord(s),
    });
  }

  /** HU-028: category, date, schedule, venue and coach; a schedule must be of the same category. */
  async program(draft: SessionDraft): Promise<TrainingSession> {
    this.authz.require('entrenamientos.crear');
    this.validate(draft);
    const now = nowDateTime();
    const session = this.db.insert(this.db.trainingSessions, {
      ...draft,
      objective: optional(draft.objective, 'El objetivo'),
      status: 'PROGRAMADO',
      notes: null,
      createdAt: now,
      updatedAt: now,
    });
    this.audit.log(
      'CREAR',
      'entrenamientos',
      'sesiones_entrenamiento',
      session.id,
      `Sesión ${session.date} ${session.startTime}`,
      null,
      session,
    );
    return this.db.respond(session);
  }

  /**
   * HU-028.2: creates PROGRAMADO sessions from the active recurring schedules between two dates, skipping the ones
   * that already exist (same schedule and date). The coach defaults to the category's current principal coach.
   */
  async generateFromSchedules(
    from: ISODate,
    to: ISODate,
    categoryId: Id | null = null,
  ): Promise<{ created: number; skipped: number }> {
    this.authz.require('entrenamientos.crear');
    if (!isISODate(from) || !isISODate(to) || to < from)
      throw new Error('Rango de fechas inválido.');
    if (addDays(from, 62) < to) throw new Error('Genera como máximo dos meses a la vez.');
    let created = 0;
    let skipped = 0;
    this.db.transaction(() => {
      const schedules = this.db.schedules.filter(
        (h) => h.active && (categoryId == null || h.categoryId === categoryId),
      );
      for (let date = from; date <= to; date = addDays(date, 1)) {
        for (const h of schedules.filter((h) => h.weekday === weekday(date))) {
          if (this.db.trainingSessions.some((s) => s.scheduleId === h.id && s.date === date)) {
            skipped++;
            continue;
          }
          const coaches = this.db.coachCategories.filter(
            (a) => a.categoryId === h.categoryId && isCurrentAssignment(a, date),
          );
          const coach =
            coaches.find((a) => a.responsibility?.toLowerCase() === 'principal') ?? coaches[0];
          const now = nowDateTime();
          this.db.insert(this.db.trainingSessions, {
            categoryId: h.categoryId,
            venueId: h.venueId,
            coachId: coach?.coachId ?? null,
            scheduleId: h.id,
            date,
            startTime: h.startTime,
            endTime: h.endTime,
            status: 'PROGRAMADO',
            objective: null,
            notes: null,
            createdAt: now,
            updatedAt: now,
          });
          created++;
        }
      }
      this.audit.log(
        'CREAR',
        'entrenamientos',
        'sesiones_entrenamiento',
        null,
        `Sesiones generadas ${from}..${to}: ${created}`,
      );
    });
    return this.db.respond({ created, skipped });
  }

  async setStatus(id: Id, status: TrainingStatus, reason = ''): Promise<void> {
    this.authz.require('entrenamientos.editar');
    const before = this.db.get(this.db.trainingSessions, id, 'Sesión');
    if (before.status === status) return this.db.respond(undefined);
    if (status === 'REALIZADO' && before.date > today())
      throw new Error('Una sesión futura no puede marcarse como realizada.');
    const motive = status === 'CANCELADO' ? required(reason, 'El motivo de cancelación') : '';
    const updated = this.db.update(this.db.trainingSessions, id, {
      status,
      notes: motive
        ? [before.notes, `Cancelada: ${motive}`].filter(Boolean).join('\n')
        : before.notes,
      updatedAt: nowDateTime(),
    });
    this.audit.log(
      status === 'CANCELADO' ? 'CANCELAR' : 'EDITAR',
      'entrenamientos',
      'sesiones_entrenamiento',
      id,
      `${before.status} → ${status}`,
      before,
      updated,
    );
    await this.db.respond(undefined);
  }

  /** HU-031: objective and notes; only the assigned coach or someone with asistencias.editar beyond their own scope (admin). */
  async saveNotes(
    id: Id,
    draft: { objective: string | null; notes: string | null },
  ): Promise<void> {
    const before = this.db.get(this.db.trainingSessions, id, 'Sesión');
    if (!this.canRecord(before))
      throw new Error('Sólo el entrenador asignado o un administrador pueden editar la sesión.');
    const updated = this.db.update(this.db.trainingSessions, id, {
      objective: optional(draft.objective, 'El objetivo'),
      notes: optional(draft.notes, 'Las observaciones', 5000),
      updatedAt: nowDateTime(),
    });
    this.audit.log(
      'EDITAR',
      'entrenamientos',
      'sesiones_entrenamiento',
      id,
      'Objetivo/observaciones de la sesión',
      before,
      updated,
    );
    await this.db.respond(undefined);
  }

  /** Active players that belonged to the category on that date. */
  groupOn(categoryId: Id, date: ISODate): Id[] {
    return this.db.playerCategories
      .filter(
        (pc) =>
          pc.categoryId === categoryId &&
          pc.startDate <= date &&
          (!pc.endDate || pc.endDate >= date),
      )
      .map((pc) => pc.playerId)
      .filter((pid) => this.db.players.find((p) => p.id === pid)?.status === 'ACTIVO');
  }

  /**
   * Office users with entrenamientos.consultar see every session; a coach only the sessions they lead or of the
   * categories they currently coach (on the session date).
   */
  inScope(s: TrainingSession): boolean {
    return this.authz.has('entrenamientos.consultar') || this.coachesSession(s);
  }

  /**
   * Recording attendance / notes (HU-030, HU-031): office-wide only with asistencias.editar from the security role
   * (Administrador); otherwise the coach profile's asistencias.editar, and only in their own sessions. So
   * SECRETARIA + ENTRENADOR captures only where she coaches, never everywhere (D12, no lateral escalation).
   */
  canRecord(s: TrainingSession): boolean {
    if (this.authz.has('asistencias.editar') && this.authz.has('entrenamientos.consultar'))
      return true;
    return (
      !!this.session.user()?.permissions.includes('asistencias.editar') && this.coachesSession(s)
    );
  }

  /** The session is led by the logged-in coach or belongs to a category they coach on its date. */
  private coachesSession(s: TrainingSession): boolean {
    const user = this.session.user();
    if (!user?.coachId || !this.authz.has('panel_entrenador.consultar')) return false;
    return s.coachId === user.coachId || this.coachesCategory(user.coachId, s.categoryId, s.date);
  }

  private coachesCategory(coachId: Id, categoryId: Id, on: ISODate): boolean {
    return this.db.coachCategories.some(
      (a) => a.coachId === coachId && a.categoryId === categoryId && isCurrentAssignment(a, on),
    );
  }

  private validate(d: SessionDraft): void {
    const category = this.db.get(this.db.categories, d.categoryId, 'Categoría');
    if (!category.active) throw new Error('La categoría está inactiva.');
    if (!this.db.get(this.db.venues, d.venueId, 'Sede').active)
      throw new Error('La sede está inactiva.');
    if (d.coachId !== null && !this.db.get(this.db.coaches, d.coachId, 'Entrenador').active)
      throw new Error('El entrenador está inactivo.');
    if (
      d.scheduleId !== null &&
      this.db.get(this.db.schedules, d.scheduleId, 'Horario').categoryId !== d.categoryId
    )
      throw new Error('El horario pertenece a otra categoría.');
    if (!isISODate(d.date)) throw new Error('Fecha inválida.');
    if (!isTime(d.startTime) || !isTime(d.endTime)) throw new Error('Horas inválidas.');
    if (d.endTime <= d.startTime)
      throw new Error('La hora de fin debe ser posterior a la de inicio.');
  }

  private view(s: TrainingSession): SessionView {
    const coach = this.db.coaches.find((c) => c.id === s.coachId);
    return {
      ...s,
      categoryName: this.db.get(this.db.categories, s.categoryId, 'Categoría').name,
      venueName: this.db.get(this.db.venues, s.venueId, 'Sede').name,
      coachName: coach ? fullName(coach) : null,
      recorded: this.db.attendance.filter((a) => a.sessionId === s.id).length,
    };
  }
}

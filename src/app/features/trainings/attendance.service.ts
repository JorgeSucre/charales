import { Injectable, inject } from '@angular/core';
import { AuthorizationService } from '../../core/auth/authorization.service';
import { MockDb } from '../../core/data/mock-db';
import { AttendanceStatus, Id, ISODate, fullName } from '../../core/models';
import { AuditService } from '../../core/services/audit.service';
import { nowDateTime, today } from '../../shared/dates';
import { optional } from '../../shared/validate';
import { TrainingService } from './training.service';

export interface AttendanceEntry {
  playerId: Id;
  status: AttendanceStatus;
  notes: string | null;
}

export interface AttendanceSummary {
  total: number;
  present: number;
  absent: number;
  justified: number;
  /** present / total, 0–100 (justified count as absences in this metric). */
  presentPct: number;
  /** (present + justified) / total: attendance excusing justified absences. */
  presentOrJustifiedPct: number;
}

export interface AttendanceReportRow extends AttendanceSummary {
  playerId: Id;
  playerName: string;
  categoryName: string;
}

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  PRESENTE: 'Presente',
  AUSENTE: 'Ausente',
  JUSTIFICADO: 'Justificado',
};

export function summarize(statuses: AttendanceStatus[]): AttendanceSummary {
  const count = (s: AttendanceStatus) => statuses.filter((x) => x === s).length;
  const total = statuses.length;
  const present = count('PRESENTE');
  const justified = count('JUSTIFICADO');
  const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  return {
    total,
    present,
    absent: count('AUSENTE'),
    justified,
    presentPct: pct(present),
    presentOrJustifiedPct: pct(present + justified),
  };
}

/** asistencias: HU-030 capture/correction (one row per session and player), HU-032 report, HU-033 per child. */
@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private db = inject(MockDb);
  private authz = inject(AuthorizationService);
  private audit = inject(AuditService);
  private trainings = inject(TrainingService);

  /**
   * Upserts one attendance per player (uq_asistencia_sesion_jugador). Corrections keep the same row, update
   * actualizado_en and are audited with before/after (HU-030.4). Only players of the session's group.
   */
  async record(sessionId: Id, entries: AttendanceEntry[]): Promise<void> {
    const session = this.db.get(this.db.trainingSessions, sessionId, 'Sesión');
    if (!this.trainings.canRecord(session))
      throw new Error('No puedes registrar asistencia de esta sesión.');
    if (session.status === 'CANCELADO') throw new Error('La sesión está cancelada.');
    if (session.date > today()) throw new Error('No se registra asistencia de una sesión futura.');
    const group = new Set([
      ...this.trainings.groupOn(session.categoryId, session.date),
      ...this.db.attendance.filter((a) => a.sessionId === sessionId).map((a) => a.playerId),
    ]);
    if (new Set(entries.map((e) => e.playerId)).size !== entries.length)
      throw new Error('Un jugador aparece dos veces.');
    for (const e of entries) {
      if (!group.has(e.playerId))
        throw new Error('Hay jugadores que no pertenecen al grupo de la sesión.');
      if (!ATTENDANCE_LABELS[e.status]) throw new Error('Estado de asistencia inválido.');
    }
    const now = nowDateTime();
    const userId = this.audit.currentUserId();
    this.db.transaction(() => {
      for (const e of entries) {
        const notes = optional(e.notes, 'La observación');
        const existing = this.db.attendance.find(
          (a) => a.sessionId === sessionId && a.playerId === e.playerId,
        );
        if (!existing) {
          const row = this.db.insert(this.db.attendance, {
            sessionId,
            playerId: e.playerId,
            status: e.status,
            notes,
            recordedBy: userId,
            recordedAt: now,
            updatedAt: now,
          });
          this.audit.log(
            'CREAR',
            'asistencias',
            'asistencias',
            row.id,
            `Asistencia sesión ${sessionId}`,
            null,
            row,
          );
        } else if (existing.status !== e.status || existing.notes !== notes) {
          const row = this.db.update(this.db.attendance, existing.id, {
            status: e.status,
            notes,
            updatedAt: now,
          });
          this.audit.log(
            'EDITAR',
            'asistencias',
            'asistencias',
            row.id,
            `Corrección de asistencia sesión ${sessionId}`,
            existing,
            row,
          );
        }
      }
      if (session.status === 'PROGRAMADO')
        this.db.update(this.db.trainingSessions, sessionId, {
          status: 'REALIZADO',
          updatedAt: now,
        });
    });
    await this.db.respond(null);
  }

  /** HU-032: by player, filtered by dates/category/player; % present and distinguishing justified absences. */
  async report(
    filter: { from?: ISODate; to?: ISODate; categoryId?: Id | null; playerId?: Id | null } = {},
  ): Promise<AttendanceReportRow[]> {
    this.authz.require('asistencias.consultar');
    const sessions = new Map(
      this.db.trainingSessions
        .filter(
          (s) =>
            s.status !== 'CANCELADO' &&
            (!filter.from || s.date >= filter.from) &&
            (!filter.to || s.date <= filter.to) &&
            (filter.categoryId == null || s.categoryId === filter.categoryId),
        )
        .map((s) => [s.id, s]),
    );
    const byPlayer = new Map<Id, { statuses: AttendanceStatus[]; categoryId: Id }>();
    for (const a of this.db.attendance) {
      const s = sessions.get(a.sessionId);
      if (!s || (filter.playerId != null && a.playerId !== filter.playerId)) continue;
      const row = byPlayer.get(a.playerId) ?? { statuses: [], categoryId: s.categoryId };
      row.statuses.push(a.status);
      byPlayer.set(a.playerId, row);
    }
    return this.db.respond(
      [...byPlayer.entries()]
        .map(([playerId, r]) => ({
          playerId,
          playerName: fullName(this.db.get(this.db.players, playerId, 'Jugador')),
          categoryName: this.db.get(this.db.categories, r.categoryId, 'Categoría').name,
          ...summarize(r.statuses),
        }))
        .sort((a, b) => a.presentPct - b.presentPct || a.playerName.localeCompare(b.playerName)),
    );
  }

  /** HU-033: one player's attendance; office permission or the player's tutor. */
  history(
    playerId: Id,
    from?: ISODate,
    to?: ISODate,
  ): {
    rows: { date: ISODate; categoryName: string; status: AttendanceStatus; notes: string | null }[];
    summary: AttendanceSummary;
  } {
    this.authz.assertPlayer(playerId, 'asistencias.consultar', { tutor: true });
    const rows = this.db.attendance
      .filter((a) => a.playerId === playerId)
      .map((a) => ({ a, s: this.db.get(this.db.trainingSessions, a.sessionId, 'Sesión') }))
      .filter(
        ({ s }) => s.status !== 'CANCELADO' && (!from || s.date >= from) && (!to || s.date <= to),
      )
      .sort((x, y) => y.s.date.localeCompare(x.s.date))
      .map(({ a, s }) => ({
        date: s.date,
        categoryName: this.db.get(this.db.categories, s.categoryId, 'Categoría').name,
        status: a.status,
        notes: a.notes,
      }));
    return { rows, summary: summarize(rows.map((r) => r.status)) };
  }
}

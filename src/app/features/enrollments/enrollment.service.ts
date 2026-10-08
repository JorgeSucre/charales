import { Injectable, inject } from '@angular/core';
import { AuthorizationService } from '../../core/auth/authorization.service';
import { MockDb } from '../../core/data/mock-db';
import {
  Cents,
  ChargeStatus,
  Enrollment,
  EnrollmentStatus,
  Id,
  ISODate,
  fullName,
} from '../../core/models';
import { AuditService } from '../../core/services/audit.service';
import { isISODate, nowDateTime } from '../../shared/dates';
import { assertCents } from '../../shared/money';
import { matches } from '../../shared/page';
import { required } from '../../shared/validate';
import { BillingService } from '../billing/billing.service';

export interface EnrollmentDraft {
  playerId: Id;
  seasonId: Id;
  enrolledOn: ISODate;
  amountCents: Cents;
  status: 'PENDIENTE' | 'ACTIVA';
  /** HU-020.2: when set (and amount > 0) a charge is created for the fee, referenced as 'INS-<id>'. */
  conceptId: Id | null;
  dueDate: ISODate | null;
}

export interface EnrollmentView extends Enrollment {
  playerName: string;
  seasonName: string;
  charge: { id: Id; status: ChargeStatus; balanceCents: Cents } | null;
}

export const ENROLLMENT_LABELS: Record<EnrollmentStatus, string> = {
  PENDIENTE: 'Pendiente',
  ACTIVA: 'Activa',
  CANCELADA: 'Cancelada',
  FINALIZADA: 'Finalizada',
};

/**
 * HU-020: administrative enrollment per season (inscripciones). It is NOT category membership
 * (that is PlayerCategoryService / jugador_categoria). One row per player and season, whatever its status.
 */
@Injectable({ providedIn: 'root' })
export class EnrollmentService {
  private db = inject(MockDb);
  private authz = inject(AuthorizationService);
  private audit = inject(AuditService);
  private billing = inject(BillingService);

  async list(
    filter: { seasonId?: Id | null; status?: EnrollmentStatus | ''; query?: string } = {},
  ): Promise<EnrollmentView[]> {
    this.authz.require('inscripciones.consultar');
    const balances = this.billing.balancesById();
    return this.db.respond(
      this.db.enrollments
        .filter(
          (e) =>
            (filter.seasonId == null || e.seasonId === filter.seasonId) &&
            (!filter.status || e.status === filter.status),
        )
        .map((e) => {
          const charge = this.linkedCharge(e);
          return {
            ...e,
            playerName: fullName(this.db.get(this.db.players, e.playerId, 'Jugador')),
            seasonName: this.db.get(this.db.seasons, e.seasonId, 'Temporada').name,
            charge: charge ? { id: charge.id, ...balances.get(charge.id)! } : null,
          };
        })
        .filter((e) => !filter.query || matches(e.playerName, filter.query))
        .sort(
          (a, b) =>
            b.enrolledOn.localeCompare(a.enrolledOn) || a.playerName.localeCompare(b.playerName),
        ),
    );
  }

  async enroll(draft: EnrollmentDraft): Promise<Enrollment> {
    this.authz.require('inscripciones.crear');
    const player = this.db.get(this.db.players, draft.playerId, 'Jugador');
    const season = this.db.get(this.db.seasons, draft.seasonId, 'Temporada');
    if (player.status !== 'ACTIVO') throw new Error('Sólo se inscriben jugadores activos.');
    if (!season.active) throw new Error('La temporada está cerrada.');
    if (!isISODate(draft.enrolledOn)) throw new Error('Fecha de inscripción inválida.');
    assertCents(draft.amountCents);
    if (draft.amountCents < 0) throw new Error('El monto no puede ser negativo.');
    const existing = this.db.enrollments.find(
      (e) => e.playerId === draft.playerId && e.seasonId === draft.seasonId,
    );
    if (existing)
      throw new Error(
        existing.status === 'CANCELADA'
          ? 'El jugador tiene una inscripción cancelada en esta temporada: reactívala.'
          : 'El jugador ya está inscrito en esta temporada.',
      );
    const enrollment = this.db.transaction(() => {
      const created = this.db.insert(this.db.enrollments, {
        playerId: draft.playerId,
        seasonId: draft.seasonId,
        enrolledOn: draft.enrolledOn,
        amountCents: draft.amountCents,
        status: draft.status,
        createdAt: nowDateTime(),
      });
      if (draft.conceptId && draft.amountCents > 0)
        this.billing.insertCharge({
          playerId: draft.playerId,
          conceptId: draft.conceptId,
          seasonId: draft.seasonId,
          period: null,
          chargedOn: draft.enrolledOn,
          dueDate: draft.dueDate,
          originalAmountCents: draft.amountCents,
          reference: `INS-${created.id}`,
        });
      this.audit.log(
        'CREAR',
        'inscripciones',
        'inscripciones',
        created.id,
        `Inscripción de ${fullName(player)} a ${season.name}`,
        null,
        created,
      );
      return created;
    });
    return this.db.respond(enrollment);
  }

  /**
   * Status changes. Cancelling needs a reason and also cancels the fee charge if nothing was paid; with payments
   * it is refused (cancel the payment first, HU-049) so the financial trail stays consistent.
   */
  async setStatus(id: Id, status: EnrollmentStatus, reason = ''): Promise<void> {
    this.authz.require('inscripciones.editar');
    const before = this.db.get(this.db.enrollments, id, 'Inscripción');
    if (before.status === status) return this.db.respond(undefined);
    const allowed: Record<EnrollmentStatus, EnrollmentStatus[]> = {
      PENDIENTE: ['ACTIVA', 'CANCELADA'],
      ACTIVA: ['FINALIZADA', 'CANCELADA'],
      CANCELADA: ['ACTIVA'],
      FINALIZADA: [],
    };
    if (!allowed[before.status].includes(status))
      throw new Error(
        `No se puede pasar de ${ENROLLMENT_LABELS[before.status]} a ${ENROLLMENT_LABELS[status]}.`,
      );
    const motive =
      status === 'CANCELADA' ? required(reason, 'El motivo de cancelación') : reason.trim();
    this.db.transaction(() => {
      if (status === 'CANCELADA') {
        const charge = this.linkedCharge(before);
        if (charge && charge.status !== 'CANCELADO')
          this.billing.voidCharge(charge.id, `Inscripción cancelada: ${motive}`);
      }
      this.db.update(this.db.enrollments, id, { status });
      this.audit.log(
        status === 'CANCELADA' ? 'CANCELAR' : 'EDITAR',
        'inscripciones',
        'inscripciones',
        id,
        `${before.status} → ${status}${motive ? `: ${motive}` : ''}`,
        { status: before.status },
        { status },
      );
    });
    await this.db.respond(undefined);
  }

  /** inscripciones has no cargo_id: the fee charge is found by player + reference 'INS-<id>'. */
  private linkedCharge(e: Enrollment) {
    return this.db.charges.find((c) => c.playerId === e.playerId && c.reference === `INS-${e.id}`);
  }
}

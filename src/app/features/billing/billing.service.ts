import { Injectable, inject } from '@angular/core';
import { SessionStore } from '../../core/auth/session.store';
import { MockDb } from '../../core/data/mock-db';
import {
  Cents,
  Charge,
  ChargeConcept,
  ChargeStatus,
  Discount,
  Id,
  ISODate,
  Payment,
  PaymentApplication,
  PaymentDraft,
  PaymentMethod,
  fullName,
} from '../../core/models';
import { AuditService } from '../../core/services/audit.service';
import { PlayerService } from '../../core/services/player.service';
import { isISODate, nowDateTime, today } from '../../shared/dates';
import { MAX_CENTS, assertCents } from '../../shared/money';
import { Page, matches, paginate } from '../../shared/page';
import { optional, required } from '../../shared/validate';
import {
  ChargeDraft,
  PERIOD_PATTERN,
  allocatePayment,
  chargeBalance,
  chargeStatus,
  debtsByPlayer,
  effectiveApplications,
  generateMonthlyCharges,
  netAmount,
  nextFolio,
  paidOn,
} from './billing.rules';

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  TARJETA: 'Tarjeta',
  OTRO: 'Otro',
};

export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
  PENDIENTE: 'Pendiente',
  PARCIAL: 'Parcial',
  PAGADO: 'Pagado',
  VENCIDO: 'Vencido',
  CANCELADO: 'Cancelado',
};

export interface ChargeView extends Charge {
  label: string;
  playerName: string;
  netCents: Cents;
  discountCents: Cents;
  paidCents: Cents;
  balanceCents: Cents;
}

export interface ReceiptView {
  payment: Payment;
  playerName: string;
  tutorName: string | null;
  recordedBy: string | null;
  lines: { label: string; amountCents: Cents }[];
}

export interface StatementView {
  playerId: Id;
  playerName: string;
  charges: ChargeView[];
  payments: (Payment & { applied: { label: string; amountCents: Cents }[] })[];
  totals: {
    chargedCents: Cents;
    discountCents: Cents;
    paidCents: Cents;
    balanceCents: Cents;
    overdueCents: Cents;
  };
}

export interface DebtView {
  playerId: Id;
  playerName: string;
  categoryName: string | null;
  tutorName: string | null;
  tutorContact: string | null;
  balanceCents: Cents;
  overdueCents: Cents;
  openCharges: number;
  oldestDueDate: ISODate | null;
}

export interface MonthlyDraft {
  conceptId: Id;
  period: string;
  dueDate: ISODate;
  /** HU-044.4: players excluded by an authorized rule (e.g. full scholarship), stated in `exclusionReason`. */
  excludedPlayerIds: Id[];
  exclusionReason: string | null;
}

/**
 * Billing (conceptos_cobro, cargos, pagos, pago_aplicacion, descuentos). Every write that touches money runs in
 * one MockDb transaction and keeps cargos.estado in sync with the derived balance. The API must do the same in
 * one DB transaction (BEGIN … COMMIT) and repeat every check.
 */
@Injectable({ providedIn: 'root' })
export class BillingService {
  private db = inject(MockDb);
  private audit = inject(AuditService);
  private session = inject(SessionStore);
  private players = inject(PlayerService);

  // ── HU-043 concepts ───────────────────────────────────────────────────

  concepts(): Promise<(ChargeConcept & { used: number })[]> {
    return this.db.respond(
      this.db.concepts
        .map((c) => ({ ...c, used: this.db.charges.filter((ch) => ch.conceptId === c.id).length }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  /** Changing the suggested amount never touches existing charges (each charge keeps its own amount). */
  async saveConcept(
    draft: Pick<ChargeConcept, 'name' | 'suggestedAmountCents' | 'recurring'> & { id?: Id },
  ): Promise<ChargeConcept> {
    const name = required(draft.name, 'El nombre', 100);
    this.assertAmount(draft.suggestedAmountCents, true);
    if (
      this.db.concepts.some((c) => c.id !== draft.id && c.name.toLowerCase() === name.toLowerCase())
    )
      throw new Error('Ya existe un concepto con ese nombre.');
    const data = {
      name,
      suggestedAmountCents: draft.suggestedAmountCents,
      recurring: draft.recurring,
    };
    let concept: ChargeConcept;
    if (draft.id) {
      const before = this.db.get(this.db.concepts, draft.id, 'Concepto');
      concept = this.db.update(this.db.concepts, draft.id, data);
      this.audit.log(
        'EDITAR',
        'cobranza',
        'conceptos_cobro',
        concept.id,
        `Edición de ${name}`,
        before,
        concept,
      );
    } else {
      concept = this.db.insert(this.db.concepts, {
        ...data,
        active: true,
        createdAt: nowDateTime(),
      });
      this.audit.log(
        'CREAR',
        'cobranza',
        'conceptos_cobro',
        concept.id,
        `Alta de ${name}`,
        null,
        concept,
      );
    }
    return this.db.respond(concept);
  }

  /** HU-043.3: concepts are deactivated, never deleted (charges reference them). */
  async setConceptActive(id: Id, active: boolean): Promise<void> {
    this.db.get(this.db.concepts, id, 'Concepto');
    this.db.update(this.db.concepts, id, { active });
    this.audit.log(
      'EDITAR',
      'cobranza',
      'conceptos_cobro',
      id,
      active ? 'Activación' : 'Desactivación',
    );
    await this.db.respond(null);
  }

  // ── HU-044 charges ────────────────────────────────────────────────────

  charges(
    filter: {
      playerId?: Id | null;
      status?: ChargeStatus | '';
      conceptId?: Id | null;
      period?: string;
      query?: string;
      page?: number;
    } = {},
  ): Promise<Page<ChargeView>> {
    this.syncStatuses();
    const rows = this.db.charges
      .filter(
        (c) =>
          (filter.playerId == null || c.playerId === filter.playerId) &&
          (!filter.status || c.status === filter.status) &&
          (filter.conceptId == null || c.conceptId === filter.conceptId) &&
          (!filter.period || c.period === filter.period),
      )
      .map((c) => this.chargeView(c))
      .filter((c) => !filter.query || matches(c.playerName, filter.query))
      .sort((a, b) => (b.dueDate ?? '').localeCompare(a.dueDate ?? '') || b.id - a.id);
    return this.db.respond(paginate(rows, filter.page));
  }

  /** Players the monthly generation would charge: active players with an ACTIVA enrollment in the current season. */
  monthlyCandidates(): Promise<{ id: Id; name: string }[]> {
    return this.db.respond(this.eligibleForMonthly().map((p) => ({ id: p.id, name: fullName(p) })));
  }

  /** HU-044: one charge per player/concept/period; re-running only adds what is missing. */
  async generateMonthlyFees(draft: MonthlyDraft): Promise<{ created: number; skipped: number }> {
    const concept = this.db.get(this.db.concepts, draft.conceptId, 'Concepto');
    if (!concept.active) throw new Error('El concepto está inactivo.');
    if (!PERIOD_PATTERN.test(draft.period))
      throw new Error('El periodo debe tener formato AAAA-MM.');
    if (!isISODate(draft.dueDate)) throw new Error('Fecha de vencimiento inválida.');
    if (concept.suggestedAmountCents <= 0)
      throw new Error('El concepto no tiene importe sugerido.');
    if (draft.excludedPlayerIds.length && !draft.exclusionReason?.trim())
      throw new Error('Indica la regla autorizada para excluir jugadores.');
    const season = this.db.seasons.find((s) => s.isCurrent);
    if (!season) throw new Error('No hay temporada actual.');
    const eligible = this.eligibleForMonthly().map((p) => p.id);
    const playerIds = eligible.filter((id) => !draft.excludedPlayerIds.includes(id));
    const drafts = generateMonthlyCharges(
      playerIds,
      concept,
      draft.period,
      draft.dueDate,
      today(),
      season.id,
      this.db.charges,
    );
    this.db.transaction(() => {
      for (const d of drafts) this.insertCharge(d, false);
      this.audit.log(
        'CREAR',
        'cobranza',
        'cargos',
        null,
        `Mensualidades ${draft.period} (${concept.name}): ${drafts.length} generadas` +
          (draft.excludedPlayerIds.length
            ? `; excluidos ${draft.excludedPlayerIds.join(', ')} por: ${draft.exclusionReason}`
            : ''),
      );
    });
    return this.db.respond({ created: drafts.length, skipped: playerIds.length - drafts.length });
  }

  /**
   * Synchronous insert for other services' transactions (enrollment fee HU-020, uniform order HU-054).
   * Validates FK targets, amount and the period uniqueness; status is derived.
   */
  insertCharge(
    draft: Omit<ChargeDraft, 'status'> & { status?: ChargeStatus },
    audit = true,
  ): Charge {
    const player = this.db.get(this.db.players, draft.playerId, 'Jugador');
    const concept = this.db.get(this.db.concepts, draft.conceptId, 'Concepto');
    if (!concept.active) throw new Error('El concepto está inactivo.');
    this.assertAmount(draft.originalAmountCents, true);
    if (draft.period && !PERIOD_PATTERN.test(draft.period))
      throw new Error('El periodo debe tener formato AAAA-MM.');
    if (
      draft.period &&
      this.db.charges.some(
        (c) =>
          c.playerId === draft.playerId &&
          c.conceptId === draft.conceptId &&
          c.period === draft.period,
      )
    )
      throw new Error(`${fullName(player)} ya tiene ${concept.name} ${draft.period}.`);
    const now = nowDateTime();
    const charge = this.db.insert(this.db.charges, {
      ...draft,
      status: 'PENDIENTE',
      createdAt: now,
      updatedAt: now,
    });
    this.syncStatuses([charge.id]);
    if (audit)
      this.audit.log(
        'CREAR',
        'cobranza',
        'cargos',
        charge.id,
        `Cargo ${this.players.chargeLabel(charge)} a ${fullName(player)}`,
        null,
        charge,
      );
    return this.db.get(this.db.charges, charge.id);
  }

  /** Manual charge (e.g. "Otro" concept) from the charges screen. */
  async createCharge(draft: {
    playerId: Id;
    conceptId: Id;
    amountCents: Cents;
    dueDate: ISODate | null;
    reference: string | null;
  }): Promise<Charge> {
    const reference = optional(draft.reference, 'La referencia', 100);
    const charge = this.db.transaction(() =>
      this.insertCharge({
        playerId: draft.playerId,
        conceptId: draft.conceptId,
        seasonId: this.db.seasons.find((s) => s.isCurrent)?.id ?? null,
        period: null,
        chargedOn: today(),
        dueDate: draft.dueDate,
        originalAmountCents: draft.amountCents,
        reference,
      }),
    );
    return this.db.respond(charge);
  }

  /** Synchronous cancellation for other services' transactions. Only charges with nothing paid can be cancelled. */
  voidCharge(id: Id, reason: string): void {
    const charge = this.db.get(this.db.charges, id, 'Cargo');
    if (charge.status === 'CANCELADO') throw new Error('El cargo ya está cancelado.');
    if (paidOn(id, this.effectiveApps()) > 0)
      throw new Error('El cargo tiene pagos aplicados: cancela primero esos pagos (HU-049).');
    const updated = this.db.update(this.db.charges, id, {
      status: 'CANCELADO',
      updatedAt: nowDateTime(),
    });
    this.audit.log(
      'CANCELAR',
      'cobranza',
      'cargos',
      id,
      `Cargo cancelado: ${reason}`,
      charge,
      updated,
    );
  }

  async cancelCharge(id: Id, reason: string): Promise<void> {
    const motive = required(reason, 'El motivo');
    this.db.transaction(() => this.voidCharge(id, motive));
    await this.db.respond(null);
  }

  openCharges(playerId: Id): Promise<ChargeView[]> {
    this.syncStatuses();
    return this.db.respond(
      this.db.charges
        .filter((c) => c.playerId === playerId)
        .map((c) => this.chargeView(c))
        .filter((c) => c.balanceCents > 0)
        .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.id - b.id),
    );
  }

  /** Tutors linked to the player: the only valid payers (fk_pago_tutor_jugador). */
  payers(
    playerId: Id,
  ): Promise<{ id: Id; name: string; relationship: string; isPrimary: boolean }[]> {
    return this.db.respond(
      this.db.tutorPlayers
        .filter((tp) => tp.playerId === playerId)
        .map((tp) => ({
          id: tp.tutorId,
          name: fullName(this.db.get(this.db.tutors, tp.tutorId, 'Tutor')),
          relationship: tp.relationship,
          isPrimary: tp.isPrimary,
        }))
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)),
    );
  }

  // ── HU-045 payments ───────────────────────────────────────────────────

  /**
   * One transaction: validates payer and charges, creates pagos + pago_aplicacion (oldest due first; total or
   * partial), generates the folio and re-derives cargos.estado. Rejects ≤ 0, non-integer cents, over-payment and
   * charges of another player.
   */
  async registerPayment(draft: PaymentDraft): Promise<Payment> {
    const player = this.db.get(this.db.players, draft.playerId, 'Jugador');
    if (!METHOD_LABELS[draft.method]) throw new Error('Forma de pago inválida.');
    this.assertAmount(draft.amountCents, false);
    if (
      draft.tutorId !== null &&
      !this.db.tutorPlayers.some(
        (tp) => tp.tutorId === draft.tutorId && tp.playerId === draft.playerId,
      )
    )
      throw new Error('Quien paga debe ser tutor de ese jugador.');
    const charges = this.db.charges.filter(
      (c) =>
        c.playerId === draft.playerId &&
        c.status !== 'CANCELADO' &&
        (!draft.chargeIds || draft.chargeIds.includes(c.id)),
    );
    if (draft.chargeIds && charges.length !== new Set(draft.chargeIds).size)
      throw new Error('Algún cargo no existe, está cancelado o no pertenece al jugador.');
    const payment = this.db.transaction(() => {
      const splits = allocatePayment(
        draft.amountCents,
        charges,
        this.effectiveApps(),
        this.db.discounts,
      );
      const now = nowDateTime();
      const created = this.db.insert(this.db.payments, {
        folio: nextFolio(this.db.payments),
        playerId: draft.playerId,
        tutorId: draft.tutorId,
        paidAt: now,
        amountCents: draft.amountCents,
        method: draft.method,
        status: 'APLICADO',
        cancellationReason: null,
        recordedBy: this.audit.currentUserId(),
        createdAt: now,
      });
      for (const s of splits)
        this.db.insert<PaymentApplication>(this.db.paymentApplications, {
          paymentId: created.id,
          chargeId: s.chargeId,
          playerId: draft.playerId,
          amountCents: s.amountCents,
          createdAt: now,
        });
      this.syncStatuses(splits.map((s) => s.chargeId));
      this.audit.log(
        'CREAR',
        'pagos',
        'pagos',
        created.id,
        `Pago ${created.folio} de ${fullName(player)}`,
        null,
        { ...created, applications: splits },
      );
      return created;
    });
    return this.db.respond(payment);
  }

  /** HU-049: authorized role, reason required; keeps the payment (CANCELADO) and its applications; balances reopen. */
  async cancelPayment(id: Id, reason: string): Promise<Payment> {
    if (!this.session.user()?.permissions.includes('pagos.cancelar'))
      throw new Error('No tienes permiso para cancelar pagos.');
    const motive = required(reason, 'El motivo de cancelación');
    const before = this.db.get(this.db.payments, id, 'Pago');
    if (before.status === 'CANCELADO') throw new Error('El pago ya está cancelado.');
    const payment = this.db.transaction(() => {
      const updated = this.db.update(this.db.payments, id, {
        status: 'CANCELADO',
        cancellationReason: motive,
      });
      this.syncStatuses(
        this.db.paymentApplications.filter((a) => a.paymentId === id).map((a) => a.chargeId),
      );
      this.audit.log(
        'CANCELAR',
        'pagos',
        'pagos',
        id,
        `Pago ${before.folio} cancelado: ${motive}`,
        before,
        updated,
      );
      return updated;
    });
    return this.db.respond(payment);
  }

  // ── HU-048 receipts ───────────────────────────────────────────────────

  receipts(
    filter: { query?: string; status?: 'APLICADO' | 'CANCELADO' | ''; page?: number } = {},
  ): Promise<Page<ReceiptView>> {
    const rows = [...this.db.payments]
      .filter((p) => !filter.status || p.status === filter.status)
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt) || b.id - a.id)
      .map((p) => this.receiptView(p))
      .filter((r) => !filter.query || matches(`${r.payment.folio} ${r.playerName}`, filter.query));
    return this.db.respond(paginate(rows, filter.page));
  }

  receipt(id: Id): Promise<ReceiptView> {
    return this.db.respond(this.receiptView(this.db.get(this.db.payments, id, 'Recibo')));
  }

  /** HU-048.2: recover a receipt by folio. */
  receiptByFolio(folio: string): Promise<ReceiptView> {
    const payment = this.db.payments.find(
      (p) => p.folio.toLowerCase() === folio.trim().toLowerCase(),
    );
    if (!payment) throw new Error('No existe un recibo con ese folio.');
    return this.db.respond(this.receiptView(payment));
  }

  // ── HU-046 / HU-047 statement ─────────────────────────────────────────

  /** Charges and payments of a player, with derived balances, optionally by date range (charge date / payment day) and concept. */
  statement(
    playerId: Id,
    filter: { from?: ISODate; to?: ISODate; conceptId?: Id | null } = {},
  ): Promise<StatementView> {
    this.syncStatuses();
    const player = this.db.get(this.db.players, playerId, 'Jugador');
    const inRange = (d: ISODate) =>
      (!filter.from || d >= filter.from) && (!filter.to || d <= filter.to);
    const charges = this.db.charges
      .filter(
        (c) =>
          c.playerId === playerId &&
          inRange(c.chargedOn) &&
          (filter.conceptId == null || c.conceptId === filter.conceptId),
      )
      .map((c) => this.chargeView(c))
      .sort((a, b) => a.chargedOn.localeCompare(b.chargedOn) || a.id - b.id);
    const payments = this.db.payments
      .filter((p) => p.playerId === playerId && inRange(p.paidAt.slice(0, 10)))
      .sort((a, b) => a.paidAt.localeCompare(b.paidAt))
      .map((p) => ({
        ...p,
        applied: this.db.paymentApplications
          .filter((a) => a.paymentId === p.id)
          .map((a) => ({
            label: this.players.chargeLabel(this.db.get(this.db.charges, a.chargeId, 'Cargo')),
            amountCents: a.amountCents,
          })),
      }));
    const live = charges.filter((c) => c.status !== 'CANCELADO');
    const sum = (f: (c: ChargeView) => Cents) => live.reduce((s, c) => s + f(c), 0);
    return this.db.respond({
      playerId,
      playerName: fullName(player),
      charges,
      payments,
      totals: {
        chargedCents: sum((c) => c.originalAmountCents),
        discountCents: sum((c) => c.discountCents),
        paidCents: sum((c) => c.paidCents),
        balanceCents: sum((c) => c.balanceCents),
        overdueCents: live
          .filter((c) => c.status === 'VENCIDO')
          .reduce((s, c) => s + c.balanceCents, 0),
      },
    });
  }

  // ── HU-050 debts ──────────────────────────────────────────────────────

  /** Debts by player with primary tutor and contact; filter by charge period and current category. Cancelled charges never count. */
  debts(
    filter: { period?: string; categoryId?: Id | null; onlyOverdue?: boolean } = {},
  ): Promise<DebtView[]> {
    this.syncStatuses();
    const on = today();
    const current = new Map(
      this.db.playerCategories
        .filter((pc) => !pc.endDate)
        .map((pc) => [pc.playerId, pc.categoryId]),
    );
    const charges = this.db.charges.filter(
      (c) =>
        (!filter.period || c.period === filter.period) &&
        (!filter.categoryId || current.get(c.playerId) === filter.categoryId),
    );
    const rows = debtsByPlayer(charges, this.effectiveApps(), this.db.discounts, on)
      .filter((d) => !filter.onlyOverdue || d.overdueCents > 0)
      .map((d) => {
        const link = this.db.tutorPlayers.find((tp) => tp.playerId === d.playerId && tp.isPrimary);
        const tutor = this.db.tutors.find((t) => t.id === link?.tutorId);
        return {
          ...d,
          playerName: fullName(this.db.get(this.db.players, d.playerId, 'Jugador')),
          categoryName:
            this.db.categories.find((c) => c.id === current.get(d.playerId))?.name ?? null,
          tutorName: tutor ? fullName(tutor) : null,
          tutorContact: tutor
            ? [tutor.phone, tutor.email].filter(Boolean).join(' · ') || null
            : null,
        };
      });
    return this.db.respond(rows);
  }

  // ── HU-051 discounts / scholarships ──────────────────────────────────

  discounts(): Promise<
    (Discount & { label: string; playerName: string; authorizedByEmail: string | null })[]
  > {
    return this.db.respond(
      [...this.db.discounts]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((d) => {
          const charge = this.db.get(this.db.charges, d.chargeId, 'Cargo');
          return {
            ...d,
            label: this.players.chargeLabel(charge),
            playerName: fullName(this.db.get(this.db.players, charge.playerId, 'Jugador')),
            authorizedByEmail: this.db.users.find((u) => u.id === d.authorizedBy)?.email ?? null,
          };
        }),
    );
  }

  /**
   * Applies a discount or scholarship to one charge, keeping the original amount (monto_original) and the final one
   * (monto_final = original − ajuste). Can't exceed what is still owed, nor apply to cancelled charges.
   */
  async addDiscount(draft: {
    chargeId: Id;
    type: 'DESCUENTO' | 'BECA';
    reason: string;
    adjustmentCents: Cents;
  }): Promise<Discount> {
    if (!this.session.user()?.permissions.includes('descuentos.crear'))
      throw new Error('No tienes permiso para autorizar descuentos.');
    const reason = required(draft.reason, 'El motivo');
    this.assertAmount(draft.adjustmentCents, false);
    const charge = this.db.get(this.db.charges, draft.chargeId, 'Cargo');
    if (charge.status === 'CANCELADO')
      throw new Error('No se aplican descuentos a cargos cancelados.');
    const balance = chargeBalance(charge, this.effectiveApps(), this.db.discounts);
    if (draft.adjustmentCents > balance)
      throw new Error('El descuento no puede ser mayor al saldo pendiente.');
    const discount = this.db.transaction(() => {
      const original = netAmount(charge, this.db.discounts);
      const created = this.db.insert(this.db.discounts, {
        chargeId: charge.id,
        type: draft.type,
        reason,
        originalAmountCents: original,
        adjustmentCents: draft.adjustmentCents,
        finalAmountCents: original - draft.adjustmentCents,
        authorizedBy: this.audit.currentUserId(),
        createdAt: nowDateTime(),
      });
      this.syncStatuses([charge.id]);
      this.audit.log(
        'CREAR',
        'descuentos',
        'descuentos',
        created.id,
        `${draft.type} en ${this.players.chargeLabel(charge)}: ${reason}`,
        null,
        created,
      );
      return created;
    });
    return this.db.respond(discount);
  }

  // ── shared helpers ────────────────────────────────────────────────────

  /** Balance and status of every charge, for other modules' views (enrollments, uniforms). */
  balancesById(): Map<Id, { status: ChargeStatus; balanceCents: Cents }> {
    this.syncStatuses();
    const apps = this.effectiveApps();
    return new Map(
      this.db.charges.map((c) => [
        c.id,
        { status: c.status, balanceCents: chargeBalance(c, apps, this.db.discounts) },
      ]),
    );
  }

  /**
   * Keeps the stored cargos.estado equal to the derived one. VENCIDO depends on the date, so the API needs a
   * daily job (MariaDB EVENT) for it; here it runs before every billing read and after every write.
   */
  syncStatuses(ids?: Id[]): void {
    const apps = this.effectiveApps();
    const on = today();
    for (const c of this.db.charges) {
      if (ids && !ids.includes(c.id)) continue;
      const status = chargeStatus(c, apps, this.db.discounts, on);
      if (status !== c.status)
        this.db.update(this.db.charges, c.id, { status, updatedAt: nowDateTime() });
    }
  }

  private chargeView(c: Charge): ChargeView {
    const apps = this.effectiveApps();
    const discountCents = c.originalAmountCents - netAmount(c, this.db.discounts);
    return {
      ...c,
      label: this.players.chargeLabel(c),
      playerName: fullName(this.db.get(this.db.players, c.playerId, 'Jugador')),
      netCents: c.originalAmountCents - discountCents,
      discountCents,
      paidCents: paidOn(c.id, apps),
      balanceCents: chargeBalance(c, apps, this.db.discounts),
    };
  }

  private receiptView(payment: Payment): ReceiptView {
    const tutor = this.db.tutors.find((t) => t.id === payment.tutorId);
    return {
      payment,
      playerName: fullName(this.db.get(this.db.players, payment.playerId, 'Jugador')),
      tutorName: tutor ? fullName(tutor) : null,
      recordedBy: this.db.users.find((u) => u.id === payment.recordedBy)?.email ?? null,
      lines: this.db.paymentApplications
        .filter((a) => a.paymentId === payment.id)
        .map((a) => ({
          label: this.players.chargeLabel(this.db.get(this.db.charges, a.chargeId, 'Cargo')),
          amountCents: a.amountCents,
        })),
    };
  }

  private eligibleForMonthly() {
    const season = this.db.seasons.find((s) => s.isCurrent);
    const enrolled = new Set(
      this.db.enrollments
        .filter((e) => e.seasonId === season?.id && e.status === 'ACTIVA')
        .map((e) => e.playerId),
    );
    return this.db.players
      .filter((p) => p.status === 'ACTIVO' && enrolled.has(p.id))
      .sort((a, b) => fullName(a).localeCompare(fullName(b)));
  }

  private effectiveApps(): PaymentApplication[] {
    return effectiveApplications(this.db.payments, this.db.paymentApplications);
  }

  private assertAmount(cents: Cents, allowZero: boolean): void {
    assertCents(cents);
    if (cents < 0 || (!allowZero && cents === 0))
      throw new Error('El importe debe ser mayor a cero.');
    if (cents > MAX_CENTS) throw new Error('El importe excede el máximo permitido.');
  }
}

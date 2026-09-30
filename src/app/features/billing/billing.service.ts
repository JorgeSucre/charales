import { Injectable, inject } from '@angular/core';
import { MockDb } from '../../core/data/mock-db';
import {
  Charge,
  ChargeConcept,
  Payment,
  PaymentApplication,
  PaymentDraft,
} from '../../core/models';
import { today } from '../../shared/dates';
import {
  allocatePayment,
  chargeBalance,
  debtsByPlayer,
  effectiveApplications,
  generateMonthlyCharges,
} from './billing.rules';

export interface ReceiptView {
  payment: Payment;
  playerName: string;
  lines: { description: string; amountCents: number }[];
}

export interface OpenCharge {
  charge: Charge;
  balanceCents: number;
}

export interface DebtView {
  playerId: string;
  playerName: string;
  balanceCents: number;
  openCharges: number;
  oldestDueDate: string;
}

@Injectable({ providedIn: 'root' })
export class BillingService {
  private db = inject(MockDb);

  // HU-043
  concepts(): Promise<ChargeConcept[]> {
    return this.db.respond(this.db.concepts);
  }

  async saveConcept(draft: Omit<ChargeConcept, 'id'> & { id?: string }): Promise<ChargeConcept> {
    if (!Number.isInteger(draft.defaultAmountCents) || draft.defaultAmountCents < 0)
      throw new Error('Monto inválido.');
    const concept: ChargeConcept = { ...draft, id: draft.id ?? this.db.id('cc') };
    this.db.concepts = draft.id
      ? this.db.concepts.map((c) => (c.id === concept.id ? concept : c))
      : [...this.db.concepts, concept];
    return this.db.respond(concept);
  }

  // HU-044: active players with an active enrollment in the active season.
  async generateMonthlyFees(conceptId: string, period: string, dueDate: string): Promise<number> {
    const concept = this.db.concepts.find((c) => c.id === conceptId && c.active);
    if (!concept) throw new Error('Concepto no encontrado o inactivo.');
    const season = this.db.seasons.find((s) => s.active);
    const activePlayers = new Set(this.db.players.filter((p) => p.active).map((p) => p.id));
    const playerIds = this.db.enrollments
      .filter(
        (e) => e.seasonId === season?.id && e.status === 'active' && activePlayers.has(e.playerId),
      )
      .map((e) => e.playerId);
    const created = generateMonthlyCharges(
      playerIds,
      concept,
      period,
      dueDate,
      this.db.charges,
      () => this.db.id('ch'),
    );
    this.db.charges = [...this.db.charges, ...created];
    return this.db.respond(created.length);
  }

  /** Used by other modules (e.g. uniforms, HU-054) to create a charge. */
  async createCharge(draft: Omit<Charge, 'id'>): Promise<Charge> {
    const charge = { ...draft, id: this.db.id('ch') };
    this.db.charges = [...this.db.charges, charge];
    return this.db.respond(charge);
  }

  /** Charges of a player that still have a balance, oldest due first. Feeds the payment capture UI. */
  openCharges(playerId: string): Promise<OpenCharge[]> {
    const apps = this.effectiveApps();
    return this.db.respond(
      this.db.charges
        .filter((c) => c.playerId === playerId)
        .map((charge) => ({ charge, balanceCents: chargeBalance(charge, apps) }))
        .filter((c) => c.balanceCents > 0)
        .sort((a, b) => a.charge.dueDate.localeCompare(b.charge.dueDate)),
    );
  }

  /**
   * SHARED CONTRACT for the payment-capture story (owned by another team member).
   * Creates one Payment and splits it over one or more charges (PaymentApplication), oldest due first.
   * Rejects: amount <= 0 or not integer cents, amount > open balance, charges of another player.
   * The backend must repeat these checks, run it in one transaction and assign receiptNumber.
   */
  async registerPayment(draft: PaymentDraft): Promise<Payment> {
    const { playerId, amountCents, method, chargeIds } = draft;
    const charges = this.db.charges.filter(
      (c) => c.playerId === playerId && (!chargeIds || chargeIds.includes(c.id)),
    );
    if (chargeIds && charges.length !== chargeIds.length) {
      throw new Error('Algún cargo no existe o no pertenece al jugador.');
    }
    const id = this.db.id('pay');
    const apps = allocatePayment(id, amountCents, charges, this.effectiveApps());
    const payment: Payment = {
      id,
      receiptNumber: `R-${String(this.db.payments.length + 1).padStart(4, '0')}`,
      playerId,
      amountCents,
      method,
      paidAt: today(),
    };
    this.db.payments = [...this.db.payments, payment];
    this.db.paymentApplications = [...this.db.paymentApplications, ...apps];
    return this.db.respond(payment);
  }

  // HU-048
  receipts(): Promise<ReceiptView[]> {
    return this.db.respond(
      [...this.db.payments]
        .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
        .map((p) => this.receiptView(p)),
    );
  }

  async receipt(paymentId: string): Promise<ReceiptView> {
    const payment = this.db.payments.find((p) => p.id === paymentId);
    if (!payment) throw new Error('Recibo no encontrado.');
    return this.db.respond(this.receiptView(payment));
  }

  // HU-050
  debts(): Promise<DebtView[]> {
    return this.db.respond(
      debtsByPlayer(this.db.charges, this.effectiveApps()).map((d) => ({
        ...d,
        playerName: this.playerName(d.playerId),
      })),
    );
  }

  private receiptView(payment: Payment): ReceiptView {
    return {
      payment,
      playerName: this.playerName(payment.playerId),
      lines: this.db.paymentApplications
        .filter((a) => a.paymentId === payment.id)
        .map((a) => ({
          description: this.db.charges.find((c) => c.id === a.chargeId)?.description ?? '—',
          amountCents: a.amountCents,
        })),
    };
  }

  private effectiveApps(): PaymentApplication[] {
    return effectiveApplications(this.db.payments, this.db.paymentApplications);
  }

  private playerName(id: string): string {
    return this.db.players.find((p) => p.id === id)?.fullName ?? '—';
  }
}

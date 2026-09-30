import { Injectable, inject } from '@angular/core';
import { MockDb } from '../../core/data/mock-db';
import { Charge, ChargeConcept, Payment, PaymentMethod } from '../../core/models';
import { allocatePayment, debtsByPlayer, generateMonthlyCharges } from './billing.rules';

export interface ReceiptView {
  payment: Payment;
  playerName: string;
  lines: { description: string; amountCents: number }[];
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

  /**
   * Payment capture UI belongs to another team member; this is the shared contract.
   * The backend must do this atomically.
   */
  async registerPayment(
    playerId: string,
    amountCents: number,
    method: PaymentMethod,
  ): Promise<Payment> {
    const id = this.db.id('pay');
    const charges = this.db.charges.filter((c) => c.playerId === playerId);
    const apps = allocatePayment(id, amountCents, charges, this.db.paymentApplications);
    const payment: Payment = {
      id,
      receiptNumber: `R-${String(this.db.payments.length + 1).padStart(4, '0')}`,
      playerId,
      amountCents,
      method,
      paidAt: new Date().toISOString().slice(0, 10),
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
      debtsByPlayer(this.db.charges, this.db.paymentApplications).map((d) => ({
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

  private playerName(id: string): string {
    return this.db.players.find((p) => p.id === id)?.fullName ?? '—';
  }
}

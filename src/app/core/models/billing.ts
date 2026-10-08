import { Cents, DateTime, Id, ISODate } from './common';

/**
 * Billing contracts (amounts in integer cents; DECIMAL(12,2) in MariaDB).
 * Charge (what is owed) and Payment (money received) are separate; PaymentApplication links them.
 * The balance is derived — original − discounts − applications of non-cancelled payments —
 * and the stored cargos.estado is kept in sync with it (billing.rules.ts).
 */

/**
 * conceptos_cobro. MariaDB has no "kind" (monthly/enrollment/uniform): `recurring` marks the concepts that monthly
 * generation can use, and every other flow lets the user pick the concept to charge.
 */
export interface ChargeConcept {
  id: Id;
  name: string;
  suggestedAmountCents: Cents;
  recurring: boolean;
  active: boolean;
  createdAt: DateTime;
}

export type ChargeStatus = 'PENDIENTE' | 'PARCIAL' | 'PAGADO' | 'VENCIDO' | 'CANCELADO';

/** cargos. period 'YYYY-MM' is unique per player+concept (uq_cargo_periodo_concepto). */
export interface Charge {
  id: Id;
  playerId: Id;
  conceptId: Id;
  seasonId: Id | null;
  period: string | null;
  chargedOn: ISODate;
  dueDate: ISODate | null;
  originalAmountCents: Cents;
  status: ChargeStatus;
  /** Free reference, e.g. 'INS-12' for an enrollment fee or 'PED-3' for a uniform order. */
  reference: string | null;
  createdAt: DateTime;
  updatedAt: DateTime;
}

export type PaymentMethod = 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA' | 'OTRO';
export type PaymentStatus = 'APLICADO' | 'CANCELADO';

/** pagos. Never deleted; cancelling keeps the row and its applications (HU-049). */
export interface Payment {
  id: Id;
  folio: string;
  playerId: Id;
  /** Who paid; must be a tutor of THIS player (fk_pago_tutor_jugador). */
  tutorId: Id | null;
  paidAt: DateTime;
  amountCents: Cents;
  method: PaymentMethod;
  status: PaymentStatus;
  cancellationReason: string | null;
  recordedBy: Id | null;
  createdAt: DateTime;
}

/** pago_aplicacion. Payment and charge belong to the same player (composite FKs). */
export interface PaymentApplication {
  id: Id;
  paymentId: Id;
  chargeId: Id;
  playerId: Id;
  amountCents: Cents;
  createdAt: DateTime;
}

/** descuentos (HU-051). finalAmountCents is a generated column: original − adjustment. */
export interface Discount {
  id: Id;
  chargeId: Id;
  type: 'DESCUENTO' | 'BECA';
  reason: string;
  originalAmountCents: Cents;
  adjustmentCents: Cents;
  finalAmountCents: Cents;
  authorizedBy: Id | null;
  createdAt: DateTime;
}

/** Input of BillingService.registerPayment (HU-045). The server assigns id, folio, recordedBy and createdAt. */
export interface PaymentDraft {
  playerId: Id;
  tutorId: Id | null;
  amountCents: Cents;
  method: PaymentMethod;
  /** Charges to pay, oldest due first. Omitted = all of the player's open charges. */
  chargeIds?: Id[];
  /**
   * HU-045.1: date/time the money was received (pagos.fecha_pago). Omitted = now. Never in the future;
   * creado_en keeps the capture moment, so back-dated payments stay traceable.
   */
  paidAt?: DateTime;
}

/**
 * Billing contracts. Amounts are integer cents.
 * Charge (what is owed) and Payment (money received) are separate; PaymentApplication links them.
 * Balances are always derived from these, never stored.
 */

export type ConceptKind = 'monthly' | 'enrollment' | 'uniform' | 'other';

export interface ChargeConcept {
  id: string;
  name: string;
  kind: ConceptKind;
  defaultAmountCents: number;
  active: boolean;
}

export interface Charge {
  id: string;
  playerId: string;
  conceptId: string;
  amountCents: number;
  description: string;
  dueDate: string;
  /** 'YYYY-MM' for monthly fees; used to avoid duplicates. */
  period?: string;
  /** Origin document, e.g. a uniform order (HU-054). */
  source?: { type: 'uniform-order'; id: string };
}

export type PaymentMethod = 'cash' | 'transfer' | 'card';

export interface Payment {
  id: string;
  receiptNumber: string;
  playerId: string;
  amountCents: number;
  method: PaymentMethod;
  paidAt: string;
}

export interface PaymentApplication {
  paymentId: string;
  chargeId: string;
  amountCents: number;
}

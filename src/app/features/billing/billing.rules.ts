import { Charge, ChargeConcept, Payment, PaymentApplication } from '../../core/models';

/**
 * Pure billing rules (no Angular, no I/O). The backend must enforce the same rules;
 * keeping them here makes the UI demo-able and testable meanwhile.
 */

export function appliedTo(chargeId: string, apps: PaymentApplication[]): number {
  return apps.filter((a) => a.chargeId === chargeId).reduce((sum, a) => sum + a.amountCents, 0);
}

export function chargeBalance(charge: Charge, apps: PaymentApplication[]): number {
  return charge.amountCents - appliedTo(charge.id, apps);
}

/** Monthly fees for the given players; idempotent (skips players already charged for concept+period). */
export function generateMonthlyCharges(
  playerIds: string[],
  concept: ChargeConcept,
  period: string,
  dueDate: string,
  existing: Charge[],
  newId: () => string,
): Charge[] {
  const charged = new Set(
    existing
      .filter((c) => c.conceptId === concept.id && c.period === period)
      .map((c) => c.playerId),
  );
  return playerIds
    .filter((id) => !charged.has(id))
    .map((playerId) => ({
      id: newId(),
      playerId,
      conceptId: concept.id,
      amountCents: concept.defaultAmountCents,
      description: `${concept.name} ${period}`,
      dueDate,
      period,
    }));
}

/** Applies a payment to open charges, oldest due date first. Overpayment is rejected (no credit balances yet). */
export function allocatePayment(
  paymentId: string,
  amountCents: number,
  charges: Charge[],
  apps: PaymentApplication[],
): PaymentApplication[] {
  if (!Number.isInteger(amountCents) || amountCents <= 0)
    throw new Error('El monto debe ser mayor a cero.');
  const open = charges
    .map((charge) => ({ charge, balance: chargeBalance(charge, apps) }))
    .filter((c) => c.balance > 0)
    .sort((a, b) => a.charge.dueDate.localeCompare(b.charge.dueDate));
  const due = open.reduce((sum, c) => sum + c.balance, 0);
  if (amountCents > due) throw new Error('El pago excede el adeudo.');

  let left = amountCents;
  const result: PaymentApplication[] = [];
  for (const { charge, balance } of open) {
    if (left === 0) break;
    const applied = Math.min(left, balance);
    result.push({ paymentId, chargeId: charge.id, amountCents: applied });
    left -= applied;
  }
  return result;
}

export interface DebtRow {
  playerId: string;
  balanceCents: number;
  openCharges: number;
  oldestDueDate: string;
}

export function debtsByPlayer(charges: Charge[], apps: PaymentApplication[]): DebtRow[] {
  const rows = new Map<string, DebtRow>();
  for (const charge of charges) {
    const balance = chargeBalance(charge, apps);
    if (balance <= 0) continue;
    const row = rows.get(charge.playerId) ?? {
      playerId: charge.playerId,
      balanceCents: 0,
      openCharges: 0,
      oldestDueDate: charge.dueDate,
    };
    row.balanceCents += balance;
    row.openCharges++;
    if (charge.dueDate < row.oldestDueDate) row.oldestDueDate = charge.dueDate;
    rows.set(charge.playerId, row);
  }
  return [...rows.values()].sort((a, b) => b.balanceCents - a.balanceCents);
}

export interface IncomeRow {
  month: string; // YYYY-MM
  conceptId: string;
  totalCents: number;
}

/** Income received between from..to (inclusive ISO dates), grouped by month and concept. */
export function incomeByMonthAndConcept(
  payments: Payment[],
  apps: PaymentApplication[],
  charges: Charge[],
  from: string,
  to: string,
): IncomeRow[] {
  const paidAt = new Map(
    payments.filter((p) => p.paidAt >= from && p.paidAt <= to).map((p) => [p.id, p.paidAt]),
  );
  const conceptOf = new Map(charges.map((c) => [c.id, c.conceptId]));
  const rows = new Map<string, IncomeRow>();
  for (const app of apps) {
    const date = paidAt.get(app.paymentId);
    const conceptId = conceptOf.get(app.chargeId);
    if (!date || !conceptId) continue;
    const month = date.slice(0, 7);
    const key = `${month}|${conceptId}`;
    const row = rows.get(key) ?? { month, conceptId, totalCents: 0 };
    row.totalCents += app.amountCents;
    rows.set(key, row);
  }
  return [...rows.values()].sort(
    (a, b) => a.month.localeCompare(b.month) || a.conceptId.localeCompare(b.conceptId),
  );
}

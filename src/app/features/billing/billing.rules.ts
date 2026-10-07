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
} from '../../core/models';
import { assertCents, sumCents } from '../../shared/money';

/**
 * Pure billing rules (no Angular, no I/O). All amounts are integer cents. The API must enforce the same rules
 * inside one transaction; MariaDB backs them with CHECKs and composite FKs.
 *
 *   balance = original − Σ discount adjustments − Σ applications of non-cancelled payments
 */

/** Applications of CANCELADO payments don't count toward balances or income (they stay as history). */
export function effectiveApplications(
  payments: Payment[],
  apps: PaymentApplication[],
): PaymentApplication[] {
  const cancelled = new Set(payments.filter((p) => p.status === 'CANCELADO').map((p) => p.id));
  return apps.filter((a) => !cancelled.has(a.paymentId));
}

/** Pass effectiveApplications(...) as `apps`. */
export function paidOn(chargeId: Id, apps: PaymentApplication[]): Cents {
  return sumCents(apps.filter((a) => a.chargeId === chargeId).map((a) => a.amountCents));
}

export function discountOn(chargeId: Id, discounts: Discount[]): Cents {
  return sumCents(discounts.filter((d) => d.chargeId === chargeId).map((d) => d.adjustmentCents));
}

/** What is really owed after discounts/scholarships (never below 0: CHECK monto_ajuste <= monto_original). */
export function netAmount(charge: Charge, discounts: Discount[]): Cents {
  return charge.originalAmountCents - discountOn(charge.id, discounts);
}

export function chargeBalance(
  charge: Charge,
  apps: PaymentApplication[],
  discounts: Discount[],
): Cents {
  if (charge.status === 'CANCELADO') return 0;
  return netAmount(charge, discounts) - paidOn(charge.id, apps);
}

export function isOverdue(charge: Charge, balance: Cents, today: ISODate): boolean {
  return balance > 0 && !!charge.dueDate && charge.dueDate < today;
}

/**
 * cargos.estado derived from the amounts (HU-044.3). CANCELADO is final. Overdue wins over partial,
 * because collections care about the due date first; `paid > 0` still tells partial from untouched.
 */
export function chargeStatus(
  charge: Charge,
  apps: PaymentApplication[],
  discounts: Discount[],
  today: ISODate,
): ChargeStatus {
  if (charge.status === 'CANCELADO') return 'CANCELADO';
  const balance = chargeBalance(charge, apps, discounts);
  if (balance <= 0) return 'PAGADO';
  if (isOverdue(charge, balance, today)) return 'VENCIDO';
  return paidOn(charge.id, apps) > 0 ? 'PARCIAL' : 'PENDIENTE';
}

export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export type ChargeDraft = Omit<Charge, 'id' | 'createdAt' | 'updatedAt'>;

/** Monthly fees (HU-044); idempotent: skips players already charged for concept+period (uq_cargo_periodo_concepto). */
export function generateMonthlyCharges(
  playerIds: Id[],
  concept: ChargeConcept,
  period: string,
  dueDate: ISODate,
  chargedOn: ISODate,
  seasonId: Id | null,
  existing: Charge[],
): ChargeDraft[] {
  if (!PERIOD_PATTERN.test(period)) throw new Error('El periodo debe tener formato AAAA-MM.');
  if (!concept.recurring) throw new Error('Las mensualidades usan un concepto recurrente.');
  const charged = new Set(
    existing
      .filter((c) => c.conceptId === concept.id && c.period === period)
      .map((c) => c.playerId),
  );
  return [...new Set(playerIds)]
    .filter((id) => !charged.has(id))
    .map((playerId) => ({
      playerId,
      conceptId: concept.id,
      seasonId,
      period,
      chargedOn,
      dueDate,
      originalAmountCents: concept.suggestedAmountCents,
      status: 'PENDIENTE',
      reference: null,
    }));
}

/**
 * Splits a payment over open charges, oldest due date first (charges without due date last). Total or partial
 * payments are fine; paying more than is owed is rejected (no credit balances in the model).
 */
export function allocatePayment(
  amountCents: Cents,
  charges: Charge[],
  apps: PaymentApplication[],
  discounts: Discount[],
): { chargeId: Id; amountCents: Cents }[] {
  assertCents(amountCents);
  if (amountCents <= 0) throw new Error('El importe debe ser mayor a cero.');
  const open = charges
    .map((charge) => ({ charge, balance: chargeBalance(charge, apps, discounts) }))
    .filter((c) => c.balance > 0)
    .sort(
      (a, b) =>
        (a.charge.dueDate ?? '9999').localeCompare(b.charge.dueDate ?? '9999') ||
        a.charge.id - b.charge.id,
    );
  const due = sumCents(open.map((c) => c.balance));
  if (!open.length) throw new Error('No hay cargos pendientes por pagar.');
  if (amountCents > due) throw new Error('El pago excede el adeudo.');

  let left = amountCents;
  const result: { chargeId: Id; amountCents: Cents }[] = [];
  for (const { charge, balance } of open) {
    if (left === 0) break;
    const applied = Math.min(left, balance);
    result.push({ chargeId: charge.id, amountCents: applied });
    left -= applied;
  }
  return result;
}

export interface DebtRow {
  playerId: Id;
  balanceCents: Cents;
  overdueCents: Cents;
  openCharges: number;
  oldestDueDate: ISODate | null;
}

/** Debts per player (HU-050). Cancelled charges never count; sorted by overdue amount. */
export function debtsByPlayer(
  charges: Charge[],
  apps: PaymentApplication[],
  discounts: Discount[],
  today: ISODate,
): DebtRow[] {
  const rows = new Map<Id, DebtRow>();
  for (const charge of charges) {
    const balance = chargeBalance(charge, apps, discounts);
    if (balance <= 0) continue;
    const row = rows.get(charge.playerId) ?? {
      playerId: charge.playerId,
      balanceCents: 0,
      overdueCents: 0,
      openCharges: 0,
      oldestDueDate: null,
    };
    row.balanceCents += balance;
    if (isOverdue(charge, balance, today)) row.overdueCents += balance;
    row.openCharges++;
    if (charge.dueDate && (!row.oldestDueDate || charge.dueDate < row.oldestDueDate))
      row.oldestDueDate = charge.dueDate;
    rows.set(charge.playerId, row);
  }
  return [...rows.values()].sort(
    (a, b) => b.overdueCents - a.overdueCents || b.balanceCents - a.balanceCents,
  );
}

export interface IncomeRow {
  month: string; // YYYY-MM
  conceptId: Id;
  totalCents: Cents;
}

/** Income received between from..to (inclusive DATEs, compared with the payment's calendar day), by month and concept (HU-067). */
export function incomeByMonthAndConcept(
  payments: Payment[],
  apps: PaymentApplication[],
  charges: Charge[],
  from: ISODate,
  to: ISODate,
): IncomeRow[] {
  const paidOnDay = new Map(
    payments
      .filter(
        (p) =>
          p.status === 'APLICADO' && p.paidAt.slice(0, 10) >= from && p.paidAt.slice(0, 10) <= to,
      )
      .map((p) => [p.id, p.paidAt.slice(0, 10)]),
  );
  const conceptOf = new Map(charges.map((c) => [c.id, c.conceptId]));
  const rows = new Map<string, IncomeRow>();
  for (const app of apps) {
    const date = paidOnDay.get(app.paymentId);
    const conceptId = conceptOf.get(app.chargeId);
    if (!date || conceptId === undefined) continue;
    const month = date.slice(0, 7);
    const key = `${month}|${conceptId}`;
    const row = rows.get(key) ?? { month, conceptId, totalCents: 0 };
    row.totalCents += app.amountCents;
    rows.set(key, row);
  }
  return [...rows.values()].sort(
    (a, b) => a.month.localeCompare(b.month) || a.conceptId - b.conceptId,
  );
}

/** Next folio 'R-0001' … (pagos.folio is UNIQUE; the API generates it inside the payment transaction). */
export function nextFolio(payments: Payment[]): string {
  const max = payments.reduce((m, p) => Math.max(m, Number(p.folio.replace(/\D/g, '')) || 0), 0);
  return `R-${String(max + 1).padStart(4, '0')}`;
}

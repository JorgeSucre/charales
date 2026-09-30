import { Charge, ChargeConcept, Payment, PaymentApplication } from '../../core/models';
import {
  allocatePayment,
  chargeBalance,
  debtsByPlayer,
  effectiveApplications,
  generateMonthlyCharges,
  incomeByMonthAndConcept,
} from './billing.rules';

const monthly: ChargeConcept = {
  id: 'cc1',
  name: 'Mensualidad',
  kind: 'monthly',
  defaultAmountCents: 60000,
  active: true,
};
const charge = (
  id: string,
  playerId: string,
  amountCents: number,
  dueDate: string,
  conceptId = 'cc1',
): Charge => ({
  id,
  playerId,
  conceptId,
  amountCents,
  dueDate,
  description: id,
});

describe('billing rules', () => {
  it('generates monthly fees once per player and period', () => {
    let n = 0;
    const newId = () => `x${++n}`;
    const first = generateMonthlyCharges(['p1', 'p2'], monthly, '2026-10', '2026-10-10', [], newId);
    expect(first.map((c) => c.playerId)).toEqual(['p1', 'p2']);
    expect(first[0]).toMatchObject({ amountCents: 60000, period: '2026-10', conceptId: 'cc1' });
    expect(
      generateMonthlyCharges(
        ['p1', 'p2', 'p3'],
        monthly,
        '2026-10',
        '2026-10-10',
        first,
        newId,
      ).map((c) => c.playerId),
    ).toEqual(['p3']);
  });

  it('applies a partial payment to the oldest charge first and keeps the balance', () => {
    const charges = [
      charge('new', 'p1', 60000, '2026-10-10'),
      charge('old', 'p1', 60000, '2026-09-10'),
    ];
    const apps = allocatePayment('pay', 90000, charges, []);
    expect(apps).toEqual([
      { paymentId: 'pay', chargeId: 'old', amountCents: 60000 },
      { paymentId: 'pay', chargeId: 'new', amountCents: 30000 },
    ]);
    expect(chargeBalance(charges[0], apps)).toBe(30000);
    expect(chargeBalance(charges[1], apps)).toBe(0);
  });

  it('rejects zero, fractional and over-payments', () => {
    const charges = [charge('c', 'p1', 1000, '2026-09-10')];
    expect(() => allocatePayment('p', 0, charges, [])).toThrow();
    expect(() => allocatePayment('p', 10.5, charges, [])).toThrow();
    expect(() => allocatePayment('p', 1001, charges, [])).toThrow();
  });

  it('lists debts per player with derived balances', () => {
    const charges = [
      charge('a', 'p1', 1000, '2026-09-01'),
      charge('b', 'p1', 500, '2026-08-01'),
      charge('c', 'p2', 700, '2026-09-01'),
    ];
    const apps: PaymentApplication[] = [
      { paymentId: 'x', chargeId: 'c', amountCents: 700 },
      { paymentId: 'y', chargeId: 'a', amountCents: 200 },
    ];
    expect(debtsByPlayer(charges, apps)).toEqual([
      { playerId: 'p1', balanceCents: 1300, openCharges: 2, oldestDueDate: '2026-08-01' },
    ]);
  });

  it('ignores applications of cancelled payments for balances and income', () => {
    const charges = [charge('c', 'p1', 1000, '2026-09-01')];
    const payments: Payment[] = [
      {
        id: 'ok',
        receiptNumber: 'R1',
        playerId: 'p1',
        amountCents: 300,
        method: 'cash',
        paidAt: '2026-09-02',
      },
      {
        id: 'void',
        receiptNumber: 'R2',
        playerId: 'p1',
        amountCents: 700,
        method: 'cash',
        paidAt: '2026-09-03',
        cancelledAt: '2026-09-04',
      },
    ];
    const apps: PaymentApplication[] = [
      { paymentId: 'ok', chargeId: 'c', amountCents: 300 },
      { paymentId: 'void', chargeId: 'c', amountCents: 700 },
    ];
    const effective = effectiveApplications(payments, apps);
    expect(chargeBalance(charges[0], effective)).toBe(700);
    expect(allocatePayment('new', 700, charges, effective)).toHaveLength(1);
    expect(incomeByMonthAndConcept(payments, apps, charges, '2026-09-01', '2026-09-30')).toEqual([
      { month: '2026-09', conceptId: 'cc1', totalCents: 300 },
    ]);
  });

  it('reports income by month and concept within the range', () => {
    const charges = [
      charge('m', 'p1', 1000, '2026-09-01', 'cc1'),
      charge('u', 'p1', 500, '2026-09-01', 'cc3'),
    ];
    const payments: Payment[] = [
      {
        id: 'pa',
        receiptNumber: 'R1',
        playerId: 'p1',
        amountCents: 1200,
        method: 'cash',
        paidAt: '2026-09-05',
      },
      {
        id: 'pb',
        receiptNumber: 'R2',
        playerId: 'p1',
        amountCents: 300,
        method: 'cash',
        paidAt: '2026-11-01',
      },
    ];
    const apps: PaymentApplication[] = [
      { paymentId: 'pa', chargeId: 'm', amountCents: 1000 },
      { paymentId: 'pa', chargeId: 'u', amountCents: 200 },
      { paymentId: 'pb', chargeId: 'u', amountCents: 300 },
    ];
    expect(incomeByMonthAndConcept(payments, apps, charges, '2026-09-01', '2026-09-30')).toEqual([
      { month: '2026-09', conceptId: 'cc1', totalCents: 1000 },
      { month: '2026-09', conceptId: 'cc3', totalCents: 200 },
    ]);
  });
});

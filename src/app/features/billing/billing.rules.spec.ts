import { Charge, ChargeConcept, Discount, Payment, PaymentApplication } from '../../core/models';
import {
  allocatePayment,
  chargeBalance,
  chargeStatus,
  debtsByPlayer,
  effectiveApplications,
  generateMonthlyCharges,
  incomeByMonthAndConcept,
  nextFolio,
} from './billing.rules';

const T = '2026-09-01T00:00:00';
const monthly: ChargeConcept = {
  id: 1,
  name: 'Mensualidad',
  suggestedAmountCents: 60000,
  recurring: true,
  active: true,
  createdAt: T,
};
const charge = (
  id: number,
  playerId: number,
  cents: number,
  dueDate: string | null,
  conceptId = 1,
): Charge => ({
  id,
  playerId,
  conceptId,
  seasonId: null,
  period: null,
  chargedOn: '2026-09-01',
  dueDate,
  originalAmountCents: cents,
  status: 'PENDIENTE',
  reference: null,
  createdAt: T,
  updatedAt: T,
});
const payment = (
  id: number,
  cents: number,
  paidAt: string,
  status: Payment['status'] = 'APLICADO',
): Payment => ({
  id,
  folio: `R-${id}`,
  playerId: 1,
  tutorId: null,
  paidAt,
  amountCents: cents,
  method: 'EFECTIVO',
  status,
  cancellationReason: status === 'CANCELADO' ? 'x' : null,
  recordedBy: null,
  createdAt: paidAt,
});
const app = (paymentId: number, chargeId: number, cents: number): PaymentApplication => ({
  id: 0,
  paymentId,
  chargeId,
  playerId: 1,
  amountCents: cents,
  createdAt: T,
});

describe('billing rules', () => {
  it('generates monthly fees once per player/concept/period and only with recurring concepts (HU-044)', () => {
    const first = generateMonthlyCharges(
      [1, 2, 2],
      monthly,
      '2026-10',
      '2026-10-10',
      '2026-10-01',
      2,
      [],
    );
    expect(first.map((c) => c.playerId)).toEqual([1, 2]);
    expect(first[0]).toMatchObject({
      originalAmountCents: 60000,
      period: '2026-10',
      seasonId: 2,
      status: 'PENDIENTE',
    });
    const existing = first.map((c, i) => ({ ...c, id: i + 1, createdAt: T, updatedAt: T }));
    expect(
      generateMonthlyCharges(
        [1, 2, 3],
        monthly,
        '2026-10',
        '2026-10-10',
        '2026-10-01',
        2,
        existing,
      ).map((c) => c.playerId),
    ).toEqual([3]);
    expect(() =>
      generateMonthlyCharges([1], monthly, '2026-13', '2026-10-10', '2026-10-01', 2, []),
    ).toThrow();
    expect(() =>
      generateMonthlyCharges(
        [1],
        { ...monthly, recurring: false },
        '2026-10',
        '2026-10-10',
        '2026-10-01',
        2,
        [],
      ),
    ).toThrow();
  });

  it('applies a partial payment to the oldest due charge first (HU-045.2)', () => {
    const charges = [
      charge(2, 1, 60000, '2026-10-10'),
      charge(1, 1, 60000, '2026-09-10'),
      charge(3, 1, 1000, null),
    ];
    expect(allocatePayment(90000, charges, [], [])).toEqual([
      { chargeId: 1, amountCents: 60000 },
      { chargeId: 2, amountCents: 30000 },
    ]);
  });

  it('rejects zero, fractional cents, overpayment and paying when nothing is owed', () => {
    const charges = [charge(1, 1, 1000, '2026-09-10')];
    expect(() => allocatePayment(0, charges, [], [])).toThrow();
    expect(() => allocatePayment(10.5, charges, [], [])).toThrow();
    expect(() => allocatePayment(1001, charges, [], [])).toThrow('excede');
    expect(() => allocatePayment(100, [], [], [])).toThrow('No hay cargos');
  });

  it('balance = original − discounts − non-cancelled applications; status derived from it (HU-044.3, HU-051)', () => {
    const c = charge(1, 1, 60000, '2026-09-10');
    const discounts: Discount[] = [
      {
        id: 1,
        chargeId: 1,
        type: 'BECA',
        reason: 'x',
        originalAmountCents: 60000,
        adjustmentCents: 30000,
        finalAmountCents: 30000,
        authorizedBy: 1,
        createdAt: T,
      },
    ];
    expect(chargeBalance(c, [], discounts)).toBe(30000);
    expect(chargeStatus(c, [], discounts, '2026-09-01')).toBe('PENDIENTE');
    expect(chargeStatus(c, [app(1, 1, 10000)], discounts, '2026-09-01')).toBe('PARCIAL');
    expect(chargeStatus(c, [app(1, 1, 10000)], discounts, '2026-09-11')).toBe('VENCIDO');
    expect(chargeStatus(c, [app(1, 1, 30000)], discounts, '2026-09-11')).toBe('PAGADO');
    expect(chargeStatus({ ...c, status: 'CANCELADO' }, [], [], '2026-09-11')).toBe('CANCELADO');
    expect(chargeBalance({ ...c, status: 'CANCELADO' }, [], [])).toBe(0);
  });

  it('cancelled payments stop counting for balances and income, but stay as history (HU-049, HU-067.3)', () => {
    const charges = [charge(1, 1, 1000, '2026-09-01')];
    const payments = [
      payment(1, 300, '2026-09-02T10:00:00'),
      payment(2, 700, '2026-09-03T10:00:00', 'CANCELADO'),
    ];
    const apps = [app(1, 1, 300), app(2, 1, 700)];
    const effective = effectiveApplications(payments, apps);
    expect(effective).toHaveLength(1);
    expect(chargeBalance(charges[0], effective, [])).toBe(700);
    expect(incomeByMonthAndConcept(payments, apps, charges, '2026-09-01', '2026-09-30')).toEqual([
      { month: '2026-09', conceptId: 1, totalCents: 300 },
    ]);
  });

  it('income compares the calendar day of DATETIME paid_at (inclusive range) and groups by concept', () => {
    const charges = [charge(1, 1, 1000, null, 1), charge(2, 1, 500, null, 3)];
    const payments = [
      payment(1, 1200, '2026-09-30T23:59:00'),
      payment(2, 300, '2026-10-01T00:00:00'),
    ];
    const apps = [app(1, 1, 1000), app(1, 2, 200), app(2, 2, 300)];
    expect(incomeByMonthAndConcept(payments, apps, charges, '2026-09-01', '2026-09-30')).toEqual([
      { month: '2026-09', conceptId: 1, totalCents: 1000 },
      { month: '2026-09', conceptId: 3, totalCents: 200 },
    ]);
  });

  it('debts by player separate overdue from total balance and skip cancelled charges (HU-050)', () => {
    const charges = [
      charge(1, 1, 1000, '2026-09-01'),
      charge(2, 1, 500, '2026-12-01'),
      { ...charge(3, 2, 700, '2026-08-01'), status: 'CANCELADO' as const },
    ];
    expect(debtsByPlayer(charges, [app(1, 1, 200)], [], '2026-10-07')).toEqual([
      {
        playerId: 1,
        balanceCents: 1300,
        overdueCents: 800,
        openCharges: 2,
        oldestDueDate: '2026-09-01',
      },
    ]);
  });

  it('folios are consecutive and unique', () => {
    expect(nextFolio([])).toBe('R-0001');
    expect(nextFolio([payment(1, 1, T), { ...payment(2, 1, T), folio: 'R-0041' }])).toBe('R-0042');
  });
});

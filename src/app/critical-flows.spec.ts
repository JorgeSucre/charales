import { TestBed } from '@angular/core/testing';
import { AuthService } from './core/auth/auth.service';
import { MockDb } from './core/data/mock-db';
import { BillingService } from './features/billing/billing.service';
import { EnrollmentService } from './features/enrollments/enrollment.service';
import { PortalService } from './features/parent-portal/portal.service';
import { ReportService } from './features/reports/report.service';
import { TutorService } from './features/tutors/tutor.service';
import { UniformService } from './features/uniforms/uniform.service';
import { UserService } from './features/users/user.service';

/** Critical flows through the service layer (HU-074). Runs against MockDb; swap for HTTP mocks later. */
describe('critical flows', () => {
  const get = TestBed.inject.bind(TestBed);

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  it('users: create, reject duplicate email, deactivate', async () => {
    const users = get(UserService);
    const user = await users.save({ fullName: 'Nuevo', email: 'Nuevo@charales.mx', role: 'coach' });
    expect(user).toMatchObject({ email: 'nuevo@charales.mx', active: true });
    await expect(
      users.save({ fullName: 'Otro', email: 'nuevo@charales.mx', role: 'coach' }),
    ).rejects.toThrow();
    await users.setActive(user.id, false);
    await expect(get(AuthService).login('nuevo@charales.mx', 'x')).rejects.toThrow();
  });

  it('tutors: require at least one player', async () => {
    const tutors = get(TutorService);
    const draft = {
      fullName: 'Ana',
      relationship: 'Madre',
      phone: '5550000000',
      playerIds: [] as string[],
    };
    await expect(tutors.save(draft)).rejects.toThrow();
    expect((await tutors.save({ ...draft, playerIds: ['p1', 'p3'] })).playerIds).toHaveLength(2);
  });

  it('enrollment: one active enrollment per player and season', async () => {
    const enrollments = get(EnrollmentService);
    await expect(enrollments.enroll({ playerId: 'p1', categoryId: 'cat1' })).rejects.toThrow();
    const e = await enrollments.enroll({ playerId: 'p4', categoryId: 'cat2' });
    expect(e).toMatchObject({ seasonId: 's1', status: 'active' });
  });

  it('billing: concept → monthly charges → payment → balance', async () => {
    const billing = get(BillingService);
    const concept = await billing.saveConcept({
      name: 'Mensualidad B',
      kind: 'monthly',
      defaultAmountCents: 50000,
      active: true,
    });
    expect(await billing.generateMonthlyFees(concept.id, '2026-10', '2026-10-10')).toBe(3); // p1, p2, p3 (p4 not enrolled)
    expect(await billing.generateMonthlyFees(concept.id, '2026-10', '2026-10-10')).toBe(0);

    const before = (await billing.debts()).find((d) => d.playerId === 'p3')!.balanceCents;
    const payment = await billing.registerPayment('p3', 20000, 'cash');
    const after = (await billing.debts()).find((d) => d.playerId === 'p3')!.balanceCents;
    expect(before - after).toBe(20000);
    expect((await billing.receipt(payment.id)).lines.reduce((s, l) => s + l.amountCents, 0)).toBe(
      20000,
    );
  });

  it('uniforms: order keeps historical price, creates a charge, delivers once', async () => {
    const uniforms = get(UniformService);
    const db = get(MockDb);
    const order = await uniforms.createOrder('p1', [{ variantId: 'uv1', quantity: 2 }]);
    db.uniformVariants = db.uniformVariants.map((v) =>
      v.id === 'uv1' ? { ...v, priceCents: 99900 } : v,
    );

    expect(order.lines[0].unitPriceCents).toBe(35000);
    expect(db.charges.find((c) => c.id === order.chargeId)).toMatchObject({
      amountCents: 70000,
      source: { type: 'uniform-order', id: order.id },
    });

    await uniforms.deliver(order.id, 'Teresa');
    await expect(uniforms.deliver(order.id, 'Teresa')).rejects.toThrow();
    expect((await uniforms.orders())[0]).toMatchObject({ status: 'delivered', totalCents: 70000 });
  });

  it('portal: tutor only sees their own children', async () => {
    await get(UniformService).createOrder('p3', [{ variantId: 'uv3', quantity: 1 }]); // someone else's child
    await get(UniformService).createOrder('p1', [{ variantId: 'uv3', quantity: 1 }]);
    await get(AuthService).login('tutor@charales.mx', 'x');
    const portal = get(PortalService);

    expect((await portal.children()).map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    expect((await portal.uniformOrders()).map((o) => o.playerId)).toEqual(['p1']);
    expect((await portal.competitions()).map((c) => c.competitionName).sort()).toEqual([
      'Copa Otoño',
      'Liga Municipal',
    ]);
  });

  it('reports: income by concept and a sorted agenda', async () => {
    const reports = get(ReportService);
    expect(await reports.income('2026-08-01', '2026-09-30')).toEqual([
      { month: '2026-08', conceptName: 'Inscripción anual', totalCents: 50000 },
      { month: '2026-09', conceptName: 'Mensualidad', totalCents: 60000 },
    ]);
    const agenda = await reports.agenda();
    expect(agenda.map((a) => a.startsAt)).toEqual([...agenda.map((a) => a.startsAt)].sort());
    expect(agenda.find((a) => a.kind === 'match')?.coachName).toBe('Carlos Coach');
  });
});

import { TestBed } from '@angular/core/testing';
import { AuthService } from './core/auth/auth.service';
import { MockDb } from './core/data/mock-db';
import { CategoryService } from './core/services/category.service';
import { CoachService } from './features/coaches/coach.service';
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
    const user = await users.save({ fullName: 'Nuevo', email: 'Nuevo@example.com', role: 'coach' });
    expect(user).toMatchObject({ email: 'nuevo@example.com', active: true });
    await expect(
      users.save({ fullName: 'Otro', email: 'nuevo@example.com', role: 'coach' }),
    ).rejects.toThrow();
    await users.setActive(user.id, false);
    await expect(get(AuthService).login('nuevo@example.com', 'x')).rejects.toThrow();
  });

  it('tutors: require at least one player; primary contact is per player and unique', async () => {
    const tutors = get(TutorService);
    const draft = {
      fullName: 'Ana',
      relationship: 'Madre',
      phone: '0000000000',
      email: ' Ana@Example.COM ',
      players: [] as { playerId: string; isPrimary: boolean }[],
    };
    await expect(tutors.save(draft)).rejects.toThrow();
    // p1 already has Teresa as primary (tutor_players_one_primary in the DB).
    await expect(
      tutors.save({ ...draft, players: [{ playerId: 'p1', isPrimary: true }] }),
    ).rejects.toThrow('Diego Hernández ya tiene un contacto principal.');
    const saved = await tutors.save({
      ...draft,
      players: [
        { playerId: 'p1', isPrimary: false },
        { playerId: 'p4', isPrimary: true },
      ],
    });
    expect(saved.players).toHaveLength(2);
    expect(saved.email).toBe('ana@example.com'); // DB CHECK: stored lowercase
    // Editing a tutor keeps their own primary contacts (not a conflict with themselves).
    await expect(tutors.save({ ...saved, fullName: 'Ana M.' })).resolves.toBeTruthy();
  });

  it('enrollment: one active enrollment per player and season', async () => {
    const enrollments = get(EnrollmentService);
    await expect(enrollments.enroll({ playerId: 'p1', seasonId: 's1' })).rejects.toThrow();
    await expect(enrollments.enroll({ playerId: 'p4', seasonId: 'nope' })).rejects.toThrow();
    const e = await enrollments.enroll({ playerId: 'p4', seasonId: 's1' });
    expect(e).toMatchObject({ seasonId: 's1', status: 'active' });
  });

  it('categories: members come from open PlayerCategory rows, not from enrollments', async () => {
    const db = get(MockDb);
    db.playerCategories = db.playerCategories.map((pc) =>
      pc.playerId === 'p3' ? { ...pc, endDate: '2026-09-01' } : pc,
    );
    expect((await get(CategoryService).players('cat1')).map((p) => p.id)).toEqual(['p1']);
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
    const payment = await billing.registerPayment({
      playerId: 'p3',
      amountCents: 20000,
      method: 'cash',
    });
    const after = (await billing.debts()).find((d) => d.playerId === 'p3')!.balanceCents;
    expect(before - after).toBe(20000);
    expect((await billing.receipt(payment.id)).lines.reduce((s, l) => s + l.amountCents, 0)).toBe(
      20000,
    );
  });

  it('billing: registerPayment only touches the given charges of that player; cancelled payments reopen balance', async () => {
    const billing = get(BillingService);
    const db = get(MockDb);
    await expect(
      billing.registerPayment({
        playerId: 'p3',
        amountCents: 100,
        method: 'cash',
        chargeIds: ['ch2'],
      }),
    ).rejects.toThrow(); // ch2 belongs to p2

    const payment = await billing.registerPayment({
      playerId: 'p2',
      amountCents: 25000,
      method: 'card',
      chargeIds: ['ch2'],
    });
    expect((await billing.openCharges('p2'))[0].balanceCents).toBe(35000);

    db.payments = db.payments.map((p) =>
      p.id === payment.id ? { ...p, cancelledAt: '2026-09-30' } : p,
    );
    expect((await billing.openCharges('p2'))[0].balanceCents).toBe(60000);
    expect((await billing.debts()).find((d) => d.playerId === 'p2')?.balanceCents).toBe(60000);
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

  it('coach assignment requires the category to take part in the competition (C2)', async () => {
    const coaches = get(CoachService);
    await expect(
      coaches.assign({ coachId: 'c1', competitionId: 'comp2', categoryId: 'cat1' }),
    ).rejects.toThrow();
    expect(
      await coaches.assign({ coachId: 'c1', competitionId: 'comp1', categoryId: 'cat2' }),
    ).toBeTruthy();
  });

  it('portal: a tutor account not linked to a tutor sees nothing', async () => {
    const db = get(MockDb);
    db.users = db.users.map((u) => (u.id === 'u4' ? { ...u, tutorId: undefined } : u));
    await get(AuthService).login('tutor@example.com', 'x');
    const portal = get(PortalService);
    expect(await portal.children()).toEqual([]);
    expect(await portal.uniformOrders()).toEqual([]);
    expect(await portal.competitions()).toEqual([]);
  });

  it('portal: tutor only sees their own children', async () => {
    await get(UniformService).createOrder('p3', [{ variantId: 'uv3', quantity: 1 }]); // someone else's child
    await get(UniformService).createOrder('p1', [{ variantId: 'uv3', quantity: 1 }]);
    await get(AuthService).login('tutor@example.com', 'x');
    const portal = get(PortalService);

    expect((await portal.children()).map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    expect((await portal.uniformOrders()).map((o) => o.playerId)).toEqual(['p1']);
    // Lucía's Sub-12 plays the Liga without an assigned coach: participation, not coach assignment, decides (C2).
    expect(
      (await portal.competitions()).map((c) => `${c.playerName}: ${c.competitionName}`).sort(),
    ).toEqual([
      'Diego Hernández: Liga Municipal',
      'Lucía Hernández: Copa Otoño',
      'Lucía Hernández: Liga Municipal',
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

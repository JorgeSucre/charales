import { TestBed } from '@angular/core/testing';
import { AuthService } from './core/auth/auth.service';
import { MockDb } from './core/data/mock-db';
import { integrityViolations } from './core/data/mock-db.integrity';
import { PlayerService } from './core/services/player.service';
import { BillingService } from './features/billing/billing.service';
import { EnrollmentService } from './features/enrollments/enrollment.service';
import { PlayerCategoryService } from './features/enrollments/player-category.service';
import { MatchService } from './features/matches/match.service';
import { PortalService } from './features/parent-portal/portal.service';

/**
 * HU-074: the six critical flows of the backlog, end to end through the service layer (the same calls the pages make)
 * against MockDb. After each one, MockDb must still satisfy every MariaDB constraint (integrityViolations).
 * Evidence: `npx ng test --watch=false` output.
 */
describe('critical flows (HU-074)', () => {
  const get = TestBed.inject.bind(TestBed);
  const login = (who: string) => get(AuthService).login(`${who}@example.com`, 'demo1234');

  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 7, 12, 0));
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    expect(integrityViolations(get(MockDb))).toEqual([]);
    vi.useRealTimers();
  });

  it('1. login: valid access by role, invalid rejected without details', async () => {
    await expect(login('nadie')).rejects.toThrow('Correo o contraseña incorrectos.');
    expect((await login('admin')).roles).toEqual(['ADMINISTRADOR']);
    get(AuthService).logout();
    expect((await login('tutor')).roles).toEqual(['TUTOR']);
    expect(get(AuthService).homeUrl()).toBe('/portal');
  });

  it('2. player registration: identifier, age, evident duplicate rejected', async () => {
    await login('secretaria');
    const players = get(PlayerService);
    const draft = {
      firstName: 'Ana',
      lastName1: 'Pérez',
      lastName2: null,
      birthDate: '2017-01-20',
      sex: 'F' as const,
      phone: null,
      email: null,
      address: null,
    };
    const ana = await players.create(draft);
    expect(ana).toMatchObject({ id: 7, identifier: 'J-0007', status: 'ACTIVO' });
    expect((await players.record(ana.id)).age).toBe(9);
    await expect(
      players.create({ ...draft, firstName: ' ana ', lastName1: 'PEREZ' }),
    ).rejects.toThrow('Posible duplicado');
  });

  it('3. enrollment: annual enrollment with fee charge + category membership with age rule', async () => {
    await login('secretaria');
    const players = get(PlayerService);
    const ana = await players.create({
      firstName: 'Ana',
      lastName1: 'Pérez',
      lastName2: null,
      birthDate: '2017-01-20',
      sex: 'F',
      phone: null,
      email: null,
      address: null,
    });
    const enrollment = await get(EnrollmentService).enroll({
      playerId: ana.id,
      seasonId: 2,
      enrolledOn: '2026-10-07',
      amountCents: 120000,
      status: 'ACTIVA',
      conceptId: 2,
      dueDate: '2026-10-15',
    });
    await expect(
      get(EnrollmentService).enroll({
        playerId: ana.id,
        seasonId: 2,
        enrolledOn: '2026-10-07',
        amountCents: 0,
        status: 'ACTIVA',
        conceptId: null,
        dueDate: null,
      }),
    ).rejects.toThrow('ya está inscrito');
    expect(get(MockDb).charges.find((c) => c.reference === `INS-${enrollment.id}`)).toMatchObject({
      originalAmountCents: 120000,
      seasonId: 2,
    });

    const membership = get(PlayerCategoryService);
    await expect(
      membership.assign({
        playerId: ana.id,
        categoryId: 2,
        date: '2026-10-07',
        exceptionReason: null,
      }),
    ).rejects.toThrow('fuera del rango');
    const row = await membership.assign({
      playerId: ana.id,
      categoryId: 1,
      date: '2026-10-07',
      exceptionReason: null,
    });
    expect(row).toMatchObject({ categoryId: 1, endDate: null, isAgeException: false });
  });

  it('4. payment and balance: partial payment, folio, derived status, cancellation reopens the balance', async () => {
    await login('admin');
    const billing = get(BillingService);
    // Mateo (3): enrollment fee 1,200.00 with 500.00 already paid → 700.00 open and overdue.
    expect((await billing.statement(3)).totals).toMatchObject({
      balanceCents: 70000,
      overdueCents: 70000,
    });
    const payment = await billing.registerPayment({
      playerId: 3,
      tutorId: 2,
      amountCents: 20000,
      method: 'EFECTIVO',
      chargeIds: [3],
    });
    expect(payment.folio).toBe('R-0004');
    expect((await billing.statement(3)).totals.balanceCents).toBe(50000);
    await expect(
      billing.registerPayment({ playerId: 3, tutorId: 1, amountCents: 100, method: 'EFECTIVO' }),
    ).rejects.toThrow('tutor de ese jugador');
    await expect(
      billing.registerPayment({ playerId: 3, tutorId: 2, amountCents: 50001, method: 'EFECTIVO' }),
    ).rejects.toThrow('excede');

    const full = await billing.registerPayment({
      playerId: 3,
      tutorId: 2,
      amountCents: 50000,
      method: 'TRANSFERENCIA',
    });
    expect(get(MockDb).charges.find((c) => c.id === 3)?.status).toBe('PAGADO');
    await billing.cancelPayment(full.id, 'Transferencia rechazada');
    expect(get(MockDb).charges.find((c) => c.id === 3)?.status).toBe('VENCIDO');
    expect((await billing.statement(3)).totals.balanceCents).toBe(50000);
    expect((await billing.receipt(full.id)).payment).toMatchObject({
      status: 'CANCELADO',
      cancellationReason: 'Transferencia rechazada',
    });
  });

  it('5. match scheduling: only registered categories, reschedule with reason, result only when played', async () => {
    await login('secretaria');
    const matches = get(MatchService);
    const match = await matches.schedule({
      competitionCategoryId: 1,
      opponentId: 2,
      venueId: 1,
      date: '2026-11-08',
      time: '09:30',
      homeAway: 'LOCAL',
      notes: null,
    });
    expect(match).toMatchObject({ status: 'PROGRAMADO', goalsFor: null });
    get(MockDb).competitionCategories[2].status = 'BAJA';
    await expect(
      matches.schedule({
        competitionCategoryId: 3,
        opponentId: 2,
        venueId: 1,
        date: '2026-11-08',
        time: '09:30',
        homeAway: 'LOCAL',
        notes: null,
      }),
    ).rejects.toThrow('no está inscrita');
    await expect(
      matches.reschedule(match.id, { date: '2026-11-09', time: '10:00', venueId: 2, reason: '' }),
    ).rejects.toThrow('motivo');
    expect(
      await matches.reschedule(match.id, {
        date: '2026-11-09',
        time: '10:00',
        venueId: 2,
        reason: 'Cancha ocupada',
      }),
    ).toMatchObject({ status: 'REPROGRAMADO', date: '2026-11-09' });
    await expect(
      matches.recordResult(match.id, { goalsFor: 1, goalsAgainst: 0, notes: null }),
    ).rejects.toThrow('futuro');
    await expect(
      matches.recordResult(1, { goalsFor: -1, goalsAgainst: 0, notes: null }),
    ).rejects.toThrow();
  });

  it('6. tutor access is restricted to their own children (tutor → tutor_jugador → jugadores)', async () => {
    await login('tutor');
    const portal = get(PortalService);
    expect((await portal.overview()).map((c) => c.name).sort()).toEqual([
      'Diego Hernández López',
      'Lucía Hernández López',
    ]);
    await expect(portal.child(3)).rejects.toThrow('No tienes acceso');
    const lucia = await portal.child(2);
    expect(lucia.competitions.map((c) => c.competitionName).sort()).toEqual([
      'Copa Otoño',
      'Liga Municipal',
    ]);
    expect(lucia.statement.charges.every((c) => c.playerId === 2)).toBe(true);
    // A tutor account without a linked tutor profile sees nothing.
    get(AuthService).logout();
    get(MockDb).tutors[0].userId = null;
    await expect(login('tutor')).rejects.toThrow('rol o perfil activo');
  });
});

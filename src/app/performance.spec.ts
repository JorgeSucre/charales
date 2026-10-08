import { TestBed } from '@angular/core/testing';
import { AuthService } from './core/auth/auth.service';
import { MockDb } from './core/data/mock-db';
import { CategoryService } from './core/services/category.service';
import { PlayerService } from './core/services/player.service';
import { BillingService } from './features/billing/billing.service';
import { ReportService } from './features/reports/report.service';

/**
 * HU-075: reproducible timing of the main queries over a large dataset (5 000 players, 20 000 charges,
 * 10 000 payments). Measures the service/domain computation without MockDb's artificial network latency.
 * It is NOT the API/MariaDB response time (that is measured when the API exists); it guards against quadratic
 * algorithms (N+1 in memory) that would also hurt the API. Budget: each query < 300 ms here.
 */
const PLAYERS = 5000;
const BUDGET_MS = 300;

function seedLarge(db: MockDb): void {
  const T = '2026-08-01T09:00:00';
  const base = db.players[0];
  for (let i = 0; i < PLAYERS; i++) {
    const id = 1000 + i;
    db.players.push({
      ...base,
      id,
      identifier: `J-${id}`,
      firstName: `Nombre${i}`,
      lastName1: `Apellido${i % 300}`,
      birthDate: '2016-05-05',
    });
    db.playerCategories.push({
      id,
      playerId: id,
      categoryId: 1 + (i % 3),
      startDate: '2026-08-05',
      endDate: null,
      isAgeException: false,
      exceptionReason: null,
      active: true,
      createdAt: T,
    });
    db.tutors.push({ ...db.tutors[1], id, userId: null });
    db.tutorPlayers.push({
      tutorId: id,
      playerId: id,
      relationship: 'Madre',
      isPrimary: true,
      createdAt: T,
    });
    for (let m = 0; m < 4; m++) {
      const chargeId = 10000 + i * 4 + m;
      db.charges.push({
        id: chargeId,
        playerId: id,
        conceptId: 1,
        seasonId: 2,
        period: `2026-0${6 + m}`,
        chargedOn: '2026-06-01',
        dueDate: `2026-0${6 + m}-10`,
        originalAmountCents: 60000,
        status: 'PENDIENTE',
        reference: null,
        createdAt: T,
        updatedAt: T,
      });
      if (m < 2) {
        const payId = 10000 + i * 2 + m;
        db.payments.push({
          id: payId,
          folio: `R-${payId}`,
          playerId: id,
          tutorId: id,
          paidAt: '2026-07-01T10:00:00',
          amountCents: 60000,
          method: 'EFECTIVO',
          status: 'APLICADO',
          cancellationReason: null,
          recordedBy: 2,
          createdAt: T,
        });
        db.paymentApplications.push({
          id: payId,
          paymentId: payId,
          chargeId,
          playerId: id,
          amountCents: 60000,
          createdAt: T,
        });
      }
    }
  }
}

describe('performance (HU-075)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 7, 12, 0));
    TestBed.resetTestingModule();
  });
  afterEach(() => vi.useRealTimers());

  it(`main queries over ${PLAYERS} players stay under ${BUDGET_MS} ms each`, async () => {
    const db = TestBed.inject(MockDb);
    seedLarge(db);
    vi.spyOn(db, 'respond').mockImplementation(async (v) => structuredClone(v)); // no artificial latency
    await TestBed.inject(AuthService).login('admin@example.com', 'demo1234');
    const queries: [string, () => Promise<unknown>][] = [
      ['búsqueda de jugadores', () => TestBed.inject(PlayerService).search({ query: 'apellido1' })],
      ['integrantes de categoría', () => TestBed.inject(CategoryService).members(1)],
      ['adeudos', () => TestBed.inject(BillingService).debts({ onlyOverdue: true })],
      ['cargos (página 1)', () => TestBed.inject(BillingService).charges({})],
      ['estado de cuenta', () => TestBed.inject(BillingService).statement(1500)],
      ['tablero', () => TestBed.inject(ReportService).dashboard()],
    ];
    const timings: Record<string, number> = {};
    for (const [name, run] of queries) {
      await run(); // warm-up (first status sync)
      const t0 = performance.now();
      await run();
      timings[name] = Math.round(performance.now() - t0);
    }
    for (const [name, ms] of Object.entries(timings))
      expect(ms, `${name}: ${ms} ms`).toBeLessThan(BUDGET_MS);
  }, 120_000);
});

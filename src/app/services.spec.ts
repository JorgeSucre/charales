import { TestBed } from '@angular/core/testing';
import { AuthService } from './core/auth/auth.service';
import { MockDb } from './core/data/mock-db';
import { integrityViolations } from './core/data/mock-db.integrity';
import { CategoryService } from './core/services/category.service';
import { PlayerService } from './core/services/player.service';
import { BillingService } from './features/billing/billing.service';
import { CoachPanelService } from './features/coach-panel/coach-panel.service';
import { PortalService } from './features/parent-portal/portal.service';
import { TrainingService } from './features/trainings/training.service';
import { UniformService } from './features/uniforms/uniform.service';
import { UserService } from './features/users/user.service';
import { VenueService } from './features/venues/venue.service';
import { monthGrid } from './shared/dates';

/** Service-level business rules not covered elsewhere (audit 2026-10-07 § H). MockDb stays consistent after each. */
const get = TestBed.inject.bind(TestBed);
const login = (who: string) => get(AuthService).login(`${who}@example.com`, 'demo1234');

describe('service rules', () => {
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

  describe('BillingService — money', () => {
    /** A 1,000.00 charge for Emiliano (no other open charges). */
    async function charge1000() {
      await login('admin');
      return get(BillingService).createCharge({
        playerId: 5,
        conceptId: 2,
        amountCents: 100000,
        dueDate: '2026-10-31',
        reference: null,
      });
    }

    it('charge 1000, pay 600 → balance 400; cancel the payment → balance 1000', async () => {
      const c = await charge1000();
      const billing = get(BillingService);
      const pay = await billing.registerPayment({
        playerId: 5,
        tutorId: 3,
        amountCents: 60000,
        method: 'EFECTIVO',
        chargeIds: [c.id],
      });
      let row = (await billing.statement(5)).charges.find((x) => x.id === c.id)!;
      expect(row).toMatchObject({ paidCents: 60000, balanceCents: 40000, status: 'PARCIAL' });
      await billing.cancelPayment(pay.id, 'Billete falso');
      row = (await billing.statement(5)).charges.find((x) => x.id === c.id)!;
      expect(row).toMatchObject({ paidCents: 0, balanceCents: 100000, status: 'PENDIENTE' });
    });

    it('charge 1000, pay 1001 → DENIED (no over-payment), nothing written', async () => {
      const c = await charge1000();
      const db = get(MockDb);
      const payments = db.payments.length;
      await expect(
        get(BillingService).registerPayment({
          playerId: 5,
          tutorId: 3,
          amountCents: 100001,
          method: 'EFECTIVO',
          chargeIds: [c.id],
        }),
      ).rejects.toThrow('excede');
      expect(db.payments).toHaveLength(payments);
    });

    it('payment amount == SUM(pago_aplicacion) when split over several charges', async () => {
      await login('admin');
      const billing = get(BillingService);
      const pay = await billing.registerPayment({
        playerId: 2,
        tutorId: 1,
        amountCents: 70000,
        method: 'TRANSFERENCIA',
      });
      const apps = get(MockDb).paymentApplications.filter((a) => a.paymentId === pay.id);
      expect(apps.length).toBe(2); // 600.00 overdue fee + 100.00 of the uniform charge
      expect(apps.reduce((s, a) => s + a.amountCents, 0)).toBe(pay.amountCents);
    });

    it('discount then partial payment: expected = original − discount; balance = expected − paid', async () => {
      const c = await charge1000();
      const billing = get(BillingService);
      await billing.addDiscount({
        chargeId: c.id,
        type: 'BECA',
        reason: 'Beca 25%',
        adjustmentCents: 25000,
      });
      await billing.registerPayment({
        playerId: 5,
        tutorId: 3,
        amountCents: 50000,
        method: 'EFECTIVO',
        chargeIds: [c.id],
      });
      const row = (await billing.statement(5)).charges.find((x) => x.id === c.id)!;
      expect(row).toMatchObject({
        originalAmountCents: 100000,
        discountCents: 25000,
        netCents: 75000,
        paidCents: 50000,
        balanceCents: 25000,
      });
      await expect(
        billing.addDiscount({
          chargeId: c.id,
          type: 'DESCUENTO',
          reason: 'x',
          adjustmentCents: 25001,
        }),
      ).rejects.toThrow();
    });

    it('overdue: after the due date the open charge becomes VENCIDO', async () => {
      const c = await charge1000();
      vi.setSystemTime(new Date(2026, 10, 1, 12, 0));
      expect(
        (await get(BillingService).statement(5)).charges.find((x) => x.id === c.id)?.status,
      ).toBe('VENCIDO');
    });

    it('HU-045: payment date is captured (back-dated allowed, future rejected); creado_en keeps the capture time', async () => {
      const c = await charge1000();
      const billing = get(BillingService);
      await expect(
        billing.registerPayment({
          playerId: 5,
          tutorId: 3,
          amountCents: 100,
          method: 'EFECTIVO',
          chargeIds: [c.id],
          paidAt: '2026-10-08T09:00',
        }),
      ).rejects.toThrow('futura');
      const p = await billing.registerPayment({
        playerId: 5,
        tutorId: 3,
        amountCents: 100,
        method: 'EFECTIVO',
        chargeIds: [c.id],
        paidAt: '2026-10-05T18:30',
      });
      expect(p).toMatchObject({ paidAt: '2026-10-05T18:30:00', createdAt: '2026-10-07T12:00:00' });
    });
  });

  describe('UserService', () => {
    it('last active administrator cannot be deactivated or demoted', async () => {
      await login('admin');
      const users = get(UserService);
      const second = await users.save({
        roleId: 1,
        firstName: 'Beto',
        lastName: '',
        email: 'beto@example.com',
      });
      await users.setActive(second.id, false);
      get(AuthService).logout();
      const row = get(MockDb).users.find((u) => u.id === second.id)!;
      row.active = true;
      row.passwordHash = get(MockDb).users[0].passwordHash; // invited accounts have no usable password yet
      await login('beto');
      await users.setActive(1, false);
      await expect(users.setActive(second.id, false)).rejects.toThrow('propia cuenta');
      await expect(
        users.save({
          id: second.id,
          roleId: 2,
          firstName: 'Beto',
          lastName: '',
          email: 'beto@example.com',
        }),
      ).rejects.toThrow('al menos un administrador');
    });
  });

  describe('PlayerService', () => {
    it('search requires jugadores.consultar; options are an office catalog', async () => {
      await login('secretaria');
      expect((await get(PlayerService).options(true)).every((p) => p.status === 'ACTIVO')).toBe(
        true,
      );
      expect(
        (await get(PlayerService).search({ query: 'ruiz' })).items.map((r) => r.player.id).sort(),
      ).toEqual([3, 6]);
    });
  });

  describe('CategoryService', () => {
    it('capacity must be a positive integer or empty; members exclude players in BAJA', async () => {
      await login('admin');
      const categories = get(CategoryService);
      await expect(
        categories.save({ seasonId: 2, name: 'Sub-14', minAge: 12, maxAge: 14, maxCapacity: 0 }),
      ).rejects.toThrow('cupo');
      await get(PlayerService).changeStatus(3, 'BAJA_TEMPORAL', 'Lesión');
      expect((await categories.members(1)).map((m) => m.playerId)).not.toContain(3);
    });
  });

  describe('VenueService', () => {
    it('unique name, deactivation instead of delete, usage count', async () => {
      await login('secretaria');
      const venues = get(VenueService);
      await expect(
        venues.save({ name: 'campo principal', location: null, reference: null }),
      ).rejects.toThrow('Ya existe');
      const v = (await venues.list()).find((x) => x.id === 1)!;
      expect(v.uses).toBeGreaterThan(0);
      await venues.setActive(1, false);
      expect((await venues.list(true)).map((x) => x.id)).not.toContain(1);
      expect('delete' in venues).toBe(false);
    });
  });

  describe('TrainingService', () => {
    it('future sessions cannot be marked done; cancelling needs a reason; secretaría sees all sessions', async () => {
      await login('secretaria');
      const trainings = get(TrainingService);
      await expect(trainings.setStatus(4, 'REALIZADO')).rejects.toThrow('futura');
      await expect(trainings.setStatus(4, 'CANCELADO')).rejects.toThrow('motivo');
      await trainings.setStatus(4, 'CANCELADO', 'Lluvia');
      expect((await trainings.list()).length).toBe(4);
      expect((await trainings.get(2)).canRecord).toBe(false); // read-only for secretaría
    });
  });

  describe('UniformService', () => {
    it('duplicate size, inactive variant and inactive player are rejected', async () => {
      await login('secretaria');
      const uniforms = get(UniformService);
      await expect(
        uniforms.saveVariant({ productId: 1, size: 'ch', priceCents: 1 }),
      ).rejects.toThrow('ya existe');
      await uniforms.setVariantActive(3, false);
      await expect(uniforms.createOrder(1, [{ variantId: 3, quantity: 1 }], 3)).rejects.toThrow(
        'inactivo',
      );
      await expect(uniforms.createOrder(4, [{ variantId: 1, quantity: 1 }], 3)).rejects.toThrow(
        'activos',
      );
      await expect(uniforms.createOrder(1, [{ variantId: 1, quantity: 1.5 }], 3)).rejects.toThrow(
        'Cantidad',
      );
    });
  });

  describe('PortalService', () => {
    it('HU-033: attendance filtered by period with its own percentage', async () => {
      await login('tutor');
      const portal = get(PortalService);
      expect((await portal.attendance(1, '2026-10-01', '2026-10-31')).summary).toMatchObject({
        total: 1,
        presentPct: 100,
      });
      expect((await portal.attendance(1, '2026-09-01', '2026-09-30')).summary.total).toBe(0);
    });

    it('HU-056: uniforms only of own children', async () => {
      await login('tutor');
      expect((await get(PortalService).child(2)).uniforms.map((o) => o.playerId)).toEqual([2]);
    });
  });

  describe('CoachPanelService', () => {
    it('HU-041: category filter options are only the coach’s categories; sessions only own', async () => {
      await login('marta');
      const panel = get(CoachPanelService);
      expect(await panel.categoryOptions()).toEqual([{ id: 2, name: 'Sub-12' }]);
      expect((await panel.sessions()).every((s) => s.categoryId === 2)).toBe(true);
      expect((await panel.myMatches({ categoryId: 2 })).every((m) => m.categoryId === 2)).toBe(
        true,
      );
    });
  });

  it('HU-068: month calendar grid covers whole weeks Monday→Sunday', () => {
    const grid = monthGrid('2026-10');
    expect(grid[0][0]).toBe('2026-09-28'); // Monday before Oct 1st (Thursday)
    expect(grid.at(-1)![6]).toBe('2026-11-01');
    expect(grid.every((w) => w.length === 7)).toBe(true);
  });
});

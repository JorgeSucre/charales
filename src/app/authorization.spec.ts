import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appConfig } from './app.config';
import { AuthService } from './core/auth/auth.service';
import { MockDb } from './core/data/mock-db';
import { CategoryService } from './core/services/category.service';
import { AuditService } from './core/services/audit.service';
import { CompetitionService } from './core/services/competition.service';
import { PlayerService } from './core/services/player.service';
import { BillingService } from './features/billing/billing.service';
import { CoachPanelService } from './features/coach-panel/coach-panel.service';
import { CoachService } from './features/coaches/coach.service';
import { MatchService } from './features/matches/match.service';
import { NoticeService } from './features/notices/notice.service';
import { PortalService } from './features/parent-portal/portal.service';
import { AttendanceService } from './features/trainings/attendance.service';
import { SeasonService } from './features/seasons/season.service';
import { TrainingService } from './features/trainings/training.service';
import { TutorService } from './features/tutors/tutor.service';
import { UniformService } from './features/uniforms/uniform.service';
import { RoleService } from './features/users/role.service';
import { UserService } from './features/users/user.service';

/**
 * Independent security tests. Expectations are written by hand from the backlog's role matrix — they do NOT derive
 * "allowed" from auth.can(), so a wrong permission seed or a missing service check makes them fail.
 * Seed: Teresa (tutor@) → children 1 Diego, 2 Lucía. Jorge (no account) → 3 Mateo, 6 Sofía.
 * Carlos (coach@) → Sub-10 (category 1). Marta (marta@) → coach of Sub-12 (2) and tutor of 5 Emiliano.
 */
const get = TestBed.inject.bind(TestBed);
const login = (who: string) => get(AuthService).login(`${who}@example.com`, 'demo1234');
const DENIED = /permiso|acceso|Sesión|asignar un rol|propia cuenta/;

describe('authorization (independent expectations)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 7, 12, 0));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: appConfig.providers });
  });
  afterEach(() => vi.useRealTimers());

  describe('routes (explicit table)', () => {
    const cases: [string, string, 'ALLOW' | 'DENY'][] = [
      ['tutor', '/admin/users', 'DENY'],
      ['tutor', '/admin/players', 'DENY'],
      ['tutor', '/admin/billing/debts', 'DENY'],
      ['tutor', '/coach', 'DENY'],
      ['tutor', '/portal', 'ALLOW'],
      ['tutor', '/portal/profile', 'ALLOW'],
      ['coach', '/coach', 'ALLOW'],
      ['coach', '/sports/trainings', 'DENY'],
      ['coach', '/admin/players', 'DENY'],
      ['coach', '/portal', 'DENY'],
      ['marta', '/coach', 'ALLOW'],
      ['marta', '/portal', 'ALLOW'],
      ['marta', '/admin/users', 'DENY'],
      ['secretaria', '/admin/players', 'ALLOW'],
      ['secretaria', '/admin/billing/payments/new', 'ALLOW'],
      ['secretaria', '/admin/permissions', 'DENY'],
      ['secretaria', '/admin/users', 'DENY'],
      ['secretaria', '/admin/audit', 'DENY'],
      ['secretaria', '/admin/billing/discounts', 'ALLOW'],
      ['secretaria', '/admin/seasons', 'ALLOW'],
      ['secretaria', '/sports/attendance', 'ALLOW'],
      ['secretaria', '/portal', 'DENY'],
      ['admin', '/admin/permissions', 'ALLOW'],
      ['admin', '/admin/users', 'ALLOW'],
      ['admin', '/admin/audit', 'ALLOW'],
      ['admin', '/admin/billing/discounts', 'ALLOW'],
      ['admin', '/portal', 'DENY'],
    ];
    for (const who of [...new Set(cases.map((c) => c[0]))]) {
      it(`${who}: explicit allow/deny`, async () => {
        await login(who);
        const harness = await RouterTestingHarness.create();
        for (const [, path, expected] of cases.filter((c) => c[0] === who)) {
          await harness.navigateByUrl(path);
          expect(get(Router).url === '/forbidden' ? 'DENY' : 'ALLOW', `${who} ${path}`).toBe(
            expected,
          );
        }
      });
    }
  });

  describe('tutor isolation in services (tutor → tutor_jugador → jugador)', () => {
    beforeEach(() => login('tutor'));

    it('own child: ALLOW', async () => {
      await expect(get(PortalService).child(1)).resolves.toBeTruthy();
      await expect(get(BillingService).statement(1)).resolves.toBeTruthy();
      await expect(get(PortalService).attendance(1)).resolves.toBeTruthy();
    });

    it("another family's child (by id): DENY everywhere", async () => {
      await expect(get(PortalService).child(3)).rejects.toThrow(DENIED);
      await expect(get(PortalService).attendance(3)).rejects.toThrow(DENIED);
      await expect(get(BillingService).statement(3)).rejects.toThrow(DENIED); // payments of child B
      await expect(get(PlayerService).record(3)).rejects.toThrow(DENIED);
      expect(() => get(AttendanceService).history(3)).toThrow(DENIED); // attendance of child B
      await expect(get(UniformService).orders({ playerIds: [6] })).rejects.toThrow(DENIED); // uniforms of child B
      await expect(get(MatchService).list({ categoryId: 2 })).rejects.toThrow(DENIED); // matches of child B
    });

    it('cannot write or list office data', async () => {
      await expect(get(PlayerService).changeStatus(3, 'BAJA_DEFINITIVA', 'x')).rejects.toThrow(
        DENIED,
      );
      await expect(get(PlayerService).search()).rejects.toThrow(DENIED);
      await expect(
        get(BillingService).registerPayment({
          playerId: 3,
          tutorId: 2,
          amountCents: 100,
          method: 'EFECTIVO',
        }),
      ).rejects.toThrow(DENIED);
      await expect(get(UserService).list()).rejects.toThrow(DENIED);
      await expect(get(TutorService).list()).rejects.toThrow(DENIED);
      await expect(get(CategoryService).list()).rejects.toThrow(DENIED);
      expect(() => get(NoticeService).forTutor(2)).toThrow(DENIED);
      // Profile edits: only their own contact data.
      await expect(
        get(TutorService).updateContact(2, { phone: '5500000000', email: null, address: null }),
      ).rejects.toThrow(DENIED);
      await expect(
        get(PortalService).updateProfile({ phone: '5500000000', email: null, address: null }),
      ).resolves.toBeTruthy();
    });
  });

  describe('coach scope in services (entrenador → entrenador_categoria / _competencia_categoria)', () => {
    beforeEach(() => login('coach'));

    it('own category, sessions and competitions: ALLOW', async () => {
      await expect(get(CategoryService).members(1)).resolves.toHaveLength(3);
      await expect(get(TrainingService).get(1)).resolves.toBeTruthy();
      expect((await get(CoachPanelService).myMatches({})).every((m) => m.categoryId === 1)).toBe(
        true,
      );
    });

    it('foreign category, session, attendance, competition and matches: DENY', async () => {
      await expect(get(CategoryService).members(2)).rejects.toThrow(DENIED);
      await expect(get(CategoryService).get(2)).rejects.toThrow(DENIED);
      await expect(get(TrainingService).get(2)).rejects.toThrow(DENIED);
      await expect(
        get(TrainingService).saveNotes(2, { objective: 'x', notes: null }),
      ).rejects.toThrow();
      await expect(get(AttendanceService).record(2, [])).rejects.toThrow();
      await expect(get(CompetitionService).roster(2)).rejects.toThrow(DENIED);
      await expect(get(MatchService).list()).rejects.toThrow(DENIED);
      expect((await get(CoachPanelService).myMatches({ categoryId: 2 })).length).toBe(0);
      await expect(get(PlayerService).update(2, {} as never)).rejects.toThrow(DENIED);
      expect(() => get(NoticeService).forCoach(2)).toThrow(DENIED);
    });
  });

  describe('office roles', () => {
    it('secretaría: registers payments, cannot edit permissions, cancel payments or escalate', async () => {
      await login('secretaria');
      await expect(
        get(BillingService).registerPayment({
          playerId: 2,
          tutorId: 1,
          amountCents: 100,
          method: 'EFECTIVO',
        }),
      ).resolves.toBeTruthy();
      await expect(get(RoleService).setPermission(2, 1, true)).rejects.toThrow(DENIED);
      await expect(get(BillingService).cancelPayment(1, 'x')).rejects.toThrow(DENIED);
      await expect(
        get(UserService).save({ roleId: 1, firstName: 'X', lastName: '', email: 'x@example.com' }),
      ).rejects.toThrow(DENIED);
      await expect(get(UserService).setActive(1, false)).rejects.toThrow(DENIED);
    });

    it('secretaría granted usuarios.* still cannot create or manage an administrator (role superset rule)', async () => {
      const db = get(MockDb);
      for (const p of db.permissions.filter((x) => x.module === 'usuarios'))
        db.rolePermissions.push({ roleId: 2, permissionId: p.id, createdAt: '' });
      await login('secretaria');
      const users = get(UserService);
      await expect(
        users.save({ roleId: 1, firstName: 'X', lastName: '', email: 'x@example.com' }),
      ).rejects.toThrow('más permisos que los tuyos');
      await expect(
        users.save({
          id: 1,
          roleId: 2,
          firstName: 'Ana',
          lastName: '',
          email: 'admin@example.com',
        }),
      ).rejects.toThrow('más permisos que los tuyos');
      await expect(users.setActive(1, false)).rejects.toThrow('más permisos que los tuyos');
      await expect(
        users.save({ roleId: 2, firstName: 'Nueva', lastName: 'Sec', email: 'nueva@example.com' }),
      ).resolves.toBeTruthy();
    });

    it('nobody links their own account to a profile (self-escalation)', async () => {
      await login('secretaria');
      await expect(get(CoachService).linkAccount(3, 'secretaria@example.com')).rejects.toThrow(
        'propia cuenta',
      );
      await expect(get(TutorService).linkAccount(2, 'secretaria@example.com')).rejects.toThrow(
        'propia cuenta',
      );
    });

    it('administrador: all office modules, including permissions and cancellation', async () => {
      await login('admin');
      await expect(get(RoleService).matrix()).resolves.toBeTruthy();
      await expect(get(BillingService).cancelPayment(1, 'Error')).resolves.toBeTruthy();
      await expect(get(UserService).list()).resolves.toBeTruthy();
      await expect(get(PortalService).child(1)).rejects.toThrow(DENIED); // no tutor profile
    });

    it('no session: every service rejects', async () => {
      await expect(get(PlayerService).search()).rejects.toThrow('Sesión no iniciada');
      await expect(get(BillingService).statement(1)).rejects.toThrow('Sesión no iniciada');
      await expect(get(PortalService).overview()).rejects.toThrow('Sesión no iniciada');
    });
  });

  /** D12 (MARIADB.md): Administrador administra el sistema; Secretaría administra la operación de la escuela. */
  describe('role matrix (D12)', () => {
    const SECRETARIA_ALLOW = [
      'temporadas.consultar',
      'temporadas.crear',
      'temporadas.editar',
      'descuentos.consultar',
      'cobranza.consultar',
      'cobranza.crear',
      'cobranza.editar',
      'cobranza.cancelar',
      'pagos.consultar',
      'pagos.crear',
      'asistencias.consultar',
      'entrenamientos.crear',
      'entrenamientos.editar',
    ];
    const SECRETARIA_DENY = [
      'descuentos.crear',
      'pagos.cancelar',
      'usuarios.consultar',
      'usuarios.crear',
      'usuarios.editar',
      'usuarios.cancelar',
      'roles.consultar',
      'roles.editar',
      'auditoria.consultar',
      'asistencias.crear',
      'asistencias.editar',
    ];
    const session = () => get(AuthService).user()!;

    it('secretaría: exactly the 45 operational permissions', async () => {
      await login('secretaria');
      const granted = session().permissions as string[];
      for (const p of SECRETARIA_ALLOW) expect(granted, p).toContain(p);
      for (const p of SECRETARIA_DENY) expect(granted, p).not.toContain(p);
      expect(granted).toHaveLength(45);
    });

    it('secretaría: manages seasons, reads discounts, voids unpaid charges only', async () => {
      await login('secretaria');
      const seasons = get(SeasonService);
      await expect(
        seasons.save({
          name: 'Temporada 2027-2028',
          startDate: '2027-08-01',
          endDate: '2028-07-31',
          active: true,
          isCurrent: false,
        }),
      ).resolves.toBeTruthy();
      await expect(
        seasons.save({
          id: 1,
          name: 'Temporada 2025-2026',
          startDate: '2025-08-01',
          endDate: '2026-07-31',
          active: false,
          isCurrent: false,
        }),
      ).resolves.toBeTruthy();
      const billing = get(BillingService);
      await expect(billing.discounts()).resolves.toBeTruthy();
      await expect(billing.cancelCharge(2, 'Cargo capturado por error')).resolves.toBeUndefined();
      expect(get(MockDb).audit.some((a) => a.entity === 'cargos' && a.entityId === 2)).toBe(true);
      await expect(billing.cancelCharge(1, 'x')).rejects.toThrow('pagos aplicados');
    });

    it('secretaría: no payment cancellation, discounts, users, roles, audit or attendance capture', async () => {
      await login('secretaria');
      const billing = get(BillingService);
      await expect(billing.cancelPayment(1, 'x')).rejects.toThrow(DENIED);
      await expect(
        billing.addDiscount({ chargeId: 2, type: 'BECA', reason: 'x', adjustmentCents: 100 }),
      ).rejects.toThrow(DENIED);
      await expect(get(UserService).list()).rejects.toThrow(DENIED);
      await expect(get(UserService).securityRoles()).rejects.toThrow(DENIED);
      await expect(get(RoleService).matrix()).rejects.toThrow(DENIED);
      await expect(get(AuditService).list()).rejects.toThrow(DENIED);
      await expect(get(AttendanceService).record(1, [])).rejects.toThrow();
      await expect(
        get(TrainingService).saveNotes(1, { objective: 'x', notes: null }),
      ).rejects.toThrow();
      expect((await get(TrainingService).get(1)).canRecord).toBe(false);
    });

    it('administrador: full system control', async () => {
      await login('admin');
      expect(session().permissions).toHaveLength(56);
      await expect(get(AuditService).list()).resolves.toBeTruthy();
      await expect(get(UserService).securityRoles()).resolves.toBeTruthy();
      await expect(
        get(BillingService).addDiscount({
          chargeId: 2,
          type: 'BECA',
          reason: 'Beca deportiva',
          adjustmentCents: 100,
        }),
      ).resolves.toBeTruthy();
      await expect(get(AttendanceService).record(2, [])).resolves.toBeUndefined();
      await expect(get(BillingService).cancelPayment(1, 'Error')).resolves.toBeTruthy();
    });

    it('entrenador: own sessions only, no office catalogs', async () => {
      await login('coach');
      const members = await get(CategoryService).members(1);
      await get(AttendanceService).record(
        3,
        members.map((m) => ({ playerId: m.playerId, status: 'PRESENTE' as const, notes: null })),
      );
      await get(AttendanceService).record(3, [
        { playerId: members[0].playerId, status: 'JUSTIFICADO', notes: null },
      ]); // correction
      await get(TrainingService).saveNotes(3, { objective: 'Pases cortos', notes: null });
      expect(get(MockDb).trainingSessions.find((s) => s.id === 3)?.status).toBe('REALIZADO');
      await expect(get(AttendanceService).record(2, [])).rejects.toThrow();
      // Profile permissions (asistencias.*) never open office-wide catalogs.
      await expect(get(PlayerService).options()).rejects.toThrow(DENIED);
      await expect(get(SeasonService).list()).rejects.toThrow(DENIED);
      await expect(get(BillingService).concepts()).rejects.toThrow(DENIED);
      await expect(get(TrainingService).list()).rejects.toThrow(DENIED);
    });

    it('tutor: own children, their coaches and uniforms; never orders or global lists', async () => {
      await login('tutor');
      const child = await get(PortalService).child(1);
      expect(child.coaches.length).toBeGreaterThan(0); // HU-062.4
      expect(child.uniforms).toBeDefined(); // HU-056: read-only through the portal
      await expect(get(UniformService).orders({ playerIds: [1] })).rejects.toThrow(DENIED);
      await expect(
        get(UniformService).createOrder(1, [{ variantId: 1, quantity: 1 }], 1),
      ).rejects.toThrow(DENIED);
      await expect(get(PlayerService).options()).rejects.toThrow(DENIED);
      await expect(get(TutorService).get(2)).rejects.toThrow(DENIED);
      await expect(get(CoachService).list()).rejects.toThrow(DENIED);
    });

    it('SECRETARIA + linked ENTRENADOR profile: coach rights only inside the coach scope (no lateral escalation)', async () => {
      // Luis (coach 3, no account) is assistant of Sub-10 (category 1): sessions 1 and 3. Sessions 2 and 4 are Sub-12.
      await login('admin');
      await get(CoachService).linkAccount(3, 'secretaria@example.com');
      get(AuthService).logout();
      await login('secretaria');
      expect(session().roles).toEqual(expect.arrayContaining(['SECRETARIA', 'ENTRENADOR']));
      const trainings = get(TrainingService);
      const attendance = get(AttendanceService);
      // Inside the coach scope: may capture and annotate.
      expect((await trainings.get(1)).canRecord).toBe(true);
      await expect(
        attendance.record(1, [{ playerId: 1, status: 'AUSENTE', notes: null }]),
      ).resolves.toBeUndefined();
      await expect(
        trainings.saveNotes(1, { objective: 'x', notes: null }),
      ).resolves.toBeUndefined();
      // Outside it: the office role still reads every session but the profile grants no capture there.
      expect((await trainings.get(2)).canRecord).toBe(false);
      await expect(attendance.record(2, [])).rejects.toThrow();
      await expect(trainings.saveNotes(2, { objective: 'x', notes: null })).rejects.toThrow();
      // And the profile never adds office permissions on top of the security role.
      await expect(get(BillingService).cancelPayment(1, 'x')).rejects.toThrow(DENIED);
      await expect(get(AuditService).list()).rejects.toThrow(DENIED);
    });
  });
});

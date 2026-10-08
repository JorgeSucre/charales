import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appConfig } from './app.config';
import { AuthService } from './core/auth/auth.service';
import { MockDb } from './core/data/mock-db';
import { CategoryService } from './core/services/category.service';
import { CompetitionService } from './core/services/competition.service';
import { PlayerService } from './core/services/player.service';
import { BillingService } from './features/billing/billing.service';
import { CoachPanelService } from './features/coach-panel/coach-panel.service';
import { CoachService } from './features/coaches/coach.service';
import { MatchService } from './features/matches/match.service';
import { NoticeService } from './features/notices/notice.service';
import { PortalService } from './features/parent-portal/portal.service';
import { AttendanceService } from './features/trainings/attendance.service';
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
      ['secretaria', '/admin/billing/discounts', 'DENY'],
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
});

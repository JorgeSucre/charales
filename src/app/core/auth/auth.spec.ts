import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { MockDb } from '../data/mock-db';
import { AuthService, IDLE_MINUTES } from './auth.service';
import { requirePermission } from './guards';
import { passwordProblem, verifyPassword } from './password';
import { PermissionKey } from './permissions';

const PASSWORD = 'demo1234';
const NOW = new Date(2026, 9, 7, 12, 0);

function runGuard(permission?: PermissionKey) {
  const state = { url: '/admin/billing/debts' } as RouterStateSnapshot;
  return TestBed.runInInjectionContext(() =>
    requirePermission(permission)({} as ActivatedRouteSnapshot, state),
  );
}

/** HU-001, 002, 003, 005, 072: login, roles from profiles, sessions, expiry, passwords. */
describe('auth, sessions & RBAC', () => {
  let auth: AuthService;
  let db: MockDb;

  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    auth = TestBed.inject(AuthService);
    db = TestBed.inject(MockDb);
  });
  afterEach(() => vi.useRealTimers());

  it('valid credentials log in; wrong password, unknown and inactive get the same message (HU-001.1/2, HU-004.3)', async () => {
    for (const [email, pwd] of [
      ['secretaria@example.com', 'mala-clave1'],
      ['nadie@example.com', PASSWORD],
      ['baja@example.com', PASSWORD],
    ])
      await expect(auth.login(email, pwd)).rejects.toThrow('Correo o contraseña incorrectos.');
    const user = await auth.login(' Secretaria@Example.com ', PASSWORD);
    expect(user).toMatchObject({ roles: ['SECRETARIA'], isStaff: true });
    expect(auth.homeUrl()).toBe('/');
  });

  it('records the access with date/time (sesiones + auditoría LOGIN) and closes it on logout (HU-001.3)', async () => {
    const user = await auth.login('admin@example.com', PASSWORD);
    const session = db.sessions.find((s) => s.id === user.sessionId)!;
    expect(session).toMatchObject({ userId: 1, startedAt: '2026-10-07T12:00:00', closedAt: null });
    expect(session.tokenHash).toMatch(/^[0-9a-f]{64}$/); // only the hash is stored
    expect(db.audit.at(-1)).toMatchObject({ action: 'LOGIN', userId: 1 });
    auth.logout();
    expect(db.sessions.find((s) => s.id === user.sessionId)?.closedAt).toBe('2026-10-07T12:00:00');
    expect(db.audit.at(-1)).toMatchObject({ action: 'LOGOUT' });
  });

  it('roles come from the account role AND linked profiles (coach + tutor on one account)', async () => {
    const marta = await auth.login('marta@example.com', PASSWORD);
    expect(marta.roles.sort()).toEqual(['ENTRENADOR', 'TUTOR']);
    expect(marta).toMatchObject({ coachId: 2, tutorId: 3, isStaff: false });
    expect(auth.can('portal.consultar') && auth.can('panel_entrenador.consultar')).toBe(true);
    expect(auth.can('jugadores.consultar')).toBe(false);
  });

  it('a deactivated coach profile no longer grants ENTRENADOR at the next login', async () => {
    db.coaches = db.coaches.map((c) => (c.id === 1 ? { ...c, active: false } : c));
    await expect(auth.login('coach@example.com', PASSWORD)).rejects.toThrow('rol o perfil activo');
  });

  it('permissions are a snapshot: rol_permiso changes apply to NEW sessions (HU-006.2)', async () => {
    await auth.login('secretaria@example.com', PASSWORD);
    const removed = db.permissions.find((p) => p.module === 'jugadores' && p.action === 'crear')!;
    db.rolePermissions = db.rolePermissions.filter(
      (rp) => !(rp.roleId === 2 && rp.permissionId === removed.id),
    );
    expect(auth.can('jugadores.crear')).toBe(true);
    auth.logout();
    await auth.login('secretaria@example.com', PASSWORD);
    expect(auth.can('jugadores.crear')).toBe(false);
  });

  it('session expires after idle time and the guard sends to login with expired=1 (HU-002.4)', async () => {
    await auth.login('admin@example.com', PASSWORD);
    expect(runGuard('reportes.consultar')).toBe(true);
    vi.setSystemTime(new Date(NOW.getTime() + (IDLE_MINUTES + 1) * 60_000));
    expect((runGuard('reportes.consultar') as UrlTree).toString()).toBe(
      '/login?returnUrl=%2Fadmin%2Fbilling%2Fdebts&expired=1',
    );
    expect(auth.isLoggedIn()).toBe(false);
  });

  it('guard: anonymous → /login; tutor → /forbidden on office routes, allowed on the portal (HU-003)', async () => {
    expect((runGuard('cobranza.consultar') as UrlTree).toString()).toBe(
      '/login?returnUrl=%2Fadmin%2Fbilling%2Fdebts',
    );
    await auth.login('tutor@example.com', PASSWORD);
    expect((runGuard('cobranza.consultar') as UrlTree).toString()).toBe('/forbidden');
    expect(runGuard('portal.consultar')).toBe(true);
    expect(auth.homeUrl()).toBe('/portal');
  });

  it('change password requires the current one and the policy (HU-005.1/2); never stored in plain text', async () => {
    await auth.login('admin@example.com', PASSWORD);
    await expect(auth.changePassword('incorrecta1', 'Nueva1234')).rejects.toThrow('actual');
    await expect(auth.changePassword(PASSWORD, 'corta1')).rejects.toThrow();
    await expect(auth.changePassword(PASSWORD, 'sinnumeros')).rejects.toThrow();
    await auth.changePassword(PASSWORD, 'Nueva1234');
    const row = db.users.find((u) => u.id === 1)!;
    expect(row.passwordHash).not.toContain('Nueva1234');
    expect(await verifyPassword('Nueva1234', row.passwordHash)).toBe(true);
    expect(passwordProblem('abc12345')).toBeNull();
  });

  it('reset token works once, expires, and closes open sessions (HU-005.3)', async () => {
    const other = TestBed.inject(AuthService);
    await other.login('secretaria@example.com', PASSWORD);
    await auth.requestPasswordReset('secretaria@example.com');
    await auth.requestPasswordReset('nadie@example.com'); // same outcome, nothing sent
    expect(db.outbox).toHaveLength(1);
    const token = /token=([0-9a-f]+)/.exec(db.outbox[0].body)![1];
    await auth.resetPassword(token, 'Otra12345');
    expect(db.sessions.every((s) => s.userId !== 2 || s.closedAt)).toBe(true);
    await expect(auth.resetPassword(token, 'Otra67890')).rejects.toThrow('no es válido');
    await expect(auth.login('secretaria@example.com', 'Otra12345')).resolves.toBeTruthy();

    await auth.requestPasswordReset('admin@example.com');
    const late = /token=([0-9a-f]+)/.exec(db.outbox[1].body)![1];
    vi.setSystemTime(new Date(NOW.getTime() + 61 * 60_000));
    await expect(auth.resetPassword(late, 'Tarde1234')).rejects.toThrow('expiró');
  });
});

import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { AuthService } from './auth.service';
import { requirePermission } from './guards';
import { Permission, roleCan } from './permissions';

function runGuard(permission?: Permission) {
  const state = { url: '/admin/billing/debts' } as RouterStateSnapshot;
  return TestBed.runInInjectionContext(() =>
    requirePermission(permission)({} as ActivatedRouteSnapshot, state),
  );
}

describe('auth & RBAC', () => {
  let auth: AuthService;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    auth = TestBed.inject(AuthService);
  });

  it('maps roles to permissions (tutor is restricted to the portal)', () => {
    expect(roleCan('admin', 'users.manage')).toBe(true);
    expect(roleCan('secretary', 'users.manage')).toBe(false);
    expect(roleCan('secretary', 'billing.manage')).toBe(true);
    expect(roleCan('coach', 'agenda.view')).toBe(true);
    expect(roleCan('coach', 'billing.manage')).toBe(false);
    expect(roleCan('tutor', 'portal.view')).toBe(true);
    expect(roleCan('tutor', 'billing.manage')).toBe(false);
    expect(roleCan('tutor', 'agenda.view')).toBe(false);
  });

  it('logs in an active user and rejects unknown or inactive ones', async () => {
    await expect(auth.login('nadie@charales.mx', 'x')).rejects.toThrow();
    await expect(auth.login('baja@charales.mx', 'x')).rejects.toThrow();
    await auth.login(' Secretaria@charales.mx ', 'x');
    expect(auth.user()?.role).toBe('secretary');
    auth.logout();
    expect(auth.isLoggedIn()).toBe(false);
  });

  it('guard: anonymous → /login with returnUrl', () => {
    const result = runGuard('billing.manage') as UrlTree;
    expect(result.toString()).toBe('/login?returnUrl=%2Fadmin%2Fbilling%2Fdebts');
  });

  it('guard: tutor → /forbidden on office routes, allowed on portal', async () => {
    await auth.login('tutor@charales.mx', 'x');
    expect((runGuard('billing.manage') as UrlTree).toString()).toBe('/forbidden');
    expect(runGuard('portal.view')).toBe(true);
  });
});

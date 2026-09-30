import { TestBed } from '@angular/core/testing';
import { Route, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appConfig } from './app.config';
import { routes } from './app.routes';
import { AuthService } from './core/auth/auth.service';
import { Permission, roleCan } from './core/auth/permissions';
import { Role } from './core/models';
import { NAV_ITEMS } from './layout/nav';

/**
 * Security review table: every route behind the login and the permission it must require
 * (null = any logged-in user). Adding a route without adding it here fails the test.
 */
const EXPECTED: Record<string, Permission | null> = {
  '/': null,
  '/forbidden': null,
  '/account/password': null,
  '/admin/users': 'users.manage',
  '/admin/seasons': 'seasons.manage',
  '/admin/tutors': 'tutors.manage',
  '/admin/enrollments': 'enrollments.manage',
  '/admin/coaches': 'coaches.manage',
  '/admin/coaches/assignments': 'coaches.manage',
  '/admin/billing/concepts': 'billing.manage',
  '/admin/billing/monthly': 'billing.manage',
  '/admin/billing/receipts': 'billing.manage',
  '/admin/billing/receipts/:id': 'billing.manage',
  '/admin/billing/debts': 'billing.manage',
  '/admin/uniforms/catalog': 'uniforms.manage',
  '/admin/uniforms/orders': 'uniforms.manage',
  '/admin/reports/income': 'reports.view',
  '/sports/categories': 'categories.view',
  '/sports/agenda': 'agenda.view',
  '/portal': 'portal.view',
};

const USERS: Record<Role, string> = {
  admin: 'admin@charales.mx',
  secretary: 'secretaria@charales.mx',
  coach: 'coach@charales.mx',
  tutor: 'tutor@charales.mx',
};

/** Leaf routes inside the authenticated shell (redirects and wildcards skipped). */
function protectedPaths(list: Route[], prefix = ''): string[] {
  return list.flatMap((r) => {
    if (r.redirectTo !== undefined || r.path === '**') return [];
    const path = [prefix, r.path].filter(Boolean).join('/');
    return r.children ? protectedPaths(r.children, path) : [`/${path}`];
  });
}

const url = (path: string) => path.replace(':id', 'pay1');

describe('routes & RBAC', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: appConfig.providers });
  });

  it('every protected route is declared in the security table', () => {
    const shell = routes.find((r) => r.path === '' && r.children)!;
    expect(protectedPaths(shell.children!).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('the menu uses the same permissions as the routes', () => {
    for (const item of NAV_ITEMS) expect(EXPECTED[item.path], item.path).toBe(item.permission);
  });

  it('anonymous users are sent to login from every protected URL', async () => {
    const harness = await RouterTestingHarness.create();
    for (const path of Object.keys(EXPECTED)) {
      await harness.navigateByUrl(url(path));
      expect(TestBed.inject(Router).url, path).toMatch(/^\/login\?returnUrl=/);
    }
  });

  for (const role of Object.keys(USERS) as Role[]) {
    it(`${role}: typing any URL reaches it only with the right permission`, async () => {
      await TestBed.inject(AuthService).login(USERS[role], 'x');
      const harness = await RouterTestingHarness.create();
      for (const [path, permission] of Object.entries(EXPECTED)) {
        await harness.navigateByUrl(url(path));
        const allowed = permission === null || roleCan(role, permission);
        expect(TestBed.inject(Router).url, `${role} ${path}`).toBe(
          allowed ? url(path) : '/forbidden',
        );
      }
    });
  }

  async function settle(harness: RouterTestingHarness) {
    await new Promise((r) => setTimeout(r, 400)); // mock latency
    harness.detectChanges();
    await harness.fixture.whenStable();
    return harness.routeNativeElement as HTMLElement;
  }

  for (const role of Object.keys(USERS) as Role[]) {
    it(`${role}: every menu page renders without load errors`, async () => {
      const auth = TestBed.inject(AuthService);
      await auth.login(USERS[role], 'x');
      const harness = await RouterTestingHarness.create();
      for (const item of NAV_ITEMS.filter((i) => auth.can(i.permission))) {
        await harness.navigateByUrl(item.path);
        const el = await settle(harness);
        expect(el.querySelector('h1')?.textContent, item.path).toBeTruthy();
        expect(el.textContent, item.path).not.toContain('No se pudo cargar');
      }
    }, 30_000);
  }

  it('renders a receipt with its lines', async () => {
    await TestBed.inject(AuthService).login(USERS.secretary, 'x');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/billing/receipts/pay1');
    const el = await settle(harness);
    expect(el.textContent).toContain('R-0001');
    expect(el.textContent).toContain('Mensualidad 2026-09');
  });
});

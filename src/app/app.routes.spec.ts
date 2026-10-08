import { TestBed } from '@angular/core/testing';
import { Route, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appConfig } from './app.config';
import { routes } from './app.routes';
import { AuthService } from './core/auth/auth.service';
import { PermissionKey } from './core/auth/permissions';
import { NAV_ITEMS } from './layout/nav';

/**
 * Security review table: every route behind the login and the permission it must require
 * (null = any logged-in user). Adding a route without adding it here fails the test.
 */
const EXPECTED: Record<string, PermissionKey | null> = {
  '/': null,
  '/forbidden': null,
  '/account/password': null,
  '/admin/dashboard': 'reportes.consultar',
  '/admin/players': 'jugadores.consultar',
  '/admin/players/new': 'jugadores.crear',
  '/admin/players/:id': 'jugadores.consultar',
  '/admin/players/:id/edit': 'jugadores.editar',
  '/admin/tutors': 'tutores.consultar',
  '/admin/coaches': 'entrenadores.consultar',
  '/admin/coaches/categories': 'entrenadores.consultar',
  '/admin/coaches/assignments': 'competencias.consultar',
  '/admin/seasons': 'temporadas.consultar',
  '/admin/enrollments': 'inscripciones.consultar',
  '/admin/billing/concepts': 'cobranza.consultar',
  '/admin/billing/charges': 'cobranza.consultar',
  '/admin/billing/monthly': 'cobranza.crear',
  '/admin/billing/discounts': 'descuentos.consultar',
  '/admin/billing/payments/new': 'pagos.crear',
  '/admin/billing/receipts': 'pagos.consultar',
  '/admin/billing/receipts/:id': 'pagos.consultar',
  '/admin/billing/statement': 'pagos.consultar',
  '/admin/billing/debts': 'cobranza.consultar',
  '/admin/uniforms/catalog': 'uniformes.consultar',
  '/admin/uniforms/orders': 'uniformes.consultar',
  '/admin/notices': 'avisos.consultar',
  '/admin/reports/players': 'reportes.consultar',
  '/admin/reports/income': 'reportes.consultar',
  '/admin/users': 'usuarios.consultar',
  '/admin/permissions': 'roles.consultar',
  '/admin/audit': 'auditoria.consultar',
  '/sports/categories': 'categorias.consultar',
  '/sports/categories/:id': 'categorias.consultar',
  '/sports/venues': 'sedes.consultar',
  '/sports/trainings': 'entrenamientos.consultar',
  '/sports/trainings/:id': 'entrenamientos.consultar',
  '/sports/attendance': 'asistencias.consultar',
  '/sports/competitions': 'competencias.consultar',
  '/sports/competitions/:id': 'competencias.consultar',
  '/sports/matches': 'partidos.consultar',
  '/sports/agenda': 'reportes.consultar',
  '/coach': 'panel_entrenador.consultar',
  '/coach/sessions': 'panel_entrenador.consultar',
  '/coach/sessions/:id': 'panel_entrenador.consultar',
  '/coach/competitions': 'panel_entrenador.consultar',
  '/coach/notices': 'panel_entrenador.consultar',
  '/portal': 'portal.consultar',
  '/portal/children/:id': 'portal.consultar',
  '/portal/notices': 'portal.consultar',
  '/portal/profile': 'portal.editar',
};

/** Seeded accounts (password demo1234). marta is coach AND tutor: two profiles on one account. */
const USERS = ['admin', 'secretaria', 'coach', 'tutor', 'marta'].map((u) => `${u}@example.com`);
const PASSWORD = 'demo1234';

/** Leaf routes inside the authenticated shell (redirects and wildcards skipped). */
function protectedPaths(list: Route[], prefix = ''): string[] {
  return list.flatMap((r) => {
    if (r.redirectTo !== undefined || r.path === '**') return [];
    const path = [prefix, r.path].filter(Boolean).join('/');
    return r.children ? protectedPaths(r.children, path) : [`/${path}`];
  });
}

/** Ids that exist in the seed and that the tutor (Teresa) may see (child 1, session 1 led by coach 1). */
const url = (path: string) => path.replace(':id', '1');

describe('routes & RBAC', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 7, 12, 0));
    TestBed.configureTestingModule({ providers: appConfig.providers });
  });
  afterEach(() => vi.useRealTimers());

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

  for (const email of USERS) {
    it(`${email}: typing any URL reaches it only with the right permission (HU-002.3)`, async () => {
      const auth = TestBed.inject(AuthService);
      await auth.login(email, PASSWORD);
      const harness = await RouterTestingHarness.create();
      for (const [path, permission] of Object.entries(EXPECTED)) {
        if (path === '/') continue; // home redirects coaches/tutors to their area
        await harness.navigateByUrl(url(path));
        const allowed = permission === null || auth.can(permission);
        expect(TestBed.inject(Router).url, `${email} ${path}`).toBe(
          allowed ? url(path) : '/forbidden',
        );
      }
    });
  }

  it('tutor-only and coach-only accounts get exclusive menus (HU-003.4, HU-002.2)', async () => {
    const auth = TestBed.inject(AuthService);
    await auth.login('tutor@example.com', PASSWORD);
    expect(
      NAV_ITEMS.filter((i) => auth.can(i.permission)).every((i) => i.section === 'Mi familia'),
    ).toBe(true);
    auth.logout();
    await auth.login('coach@example.com', PASSWORD);
    expect(
      NAV_ITEMS.filter((i) => auth.can(i.permission)).every((i) => i.section === 'Mi panel'),
    ).toBe(true);
  });

  async function settle(harness: RouterTestingHarness) {
    await new Promise((r) => setTimeout(r, 600)); // mock latency (sequential loads)
    harness.detectChanges();
    await harness.fixture.whenStable();
    return harness.routeNativeElement as HTMLElement;
  }

  for (const email of USERS) {
    it(`${email}: every menu page renders without load errors`, async () => {
      const auth = TestBed.inject(AuthService);
      await auth.login(email, PASSWORD);
      const harness = await RouterTestingHarness.create();
      for (const item of NAV_ITEMS.filter((i) => auth.can(i.permission))) {
        await harness.navigateByUrl(item.path);
        const el = await settle(harness);
        expect(el.querySelector('h1')?.textContent, item.path).toBeTruthy();
        expect(el.textContent, item.path).not.toContain('No se pudo cargar');
        // HU-071: every table can scroll horizontally on narrow screens instead of breaking the layout.
        for (const table of Array.from(el.querySelectorAll('table')))
          expect(
            table.closest('.table-wrap'),
            `${item.path}: tabla sin .table-wrap`,
          ).not.toBeNull();
      }
    }, 60_000);
  }

  it('renders detail pages: receipt, player record, child (own) and session', async () => {
    const auth = TestBed.inject(AuthService);
    await auth.login('admin@example.com', PASSWORD);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/billing/receipts/1');
    expect((await settle(harness)).textContent).toContain('R-0001');
    await harness.navigateByUrl('/admin/players/1');
    expect((await settle(harness)).textContent).toContain('J-0001');
    await harness.navigateByUrl('/sports/trainings/1');
    expect((await settle(harness)).textContent).toContain('Asistencia');
    auth.logout();
    await auth.login('tutor@example.com', PASSWORD);
    await harness.navigateByUrl('/portal/children/1');
    expect((await settle(harness)).textContent).toContain('Diego');
  }, 30_000);

  it("a tutor opening another family's child sees an error, not the data (HU-003.2)", async () => {
    await TestBed.inject(AuthService).login('tutor@example.com', PASSWORD);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/portal/children/3'); // Mateo is Jorge Ruiz's son
    const el = await settle(harness);
    expect(el.textContent).toContain('No se pudo cargar');
    expect(el.textContent).not.toContain('Mateo');
  });
});

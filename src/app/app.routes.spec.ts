import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appConfig } from './app.config';
import { AuthService } from './core/auth/auth.service';
import { NAV_ITEMS } from './layout/nav';

/** Smoke test: every menu route renders for a role that can see it, and protected navigation redirects. */
describe('routes', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: appConfig.providers });
  });

  async function settle(harness: RouterTestingHarness) {
    await new Promise((r) => setTimeout(r, 400)); // mock latency
    harness.detectChanges();
    await harness.fixture.whenStable();
    return harness.routeNativeElement as HTMLElement;
  }

  for (const email of ['admin@charales.mx', 'coach@charales.mx', 'tutor@charales.mx']) {
    it(`renders every allowed page for ${email}`, async () => {
      const auth = TestBed.inject(AuthService);
      await auth.login(email, 'x');
      const harness = await RouterTestingHarness.create();
      for (const item of NAV_ITEMS.filter((i) => auth.can(i.permission))) {
        await harness.navigateByUrl(item.path);
        const el = await settle(harness);
        expect(TestBed.inject(Router).url, item.path).toBe(item.path);
        expect(el.querySelector('h1')?.textContent, item.path).toBeTruthy();
        expect(el.textContent, item.path).not.toContain('No se pudo cargar');
      }
    }, 30_000);
  }

  it('redirects anonymous users to login and tutors away from office pages', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/users');
    expect(TestBed.inject(Router).url).toBe('/login?returnUrl=%2Fadmin%2Fusers');

    await TestBed.inject(AuthService).login('tutor@charales.mx', 'x');
    await harness.navigateByUrl('/admin/billing/debts');
    expect(TestBed.inject(Router).url).toBe('/forbidden');
  });

  it('renders a receipt with its lines', async () => {
    await TestBed.inject(AuthService).login('secretaria@charales.mx', 'x');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/billing/receipts/pay1');
    const el = await settle(harness);
    expect(el.textContent).toContain('R-0001');
    expect(el.textContent).toContain('Mensualidad 2026-09');
  });
});

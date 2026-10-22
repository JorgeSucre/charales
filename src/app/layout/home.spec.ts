import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { baseProviders } from '../app.config';
import { AuthService } from '../core/auth/auth.service';
import { QUICK_ACCESS } from './nav';

/** Inicio and the shell header over MockDb: quick access by permission, real indicators, context and user menu. */
describe('Inicio and shell header', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [...baseProviders, provideHttpClientTesting()] });
  });
  afterEach(() => vi.useRealTimers());

  let harness: RouterTestingHarness;

  async function open(email: string, url: string): Promise<HTMLElement> {
    await TestBed.inject(AuthService).login(email, 'demo1234');
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    return settle();
  }

  async function settle(): Promise<HTMLElement> {
    await new Promise((r) => setTimeout(r, 600)); // mock latency
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    return harness.fixture.nativeElement as HTMLElement;
  }

  const texts = (el: HTMLElement, selector: string) =>
    [...el.querySelectorAll(selector)].map((e) => e.textContent!.trim());

  it('administrador: indicators from the dashboard service, every quick card once, not repeated below', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 21, 12, 0));
    const el = await open('admin@example.com', '/');
    expect(el.querySelector('.context')!.textContent).toContain('Inicio');
    const kpis = texts(el, '.kpis.six .kpi span');
    expect(kpis).toHaveLength(6);
    expect(kpis).toContain('Jugadores activos');
    // The service's «Ingresos 2026-10-01 a 2026-10-21», named in Spanish; the figure is untouched.
    expect(kpis).toContain('Ingresos del 1 al 21 de octubre de 2026');
    expect(kpis.join(' ')).not.toMatch(/\d{4}-\d{2}-\d{2}/);

    const quick = [...el.querySelectorAll<HTMLAnchorElement>('.card.module')].map((a) =>
      a.getAttribute('href'),
    );
    expect(quick).toEqual(Object.keys(QUICK_ACCESS));
    const others = [...el.querySelectorAll('.module-row a')].map((a) => a.getAttribute('href'));
    expect(others.filter((p) => quick.includes(p))).toEqual([]);
    expect(others).toContain('/admin/audit');
    // Nothing of the menu is lost on Inicio: every side-menu link is a quick card or in «Otros módulos».
    const menu = [...el.querySelectorAll('#nav-links a')]
      .map((a) => a.getAttribute('href'))
      .filter((p) => p !== '/');
    expect([...quick, ...others].sort()).toEqual(menu.sort());
  }, 20_000);

  it('secretaría: no quick card for a module outside her role; header names section and page', async () => {
    const el = await open('secretaria@example.com', '/sports/categories');
    expect(texts(el, '.context span')).toEqual(['/', 'Gestión deportiva', '/', 'Categorías']);

    await harness.navigateByUrl('/');
    const home = await settle();
    const links = [...home.querySelectorAll('main a')].map((a) => a.getAttribute('href'));
    expect(links).not.toContain('/admin/audit');
    expect(links).toContain('/admin/billing/payments/new');
  }, 20_000);

  it('user menu: Escape closes it and returns focus to its button', async () => {
    const el = await open('admin@example.com', '/');
    const menu = el.querySelector<HTMLDetailsElement>('.user-menu')!;
    menu.open = true;
    menu
      .querySelector('a')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(menu.querySelector('summary'));
  }, 20_000);

  it('phone menu: «Menú» opens it, Escape inside closes it and returns focus to «Menú»', async () => {
    const el = await open('secretaria@example.com', '/');
    const nav = el.querySelector<HTMLElement>('nav.sidenav')!;
    const toggle = el.querySelector<HTMLButtonElement>('.menu-toggle')!;
    toggle.click();
    harness.detectChanges();
    expect(nav.classList).toContain('open');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    nav
      .querySelector('#nav-links a')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    harness.detectChanges();
    expect(nav.classList).not.toContain('open');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  }, 20_000);
});

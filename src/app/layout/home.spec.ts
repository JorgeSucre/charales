import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { Router } from '@angular/router';
import { baseProviders } from '../app.config';
import { AuthService } from '../core/auth/auth.service';
import { MockDb } from '../core/data/mock-db';
import { RoleService } from '../features/users/role.service';
import { QUICK_TASKS } from './nav';

/** The Tablero is the main page: '/' sends each session to its own; the menu has no «Inicio»; header and menus. */
describe('main page (Tablero) and shell header', () => {
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
  const path = () => TestBed.inject(Router).url;

  /** As the administrator would, through the permissions screen (HU-006); then the user logs in again. */
  async function revoke(role: number, key: string): Promise<void> {
    const auth = TestBed.inject(AuthService);
    await auth.login('admin@example.com', 'demo1234');
    const [module, action] = key.split('.');
    const p = TestBed.inject(MockDb).permissions.find(
      (x) => x.module === module && x.action === action,
    )!;
    await TestBed.inject(RoleService).setPermission(role, p.id, false);
    auth.logout();
  }

  it('staff land on the Tablero: login target, the old «/» and the brand all lead there', async () => {
    const el = await open('admin@example.com', '/');
    expect(path()).toBe('/admin/dashboard');
    expect(TestBed.inject(AuthService).homeUrl()).toBe('/admin/dashboard');
    expect(texts(el, '.context span')).toEqual(['/', 'Resumen', '/', 'Tablero']);
    expect(el.querySelector('h1')?.textContent).toContain('Tablero');
    expect(el.querySelector('.sidenav-brand')?.getAttribute('href')).toBe('/admin/dashboard');
  }, 20_000);

  it('the menu keeps its sections and groups but no «Inicio», and nothing lists the modules again', async () => {
    const el = await open('admin@example.com', '/admin/dashboard');
    const nav = el.querySelector('#nav-links')!;
    expect(nav.querySelector('a[href="/"]')).toBeNull();
    expect(nav.textContent).not.toContain('Inicio');
    expect(texts(el, '.nav-section .nav-label')).toContain('Resumen');
    expect(el.querySelector('.module-index, .module-row')).toBeNull();
    expect(el.textContent).not.toContain('Otros módulos');
    // the active group of the Tablero is open and marked
    const group = [...el.querySelectorAll('.nav-group')].find((g) =>
      g.textContent?.includes('Tablero'),
    )!;
    expect(group.classList).toContain('current');
    expect(group.querySelector('a[aria-current="page"]')?.textContent).toContain('Tablero');
  }, 20_000);

  it('quick tasks: a short list of frequent tasks, each linked to its page', async () => {
    const el = await open('secretaria@example.com', '/admin/dashboard');
    expect(texts(el, '.card.module strong')).toEqual(QUICK_TASKS.map((t) => t.label));
    const tutor = [...el.querySelectorAll<HTMLAnchorElement>('.card.module')].find((a) =>
      a.textContent?.includes('Registrar tutor'),
    )!;
    expect(tutor.getAttribute('href')).toBe('/admin/tutors?nuevo=1');
  }, 20_000);

  it('quick tasks: a task the role cannot perform is not offered', async () => {
    await revoke(2, 'partidos.crear');
    const el = await open('secretaria@example.com', '/admin/dashboard');
    expect(texts(el, '.card.module strong')).toEqual(
      QUICK_TASKS.map((t) => t.label).filter((l) => l !== 'Programar partido'),
    );
  }, 20_000);

  it('a quick task opens the create form of its page at once (?nuevo=1)', async () => {
    const el = await open('secretaria@example.com', '/admin/tutors?nuevo=1');
    await settle();
    expect(el.querySelector('#tutor-form')).not.toBeNull();
  }, 20_000);

  it('a role without the Tablero stays on «/» with a short notice, never a module directory', async () => {
    await revoke(2, 'reportes.consultar');
    const el = await open('secretaria@example.com', '/');
    expect(path()).toBe('/');
    expect(TestBed.inject(AuthService).homeUrl()).toBe('/');
    expect(el.querySelector('main')?.textContent).toContain('Usa el menú');
    expect(el.querySelectorAll('main a').length).toBe(0);
    expect(el.querySelector('.context .page')).toBeNull();
  }, 20_000);

  it('user menu: Escape closes it and returns focus to its button', async () => {
    const el = await open('admin@example.com', '/admin/dashboard');
    const menu = el.querySelector<HTMLDetailsElement>('.user-menu')!;
    menu.open = true;
    menu
      .querySelector('a')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(menu.querySelector('summary'));
  }, 20_000);

  it('phone menu: «Menú» opens it, Escape inside closes it and returns focus to «Menú»', async () => {
    const el = await open('secretaria@example.com', '/admin/dashboard');
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

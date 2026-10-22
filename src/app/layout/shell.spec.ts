import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { baseProviders } from '../app.config';
import { AuthService } from '../core/auth/auth.service';
import { NAV_ITEMS } from './nav';
import { activeNavPath } from './shell';

describe('activeNavPath (menu item of the current URL)', () => {
  const paths = NAV_ITEMS.map((i) => i.path);

  it('a detail page marks its module', () => {
    expect(activeNavPath('/admin/players/7', paths)).toBe('/admin/players');
    expect(activeNavPath('/admin/players/7/edit', paths)).toBe('/admin/players');
    expect(activeNavPath('/admin/billing/receipts/1', paths)).toBe('/admin/billing/receipts');
    expect(activeNavPath('/sports/trainings/3', paths)).toBe('/sports/trainings');
    expect(activeNavPath('/portal/children/3', paths)).toBe('/portal');
  });

  it('overlapping prefixes mark only the longest one', () => {
    expect(activeNavPath('/admin/coaches', paths)).toBe('/admin/coaches');
    expect(activeNavPath('/admin/coaches/categories', paths)).toBe('/admin/coaches/categories');
    expect(activeNavPath('/admin/coaches/assignments', paths)).toBe('/admin/coaches/assignments');
    expect(activeNavPath('/coach', paths)).toBe('/coach');
    expect(activeNavPath('/coach/sessions/3', paths)).toBe('/coach/sessions');
    expect(activeNavPath('/portal/notices', paths)).toBe('/portal/notices');
  });

  it('ignores query and fragment, and does not match by bare text prefix', () => {
    expect(activeNavPath('/admin/billing/statement?player=3', paths)).toBe(
      '/admin/billing/statement',
    );
    expect(activeNavPath('/coaching', paths)).toBeNull();
    expect(activeNavPath('/', paths)).toBeNull();
    expect(activeNavPath('/account/password', paths)).toBeNull();
  });

  it('only considers the items the session can see', () => {
    expect(activeNavPath('/admin/coaches/categories', ['/admin/coaches'])).toBe('/admin/coaches');
  });
});

/** The side menu on the real shell over MockDb (jsdom: no media queries, so the expanded desktop menu). */
describe('side menu (groups, compact mode, phone panel)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [...baseProviders, provideHttpClientTesting()] });
  });

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

  const group = (el: HTMLElement, name: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('.nav-section')].find(
      (b) => b.textContent!.trim() === name,
    )!;
  const links = (el: HTMLElement, button: HTMLButtonElement) =>
    el.querySelector<HTMLElement>('#' + button.getAttribute('aria-controls'))!;

  it('only the active page’s group starts open; groups toggle independently; the active link is kept', async () => {
    const el = await open('secretaria@example.com', '/sports/categories');
    const sports = group(el, 'Gestión deportiva');
    const billing = group(el, 'Cobranza');
    expect(sports.getAttribute('aria-expanded')).toBe('true');
    expect(links(el, sports).hidden).toBe(false);
    expect(billing.getAttribute('aria-expanded')).toBe('false');
    expect(links(el, billing).hidden).toBe(true);
    expect(el.querySelector('#nav-links a[aria-current=page]')!.getAttribute('href')).toBe(
      '/sports/categories',
    );

    billing.click();
    harness.detectChanges();
    expect(billing.getAttribute('aria-expanded')).toBe('true');
    expect(sports.getAttribute('aria-expanded')).toBe('true'); // independent
    sports.click();
    harness.detectChanges();
    expect(links(el, sports).hidden).toBe(true);

    // Navigating into a closed group opens it; the user's other open groups stay as they were.
    await harness.navigateByUrl('/sports/venues');
    await settle();
    expect(sports.getAttribute('aria-expanded')).toBe('true');
    expect(billing.getAttribute('aria-expanded')).toBe('true');
  }, 20_000);

  it('no link without permission: secretaría gets no Sistema links for users, permissions or audit', async () => {
    const el = await open('secretaria@example.com', '/');
    const hrefs = [...el.querySelectorAll('#nav-links a')].map((a) => a.getAttribute('href'));
    for (const path of ['/admin/users', '/admin/permissions', '/admin/audit'])
      expect(hrefs).not.toContain(path);
    expect(hrefs).toContain('/admin/players');
  }, 20_000);

  it('compact mode: the header button collapses it; an area button expands it, opens the area and focuses its first link', async () => {
    const el = await open('admin@example.com', '/');
    const railToggle = el.querySelector<HTMLButtonElement>('.rail-toggle')!;
    expect(railToggle.getAttribute('aria-expanded')).toBe('true');
    railToggle.click();
    harness.detectChanges();
    expect(el.querySelector('.layout')!.classList).toContain('rail');
    expect(railToggle.getAttribute('aria-expanded')).toBe('false');
    expect(railToggle.textContent).toContain('Expandir menú lateral');
    const billing = group(el, 'Cobranza');
    expect(billing.getAttribute('data-tip')).toBe('Cobranza'); // tooltip; the name stays in the button

    billing.click();
    await settle();
    expect(el.querySelector('.layout')!.classList).not.toContain('rail');
    expect(billing.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(links(el, billing).querySelector('a'));
  }, 20_000);

  it('phone panel: opening focuses «Cerrar menú» and makes the page inert; a link or the backdrop close it', async () => {
    const el = await open('admin@example.com', '/');
    const toggle = el.querySelector<HTMLButtonElement>('.menu-toggle')!;
    toggle.click();
    await settle();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(el.querySelector('.drawer-close'));
    expect(el.querySelector('main')!.hasAttribute('inert')).toBe(true);
    expect(el.querySelector('.topbar')!.hasAttribute('inert')).toBe(true);

    // A group button keeps the panel open.
    group(el, 'Cobranza').click();
    harness.detectChanges();
    expect(el.querySelector('nav.sidenav')!.classList).toContain('open');

    el.querySelector<HTMLElement>('.nav-backdrop')!.click();
    harness.detectChanges();
    expect(el.querySelector('nav.sidenav')!.classList).not.toContain('open');
    expect(el.querySelector('main')!.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(toggle);

    toggle.click();
    await settle();
    el.querySelector<HTMLAnchorElement>('#nav-links a[href="/admin/players"]')!.click();
    await settle();
    expect(el.querySelector('nav.sidenav')!.classList).not.toContain('open');
    expect(TestBed.inject(Router).url).toBe('/admin/players');
  }, 20_000);
});

import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { baseProviders } from '../../app.config';
import { AuthService } from '../../core/auth/auth.service';

/** F3.1: focus after a rejected submit, status tones and the empty state, on the real pages over MockDb. */
describe('players pages (F3.1)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 7, 12, 0));
    TestBed.configureTestingModule({ providers: [...baseProviders, provideHttpClientTesting()] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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
    return harness.routeNativeElement as HTMLElement;
  }

  it('a rejected registration focuses the first invalid field; typing does not move focus', async () => {
    const el = await open('secretaria@example.com', '/admin/players/new');
    el.querySelector<HTMLButtonElement>('form button[type=submit]')!.click();
    await settle();
    expect(document.activeElement).toBe(el.querySelector('[formcontrolname=firstName]'));
    expect(el.textContent).toContain('Campo requerido.');

    const last = el.querySelector<HTMLInputElement>('[formcontrolname=lastName1]')!;
    last.focus();
    last.value = 'Pérez';
    last.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(document.activeElement).toBe(last);
  }, 20_000);

  it('a status change without a reason focuses the reason and never reaches confirm()', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const el = await open('admin@example.com', '/admin/players/1');
    [...el.querySelectorAll<HTMLButtonElement>('[role=tab]')]
      .find((b) => /estatus/i.test(b.textContent ?? ''))!
      .click();
    await settle();
    [...el.querySelectorAll<HTMLButtonElement>('button[type=submit]')]
      .find((b) => b.textContent?.includes('Cambiar estatus'))!
      .click();
    await settle();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(el.querySelector('input[name=statusReason]'));
    expect(el.textContent).toContain('Campo requerido.');
  }, 20_000);

  it('status tags keep their label and get the approved tone', async () => {
    const el = await open('admin@example.com', '/admin/players');
    const tags = [...el.querySelectorAll('td .tag')];
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      const label = tag.textContent?.trim();
      const tone = { Activo: 'ok', 'Baja temporal': 'warn', 'Baja definitiva': 'danger' }[label!];
      expect(tone, `etiqueta inesperada «${label}»`).toBeDefined();
      expect(tag.classList).toContain(tone);
    }
  }, 20_000);

  it('an empty result shows the styled empty state, not an error', async () => {
    const el = await open('admin@example.com', '/admin/players');
    const search = el.querySelector<HTMLInputElement>('input[type=search]')!;
    search.value = 'zzzz-nadie';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    const empty = el.querySelector('app-load-state > p.empty');
    expect(empty?.textContent).toContain('Ningún jugador coincide');
    expect(el.querySelector('.alert.error')).toBeNull();
  }, 20_000);
});

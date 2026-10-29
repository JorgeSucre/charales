import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { baseProviders } from '../../app.config';
import { AuthService } from '../../core/auth/auth.service';
import { MockDb } from '../../core/data/mock-db';
import { TutorService } from '../tutors/tutor.service';

/** F3.1: focus after a rejected submit, status tones, record header, tabs and the empty state, over MockDb. */
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

  const statusTab = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLButtonElement>('[role=tab]')].find((b) =>
      /estatus/i.test(b.textContent ?? ''),
    )!;

  const tutorsTab = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLButtonElement>('[role=tab]')].find((b) =>
      /tutores/i.test(b.textContent ?? ''),
    )!;

  it('HU-011: the Tutores tab makes a linked tutor the primary contact in one click', async () => {
    await TestBed.inject(AuthService).login('secretaria@example.com', 'demo1234');
    const ana = await TestBed.inject(TutorService).save({
      firstName: 'Ana',
      lastName1: 'Segunda',
      lastName2: null,
      phone: '3311110000',
      email: null,
      address: null,
      links: [{ playerId: 4, relationship: 'Madre', isPrimary: false }],
    });
    let el = await open('secretaria@example.com', '/admin/players/4');
    tutorsTab(el).click();
    el = await settle();
    expect(el.querySelector('#record-panel .tag.warn')).toBeNull();
    [...el.querySelectorAll<HTMLButtonElement>('#record-panel button')]
      .find((b) => /hacer contacto principal/i.test(b.textContent ?? ''))!
      .click();
    el = await settle();
    const db = TestBed.inject(MockDb);
    expect(db.tutorPlayers.filter((tp) => tp.playerId === 4 && tp.isPrimary)).toEqual([
      expect.objectContaining({ tutorId: ana.id }),
    ]);
    expect(el.textContent).toContain('Contacto principal actualizado.');
  }, 20_000);

  it('HU-011: a player with tutors but no primary contact is flagged in the Tutores tab', async () => {
    const db = TestBed.inject(MockDb);
    db.tutorPlayers = db.tutorPlayers.map((tp) =>
      tp.playerId === 4 ? { ...tp, isPrimary: false } : tp,
    );
    let el = await open('secretaria@example.com', '/admin/players/4');
    tutorsTab(el).click();
    el = await settle();
    expect(el.querySelector('#record-panel .tag.warn')?.textContent).toContain(
      'Sin contacto principal.',
    );
  }, 20_000);

  it('HU-014.4: each search result links to the player record', async () => {
    let el = await open('secretaria@example.com', '/admin/players');
    const link = [...el.querySelectorAll<HTMLAnchorElement>('table a')].find((a) =>
      /diego/i.test(a.textContent ?? ''),
    )!;
    expect(link.getAttribute('href')).toBe('/admin/players/1');
    link.click();
    el = await settle();
    expect(el.querySelector('h1')?.textContent).toContain('Diego');
  }, 20_000);

  it('a rejected registration focuses the first invalid field; typing does not move focus', async () => {
    const el = await open('secretaria@example.com', '/admin/players/new');
    expect([...el.querySelectorAll('fieldset > legend')].map((l) => l.textContent)).toEqual([
      'Datos personales',
      'Contacto del jugador',
    ]);
    el.querySelector<HTMLButtonElement>('form button[type=submit]')!.click();
    await settle();
    expect(document.activeElement).toBe(el.querySelector('[formcontrolname=firstName]'));
    expect(el.textContent).toContain('Este campo es obligatorio.');

    const last = el.querySelector<HTMLInputElement>('[formcontrolname=lastName1]')!;
    last.focus();
    last.value = 'Pérez';
    last.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(document.activeElement).toBe(last);
  }, 20_000);

  it('status change keeps its flow: an empty reason still asks confirm() and shows the service error', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const el = await open('admin@example.com', '/admin/players/1');
    statusTab(el).click();
    await settle();
    // Player 1 is active; the form proposes «Baja temporal» by default.
    const select = el.querySelector<HTMLSelectElement>('select[name=status]')!;
    expect(select.value).toBe('BAJA_TEMPORAL');
    expect(el.querySelector<HTMLInputElement>('input[name=statusReason]')!.value).toBe('');
    [...el.querySelectorAll<HTMLButtonElement>('button[type=submit]')]
      .find((b) => b.textContent?.includes('Cambiar estatus'))!
      .click();
    await settle();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('Falta el motivo. Es un dato obligatorio.');
  }, 20_000);

  it('record: summary with status, age, category and balance; tabs keep role=tab and point to their panel', async () => {
    const el = await open('admin@example.com', '/admin/players/1');
    expect([...el.querySelectorAll('.summary dt')].map((d) => d.textContent)).toEqual([
      'Estatus',
      'Edad',
      'Categoría',
      'Saldo',
    ]);
    const tablist = el.querySelector('[role=tablist]')!;
    expect(tablist.getAttribute('aria-label')).toBe('Secciones del expediente');
    const tabs = [...el.querySelectorAll<HTMLButtonElement>('[role=tab]')];
    expect(tabs.length).toBeGreaterThan(1);
    for (const t of tabs) expect(t.getAttribute('aria-controls')).toBe('record-panel');

    statusTab(el).click();
    await settle();
    const panel = el.querySelector('[role=tabpanel]')!;
    expect(panel.id).toBe('record-panel');
    expect(panel.getAttribute('aria-labelledby')).toBe(statusTab(el).id);
    expect(statusTab(el).getAttribute('aria-selected')).toBe('true');
  }, 20_000);

  it('status tags keep their label and get the approved tone', async () => {
    const el = await open('admin@example.com', '/admin/players');
    expect(el.querySelector('table caption')?.textContent).toContain('Jugadores encontrados');
    const tags = [...el.querySelectorAll('td .tag')];
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      const label = tag.textContent?.trim();
      const tone = { Activo: 'ok', 'Baja temporal': 'warn', 'Baja definitiva': 'danger' }[label!];
      expect(tone, `etiqueta inesperada «${label}»`).toBeDefined();
      expect(tag.classList).toContain(tone);
    }
  }, 20_000);

  it('an empty result shows the styled empty state with its own text, not an error', async () => {
    const el = await open('admin@example.com', '/admin/players');
    const search = el.querySelector<HTMLInputElement>('input[type=search]')!;
    search.value = 'zzzz-nadie';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    const empty = el.querySelector('app-load-state > p.empty');
    expect(empty?.textContent?.trim()).toBe('Sin resultados.');
    expect(el.querySelector('.alert.error')).toBeNull();
  }, 20_000);
});

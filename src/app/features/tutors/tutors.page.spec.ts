import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { baseProviders } from '../../app.config';
import { AuthService } from '../../core/auth/auth.service';
import { MockDb } from '../../core/data/mock-db';

/** HU-011 form: phone formats accepted as the API accepts them, and a warning before leaving a player without primary. */
describe('tutors page (HU-011)', () => {
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

  async function settle(): Promise<HTMLElement> {
    await new Promise((r) => setTimeout(r, 600)); // mock latency
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    return harness.routeNativeElement as HTMLElement;
  }

  async function open(): Promise<HTMLElement> {
    await TestBed.inject(AuthService).login('secretaria@example.com', 'demo1234');
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/tutors');
    return settle();
  }

  function type(el: HTMLElement, name: string, value: string): void {
    const input = el.querySelector<HTMLInputElement>(`[formcontrolname=${name}]`)!;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('blur'));
  }

  async function editTeresa(el: HTMLElement): Promise<HTMLElement> {
    const row = [...el.querySelectorAll('tbody tr')].find((r) =>
      r.textContent?.includes('Teresa'),
    )!;
    row.querySelector<HTMLButtonElement>('button')!.click();
    return settle();
  }

  it('the phone field accepts separators and international numbers, and explains a wrong one', async () => {
    let el = await editTeresa(await open());
    type(el, 'phone', '+1 (555) 123-4567');
    el = await settle();
    expect(el.textContent).not.toContain('Ingresa un número de teléfono válido');
    type(el, 'phone', '123');
    el = await settle();
    expect(el.textContent).toContain('Ingresa un número de teléfono válido: de 10 a 15 dígitos');
    // Accessible: the field is marked invalid and points to the message that explains it (FieldA11y).
    const phone = el.querySelector<HTMLInputElement>('[formcontrolname=phone]')!;
    expect(phone.getAttribute('aria-invalid')).toBe('true');
    const message = document.getElementById(phone.getAttribute('aria-describedby')!);
    expect(message?.textContent).toContain('Ingresa un número de teléfono válido');
    type(el, 'phone', '33 1234 5678');
    el = await settle();
    expect(phone.hasAttribute('aria-invalid')).toBe(false);
    expect(phone.hasAttribute('aria-describedby')).toBe(false);
  }, 20_000);

  it('unchecking a primary contact asks first; cancelling saves nothing, accepting leaves the player without one', async () => {
    const db = TestBed.inject(MockDb);
    const primaries = () => db.tutorPlayers.filter((tp) => tp.tutorId === 1 && tp.isPrimary).length;
    let el = await editTeresa(await open());
    const before = primaries();
    expect(before).toBeGreaterThan(0);
    const box = el.querySelector<HTMLInputElement>('[formcontrolname=isPrimary]')!;
    box.click();
    el = await settle();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    el.querySelector<HTMLButtonElement>('form button[type=submit]')!.click();
    el = await settle();
    expect(confirm.mock.calls[0][0]).toMatch(/quedará sin contacto principal/);
    expect(primaries()).toBe(before);

    confirm.mockReturnValue(true);
    el.querySelector<HTMLButtonElement>('form button[type=submit]')!.click();
    await settle();
    expect(primaries()).toBe(before - 1);
  }, 20_000);

  it('Phase 4B: unified editing workspace shows portal access status and keeps one form[id]', async () => {
    let el = await editTeresa(await open());
    const workspace = el.querySelector('.tutor-workspace.with-portal');
    expect(workspace).not.toBeNull();
    expect(el.querySelectorAll('form[id]').length).toBe(1);
    const portal = workspace!.querySelector('.portal-panel')!;
    expect(portal.textContent).toContain('Acceso al portal familiar');
    expect(portal.textContent).toContain('Activo');

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    [...portal.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => /desvincular cuenta/i.test(b.textContent ?? ''))!
      .click();
    el = await settle();
    expect(el.querySelector('.portal-panel')?.textContent).toContain('Sin acceso');
  }, 20_000);

  it('Phase 4B: search filter shows count and Limpiar button resets the query; multiple player links can be added', async () => {
    let el = await open();
    const search = el.querySelector<HTMLInputElement>('input[type=search]')!;
    search.value = 'zzzz-nadie';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    el = await settle();
    expect(el.querySelector('app-load-state > p.empty')).not.toBeNull();

    const clearBtn = [...el.querySelectorAll<HTMLButtonElement>('.filters button')].find((b) =>
      /limpiar/i.test(b.textContent ?? ''),
    )!;
    clearBtn.click();
    el = await settle();
    expect(el.querySelectorAll('tbody tr').length).toBeGreaterThan(0);

    el = await editTeresa(el);
    const beforeLinks = el.querySelectorAll('.link-row').length;
    [...el.querySelectorAll<HTMLButtonElement>('#tutor-form button')]
      .find((b) => /agregar otro jugador/i.test(b.textContent ?? ''))!
      .click();
    el = await settle();
    expect(el.querySelectorAll('.link-row').length).toBe(beforeLinks + 1);
  }, 20_000);
});

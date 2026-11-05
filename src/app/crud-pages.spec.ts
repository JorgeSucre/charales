import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { baseProviders } from './app.config';
import { AuthService } from './core/auth/auth.service';
import { MockDb } from './core/data/mock-db';
import { DISCARD_MESSAGE } from './shared/form-panel';

/**
 * List-first CRUD pages (docs/DEVELOPMENT.md § 5.2), over MockDb: every create form starts closed, opens from its
 * button (aria-expanded, focus on its first field), and closing it never writes; with unsaved changes it asks first.
 */
type Table = keyof MockDb & string;
interface PageCase {
  name: string;
  url: string;
  button: RegExp;
  form: string;
  table: Table;
  who?: 'admin' | 'secretaria';
  /** false: the form has nothing worth confirming (dates with defaults only). */
  asks?: boolean;
}

const PAGES: PageCase[] = [
  {
    name: 'Tutores',
    url: '/admin/tutors',
    button: /registrar tutor/i,
    form: 'tutor-form',
    table: 'tutors',
  },
  {
    name: 'Entrenadores',
    url: '/admin/coaches',
    button: /registrar entrenador/i,
    form: 'coach-form',
    table: 'coaches',
  },
  {
    name: 'Usuarios',
    url: '/admin/users',
    button: /nueva cuenta/i,
    form: 'user-form',
    table: 'users',
    who: 'admin',
  },
  {
    name: 'Temporadas',
    url: '/admin/seasons',
    button: /nueva temporada/i,
    form: 'season-form',
    table: 'seasons',
  },
  {
    name: 'Sedes',
    url: '/sports/venues',
    button: /nueva sede/i,
    form: 'venue-form',
    table: 'venues',
  },
  {
    name: 'Categorías',
    url: '/sports/categories',
    button: /nueva categoría/i,
    form: 'category-form',
    table: 'categories',
  },
  {
    name: 'Competencias',
    url: '/sports/competitions',
    button: /nueva competencia/i,
    form: 'competition-form',
    table: 'competitions',
  },
  {
    name: 'Conceptos',
    url: '/admin/billing/concepts',
    button: /nuevo concepto/i,
    form: 'concept-form',
    table: 'concepts',
  },
  {
    name: 'Cargos',
    url: '/admin/billing/charges',
    button: /nuevo cargo manual/i,
    form: 'charge-form',
    table: 'charges',
  },
  {
    name: 'Descuentos',
    url: '/admin/billing/discounts',
    button: /registrar ajuste/i,
    form: 'discount-form',
    table: 'discounts',
    who: 'admin',
  },
  {
    name: 'Inscripciones',
    url: '/admin/enrollments',
    button: /nueva inscripción/i,
    form: 'enrollment-form',
    table: 'enrollments',
  },
  {
    name: 'Avisos',
    url: '/admin/notices',
    button: /nuevo aviso/i,
    form: 'notice-form',
    table: 'notices',
  },
  {
    name: 'Productos',
    url: '/admin/uniforms/catalog',
    button: /nuevo producto/i,
    form: 'product-form',
    table: 'uniformProducts',
  },
  {
    name: 'Tallas',
    url: '/admin/uniforms/catalog',
    button: /nueva talla/i,
    form: 'variant-form',
    table: 'uniformVariants',
  },
  {
    name: 'Pedidos',
    url: '/admin/uniforms/orders',
    button: /nuevo pedido/i,
    form: 'order-form',
    table: 'uniformOrders',
  },
  {
    name: 'Sesiones',
    url: '/sports/trainings',
    button: /programar sesión/i,
    form: 'program-form',
    table: 'trainingSessions',
  },
  {
    name: 'Generar sesiones',
    url: '/sports/trainings',
    button: /generar desde horarios/i,
    form: 'generate-form',
    table: 'trainingSessions',
    asks: false,
  },
  {
    name: 'Partidos',
    url: '/sports/matches',
    button: /programar partido/i,
    form: 'schedule-form',
    table: 'matches',
  },
  {
    name: 'Rivales',
    url: '/sports/matches',
    button: /nuevo rival/i,
    form: 'opponent-form',
    table: 'opponents',
  },
  {
    name: 'Entrenadores por categoría',
    url: '/admin/coaches/categories',
    button: /asignar entrenador/i,
    form: 'category-assignment-form',
    table: 'coachCategories',
  },
  {
    name: 'Entrenadores por torneo',
    url: '/admin/coaches/assignments',
    button: /asignar entrenador/i,
    form: 'competition-assignment-form',
    table: 'coachCompetitions',
  },
  {
    name: 'Horarios de una categoría',
    url: '/sports/categories/1',
    button: /agregar horario/i,
    form: 'schedule-form',
    table: 'schedules',
  },
  {
    name: 'Categorías participantes',
    url: '/sports/competitions/1',
    button: /inscribir categoría/i,
    form: 'register-form',
    table: 'competitionCategories',
  },
];

describe('list-first CRUD pages', () => {
  let harness: RouterTestingHarness;
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 7, 12, 0));
    TestBed.configureTestingModule({ providers: [...baseProviders, provideHttpClientTesting()] });
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function settle(): Promise<HTMLElement> {
    await new Promise((r) => setTimeout(r, 600)); // mock latency
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    return harness.routeNativeElement as HTMLElement;
  }

  async function open(url: string, who = 'secretaria'): Promise<HTMLElement> {
    await TestBed.inject(AuthService).login(`${who}@example.com`, 'demo1234');
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    return settle();
  }

  const button = (el: HTMLElement, text: RegExp) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      text.test(b.textContent ?? ''),
    );
  const rows = (table: Table) => (TestBed.inject(MockDb)[table] as unknown[]).length;

  /** Types into the first editable field of the form, as a user would. */
  function change(form: HTMLElement): void {
    const input = form.querySelector<HTMLInputElement>(
      'input:not([type=checkbox]):not([type=hidden]):not([type=radio]), textarea',
    );
    if (input) {
      const kind = input.getAttribute('type');
      input.value =
        kind === 'date'
          ? '2026-12-01'
          : kind === 'number'
            ? '7'
            : kind === 'time'
              ? '09:15'
              : 'Cambio';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const select = form.querySelector<HTMLSelectElement>('select')!;
    select.selectedIndex = select.options.length - 1;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  for (const p of PAGES)
    it(`${p.name}: the form starts closed, opens from its button, and closing it never writes`, async () => {
      let el = await open(p.url, p.who);
      expect(el.querySelector(`#${p.form}`)).toBeNull();
      const trigger = button(el, p.button)!;
      expect(trigger, `${p.name}: create button`).toBeTruthy();
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(trigger.getAttribute('aria-controls')).toBe(p.form);
      const before = rows(p.table);

      trigger.click();
      el = await settle();
      let form = el.querySelector<HTMLFormElement>(`#${p.form}`)!;
      expect(form, `${p.name}: form open`).toBeTruthy();
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(form.contains(document.activeElement)).toBe(true); // focus moved into the form

      // An untouched form closes without asking.
      button(form, /^\s*cancelar\s*$/i)!.click();
      el = await settle();
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(el.querySelector(`#${p.form}`)).toBeNull();

      // With changes: «keep editing» leaves it open; «discard» closes it. Nothing is written either way.
      button(el, p.button)!.click();
      el = await settle();
      form = el.querySelector<HTMLFormElement>(`#${p.form}`)!;
      change(form);
      el = await settle();
      confirmSpy.mockReturnValueOnce(false);
      button(form, /^\s*cancelar\s*$/i)!.click();
      el = await settle();
      if (p.asks !== false) {
        expect(confirmSpy).toHaveBeenCalledWith(DISCARD_MESSAGE);
        expect(el.querySelector(`#${p.form}`)).not.toBeNull();
        button(el.querySelector(`#${p.form}`)!, /^\s*cancelar\s*$/i)!.click();
        el = await settle();
      }
      expect(el.querySelector(`#${p.form}`)).toBeNull();
      expect(rows(p.table)).toBe(before);
    }, 20_000);

  function type(form: HTMLElement, name: string, value: string): void {
    const field = form.querySelector<HTMLInputElement | HTMLSelectElement>(
      `[formcontrolname=${name}], [name=${name}]`,
    )!;
    field.value = value;
    field.dispatchEvent(
      new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
    field.dispatchEvent(new Event('blur'));
  }

  it('Tutores: save creates the tutor, closes the form and updates the list; search finds it; edit and cancel keep it', async () => {
    let el = await open('/admin/tutors');
    button(el, /registrar tutor/i)!.click();
    el = await settle();
    let form = el.querySelector<HTMLFormElement>('#tutor-form')!;
    type(form, 'firstName', 'Inés');
    type(form, 'lastName1', "O'Neil-Ávila");
    type(form, 'phone', '+52 33 1234 5678');
    const player = form.querySelector<HTMLSelectElement>('[formcontrolname=playerId]')!;
    player.selectedIndex = 1;
    player.dispatchEvent(new Event('change', { bubbles: true }));
    type(form, 'relationship', 'Madre');
    form.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    el = await settle();
    expect(el.querySelector('#tutor-form')).toBeNull();
    expect(el.querySelector('.alert.ok')?.textContent).toContain('Tutor registrado.');
    expect(el.querySelector('tbody')?.textContent).toContain("Inés O'Neil-Ávila");

    // search keeps working after the create
    const search = el.querySelector<HTMLInputElement>('input[type=search]')!;
    search.value = 'Inés';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    el = await settle();
    expect([...el.querySelectorAll('tbody tr')].map((r) => r.textContent)).toEqual([
      expect.stringContaining('Inés'),
    ]);

    // edit opens with its data, as the only form; cancelling changes nothing
    button(el.querySelector('tbody tr')!, /editar/i)!.click();
    el = await settle();
    expect(el.querySelectorAll('form[id]').length).toBe(1);
    form = el.querySelector<HTMLFormElement>('#tutor-form')!;
    expect(form.querySelector('h2')?.textContent).toContain('Editar tutor');
    expect(form.querySelector<HTMLInputElement>('[formcontrolname=lastName1]')!.value).toBe(
      "O'Neil-Ávila",
    );
    type(form, 'firstName', 'Otra');
    button(form, /^\s*cancelar\s*$/i)!.click(); // confirm() answers true: discard
    el = await settle();
    expect(el.querySelector('#tutor-form')).toBeNull();
    const db = TestBed.inject(MockDb);
    expect(db.tutors.find((t) => t.lastName1 === "O'Neil-Ávila")?.firstName).toBe('Inés');
  }, 20_000);

  it('Sedes: create then edit through the same closed-by-default form; a catalog name may carry digits', async () => {
    let el = await open('/sports/venues');
    button(el, /nueva sede/i)!.click();
    el = await settle();
    let form = el.querySelector<HTMLFormElement>('#venue-form')!;
    type(form, 'name', 'Cancha 3 (techada)');
    form.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    el = await settle();
    expect(el.querySelector('#venue-form')).toBeNull();
    expect(el.querySelector('tbody')?.textContent).toContain('Cancha 3 (techada)');
    const row = [...el.querySelectorAll('tbody tr')].find((r) =>
      r.textContent?.includes('Cancha 3'),
    )!;
    button(row as HTMLElement, /editar/i)!.click();
    el = await settle();
    form = el.querySelector<HTMLFormElement>('#venue-form')!;
    expect(form.querySelector<HTMLInputElement>('[formcontrolname=name]')!.value).toBe(
      'Cancha 3 (techada)',
    );
    type(form, 'name', 'Cancha 3');
    form.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    el = await settle();
    expect(el.querySelector('#venue-form')).toBeNull();
    expect(el.querySelector('.alert.ok')?.textContent).toContain('Sede guardada.');
    expect(TestBed.inject(MockDb).venues.some((v) => v.name === 'Cancha 3')).toBe(true);
  }, 20_000);

  it('editing while another form has unsaved changes asks first, and «keep editing» keeps them', async () => {
    let el = await open('/sports/venues');
    button(el, /nueva sede/i)!.click();
    el = await settle();
    type(el.querySelector('#venue-form')!, 'name', 'A medias');
    confirmSpy.mockReturnValueOnce(false);
    button(el.querySelector('tbody tr')!, /editar/i)!.click();
    el = await settle();
    expect(confirmSpy).toHaveBeenCalledWith(DISCARD_MESSAGE);
    const name = el.querySelector<HTMLInputElement>('#venue-form [formcontrolname=name]')!;
    expect(name.value).toBe('A medias');
    expect(el.querySelector('#venue-form h2')?.textContent).toContain('Nueva sede');
  }, 20_000);

  it('permissions: Secretaría sees no create button where D12 denies it (discounts), and the page still lists', async () => {
    const el = await open('/admin/billing/discounts');
    expect(button(el, /registrar ajuste/i)).toBeUndefined();
    expect(el.querySelector('#discount-form')).toBeNull();
    expect(el.querySelector('h1')?.textContent).toContain('Descuentos y becas');
  }, 20_000);

  it('R21: a person name with digits shows its message next to its own field, linked for assistive technology', async () => {
    let el = await open('/admin/coaches');
    button(el, /registrar entrenador/i)!.click();
    el = await settle();
    const form = el.querySelector<HTMLFormElement>('#coach-form')!;
    type(form, 'firstName', 'Iván');
    type(form, 'lastName1', 'Soto2');
    type(form, 'lastName2', 'D’Ávila');
    el = await settle();
    const last1 = form.querySelector<HTMLInputElement>('[formcontrolname=lastName1]')!;
    expect(last1.getAttribute('aria-invalid')).toBe('true');
    const message = document.getElementById(last1.getAttribute('aria-describedby')!)!;
    expect(message.textContent).toContain('Escribe sólo letras, espacios, guiones, apóstrofos');
    expect(last1.closest('div')!.contains(message)).toBe(true); // under its own field, not the neighbour's
    expect(form.querySelector('[formcontrolname=lastName2]')!.hasAttribute('aria-invalid')).toBe(
      false,
    );
    expect(form.querySelector('[formcontrolname=firstName]')!.hasAttribute('aria-invalid')).toBe(
      false,
    );
  }, 20_000);
});

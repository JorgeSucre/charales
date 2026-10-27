import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { baseProviders } from '../../app.config';
import { AuthService } from '../../core/auth/auth.service';
import { BillingService } from './billing.service';

/** F3.2: billing pages over MockDb — tones, pattern B, guidance, and the amount checked before confirm(). */
describe('billing pages (F3.2)', () => {
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

  const TONES: Record<string, string> = {
    Pagado: 'ok',
    Aplicado: 'ok',
    Pendiente: 'warn',
    Parcial: 'warn',
    Vencido: 'danger',
    Cancelado: 'neutral',
  };
  function expectTones(tags: Element[]): void {
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      const label = tag.textContent!.trim();
      expect(TONES[label], `etiqueta inesperada «${label}»`).toBeDefined();
      expect(tag.classList).toContain(TONES[label]);
    }
  }

  const money = (text: string) => Number(text.replace(/[^0-9.]/g, ''));

  describe('Registrar pago', () => {
    // Lucía (player 2): charge 2 «Mensualidad» VENCIDO $600.00 and charge 5 «Uniforme» PENDIENTE $350.00.
    async function openLucia() {
      const el = await open('secretaria@example.com', '/admin/billing/payments/new?player=2');
      const box = (text: string) =>
        [...el.querySelectorAll<HTMLLabelElement>('fieldset label.check')]
          .find((l) => l.textContent!.includes(text))!
          .querySelector('input')!;
      const amount = () => el.querySelector<HTMLInputElement>('input[name=amount]')!;
      const type = async (value: string) => {
        amount().value = value;
        amount().dispatchEvent(new Event('input', { bubbles: true }));
        amount().dispatchEvent(new Event('blur'));
        await settle();
      };
      const submit = async () => {
        el.querySelector<HTMLButtonElement>('form button[type=submit]')!.click();
        await settle();
      };
      return { el, box, amount, type, submit };
    }

    it('without a player it asks to pick one', async () => {
      const el = await open('secretaria@example.com', '/admin/billing/payments/new');
      expect(el.querySelector('.hint')?.textContent).toContain('Elige un jugador');
      expect(el.querySelector<HTMLButtonElement>('form button[type=submit]')!.disabled).toBe(true);
    }, 20_000);

    it('with a player it asks to mark a charge, and shows the charges with their tones', async () => {
      const { el } = await openLucia();
      const button = el.querySelector<HTMLButtonElement>('form button[type=submit]')!;
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-describedby')).toBe('pay-hint');
      expect(el.querySelector('#pay-hint')?.textContent).toContain('Marca al menos un cargo');
      expectTones([...el.querySelectorAll('fieldset .tag')]);
    }, 20_000);

    it('an invalid amount (0, empty, over the selected balance) is caught before confirm()', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm');
      const register = vi.spyOn(TestBed.inject(BillingService), 'registerPayment');
      const { el, box, amount, type, submit } = await openLucia();
      box('Mensualidad').click();
      await settle();
      expect(el.querySelector('[aria-label="Resumen del pago"]')?.textContent).toContain('$600.00');

      for (const [value, message] of [
        ['0', 'Debe ser mayor que $0.00.'],
        ['', 'Campo requerido.'],
        ['700', 'Excede el saldo seleccionado ($600.00).'],
      ]) {
        await type(value);
        await submit();
        expect(document.activeElement, `importe «${value}»`).toBe(amount());
        expect(el.querySelector('.field-error')?.textContent?.trim()).toBe(message);
      }
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(register).not.toHaveBeenCalled();
    }, 20_000);

    it('the over-balance error follows the selection', async () => {
      const { el, box, type } = await openLucia();
      box('Mensualidad').click();
      await type('700');
      expect(el.querySelector('.field-error')?.textContent).toContain('Excede');
      box('Uniforme').click(); // $950.00 selected now
      await settle();
      expect(el.querySelector('.field-error')).toBeNull();
      box('Uniforme').click();
      await settle();
      expect(el.querySelector('.field-error')?.textContent).toContain('Excede');
    }, 20_000);

    it('a valid amount keeps confirm(): dismissing records nothing, accepting shows the folio', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const register = vi.spyOn(TestBed.inject(BillingService), 'registerPayment');
      const { el, box, type, submit } = await openLucia();
      box('Mensualidad').click();
      await type('100');
      await submit();
      expect(confirmSpy).toHaveBeenCalledWith('¿Registrar el pago por $100?');
      expect(register).not.toHaveBeenCalled();

      confirmSpy.mockReturnValue(true);
      await submit();
      expect(register).toHaveBeenCalledTimes(1);
      expect(el.textContent).toMatch(/Pago registrado con folio R-\d+/);
      expect(el.querySelector('a[href^="/admin/billing/receipts/"]')?.textContent).toContain(
        'Ver / imprimir recibo',
      );
      expect(el.querySelector('.field-error')).toBeNull(); // amount reset, not an error
    }, 20_000);
  });

  it('Cargos: the manual charge is folded under the list and still works', async () => {
    const el = await open('admin@example.com', '/admin/billing/charges');
    const panel = el.querySelector<HTMLDetailsElement>('details.create-panel')!;
    expect(panel.open).toBe(false);
    expect(panel.querySelector('summary')?.textContent).toContain('Nuevo cargo manual');
    expect(el.textContent).toMatch(/Resultados: \d+/);
    expectTones([...el.querySelectorAll('td .tag')]);

    panel.open = true;
    for (const name of ['player', 'concept']) {
      const select = panel.querySelector<HTMLSelectElement>(`select[name=${name}]`)!;
      select.selectedIndex = 1;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await settle();
    panel.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await settle();
    expect(el.textContent).toContain('Cargo creado.');
  }, 20_000);

  it('Estado de cuenta: guidance when no player is selected', async () => {
    const el = await open('secretaria@example.com', '/admin/billing/statement');
    expect(el.querySelector('.alert.info')?.textContent).toContain('Elige un jugador');
    expect(el.querySelector('table')).toBeNull();
  }, 20_000);

  it('Estado de cuenta: with a player, KPIs and tones and no guidance', async () => {
    const el = await open('secretaria@example.com', '/admin/billing/statement?player=2');
    expect(el.querySelector('.alert.info')).toBeNull();
    expect(el.querySelectorAll('.kpi').length).toBe(5);
    expectTones([...el.querySelectorAll('td .tag')]);
  }, 20_000);

  it('Adeudos: the KPIs add up the rows', async () => {
    const el = await open('secretaria@example.com', '/admin/billing/debts');
    const rows = [...el.querySelectorAll('tbody tr')];
    expect(rows.length).toBeGreaterThan(0);
    const sum = (col: number) =>
      rows.reduce((total, r) => total + money(r.querySelectorAll('td')[col].textContent!), 0);
    const [overdue, balance] = [...el.querySelectorAll('.kpi strong')].map((s) =>
      money(s.textContent!),
    );
    expect(overdue).toBeCloseTo(sum(6), 2);
    expect(balance).toBeCloseTo(sum(7), 2);
    expect(el.querySelector('.kpi')!.classList).toContain('danger');
  }, 20_000);

  it('Pagos y recibos: a cancelled payment is grey and still says «Cancelado»', async () => {
    await TestBed.inject(AuthService).login('admin@example.com', 'demo1234');
    await TestBed.inject(BillingService).cancelPayment(1, 'Prueba F3.2');
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/billing/receipts');
    const el = await settle();
    const tag = el.querySelector('td .tag')!;
    expect(tag.textContent!.trim()).toBe('Cancelado');
    expect(tag.classList).toContain('neutral');
  }, 20_000);
});

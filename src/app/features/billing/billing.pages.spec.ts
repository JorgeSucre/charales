import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { baseProviders } from '../../app.config';
import { AuthService } from '../../core/auth/auth.service';
import { ChargeStatus } from '../../core/models';
import { CHARGE_TONE } from '../../shared/status-tone';
import { BillingService, CHARGE_STATUS_LABELS } from './billing.service';

/** F3.2: manual charge disclosure, payment guidance and amount validation, status tones, KPIs and captions. */
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

  function choose(select: HTMLSelectElement, text: string): void {
    select.selectedIndex = [...select.options].findIndex((o) => o.text.includes(text));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const labelOf = Object.fromEntries(
    Object.entries(CHARGE_STATUS_LABELS).map(([k, v]) => [v, k as ChargeStatus]),
  );

  /** Every charge tag keeps its official label and gets the tone of that status. */
  function expectChargeTones(tags: Element[]): void {
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      const status = labelOf[tag.textContent!.trim()];
      expect(status, `etiqueta inesperada «${tag.textContent}»`).toBeDefined();
      expect(tag.classList).toContain(CHARGE_TONE[status]);
    }
  }

  const submitButton = (el: HTMLElement) =>
    el.querySelector<HTMLButtonElement>('form button[type=submit]')!;
  const amountInput = (el: HTMLElement) =>
    el.querySelector<HTMLInputElement>('input[name=amount]')!;

  /** Payment page with Lucía (charge 2: Mensualidad, VENCIDO, $600) selected. */
  async function paymentForLucia(): Promise<HTMLElement> {
    const el = await open('secretaria@example.com', '/admin/billing/payments/new');
    choose(el.querySelector('select[name=player]')!, 'Lucía');
    await settle();
    const overdue = [...el.querySelectorAll('label.check')].find((l) =>
      l.textContent!.includes('Vencido'),
    )!;
    overdue.querySelector('input')!.click();
    return settle();
  }

  it('charges: the manual charge form starts folded in a native disclosure and still creates the charge', async () => {
    const el = await open('secretaria@example.com', '/admin/billing/charges');
    const details = el.querySelector<HTMLDetailsElement>('details.disclosure')!;
    expect(details.open).toBe(false);
    const summary = details.querySelector(':scope > summary')!;
    expect(summary.textContent).toContain('Cargo manual');

    details.open = true; // what a click, Enter or Space on <summary> does natively
    await settle();
    choose(details.querySelector('select[name=player]')!, 'Lucía');
    choose(details.querySelector('select[name=concept]')!, 'Mensualidad');
    await settle();
    details.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    await settle();
    const alert = el.querySelector('.alert.ok')!;
    expect(alert.textContent).toContain('Cargo creado.');
    expect(details.contains(alert)).toBe(false); // the result is never hidden inside the folded form
    expectChargeTones([...el.querySelectorAll('td .tag')]);
    expect(el.querySelector('table caption')?.textContent).toContain('Cargos');
  }, 20_000);

  it('payment: guidance without a player, then what is missing to enable the button', async () => {
    const el = await open('secretaria@example.com', '/admin/billing/payments/new');
    const hint = () => el.querySelector('#pay-hint');
    expect(submitButton(el).disabled).toBe(true);
    expect(submitButton(el).getAttribute('aria-describedby')).toBe('pay-hint');
    expect(hint()!.classList).toContain('info');
    expect(hint()!.textContent).toContain('Elige un jugador');

    choose(el.querySelector('select[name=player]')!, 'Lucía');
    await settle();
    expect(submitButton(el).disabled).toBe(true);
    expect(hint()!.textContent).toContain('Selecciona al menos un cargo');
    expectChargeTones([...el.querySelectorAll('label.check .tag')]);
  }, 20_000);

  it('payment: the summary lists the selected charges, amount, method and payer before confirming', async () => {
    const el = await paymentForLucia();
    expect(el.querySelector('#pay-hint')).toBeNull();
    expect(submitButton(el).disabled).toBe(false);
    type(amountInput(el), '100');
    await settle();
    const summary = el.querySelector('dl.summary')!;
    expect([...summary.querySelectorAll('dt')].map((d) => d.textContent)).toEqual([
      'Cargos',
      'Importe',
      'Forma de pago',
      'Quién paga',
    ]);
    const values = [...summary.querySelectorAll('dd')].map((d) => d.textContent!.trim());
    expect(values[0]).toContain('Mensualidad');
    expect(values[1]).toBe('$100.00');
    expect(values[2]).toBe('Efectivo');
    expect(values[3]).toBe('No especificado');
  }, 20_000);

  it('payment: an empty, zero, negative or excessive amount is shown on the field, focused, and never confirmed or sent', async () => {
    const el = await paymentForLucia();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const register = vi.spyOn(TestBed.inject(BillingService), 'registerPayment');
    const error = () => el.querySelector('#amount-error')!.textContent!.trim();
    expect(amountInput(el).getAttribute('aria-describedby')).toContain('amount-error');

    for (const [value, message] of [
      ['', 'Campo requerido.'],
      ['0', 'Debe ser al menos $0.01.'],
      ['-5', 'Debe ser al menos $0.01.'],
      ['600.01', 'No puede superar el saldo de los cargos seleccionados ($600.00).'],
    ]) {
      type(amountInput(el), value);
      await settle();
      submitButton(el).focus(); // focus starts away from the field, so landing on it is the page's doing
      expect(document.activeElement, `importe «${value}»`).toBe(submitButton(el));
      submitButton(el).click();
      await settle();
      expect(error(), `importe «${value}»`).toBe(message);
      expect(document.activeElement, `importe «${value}»`).toBe(amountInput(el));
    }
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();

    type(amountInput(el), '600');
    await settle();
    expect(error()).toBe('');
  }, 30_000);

  it('payment: changing the selection recomputes the maximum and the validity', async () => {
    const el = await paymentForLucia(); // $600 selected
    type(amountInput(el), '900');
    await settle();
    submitButton(el).click(); // marks it touched; confirm is never reached
    await settle();
    expect(el.querySelector('#amount-error')!.textContent).toContain('($600.00)');

    const pending = [...el.querySelectorAll('label.check')].find((l) =>
      l.textContent!.includes('Pendiente'),
    )!;
    pending.querySelector('input')!.click(); // + $350 → $950
    await settle();
    expect(el.querySelector('#amount-error')!.textContent!.trim()).toBe('');
    expect(amountInput(el).classList).toContain('ng-valid');

    pending.querySelector('input')!.click(); // back to $600
    await settle();
    expect(el.querySelector('#amount-error')!.textContent).toContain('($600.00)');
  }, 20_000);

  it('payment: a valid amount keeps confirm(), registers it and links the receipt by folio', async () => {
    const el = await paymentForLucia();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    type(amountInput(el), '100');
    await settle();
    submitButton(el).click();
    await settle();
    await settle();
    expect(confirmSpy).toHaveBeenCalledExactlyOnceWith('¿Registrar el pago por $100?');
    expect(el.querySelector('.alert.ok')!.textContent).toMatch(/Pago registrado con folio R-\d+/);
    const link = [...el.querySelectorAll('main a')].find((a) =>
      a.textContent!.includes('imprimir recibo'),
    )!;
    expect(link.getAttribute('href')).toMatch(/^\/admin\/billing\/receipts\/\d+$/);
    expect(el.querySelector('#amount-error')!.textContent!.trim()).toBe(''); // reset, not an error
  }, 20_000);

  it('statement: guidance without a player; tones and captions with one', async () => {
    const el = await open('secretaria@example.com', '/admin/billing/statement');
    const guide = el.querySelector('p.alert.info')!;
    expect(guide.textContent!.trim()).toBe('Elige un jugador para ver sus cargos, pagos y saldo.');
    expect(el.querySelector('.empty')).toBeNull();

    // Choosing a player only changes the query (?player=): focus stays on the select, not on <main>.
    const select = el.querySelector<HTMLSelectElement>('.filters select')!;
    select.focus();
    choose(select, 'Mateo');
    await settle();
    expect(TestBed.inject(Router).url).toBe('/admin/billing/statement?player=3');
    expect(document.activeElement).toBe(select);
    expect(el.querySelector('p.alert.info')).toBeNull();
    const [charges, payments] = [...el.querySelectorAll('table')];
    expect(charges.querySelector('caption')!.textContent).toContain('Cargos');
    expect(payments.querySelector('caption')!.textContent).toContain('Pagos');
    expectChargeTones([...charges.querySelectorAll('td .tag')]);
    const paid = payments.querySelector('td .tag')!;
    expect(paid.textContent!.trim()).toBe('Aplicado');
    expect(paid.classList).toContain('ok');
  }, 20_000);

  it('debts: two KPIs equal to the sums of the table; «Vencido» is danger only above zero', async () => {
    const el = await open('secretaria@example.com', '/admin/billing/debts');
    const kpis = [...el.querySelectorAll('.kpis .kpi')];
    expect(kpis.map((k) => k.querySelector('span')!.textContent)).toEqual([
      'Vencido',
      'Saldo total',
    ]);
    const cents = (s: string) => Math.round(Number(s.replace(/[$,]/g, '')) * 100);
    const column = (i: number) =>
      [...el.querySelectorAll('tbody tr')]
        .map((r) => cents(r.querySelectorAll('td')[i].textContent!))
        .reduce((a, b) => a + b, 0);
    const value = (k: Element) => cents(k.querySelector('strong')!.textContent!);
    expect(value(kpis[0])).toBe(column(6));
    expect(value(kpis[1])).toBe(column(7));
    expect(value(kpis[0])).toBeGreaterThan(0);
    expect(kpis[0].classList).toContain('danger');
    expect(kpis[1].classList).not.toContain('danger');
    expect(el.querySelector('table caption')?.textContent).toContain('Adeudos');
  }, 20_000);

  it('debts: a zero overdue total is not marked danger', async () => {
    await TestBed.inject(AuthService).login('secretaria@example.com', 'demo1234');
    const billing = TestBed.inject(BillingService);
    // Settle both overdue charges (Lucía $600, Mateo $700); Lucía keeps her pending $350.
    for (const [playerId, chargeId, amountCents] of [
      [2, 2, 60000],
      [3, 3, 70000],
    ])
      await billing.registerPayment({
        playerId,
        tutorId: null,
        amountCents,
        method: 'EFECTIVO',
        chargeIds: [chargeId],
      });
    const el = await open('secretaria@example.com', '/admin/billing/debts');
    el.querySelector<HTMLInputElement>('.filters input[type=checkbox]')!.click(); // all balances
    await settle();
    const [overdue, total] = [...el.querySelectorAll('.kpis .kpi')];
    expect(overdue.querySelector('strong')!.textContent).toBe('$0.00');
    expect(overdue.classList).not.toContain('danger');
    expect(total.querySelector('strong')!.textContent).toBe('$350.00');
  }, 20_000);

  it('receipts: a cancelled payment shows «Cancelado» in grey; the table has a caption', async () => {
    await TestBed.inject(AuthService).login('admin@example.com', 'demo1234');
    await TestBed.inject(BillingService).cancelPayment(3, 'Prueba F3.2');
    const el = await open('admin@example.com', '/admin/billing/receipts');
    const tag = el.querySelector('td .tag')!;
    expect(tag.textContent!.trim()).toBe('Cancelado');
    expect(tag.classList).toContain('neutral');
    expect(tag.classList).not.toContain('off');
    expect(el.querySelector('table caption')?.textContent).toContain('Pagos');
  }, 20_000);
});

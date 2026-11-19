import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { baseProviders } from '../../app.config';
import { AuthService } from '../../core/auth/auth.service';

describe('Phase 4D finance, uniforms & enrollments UX', () => {
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
    await new Promise((r) => setTimeout(r, 600));
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    return harness.routeNativeElement as HTMLElement;
  }

  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('ChargesPage shows em-dash for zero discounts, page footer totals, and cancels via PromptDialog', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    const el = await open('admin@example.com', '/admin/billing/charges');

    expect(el.querySelector('tfoot')?.textContent).toContain('Total en página');
    const cells = [...el.querySelectorAll('tbody td')].map((td) => td.textContent?.trim());
    expect(cells).toContain('—');

    const cancelBtn = [...el.querySelectorAll('td.row-actions button')].find(
      (b) => b.textContent?.trim() === 'Cancelar' && b.classList.contains('danger'),
    ) as HTMLButtonElement;
    expect(cancelBtn).toBeDefined();
    cancelBtn.click();
    await settle();

    expect(promptSpy).not.toHaveBeenCalled();
    const dialog = el.querySelector('dialog[open]') as HTMLDialogElement;
    expect(dialog).toBeTruthy();

    type(dialog.querySelector('input')!, 'Cargo duplicado por error');
    (dialog.querySelector('button[type=submit]') as HTMLButtonElement).click();
    await settle();

    expect(el.querySelector('dialog[open]')).toBeNull();
    expect(el.textContent).toContain('Cancelado');
  });

  it('PaymentPage quick-selects overdue charges with Seleccionar vencidos', async () => {
    const el = await open('secretaria@example.com', '/admin/billing/payments/new');
    const select = el.querySelector('select[name=player]') as HTMLSelectElement;
    select.selectedIndex = [...select.options].findIndex((o) => o.text.includes('Lucía'));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    const overdueBtn = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Seleccionar vencidos'),
    )!;
    expect(overdueBtn).toBeDefined();
    overdueBtn.click();
    await settle();

    const checked = [...el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].filter(
      (c) => c.checked,
    );
    expect(checked.length).toBeGreaterThan(0);

    const fillTotalBtn = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Pagar el total seleccionado'),
    )!;
    fillTotalBtn.click();
    await settle();

    expect(el.querySelector('dl.summary')?.textContent).toContain('$600.00');
  });

  it('ReceiptsPage cancels via PromptDialog and ReceiptPage renders print branding + non-fiscal notice', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    let el = await open('admin@example.com', '/admin/billing/receipts');

    const cancelBtn = [...el.querySelectorAll('td.row-actions button')].find(
      (b) => b.textContent?.trim() === 'Cancelar' && b.classList.contains('danger'),
    ) as HTMLButtonElement;
    expect(cancelBtn).toBeDefined();
    cancelBtn.click();
    await settle();

    expect(promptSpy).not.toHaveBeenCalled();
    const dialog = el.querySelector('dialog[open]') as HTMLDialogElement;
    expect(dialog).toBeTruthy();
    type(dialog.querySelector('input')!, 'Folio emitido dos veces');
    (dialog.querySelector('button[type=submit]') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('dialog[open]')).toBeNull();

    const receiptLink = el.querySelector('tbody td.row-actions a') as HTMLAnchorElement;
    receiptLink.click();
    el = await settle();

    expect(el.querySelector('.receipt')?.textContent).toContain('Escuela Formativa Charales');
    expect(el.querySelector('.receipt')?.textContent).toContain(
      'No constituye comprobante fiscal',
    );
  });

  it('UniformOrdersPage delivers and cancels orders via PromptDialog', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    const el = await open('admin@example.com', '/admin/uniforms/orders');

    const deliverBtn = [...el.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Entregar',
    )!;
    deliverBtn.click();
    await settle();

    expect(promptSpy).not.toHaveBeenCalled();
    let dialog = el.querySelector('dialog[open]') as HTMLDialogElement;
    expect(dialog).toBeTruthy();
    type(dialog.querySelector('input')!, 'Mamá de Lucía');
    (dialog.querySelector('button[type=submit]') as HTMLButtonElement).click();
    await settle();
    expect(el.textContent).toContain('Entregado');

    const cancelBtn = [...el.querySelectorAll('td.row-actions button')].find(
      (b) => b.textContent?.trim() === 'Cancelar' && b.classList.contains('danger'),
    ) as HTMLButtonElement | undefined;
    if (cancelBtn) {
      cancelBtn.click();
      await settle();
      dialog = el.querySelector('dialog[open]') as HTMLDialogElement;
      expect(dialog).toBeTruthy();
      type(dialog.querySelector('input')!, 'Cambio de talla');
      (dialog.querySelector('button[type=submit]') as HTMLButtonElement).click();
      await settle();
    }
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('EnrollmentsPage cancels enrollments via PromptDialog', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    const el = await open('admin@example.com', '/admin/enrollments');

    const cancelBtn = [...el.querySelectorAll('td.row-actions button')].find(
      (b) => b.textContent?.trim() === 'Cancelar' && b.classList.contains('danger'),
    ) as HTMLButtonElement;
    expect(cancelBtn).toBeDefined();
    cancelBtn.click();
    await settle();

    expect(promptSpy).not.toHaveBeenCalled();
    const dialog = el.querySelector('dialog[open]') as HTMLDialogElement;
    expect(dialog).toBeTruthy();
    type(dialog.querySelector('input')!, 'Baja temporal');
    (dialog.querySelector('button[type=submit]') as HTMLButtonElement).click();
    await settle();

    expect(el.querySelector('dialog[open]')).toBeNull();
    expect(el.textContent).toContain('Cancelada');
  });
});

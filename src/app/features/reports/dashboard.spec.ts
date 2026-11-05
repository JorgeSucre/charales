import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { baseProviders } from '../../app.config';
import { AuthService } from '../../core/auth/auth.service';
import { MockDb } from '../../core/data/mock-db';
import { BillingService } from '../billing/billing.service';
import { ReportService } from './report.service';

/** HU-065 · Tablero over MockDb: indicators, charts from the services, period rules, empty and error states. */
describe('Tablero (HU-065)', () => {
  let harness: RouterTestingHarness;

  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 13, 12, 0));
    TestBed.configureTestingModule({ providers: [...baseProviders, provideHttpClientTesting()] });
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

  async function open(before?: () => void | Promise<void>): Promise<HTMLElement> {
    await TestBed.inject(AuthService).login('admin@example.com', 'demo1234');
    await before?.();
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/dashboard');
    return settle();
  }

  const db = () => TestBed.inject(MockDb);
  const section = (el: HTMLElement, title: string) =>
    [...el.querySelectorAll<HTMLElement>('section')].find((s) =>
      s.querySelector('h2')?.textContent?.includes(title),
    )!;
  const barTexts = (s: HTMLElement) =>
    [...s.querySelectorAll('.bars li')].map((li) => [
      li.querySelector('.bar-label')!.textContent!.trim(),
      li.querySelector('.bar-text')!.textContent!.replace(/^:\s*/, '').trim(),
    ]);
  const kpi = (el: HTMLElement, label: string) =>
    [...el.querySelectorAll<HTMLElement>('.kpi')].find((k) =>
      k.querySelector('span')?.textContent?.includes(label),
    )!;
  const cents = (text: string) => Math.round(Number(text.replace(/[^\d.]/g, '')) * 100);
  function setPeriod(el: HTMLElement, from: string, to: string): void {
    const [a, b] = section(el, 'Ingresos por mes').querySelectorAll<HTMLInputElement>(
      'input[type=date]',
    );
    a.value = from;
    a.dispatchEvent(new Event('input', { bubbles: true }));
    b.value = to;
    b.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('six indicators in plain words, each with a link and an explanation, never table or column names', async () => {
    const el = await open();
    const labels = [...el.querySelectorAll('.kpis.six .kpi > span')].map((s) =>
      s.textContent!.trim(),
    );
    expect(labels).toEqual([
      'Jugadores activos',
      'Categorías activas',
      'Partidos próximos',
      'Adeudo vencido',
      'Jugadores con adeudo vencido',
      'Ingresos del periodo',
    ]);
    const text = el.querySelector('.kpis')!.textContent!;
    expect(text).not.toMatch(/[a-z_]+\.[a-z_]+|APLICADO|PROGRAMADO\/|pago_aplicacion/);
    expect([...el.querySelectorAll('.kpis .kpi')].every((a) => a.getAttribute('href'))).toBe(true);
    expect(kpi(el, 'Jugadores activos').querySelector('strong')!.textContent!.trim()).toBe(
      String(db().players.filter((p) => p.status === 'ACTIVO').length),
    );
    expect(kpi(el, 'Ingresos del periodo').textContent).toContain('del 1 al 13 de octubre de 2026');
  }, 20_000);

  it('players by status: one segment per status from the data, percentages, accessible summary, filtered links', async () => {
    const el = await open();
    const chart = section(el, 'Jugadores por estatus');
    const count = (s: string) => db().players.filter((p) => p.status === s).length;
    const legend = [...chart.querySelectorAll('.chart-legend li')].map((li) =>
      li.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(legend).toEqual([
      expect.stringContaining(`Activo: ${count('ACTIVO')}`),
      expect.stringContaining(`Baja temporal: ${count('BAJA_TEMPORAL')}`),
      expect.stringContaining(`Baja definitiva: ${count('BAJA_DEFINITIVA')}`),
    ]);
    const svg = chart.querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toContain(`${db().players.length} jugadores`);
    const link = [...chart.querySelectorAll<HTMLAnchorElement>('.chart-legend a')].find((a) =>
      a.textContent?.includes('Baja temporal'),
    )!;
    expect(link.getAttribute('href')).toBe('/admin/players?status=BAJA_TEMPORAL');
  }, 20_000);

  it('collection status: non-cancelled charges by derived status; a cancelled charge never shows', async () => {
    const el = await open();
    const chart = section(el, 'Estado de cobranza');
    const rows = barTexts(chart);
    expect(rows.map((r) => r[0])).toEqual(['Pendiente', 'Parcial', 'Vencido', 'Pagado']);
    for (const [label, text] of rows) {
      const status = {
        Pendiente: 'PENDIENTE',
        Parcial: 'PARCIAL',
        Vencido: 'VENCIDO',
        Pagado: 'PAGADO',
      }[label]!;
      expect(text).toMatch(
        new RegExp(`^${db().charges.filter((c) => c.status === status).length} cargos?`),
      );
    }
    expect(chart.textContent).not.toContain('Cancelado');
    expect(chart.querySelector('ul.bars')!.getAttribute('aria-label')).toBe('Cargos por estado');
  }, 20_000);

  it('occupancy: a defined capacity, no limit (null) and capacity 0 are told apart', async () => {
    const el = await open(() => {
      // seed: Sub-10 holds 20, Sub-8 has no limit; Sub-12 is set to capacity 0 here
      db().categories = db().categories.map((c) =>
        c.name === 'Sub-12' ? { ...c, maxCapacity: 0 } : c,
      );
    });
    const texts = barTexts(section(el, 'Ocupación por categoría')).map((r) => r[1]);
    expect(texts.some((t) => /^\d+ · sin límite de cupo$/.test(t))).toBe(true);
    expect(texts.some((t) => /^\d+ · cupo 0$/.test(t))).toBe(true);
    expect(texts.some((t) => /^\d+ de \d+$/.test(t))).toBe(true);
  }, 20_000);

  it('the period only reloads the income: once per change, and the other indicators are not asked again', async () => {
    const reports = TestBed.inject(ReportService);
    const dashboard = vi.spyOn(reports, 'dashboard');
    const income = vi.spyOn(reports, 'income');
    let el = await open();
    expect(dashboard).toHaveBeenCalledTimes(1);
    expect(income).toHaveBeenCalledTimes(1);
    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Últimos 6 meses'))!
      .click();
    el = await settle();
    expect(dashboard).toHaveBeenCalledTimes(1);
    expect(income).toHaveBeenCalledTimes(2);
    expect(income).toHaveBeenLastCalledWith('2026-05-01', '2026-10-13');
    expect(barTexts(section(el, 'Ingresos por mes')).map((r) => r[0])).toEqual([
      'mayo 2026',
      'junio 2026',
      'julio 2026',
      'agosto 2026',
      'septiembre 2026',
      'octubre 2026',
    ]);
    // an inverted range is refused before asking anything
    setPeriod(el, '2026-10-10', '2026-10-01');
    el = await settle();
    expect(income).toHaveBeenCalledTimes(2);
    expect(section(el, 'Ingresos por mes').textContent).toContain('Ingresa un periodo válido');
  }, 20_000);

  it('income: cancelled payments do not count, and a payment applied to several charges counts once', async () => {
    let el = await open();
    setPeriod(el, '2026-08-01', '2026-10-31');
    el = await settle();
    const applied = db()
      .payments.filter(
        (p) =>
          p.status === 'APLICADO' &&
          p.paidAt >= '2026-08-01' &&
          p.paidAt.slice(0, 10) <= '2026-10-31',
      )
      .reduce((s, p) => s + p.amountCents, 0);
    expect(cents(kpi(el, 'Ingresos del periodo').querySelector('strong')!.textContent!)).toBe(
      applied,
    );
    // every payment counts once, whatever its number of applications
    const multi = db().payments.find(
      (p) => db().paymentApplications.filter((a) => a.paymentId === p.id).length > 1,
    );
    if (multi)
      expect(applied).toBe(
        db()
          .payments.filter((p) => p.status === 'APLICADO' && p.paidAt >= '2026-08-01')
          .reduce((s, p) => s + p.amountCents, 0),
      );
    const victim = db().payments.find((p) => p.status === 'APLICADO' && p.paidAt >= '2026-08-01')!;
    await TestBed.inject(BillingService).cancelPayment(victim.id, 'Prueba');
    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Últimos 6 meses'))!
      .click();
    el = await settle();
    setPeriod(el, '2026-08-01', '2026-10-31');
    el = await settle();
    expect(cents(kpi(el, 'Ingresos del periodo').querySelector('strong')!.textContent!)).toBe(
      applied - victim.amountCents,
    );
  }, 20_000);

  it('empty data says so; a failed request is an error, never a $0', async () => {
    let el = await open(() => {
      db().players = [];
    });
    expect(section(el, 'Jugadores por estatus').textContent).toContain('No hay jugadores.');
    setPeriod(el, '2030-01-01', '2030-01-31');
    el = await settle();
    expect(section(el, 'Ingresos por mes').textContent).toContain(
      'No hay pagos registrados en el periodo.',
    );

    vi.spyOn(TestBed.inject(ReportService), 'income').mockRejectedValue(new Error('Sin conexión'));
    setPeriod(el, '2026-10-01', '2026-10-13');
    el = await settle();
    expect(kpi(el, 'Ingresos del periodo').textContent).toContain('No disponible');
    expect(kpi(el, 'Ingresos del periodo').textContent).not.toContain('$0.00');
    expect(section(el, 'Ingresos por mes').textContent).toContain('Sin conexión');
  }, 20_000);
});

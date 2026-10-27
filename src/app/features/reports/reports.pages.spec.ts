import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { baseProviders } from '../../app.config';
import { AuthService } from '../../core/auth/auth.service';

/** Tablero (HU-065) over MockDb: the income indicator names its period in Spanish; six indicators in the grid. */
describe('Tablero', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 21, 12, 0));
    TestBed.configureTestingModule({ providers: [...baseProviders, provideHttpClientTesting()] });
  });
  afterEach(() => vi.useRealTimers());

  let harness: RouterTestingHarness;

  async function settle(): Promise<HTMLElement> {
    await new Promise((r) => setTimeout(r, 600)); // mock latency
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    return harness.routeNativeElement as HTMLElement;
  }

  const labels = (el: HTMLElement) =>
    [...el.querySelectorAll('.kpis.six .kpi span')].map((e) => e.textContent!.trim());

  async function setDate(el: HTMLElement, index: number, value: string): Promise<HTMLElement> {
    const input = el.querySelectorAll<HTMLInputElement>('.filters input[type=date]')[index];
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return settle();
  }

  it('names the income period of the loaded figures: same month, across years, reversed range', async () => {
    await TestBed.inject(AuthService).login('admin@example.com', 'demo1234');
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/dashboard');
    let el = await settle();
    expect(labels(el)).toHaveLength(6);
    expect(labels(el)).toContain('Ingresos del 1 al 21 de octubre de 2026');
    expect(labels(el).join(' ')).not.toMatch(/\d{4}-\d{2}-\d{2}/);

    el = await setDate(el, 0, '2025-12-15');
    expect(labels(el)).toContain('Ingresos del 15 de diciembre de 2025 al 21 de octubre de 2026');

    el = await setDate(el, 1, '2025-12-01'); // «hasta» before «desde»: no invented dates
    expect(labels(el)).toContain('Ingresos (periodo no disponible)');
    expect(labels(el)).toContain('Jugadores activos'); // the other indicators are untouched
  }, 20_000);
});

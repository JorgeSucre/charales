import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { baseProviders } from '../../app.config';
import { AuthService } from '../../core/auth/auth.service';
import { MockDb } from '../../core/data/mock-db';
import { AgendaPage, DashboardPage, IncomeReportPage, PlayersReportPage } from './reports.pages';
import { ReportService } from './report.service';

interface AgendaInternals {
  view: { set(v: 'list' | 'calendar'): void };
  month: { (): string; set(v: string): void };
  from: { set(v: string): void };
  to: { set(v: string): void };
  category: { set(v: number | null): void };
  coach: { set(v: number | null): void };
  kind: { set(v: string): void };
  filtered(): { kind: string; categoryId: number; coachIds: number[] }[];
  goToday(): void;
  resetFilters(): void;
}

/** HU-065..068: Dashboard & Reports pages verification over MockDb. */
describe('reports pages (HU-065..068)', () => {
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

  async function settle(): Promise<void> {
    await new Promise((r) => setTimeout(r, 600));
  }

  it('AgendaPage filters by kind, category and coach without losing events and resets cleanly', async () => {
    await TestBed.inject(AuthService).login('secretaria@example.com', 'demo1234');
    const fixture = TestBed.createComponent(AgendaPage);
    const page = fixture.componentInstance as unknown as AgendaInternals;
    page.view.set('list');
    page.from.set('2026-10-01');
    page.to.set('2026-10-31');
    fixture.detectChanges();
    await settle();
    await fixture.whenStable();
    const all = page.filtered();
    expect(all.some((e) => e.kind === 'training') && all.some((e) => e.kind === 'match')).toBe(
      true,
    );

    page.kind.set('match');
    expect(page.filtered().length).toBeGreaterThan(0);
    expect(page.filtered().every((e) => e.kind === 'match')).toBe(true);
    page.kind.set('');

    const category = all[0].categoryId;
    page.category.set(category);
    expect(page.filtered()).toEqual(all.filter((e) => e.categoryId === category));
    page.category.set(null);

    const coach = all.find((e) => e.coachIds.length)!.coachIds[0];
    page.coach.set(coach);
    expect(page.filtered().length).toBeGreaterThan(0);
    expect(page.filtered()).toEqual(all.filter((e) => e.coachIds.includes(coach)));

    page.resetFilters();
    expect(page.filtered()).toEqual(all);

    page.view.set('calendar');
    page.month.set('2026-11');
    page.goToday();
    expect(page.month()).toBe('2026-10');
  }, 20_000);

  it('PlayersReportPage filters by category/status, displays semantic tags, and resets filters', async () => {
    await TestBed.inject(AuthService).login('admin@example.com', 'demo1234');
    const fixture = TestBed.createComponent(PlayersReportPage);
    fixture.detectChanges();
    await settle();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.table-wrap table').length).toBeGreaterThan(0);
    expect(el.querySelectorAll('td .tag').length).toBeGreaterThan(0);
    const activeTotal = el.querySelector('.report-total')!.textContent!;

    const statusSelect = el.querySelectorAll<HTMLSelectElement>('select')[1]!;
    statusSelect.value = '';
    statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    await settle();
    await fixture.whenStable();
    fixture.detectChanges();

    const resetBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Restablecer'),
    )!;
    expect(resetBtn).toBeTruthy();
    resetBtn.click();
    fixture.detectChanges();
    await settle();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('.report-total')!.textContent).toBe(activeTotal);
  }, 20_000);

  it('IncomeReportPage supports period presets, validates inverted ranges, and shows matching summary totals', async () => {
    await TestBed.inject(AuthService).login('admin@example.com', 'demo1234');
    const reports = TestBed.inject(ReportService);
    const incomeSpy = vi.spyOn(reports, 'income');
    const fixture = TestBed.createComponent(IncomeReportPage);
    fixture.detectChanges();
    await settle();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const summaryVal = el.querySelector('.summary dd')!.textContent!.trim();
    const footerVal = el.querySelector('tfoot th.num')!.textContent!.trim();
    expect(summaryVal).toBe(footerVal);

    const sixBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Últimos 6 meses'),
    )!;
    sixBtn.click();
    fixture.detectChanges();
    await settle();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(sixBtn.getAttribute('aria-pressed')).toBe('true');

    const [fromInput, toInput] = el.querySelectorAll<HTMLInputElement>('input[type=date]');
    const callsBeforeInvalid = incomeSpy.mock.calls.length;
    fromInput.value = '2026-10-20';
    fromInput.dispatchEvent(new Event('input', { bubbles: true }));
    toInput.value = '2026-10-01';
    toInput.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    expect(incomeSpy).toHaveBeenCalledTimes(callsBeforeInvalid);
    expect(el.querySelector('.alert.error')?.textContent).toContain('Ingresa un periodo válido');
  }, 20_000);

  it('DashboardPage highlights active period preset, syncs period income summary, and structures upcoming matches', async () => {
    await TestBed.inject(AuthService).login('admin@example.com', 'demo1234');
    const db = TestBed.inject(MockDb);
    db.matches.push({
      id: 999,
      competitionCategoryId: 1,
      opponentId: 1,
      venueId: 1,
      date: '2026-10-10',
      time: '10:30',
      homeAway: 'LOCAL',
      status: 'REPROGRAMADO',
      rescheduleReason: 'Cambio de sede',
      goalsFor: null,
      goalsAgainst: null,
      notes: null,
      createdAt: '2026-10-01T12:00:00Z',
      updatedAt: '2026-10-01T12:00:00Z',
    });

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/dashboard');
    await settle();
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();

    const el = harness.routeNativeElement as HTMLElement;
    const monthBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Mes actual'),
    )!;
    expect(monthBtn.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelectorAll('.cards.quick .card').length).toBe(7);
    expect(el.querySelector('.income-summary-value')!.textContent!.trim()).toBe(
      el.querySelector('.kpi.kpi-period strong')!.textContent!.trim(),
    );
    expect(el.querySelector('.match-row .tag.warn')?.textContent?.trim()).toBe('Reprogramado');
    expect(el.querySelector('a.button[href="/sports/matches"]')?.textContent?.trim()).toBe(
      'Ver partidos',
    );
    void DashboardPage;
  }, 20_000);
});

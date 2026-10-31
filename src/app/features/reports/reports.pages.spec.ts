import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { baseProviders } from '../../app.config';
import { AuthService } from '../../core/auth/auth.service';
import { AgendaPage } from './reports.pages';

interface AgendaInternals {
  view: { set(v: 'list'): void };
  from: { set(v: string): void };
  to: { set(v: string): void };
  category: { set(v: number | null): void };
  coach: { set(v: number | null): void };
  kind: { set(v: string): void };
  filtered(): { kind: string; categoryId: number; coachIds: number[] }[];
}

/** HU-068.3: the global agenda filters trainings and matches by type, category and coach (over MockDb). */
describe('agenda page (HU-068)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 7, 12, 0));
    TestBed.configureTestingModule({ providers: [...baseProviders, provideHttpClientTesting()] });
  });
  afterEach(() => vi.useRealTimers());

  it('filters by kind, category and coach without losing events of the others', async () => {
    await TestBed.inject(AuthService).login('secretaria@example.com', 'demo1234');
    const fixture = TestBed.createComponent(AgendaPage);
    const page = fixture.componentInstance as unknown as AgendaInternals;
    page.view.set('list');
    page.from.set('2026-10-01');
    page.to.set('2026-10-31');
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 600)); // mock latency
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
  }, 20_000);
});

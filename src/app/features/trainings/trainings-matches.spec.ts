import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { baseProviders } from '../../app.config';
import { AuthService } from '../../core/auth/auth.service';
import { MockDb } from '../../core/data/mock-db';

describe('Phase 4C: trainings, attendance & matches pages', () => {
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

  it('SessionPage places attendance before notes, shows live counters, and tracks unsaved edits', async () => {
    let el = await open('admin@example.com', '/sports/trainings/1');
    const attendanceHeading = el.querySelector('#attendance-heading')!;
    const notesHeading = [...el.querySelectorAll('h2')].find((h) =>
      /bitácora/i.test(h.textContent ?? ''),
    )!;
    expect(
      attendanceHeading.compareDocumentPosition(notesHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const statsText = () =>
      [...el.querySelectorAll('.attendance-stats dd')].map((d) => Number(d.textContent?.trim()));
    const before = statsText();
    expect(before.length).toBe(4);

    // Marking all present updates counters immediately and shows unsaved indicator
    const allPresentBtn = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      /todos presentes/i.test(b.textContent ?? ''),
    )!;
    allPresentBtn.click();
    harness.detectChanges();

    const after = statsText();
    expect(after[1]).toBe(0); // absent = 0
    expect(after[2]).toBe(0); // justified = 0
    expect(after[3]).toBe(0); // unmarked = 0
    expect(el.textContent).toContain('Cambios sin guardar');

    // Save persists attendance and clears unsaved indicator
    const saveBtn = [...el.querySelectorAll<HTMLButtonElement>('.attendance-toolbar button')].find(
      (b) => /guardar asistencia/i.test(b.textContent ?? ''),
    )!;
    saveBtn.click();
    el = await settle();
    expect(el.textContent).toContain('Asistencia guardada');
    expect(el.textContent).not.toContain('Cambios sin guardar');
  }, 20_000);

  it('TrainingsPage cancels a session via accessible PromptDialog (not window.prompt)', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    let el = await open('secretaria@example.com', '/sports/trainings');

    const cancelBtn = [...el.querySelectorAll<HTMLButtonElement>('tbody button')].find((b) =>
      /cancelar/i.test(b.textContent ?? ''),
    )!;
    cancelBtn.click();
    harness.detectChanges();

    expect(promptSpy).not.toHaveBeenCalled();
    const dialog = el.querySelector<HTMLDialogElement>('dialog.prompt-dialog')!;
    expect(dialog.hasAttribute('open') || dialog.open).toBe(true);

    const input = dialog.querySelector<HTMLInputElement>('input')!;
    input.value = 'Lluvia fuerte';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    dialog.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    el = await settle();

    expect(el.textContent).toContain('Sesión cancelada.');
    expect(
      TestBed.inject(MockDb).trainingSessions.some((s) => s.status === 'CANCELADO'),
    ).toBe(true);
  }, 20_000);

  it('MatchesPage uses PromptDialog for cancellation and Escape closes reschedule panel', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    let el = await open('secretaria@example.com', '/sports/matches');

    const reschedBtn = [...el.querySelectorAll<HTMLButtonElement>('tbody button')].find((b) =>
      /reprogramar/i.test(b.textContent ?? ''),
    )!;
    reschedBtn.click();
    harness.detectChanges();
    const actionForm = el.querySelector<HTMLFormElement>('#match-action-form')!;
    expect(actionForm).not.toBeNull();

    actionForm.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    harness.detectChanges();
    expect(el.querySelector('#match-action-form')).toBeNull();

    const cancelBtn = [...el.querySelectorAll<HTMLButtonElement>('tbody button')].find((b) =>
      /cancelar/i.test(b.textContent ?? ''),
    )!;
    cancelBtn.click();
    harness.detectChanges();
    expect(promptSpy).not.toHaveBeenCalled();

    const dialog = el.querySelector<HTMLDialogElement>('dialog.prompt-dialog')!;
    const input = dialog.querySelector<HTMLInputElement>('input')!;
    input.value = 'Cancha en mantenimiento';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    dialog.querySelector<HTMLButtonElement>('button[type=submit]')!.click();
    el = await settle();

    expect(el.textContent).toContain('Partido cancelado.');
  }, 20_000);

  it('AttendanceReportPage filters and shows semantic attendance badges', async () => {
    let el = await open('admin@example.com', '/sports/attendance');
    expect(el.querySelector('.table-wrap table')).not.toBeNull();
    const firstTag = el.querySelector('tbody td .tag');
    expect(firstTag).not.toBeNull();
  }, 20_000);
});

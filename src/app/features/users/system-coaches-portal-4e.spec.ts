import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { baseProviders } from '../../app.config';
import { AuthService } from '../../core/auth/auth.service';

describe('Phase 4E admin, coach panel, parent portal & catalogs UX', () => {
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

  it('PermissionsPage groups 59 permissions by module, supports search & collapse', async () => {
    const el = await open('admin@example.com', '/admin/permissions');

    const groupToggles = el.querySelectorAll<HTMLButtonElement>('.matrix-group-toggle');
    expect(groupToggles.length).toBeGreaterThan(10);
    expect(el.textContent).toContain('59');
    expect(el.querySelectorAll('.matrix-lock').length).toBeGreaterThan(0);

    // Collapse first module
    const firstToggle = groupToggles[0];
    expect(firstToggle.getAttribute('aria-expanded')).toBe('true');
    firstToggle.click();
    await settle();
    expect(firstToggle.getAttribute('aria-expanded')).toBe('false');

    // Filter by 'cobranza'
    const search = el.querySelector<HTMLInputElement>('input[type=search]')!;
    type(search, 'cobranza');
    await settle();

    expect(el.querySelectorAll('.matrix-group-toggle').length).toBe(1);
    expect(el.textContent).toContain('Cobranza y cargos');
  });

  it('CoachesPage unifies coach-form and Cuenta de acceso panel on edit with single form[id]', async () => {
    const el = await open('admin@example.com', '/admin/coaches');

    const editBtn = [...el.querySelectorAll('td.row-actions button')].find(
      (b) => b.textContent?.trim() === 'Editar',
    ) as HTMLButtonElement;
    expect(editBtn).toBeDefined();
    editBtn.click();
    await settle();

    expect(el.querySelector('.tutor-workspace.with-portal')).toBeTruthy();
    expect(el.querySelector('.portal-panel')?.textContent).toContain('Cuenta de acceso');
    expect(el.querySelectorAll('form[id]').length).toBe(1);
  });

  it('CoachHomePage displays coach KPIs, upcoming sessions, weekly schedule and assigned categories', async () => {
    const el = await open('coach@example.com', '/coach');

    expect(el.querySelector('h1')?.textContent).toContain('Panel de entrenador');
    expect(el.querySelectorAll('.kpi').length).toBe(4);
    expect(el.textContent).toContain('Sesiones de hoy y próximos 7 días');
    expect(el.textContent).toContain('Horario semanal');
    expect(el.textContent).toContain('Mis categorías');
  });

  it('PortalHomePage and ChildPage show family summary, child tabs, and reject unauthorized players', async () => {
    let el = await open('tutor@example.com', '/portal');

    expect(el.querySelector('h1')?.textContent).toContain('Mis hijos');
    const cards = el.querySelectorAll<HTMLAnchorElement>('.portal-child-card');
    expect(cards.length).toBeGreaterThan(0);

    cards[0].click();
    el = await settle();

    expect(el.querySelector('a.back-link')?.textContent).toContain('Mis hijos');
    const cuentaTab = [...el.querySelectorAll('[role=tab]')].find((t) =>
      t.textContent?.includes('Pagos y adeudos'),
    ) as HTMLButtonElement;
    cuentaTab.click();
    await settle();
    expect(el.querySelectorAll('.kpi').length).toBe(3);

    // Other family's child id must be rejected
    await harness.navigateByUrl('/portal/children/3');
    el = await settle();
    expect(el.textContent).toContain('No se pudo cargar');
  });

  it('NoticesPage supports live search, status filter and Limpiar filtros', async () => {
    const el = await open('admin@example.com', '/admin/notices');
    const initialCount = el.querySelectorAll('article.panel').length;
    expect(initialCount).toBeGreaterThan(0);

    const search = el.querySelector<HTMLInputElement>('input[type=search]')!;
    type(search, 'zzznonexistent999');
    await settle();
    expect(el.querySelectorAll('article.panel').length).toBe(0);
    expect(el.textContent).toContain('Limpiar filtros');

    const clearBtn = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Limpiar filtros'),
    ) as HTMLButtonElement;
    clearBtn.click();
    await settle();
    expect(el.querySelectorAll('article.panel').length).toBe(initialCount);
  });
});

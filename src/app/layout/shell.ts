import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../core/auth/auth.service';
import { ROLE_LABELS } from '../core/auth/permissions';
import { NAV_ITEMS, NavSection, SECTION_ICONS, UI_ICONS } from './nav';

/** Groups the allowed menu items by section (also used by the home page). */
export function navSections(can: (item: (typeof NAV_ITEMS)[number]) => boolean) {
  const items = NAV_ITEMS.filter(can);
  return [...new Set(items.map((i) => i.section))].map((name) => ({
    name,
    items: items.filter((i) => i.section === name),
  }));
}

/** localStorage key of the desktop compact-menu preference (D3). */
const RAIL_KEY = 'charales.nav.rail';

/** Path of a URL without query string or fragment. */
const pathOf = (url: string) => url.split(/[?#]/)[0];

/**
 * The menu item a URL belongs to: the longest item path equal to the URL's path or a parent of it, so a detail page
 * marks its module (/admin/players/7 → /admin/players) and /admin/coaches/categories never also marks /admin/coaches.
 */
export function activeNavPath(url: string, paths: readonly string[]): string | null {
  const path = pathOf(url);
  let best: string | null = null;
  for (const p of paths)
    if ((path === p || path.startsWith(p + '/')) && p.length > (best?.length ?? 0)) best = p;
  return best;
}

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  host: { '(document:click)': 'onDocumentClick($event)' },
  template: `
    <a class="skip-link" href="#main" (click)="skipToMain($event)" [attr.inert]="drawerInert()"
      >Saltar al contenido</a
    >
    <div class="layout" [class.rail]="rail()">
      <header class="topbar" [attr.inert]="drawerInert()">
        <!-- Phones: opens the side panel. -->
        <button
          #menuToggle
          type="button"
          class="icon-button menu-toggle"
          aria-controls="sidenav"
          [attr.aria-expanded]="menuOpen()"
          (click)="openMenu()"
        >
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="ui.menu" /></svg>
          <span class="sr-only">Abrir menú</span>
        </button>
        <!-- Tablet and desktop: compact (icons) or expanded side menu. -->
        <button
          type="button"
          class="icon-button rail-toggle"
          aria-controls="sidenav"
          [attr.aria-expanded]="!rail()"
          (click)="setRail(!rail())"
        >
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="ui.menu" /></svg>
          <span class="sr-only">{{
            rail() ? 'Expandir menú lateral' : 'Contraer menú lateral'
          }}</span>
        </button>
        <!-- Phones only: on wider screens the crest sits at the top of the side menu. -->
        <a routerLink="/" class="brand"
          ><img src="brand/CHCH23logo.webp" alt="" width="32" height="32" />Charales</a
        >
        <p class="context">
          <strong>Charales</strong>
          @if (context(); as c) {
            @if (c.section) {
              <span class="sep" aria-hidden="true">/</span><span>{{ c.section }}</span>
            }
            <span class="sep" aria-hidden="true">/</span><span class="page">{{ c.page }}</span>
          }
        </p>
        <span class="demo-badge" title="Entorno de desarrollo con datos de demostración">DEMO</span>
        <div class="spacer"></div>
        @if (auth.user(); as user) {
          <details #userMenu class="user-menu" (keydown.escape)="closeUserMenu(true)">
            <summary>
              <span class="avatar" aria-hidden="true">{{ initials() }}</span>
              <span class="user-name">{{ user.displayName }}</span>
              <span class="sr-only">, {{ roles() }}. Menú de usuario</span>
            </summary>
            <div class="menu">
              <p class="menu-head">
                <strong>{{ user.displayName }}</strong
                ><small>{{ roles() }}</small>
              </p>
              <a routerLink="/account/password">Cambiar contraseña</a>
              <button type="button" class="link" (click)="logout()">Salir</button>
            </div>
          </details>
        }
      </header>
      @if (menuOpen()) {
        <!-- Phones: tapping outside the panel closes it (keyboard: Escape or «Cerrar menú»). -->
        <div class="nav-backdrop" aria-hidden="true" (click)="closeMenu()"></div>
      }
      <nav
        id="sidenav"
        aria-label="Principal"
        class="sidenav"
        [class.open]="menuOpen()"
        (keydown.escape)="closeMenu()"
      >
        <div class="sidenav-head">
          <a routerLink="/" class="sidenav-brand">
            <img src="brand/CHCH23logo.webp" alt="" width="48" height="48" />
            <span class="brand-text"
              ><strong>Charales de Chapala</strong><small>Escuela Formativa</small></span
            >
          </a>
          <button #drawerClose type="button" class="icon-button drawer-close" (click)="closeMenu()">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path [attr.d]="ui.close" />
            </svg>
            <span class="sr-only">Cerrar menú</span>
          </button>
        </div>
        <div id="nav-links" class="nav-links" (click)="onNavClick($event)">
          <a
            routerLink="/"
            class="nav-home"
            data-tip="Inicio"
            routerLinkActive="active"
            ariaCurrentWhenActive="page"
            [routerLinkActiveOptions]="{ exact: true }"
            ><svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path [attr.d]="ui.home" /></svg
            ><span class="nav-label">Inicio</span></a
          >
          @for (section of sections(); track section.name; let i = $index) {
            <div class="nav-group" [class.current]="section.name === activeSection()">
              <button
                type="button"
                class="nav-section"
                [attr.data-tip]="section.name"
                [attr.aria-expanded]="!rail() && openGroups().has(section.name)"
                [attr.aria-controls]="'nav-group-' + i"
                (click)="toggleGroup(section.name, i)"
              >
                <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path [attr.d]="icons[section.name]" />
                </svg>
                <span class="nav-label">{{ section.name }}</span>
                <svg class="icon chevron" viewBox="0 0 24 24" aria-hidden="true">
                  <path [attr.d]="ui.chevron" />
                </svg>
              </button>
              <div
                class="nav-group-links"
                [id]="'nav-group-' + i"
                [hidden]="!openGroups().has(section.name)"
              >
                @for (item of section.items; track item.path) {
                  <a
                    [routerLink]="item.path"
                    [class.active]="item.path === activePath()"
                    [attr.aria-current]="item.path === activePath() ? 'page' : null"
                    >{{ item.label }}</a
                  >
                }
              </div>
            </div>
          }
        </div>
      </nav>
      <main #main id="main" tabindex="-1" [attr.inert]="drawerInert()"><router-outlet /></main>
    </div>
  `,
})
export class Shell {
  protected auth = inject(AuthService);
  private router = inject(Router);
  protected icons = SECTION_ICONS;
  protected ui = UI_ICONS;
  private injector = inject(Injector);
  protected sections = computed(() =>
    this.auth.user() ? navSections((i) => this.auth.can(i.permission)) : [],
  );
  protected roles = computed(() =>
    (this.auth.user()?.roles ?? []).map((r) => ROLE_LABELS[r] ?? r).join(' + '),
  );
  /** Phones: the side panel is open. The rest of the page is inert meanwhile (D1). */
  protected menuOpen = signal(false);
  protected drawerInert = computed(() => (this.menuOpen() ? '' : null));
  private menuToggle = viewChild.required<ElementRef<HTMLButtonElement>>('menuToggle');
  private drawerClose = viewChild.required<ElementRef<HTMLButtonElement>>('drawerClose');
  /** Tablet and desktop: compact side menu (icons only). */
  protected rail = signal(false);
  /** Groups the user has open; the active page's group is opened on every navigation. */
  protected openGroups = signal<ReadonlySet<NavSection>>(new Set());

  protected openMenu(): void {
    this.menuOpen.set(true);
    afterNextRender(() => this.drawerClose().nativeElement.focus(), { injector: this.injector });
  }

  /** Phones: Escape, «Cerrar menú», the backdrop or a chosen link close the panel; focus returns to the hamburger. */
  protected closeMenu(): void {
    if (!this.menuOpen()) return;
    this.menuOpen.set(false);
    // After the render that removes `inert` from the header: an inert button cannot take focus.
    afterNextRender(() => this.menuToggle().nativeElement.focus(), { injector: this.injector });
  }

  protected onNavClick(event: Event): void {
    // A link: close the panel (a navigation then moves focus to the new page). A group button: keep it open.
    if ((event.target as Element).closest('a')) this.closeMenu();
  }

  protected setRail(rail: boolean): void {
    this.rail.set(rail);
    // D3: the preference is only remembered on desktop; a tablet always starts compact.
    if (this.desktop?.matches)
      try {
        localStorage.setItem(RAIL_KEY, rail ? '1' : '0');
      } catch {
        // Storage unavailable (private mode): the choice lasts for this page only.
      }
  }

  /** Expanded menu: opens or closes the group. Compact menu (D2): expands it, opens the group, focuses its first link. */
  protected toggleGroup(name: NavSection, index: number): void {
    const open = new Set(this.openGroups());
    if (this.rail()) {
      this.setRail(false);
      open.add(name);
      this.openGroups.set(open);
      afterNextRender(() => document.querySelector<HTMLElement>(`#nav-group-${index} a`)?.focus(), {
        injector: this.injector,
      });
      return;
    }
    if (!open.delete(name)) open.add(name);
    this.openGroups.set(open);
  }

  /** Breakpoints of styles.css: phones ≤ 760 px (panel), tablet (compact by default), desktop ≥ 1024 px. */
  private phone = typeof matchMedia === 'function' ? matchMedia('(max-width: 760px)') : null;
  private desktop = typeof matchMedia === 'function' ? matchMedia('(min-width: 1024px)') : null;

  private applyBreakpoint(): void {
    if (this.phone?.matches) {
      this.rail.set(false); // the panel always shows names
      return;
    }
    this.menuOpen.set(false);
    if (this.desktop?.matches) {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(RAIL_KEY);
      } catch {
        // Storage unavailable: expanded by default.
      }
      this.rail.set(stored === '1');
    } else if (this.phone) this.rail.set(true); // tablet
  }

  private url = signal(this.router.url);
  protected activePath = computed(() =>
    activeNavPath(
      this.url(),
      this.sections().flatMap((s) => s.items.map((i) => i.path)),
    ),
  );
  /** Top bar context: the section and page of the active menu item. */
  protected activeSection = computed(
    () => NAV_ITEMS.find((i) => i.path === this.activePath())?.section ?? null,
  );
  protected context = computed(() => {
    const item = NAV_ITEMS.find((i) => i.path === this.activePath());
    if (item) return { section: item.section, page: item.label };
    return pathOf(this.url()) === '/' ? { section: null, page: 'Inicio' } : null;
  });
  protected initials = computed(() =>
    (this.auth.user()?.displayName ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join(''),
  );
  private main = viewChild.required<ElementRef<HTMLElement>>('main');
  private userMenu = viewChild<ElementRef<HTMLDetailsElement>>('userMenu');

  constructor() {
    this.applyBreakpoint();
    for (const query of [this.phone, this.desktop])
      query?.addEventListener('change', () => this.applyBreakpoint());
    // The first NavigationEnd is the page load (or the login), and replaceUrl ones are redirects (Home → /coach,
    // /portal) or filters kept in the URL: focus stays where it is, so the skip link is still the first stop.
    let previous: string | null = null;
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((e) => {
        this.url.set(e.urlAfterRedirects);
        this.closeUserMenu(false);
        this.menuOpen.set(false);
        const section = this.activeSection();
        if (section && !this.openGroups().has(section))
          this.openGroups.set(new Set([...this.openGroups(), section]));
        const path = pathOf(e.urlAfterRedirects);
        // A new page moves focus to its content (WCAG focus on route change); a query-only change keeps focus
        // where the user is. preventScroll leaves scrolling to the router (withInMemoryScrolling).
        const redirect = this.router.lastSuccessfulNavigation()?.extras.replaceUrl;
        if (previous !== null && path !== previous && !redirect)
          this.main().nativeElement.focus({ preventScroll: true });
        previous = path;
      });
  }

  /** Native <details> disclosure: also closes on Escape (focus back to its button), outside clicks and navigation. */
  protected closeUserMenu(refocus: boolean): void {
    const menu = this.userMenu()?.nativeElement;
    if (!menu?.open) return;
    menu.open = false;
    if (refocus) menu.querySelector('summary')?.focus();
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (!this.userMenu()?.nativeElement.contains(event.target as Node)) this.closeUserMenu(false);
  }

  /** With <base href="/">, a bare #main resolves to /#main (another page): focus this page's <main> instead. */
  protected skipToMain(event: Event): void {
    event.preventDefault();
    this.main().nativeElement.focus();
  }

  logout(): void {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}

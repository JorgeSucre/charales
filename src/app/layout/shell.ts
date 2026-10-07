import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { ROLE_LABELS } from '../core/auth/permissions';
import { NAV_ITEMS } from './nav';

/** Groups the allowed menu items by section (also used by the home page). */
export function navSections(can: (item: (typeof NAV_ITEMS)[number]) => boolean) {
  const items = NAV_ITEMS.filter(can);
  return [...new Set(items.map((i) => i.section))].map((name) => ({
    name,
    items: items.filter((i) => i.section === name),
  }));
}

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <a class="skip-link" href="#main">Saltar al contenido</a>
    <header class="topbar">
      <a routerLink="/" class="brand">⚽ Charales</a>
      <span class="demo-badge" title="Datos simulados, sin backend">DEMO</span>
      <div class="spacer"></div>
      @if (auth.user(); as user) {
        <span class="user">{{ user.displayName }} · {{ roles() }}</span>
        <a routerLink="/account/password">Contraseña</a>
        <button type="button" class="link" (click)="logout()">Salir</button>
      }
    </header>
    <div class="layout">
      <nav aria-label="Principal" class="sidenav" [class.open]="menuOpen()">
        <button
          type="button"
          class="secondary menu-toggle"
          aria-controls="nav-links"
          [attr.aria-expanded]="menuOpen()"
          (click)="menuOpen.set(!menuOpen())"
        >
          Menú
        </button>
        <div id="nav-links" class="nav-links" (click)="menuOpen.set(false)">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"
            >Inicio</a
          >
          @for (section of sections(); track section.name) {
            <p class="nav-section">{{ section.name }}</p>
            @for (item of section.items; track item.path) {
              <a
                [routerLink]="item.path"
                routerLinkActive="active"
                [routerLinkActiveOptions]="{ exact: true }"
                >{{ item.label }}</a
              >
            }
          }
        </div>
      </nav>
      <main id="main" tabindex="-1"><router-outlet /></main>
    </div>
  `,
})
export class Shell {
  protected auth = inject(AuthService);
  private router = inject(Router);
  protected sections = computed(() =>
    this.auth.user() ? navSections((i) => this.auth.can(i.permission)) : [],
  );
  protected roles = computed(() =>
    (this.auth.user()?.roles ?? []).map((r) => ROLE_LABELS[r] ?? r).join(' + '),
  );
  /** Only matters on small screens, where the menu is collapsed by default. */
  protected menuOpen = signal(false);

  logout(): void {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}

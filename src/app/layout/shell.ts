import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { ROLE_LABELS } from '../core/auth/permissions';
import { NAV_ITEMS } from './nav';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <a class="skip-link" href="#main">Saltar al contenido</a>
    <header class="topbar">
      <a routerLink="/" class="brand">⚽ Charales</a>
      <span class="demo-badge" title="Autenticación simulada, sin backend">DEMO</span>
      <div class="spacer"></div>
      @if (auth.user(); as user) {
        <span class="user">{{ user.fullName }} · {{ roleLabel() }}</span>
        <a routerLink="/account/password">Contraseña</a>
        <button type="button" class="link" (click)="logout()">Salir</button>
      }
    </header>
    <div class="layout">
      <nav aria-label="Principal" class="sidenav">
        <details open>
          <summary>Menú</summary>
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"
            >Inicio</a
          >
          @for (item of items(); track item.path) {
            <a
              [routerLink]="item.path"
              routerLinkActive="active"
              [routerLinkActiveOptions]="{ exact: true }"
              >{{ item.label }}</a
            >
          }
        </details>
      </nav>
      <main id="main" tabindex="-1"><router-outlet /></main>
    </div>
  `,
})
export class Shell {
  protected auth = inject(AuthService);
  private router = inject(Router);
  protected items = computed(() =>
    this.auth.user() ? NAV_ITEMS.filter((i) => this.auth.can(i.permission)) : [],
  );
  protected roleLabel = computed(() => ROLE_LABELS[this.auth.user()!.role]);

  logout(): void {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}

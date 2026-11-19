import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';

/**
 * '/' (bookmarks, the old Inicio): sends the session to its main page — the Tablero for staff who may read it, the
 * portal or the coach panel. It only renders for a session with none of those (a role whose permissions were
 * narrowed, HU-006): a short notice, never a second list of the menu.
 */
@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (target === '/') {
      <h1>Charales</h1>
      <p class="muted">Usa el menú para ir a los módulos que tu rol tiene disponibles.</p>
    }
  `,
})
export class Home {
  protected target = inject(AuthService).homeUrl();

  constructor() {
    if (this.target !== '/') inject(Router).navigateByUrl(this.target, { replaceUrl: true });
  }
}

@Component({
  selector: 'app-forbidden',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="panel narrow">
      <h1>Acceso denegado</h1>
      <p class="muted">Tu rol no tiene permiso para ver esta sección.</p>
      <a class="button secondary" routerLink="/">Ir a la página principal</a>
    </section>
  `,
})
export class Forbidden {}

import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { navSections } from './shell';

/** Home: tutors and coaches land on their own area (HU-001.4 redirect by role); staff get the module cards. */
@Component({
  selector: 'app-home',
  imports: [RouterLink],
  template: `
    <h1>Hola, {{ auth.user()?.displayName }}</h1>
    @for (section of sections(); track section.name) {
      <h2>{{ section.name }}</h2>
      <div class="cards">
        @for (item of section.items; track item.path) {
          <a class="card" [routerLink]="item.path">{{ item.label }}</a>
        }
      </div>
    }
  `,
})
export class Home {
  protected auth = inject(AuthService);
  protected sections = computed(() => navSections((i) => this.auth.can(i.permission)));

  constructor() {
    const target = this.auth.homeUrl();
    if (target !== '/') inject(Router).navigateByUrl(target, { replaceUrl: true });
  }
}

@Component({
  selector: 'app-forbidden',
  imports: [RouterLink],
  template: `<h1>Acceso denegado</h1>
    <p>Tu rol no tiene permiso para ver esta sección.</p>
    <a routerLink="/">Volver al inicio</a>`,
})
export class Forbidden {}

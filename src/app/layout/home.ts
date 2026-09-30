import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { NAV_ITEMS } from './nav';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  template: `
    <h1>Hola, {{ auth.user()?.fullName }}</h1>
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
  protected sections = computed(() => {
    const items = NAV_ITEMS.filter((i) => this.auth.can(i.permission));
    return [...new Set(items.map((i) => i.section))].map((name) => ({
      name,
      items: items.filter((i) => i.section === name),
    }));
  });
}

@Component({
  selector: 'app-forbidden',
  imports: [RouterLink],
  template: `<h1>Acceso denegado</h1>
    <p>Tu rol no tiene permiso para ver esta sección.</p>
    <a routerLink="/">Volver al inicio</a>`,
})
export class Forbidden {}

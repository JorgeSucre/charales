import { DatePipe } from '@angular/common';
import { Component, computed, inject, resource } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { ReportService } from '../features/reports/report.service';
import { LoadState } from '../shared/load-state';
import { dateRangeLabel, today } from '../shared/dates';
import { MoneyPipe } from '../shared/money.pipe';
import { QUICK_ACCESS, SECTION_ICONS } from './nav';
import { navSections } from './shell';

/**
 * Home: tutors and coaches land on their own area (HU-001.4 redirect by role); staff get a greeting, the HU-065
 * indicators (only with reportes.consultar, the same data as the Tablero), quick-access cards and the other modules.
 */
@Component({
  selector: 'app-home',
  imports: [RouterLink, DatePipe, LoadState, MoneyPipe],
  template: `
    <header class="welcome">
      <p class="eyebrow">{{ now | date: 'fullDate' }}</p>
      <h1>Hola, {{ auth.user()?.displayName }}</h1>
      <p class="muted">Panel administrativo de la Escuela Formativa Charales de Chapala.</p>
    </header>

    @if (summary) {
      <section aria-labelledby="home-summary">
        <div class="section-head">
          <h2 id="home-summary">Resumen del mes</h2>
          <a routerLink="/admin/dashboard">Ver tablero completo</a>
        </div>
        <app-load-state [res]="summary"
          ><ng-template>
            <div class="kpis six">
              @for (k of summary.value()!.kpis; track k.label) {
                <a class="kpi" [routerLink]="k.link" [title]="'Fuente: ' + k.source">
                  <span>{{ kpiLabel(k.label) }}</span>
                  <strong>{{ k.money ? (k.value | money) : k.value }}</strong>
                </a>
              }
            </div>
          </ng-template></app-load-state
        >
      </section>
    }

    <section aria-labelledby="home-quick">
      <h2 id="home-quick">Accesos rápidos</h2>
      @if (quick().length) {
        <div class="cards quick">
          @for (item of quick(); track item.path) {
            <a class="card module" [routerLink]="item.path">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                <path [attr.d]="quickIcons[item.path]" />
              </svg>
              <strong>{{ item.label }}</strong>
              <span class="muted">{{ item.description }}</span>
            </a>
          }
        </div>
      } @else {
        <p class="muted empty">
          Tu rol no tiene accesos rápidos. Usa el menú para ir a tus módulos.
        </p>
      }
    </section>

    @if (others().length) {
      <section aria-labelledby="home-others">
        <h2 id="home-others">Otros módulos</h2>
        <!-- One compact row per area: every link stays visible without a column per section. -->
        <div class="module-index">
          @for (section of others(); track section.name) {
            <div class="module-row">
              <h3>
                <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path [attr.d]="icons[section.name]" />
                </svg>
                {{ section.name }}
              </h3>
              <ul>
                @for (item of section.items; track item.path) {
                  <li>
                    <a [routerLink]="item.path">{{ item.label }}</a>
                  </li>
                }
              </ul>
            </div>
          }
        </div>
      </section>
    }
  `,
})
export class Home {
  protected auth = inject(AuthService);
  protected icons = SECTION_ICONS;
  protected quickIcons = QUICK_ACCESS;
  protected now = new Date();
  private sections = computed(() => navSections((i) => this.auth.can(i.permission)));
  protected quick = computed(() =>
    Object.keys(QUICK_ACCESS)
      .map((path) =>
        this.sections()
          .flatMap((s) => s.items)
          .find((i) => i.path === path),
      )
      .filter((i) => i !== undefined),
  );
  protected others = computed(() =>
    this.sections()
      .map((s) => ({ ...s, items: s.items.filter((i) => !(i.path in QUICK_ACCESS)) }))
      .filter((s) => s.items.length),
  );
  private reports = inject(ReportService);
  /** The service's own default period (current month up to today, both inclusive), passed explicitly to name it. */
  private period = { from: `${today().slice(0, 7)}-01`, to: today() };
  /** Only loaded with reportes.consultar (the service would refuse it otherwise). */
  protected summary = this.auth.can('reportes.consultar')
    ? resource({ loader: () => this.reports.dashboard(this.period.from, this.period.to) })
    : null;

  /** «Ingresos 2026-10-01 a 2026-10-21» (ReportService label) → «Ingresos del 1 al 21 de octubre de 2026». */
  protected kpiLabel(label: string): string {
    const { from, to } = this.period;
    if (label !== `Ingresos ${from} a ${to}`) return label;
    const range = dateRangeLabel(from, to);
    return range ? `Ingresos ${range}` : 'Ingresos (periodo no disponible)';
  }

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

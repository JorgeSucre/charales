import { Component, computed, inject, resource, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Id, PlayerStatus } from '../../core/models';
import { CategoryService } from '../../core/services/category.service';
import { STATUS_LABELS } from '../../core/services/player.service';
import { addDays, today } from '../../shared/dates';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { idOrNull } from '../../shared/ui';
import { CoachService } from '../coaches/coach.service';
import { ReportService } from './report.service';

/** HU-065: KPIs with their source, period filter and links to the modules. */
@Component({
  selector: 'app-dashboard-page',
  imports: [FormsModule, RouterLink, LoadState, MoneyPipe, DatePipe],
  template: `
    <h1>Tablero</h1>
    <div class="filters">
      <label
        >Ingresos desde <input type="date" [ngModel]="from()" (ngModelChange)="from.set($event)"
      /></label>
      <label>hasta <input type="date" [ngModel]="to()" (ngModelChange)="to.set($event)" /></label>
    </div>
    <app-load-state [res]="data"
      ><ng-template>
        @if (data.value(); as d) {
          <div class="kpis">
            @for (k of d.kpis; track k.label) {
              <a class="kpi" [routerLink]="k.link" [title]="'Fuente: ' + k.source">
                <span>{{ k.label }}</span>
                <strong>{{ k.money ? (k.value | money) : k.value }}</strong>
                <small class="muted">{{ k.source }}</small>
              </a>
            }
          </div>
          <div class="two-col">
            <section>
              <h2>Ocupación por categoría</h2>
              <ul class="list">
                @for (c of d.categories; track c.id) {
                  <li>
                    <a [routerLink]="['/sports/categories', c.id]">{{ c.name }}</a> ·
                    {{ c.occupancy }} / {{ c.capacity ?? '∞' }}
                    @if (c.capacity) {
                      <meter
                        [value]="c.occupancy"
                        min="0"
                        [max]="c.capacity"
                        [high]="c.capacity - 0.5"
                      ></meter>
                    }
                  </li>
                }
              </ul>
            </section>
            <section>
              <h2>Próximos partidos</h2>
              <ul class="list">
                @for (m of d.upcoming; track $index) {
                  <li>
                    {{ m.date | date: 'EEE d MMM' }} {{ m.time }} · {{ m.title }} ·
                    {{ m.venueName ?? '—' }}
                  </li>
                } @empty {
                  <li class="muted">Sin partidos en 14 días.</li>
                }
              </ul>
            </section>
          </div>
        }
      </ng-template></app-load-state
    >
  `,
})
export class DashboardPage {
  private service = inject(ReportService);
  protected from = signal(`${today().slice(0, 7)}-01`);
  protected to = signal(today());
  protected data = resource({
    params: () => ({ from: this.from(), to: this.to() }),
    loader: ({ params }) => this.service.dashboard(params.from, params.to),
  });
}

/** HU-066: players by category with primary tutor and contact, totals per category, printable. */
@Component({
  selector: 'app-players-report-page',
  imports: [FormsModule, LoadState],
  template: `
    <h1>Jugadores por categoría</h1>
    <div class="filters no-print">
      <label
        >Categoría
        <select [ngModel]="categoryId()" (ngModelChange)="categoryId.set(idOrNull($event))">
          <option [ngValue]="null">Todas</option>
          @for (c of categories.value() ?? []; track c.id) {
            <option [ngValue]="c.id">{{ c.name }} · {{ c.seasonName ?? '' }}</option>
          }
        </select>
      </label>
      <label
        >Estatus
        <select [ngModel]="status()" (ngModelChange)="status.set($event)">
          <option value="">Todos</option>
          @for (s of statuses; track s[0]) {
            <option [value]="s[0]">{{ s[1] }}</option>
          }
        </select>
      </label>
      <button type="button" class="secondary" (click)="print()">Imprimir</button>
    </div>
    <app-load-state [res]="rows" emptyText="Sin jugadores."
      ><ng-template>
        @for (g of rows.value() ?? []; track g.categoryName) {
          <h2>
            {{ g.categoryName }} <span class="muted">({{ g.players.length }})</span>
          </h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Jugador</th>
                  <th>Identificador</th>
                  <th class="num">Edad</th>
                  <th>Estatus</th>
                  <th>Tutor principal</th>
                  <th>Contacto</th>
                </tr>
              </thead>
              <tbody>
                @for (p of g.players; track p.identifier) {
                  <tr>
                    <td>{{ p.name }}</td>
                    <td>{{ p.identifier }}</td>
                    <td class="num">{{ p.age }}</td>
                    <td>{{ statusLabels[p.status] }}</td>
                    <td>{{ p.tutor ?? '—' }}</td>
                    <td>{{ p.contact ?? '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        <p>
          <strong>Total: {{ total() }} jugador(es)</strong>
        </p>
      </ng-template></app-load-state
    >
  `,
})
export class PlayersReportPage {
  private service = inject(ReportService);
  private categoryService = inject(CategoryService);
  protected idOrNull = idOrNull;
  protected statusLabels = STATUS_LABELS;
  protected statuses = Object.entries(STATUS_LABELS) as [PlayerStatus, string][];
  protected categories = resource({ loader: () => this.categoryService.list() });
  protected categoryId = signal<Id | null>(null);
  protected status = signal<PlayerStatus | ''>('ACTIVO');
  protected rows = resource({
    params: () => ({ categoryId: this.categoryId(), status: this.status() }),
    loader: ({ params }) => this.service.playersByCategory(params),
  });
  protected total = computed(() =>
    (this.rows.value() ?? []).reduce((s, g) => s + g.players.length, 0),
  );

  print(): void {
    window.print();
  }
}

/** HU-067 */
@Component({
  selector: 'app-income-report-page',
  imports: [FormsModule, LoadState, MoneyPipe],
  template: `
    <h1>Ingresos por periodo y concepto</h1>
    <p class="muted">Pagos aplicados (los cancelados se excluyen), por fecha de pago.</p>
    <div class="filters">
      <label
        >Desde <input type="date" [ngModel]="from()" (ngModelChange)="from.set($event)"
      /></label>
      <label>Hasta <input type="date" [ngModel]="to()" (ngModelChange)="to.set($event)" /></label>
    </div>
    <app-load-state [res]="income" emptyText="Sin ingresos en el periodo."
      ><ng-template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Mes</th>
                <th>Concepto</th>
                <th class="num">Total</th>
              </tr>
            </thead>
            <tbody>
              @for (r of income.value() ?? []; track r.month + r.conceptName) {
                <tr>
                  <td>{{ r.month }}</td>
                  <td>{{ r.conceptName }}</td>
                  <td class="num">{{ r.totalCents | money }}</td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <th colspan="2">Total general</th>
                <th class="num">{{ total() | money }}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      </ng-template></app-load-state
    >
  `,
})
export class IncomeReportPage {
  private service = inject(ReportService);
  protected from = signal(`${today().slice(0, 4)}-01-01`);
  protected to = signal(today());
  protected income = resource({
    params: () => ({ from: this.from(), to: this.to() }),
    loader: ({ params }) => this.service.income(params.from, params.to),
  });
  protected total = computed(() =>
    (this.income.value() ?? []).reduce((sum, r) => sum + r.totalCents, 0),
  );
}

/** HU-068: global agenda of trainings and matches; filters by type, category and coach; venue and time. */
@Component({
  selector: 'app-agenda-page',
  imports: [FormsModule, LoadState, DatePipe],
  template: `
    <h1>Agenda</h1>
    <div class="filters">
      <label
        >Desde <input type="date" [ngModel]="from()" (ngModelChange)="from.set($event)"
      /></label>
      <label>Hasta <input type="date" [ngModel]="to()" (ngModelChange)="to.set($event)" /></label>
      <label
        >Tipo
        <select [ngModel]="kind()" (ngModelChange)="kind.set($event)">
          <option value="">Todos</option>
          <option value="training">Entrenamientos</option>
          <option value="match">Partidos</option>
        </select>
      </label>
      <label
        >Categoría
        <select [ngModel]="category()" (ngModelChange)="category.set(idOrNull($event))">
          <option [ngValue]="null">Todas</option>
          @for (c of categories.value() ?? []; track c.id) {
            <option [ngValue]="c.id">{{ c.name }}</option>
          }
        </select>
      </label>
      <label
        >Entrenador
        <select [ngModel]="coach()" (ngModelChange)="coach.set(idOrNull($event))">
          <option [ngValue]="null">Todos</option>
          @for (c of coaches.value() ?? []; track c.id) {
            <option [ngValue]="c.id">{{ c.name }}</option>
          }
        </select>
      </label>
    </div>
    <app-load-state [res]="agenda" [empty]="!filtered().length" emptyText="Sin eventos."
      ><ng-template>
        @for (day of days(); track day.date) {
          <h2>{{ day.date | date: 'EEEE d MMMM' }}</h2>
          <ul class="agenda">
            @for (e of day.items; track $index) {
              <li [class.match]="e.kind === 'match'" [class.muted]="e.status === 'CANCELADO'">
                <strong>{{ e.start }}{{ e.end ? '–' + e.end : '' }}</strong>
                <span class="tag">{{ e.kind === 'match' ? 'Partido' : 'Entrenamiento' }}</span>
                {{ e.categoryName }} · {{ e.detail }} · {{ e.venueName }} · {{ e.coachNames }}
                @if (e.status === 'CANCELADO' || e.status === 'REPROGRAMADO') {
                  <span class="tag off">{{ e.status }}</span>
                }
              </li>
            }
          </ul>
        }
      </ng-template></app-load-state
    >
  `,
})
export class AgendaPage {
  private service = inject(ReportService);
  private categoryService = inject(CategoryService);
  private coachService = inject(CoachService);
  protected idOrNull = idOrNull;
  protected categories = resource({
    loader: () => this.categoryService.list({ onlyActive: true }),
  });
  protected coaches = resource({ loader: () => this.coachService.list() });
  protected from = signal(today());
  protected to = signal(addDays(today(), 14));
  protected kind = signal('');
  protected category = signal<Id | null>(null);
  protected coach = signal<Id | null>(null);
  protected agenda = resource({
    params: () => ({ from: this.from(), to: this.to() }),
    loader: ({ params }) => this.service.agenda(params.from, params.to),
  });
  protected filtered = computed(() =>
    (this.agenda.hasValue() ? this.agenda.value() : []).filter(
      (e) =>
        (!this.kind() || e.kind === this.kind()) &&
        (this.category() === null || e.categoryId === this.category()) &&
        (this.coach() === null || e.coachIds.includes(this.coach()!)),
    ),
  );
  protected days = computed(() => {
    const map = new Map<string, ReturnType<typeof this.filtered>>();
    for (const e of this.filtered()) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return [...map.entries()].map(([date, items]) => ({ date, items }));
  });
}

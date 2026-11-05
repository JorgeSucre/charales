import { sumCents } from '../../shared/money';
import { Component, LOCALE_ID, computed, inject, resource, signal } from '@angular/core';
import { DatePipe, formatDate } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Id, PlayerStatus } from '../../core/models';
import { CategoryService } from '../../core/services/category.service';
import { STATUS_LABELS } from '../../core/services/player.service';
import {
  WEEKDAYS,
  addDays,
  addMonths,
  dateRangeLabel,
  isISODate,
  monthGrid,
  today,
} from '../../shared/dates';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { idOrNull } from '../../shared/ui';
import { CoachService } from '../coaches/coach.service';
import { AuthService } from '../../core/auth/auth.service';
import { QUICK_TASKS } from '../../layout/nav';
import { Bar, BarChart, ChartTone, DonutChart, DonutSegment } from '../../shared/charts';
import { CHARGE_STATUS_LABELS } from '../billing/billing.service';
import { OpenChargeStatus, ReportService } from './report.service';

/**
 * HU-065 · Tablero, the main page of the office: today's indicators, the income of a period, four charts from the API
 * and a few quick tasks. Only the income depends on the period; everything else is a snapshot of today and is not
 * reloaded when the period changes. Colours keep one meaning (docs/DEVELOPMENT.md § 5.3).
 */
@Component({
  selector: 'app-dashboard-page',
  imports: [FormsModule, RouterLink, LoadState, MoneyPipe, DatePipe, DonutChart, BarChart],
  template: `
    <div class="page-head">
      <div>
        <h1>Tablero</h1>
        <p class="muted">Datos al {{ todayDate | date: 'fullDate' }}.</p>
      </div>
    </div>

    <app-load-state [res]="overview"
      ><ng-template>
        @if (overview.value(); as d) {
          <section aria-labelledby="kpi-title">
            <h2 id="kpi-title" class="sr-only">Indicadores</h2>
            <div class="kpis six">
              @for (k of todayKpis(); track k.key) {
                <a class="kpi" [routerLink]="k.link">
                  <span>{{ k.label }}</span>
                  <strong>{{ k.money ? (k.value | money) : k.value }}</strong>
                  <small class="muted">{{ k.hint }}</small>
                </a>
              }
              <a class="kpi" routerLink="/admin/reports/income">
                <span>Ingresos del periodo</span>
                <strong>
                  @if (income.hasValue()) {
                    {{ incomeTotal() | money }}
                  } @else if (income.error()) {
                    <span class="kpi-error">No disponible</span>
                  } @else {
                    …
                  }
                </strong>
                <small class="muted">{{ periodText() }}; los pagos cancelados no cuentan.</small>
              </a>
            </div>
          </section>

          <section class="panel" aria-labelledby="income-title">
            <div class="page-head">
              <h2 id="income-title">Ingresos por mes</h2>
              <div class="actions">
                <button type="button" class="secondary" (click)="setMonth()">Mes actual</button>
                <button type="button" class="secondary" (click)="setLastMonths(6)">
                  Últimos 6 meses
                </button>
              </div>
            </div>
            <div class="filters">
              <label
                >Desde <input type="date" [ngModel]="from()" (ngModelChange)="from.set($event)"
              /></label>
              <label
                >Hasta <input type="date" [ngModel]="to()" (ngModelChange)="to.set($event)"
              /></label>
            </div>
            @if (validPeriod()) {
              <p class="muted">Pagos registrados {{ periodText() }}, por mes.</p>
              <app-load-state [res]="income" emptyText="No hay pagos registrados en el periodo."
                ><ng-template>
                  <app-bars
                    [rows]="incomeBars()"
                    label="Ingresos por mes"
                    empty="No hay pagos registrados en el periodo."
                  /> </ng-template
              ></app-load-state>
            } @else {
              <p class="alert error" role="status">
                Ingresa un periodo válido: la fecha final no puede ser anterior a la inicial.
              </p>
            }
          </section>

          <div class="chart-grid">
            <section class="panel" aria-labelledby="status-title">
              <h2 id="status-title">Jugadores por estatus</h2>
              <app-donut [segments]="statusSegments()" unit="jugadores" empty="No hay jugadores." />
            </section>

            <section class="panel" aria-labelledby="charges-title">
              <h2 id="charges-title">Estado de cobranza</h2>
              <p class="muted">Todos los cargos no cancelados, por estado.</p>
              <app-bars
                [rows]="chargeBars()"
                label="Cargos por estado"
                empty="No hay cargos registrados."
              />
            </section>

            <section class="panel" aria-labelledby="occupancy-title">
              <h2 id="occupancy-title">Ocupación por categoría</h2>
              <p class="muted">
                Categorías activas de la temporada actual: integrantes con inscripción vigente
                frente a su cupo.
              </p>
              <app-bars
                [rows]="occupancyBars()"
                label="Ocupación por categoría"
                [hideZeros]="false"
                empty="No hay categorías activas en la temporada actual."
              />
            </section>

            <section class="panel" aria-labelledby="matches-title">
              <h2 id="matches-title">Próximos partidos (14 días)</h2>
              <ul class="list">
                @for (m of d.upcoming; track $index) {
                  <li>
                    <strong>{{ m.date | date: 'EEE d MMM' }} {{ m.time }}</strong> · {{ m.title }} ·
                    {{ m.venueName ?? 'Sede por definir' }}
                  </li>
                } @empty {
                  <li class="muted">No hay partidos programados en los próximos 14 días.</li>
                }
              </ul>
            </section>
          </div>
        }
      </ng-template></app-load-state
    >

    @if (tasks().length) {
      <section aria-labelledby="tasks-title">
        <h2 id="tasks-title">Accesos rápidos</h2>
        <div class="cards quick">
          @for (t of tasks(); track t.label) {
            <a class="card module" [routerLink]="t.path" [queryParams]="t.query">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                <path [attr.d]="t.icon" />
              </svg>
              <strong>{{ t.label }}</strong>
            </a>
          }
        </div>
      </section>
    }
  `,
})
export class DashboardPage {
  private service = inject(ReportService);
  private auth = inject(AuthService);
  private locale = inject(LOCALE_ID);
  private money = new MoneyPipe();
  protected todayDate = today();
  /** Default period as before: the current month up to today (inclusive). */
  protected from = signal(`${today().slice(0, 7)}-01`);
  protected to = signal(today());
  protected validPeriod = computed(
    () => isISODate(this.from()) && isISODate(this.to()) && this.from() <= this.to(),
  );
  protected periodText = computed(
    () => (this.validPeriod() && dateRangeLabel(this.from(), this.to())) || 'en el periodo elegido',
  );
  /** Snapshot of today: loaded once, never with the period. */
  protected overview = resource({ loader: () => this.service.dashboard() });
  /** The only data that follows the period (HU-067's query: APLICADO payments, by month and concept). */
  protected income = resource({
    params: () => (this.validPeriod() ? { from: this.from(), to: this.to() } : undefined),
    loader: ({ params }) => this.service.income(params.from, params.to),
  });
  protected tasks = computed(() =>
    QUICK_TASKS.filter((t) => t.permissions.every((p) => this.auth.can(p))),
  );
  protected todayKpis = computed(() =>
    (this.overview.value()?.kpis ?? []).filter((k) => k.key !== 'income'),
  );
  protected incomeTotal = computed(() =>
    sumCents((this.income.value() ?? []).map((r) => r.totalCents)),
  );

  /** Every month of the period, with $0 where nothing was paid (a real zero, so months stay comparable). */
  protected incomeBars = computed<Bar[]>(() => {
    const byMonth = new Map<string, number>();
    for (const r of this.income.value() ?? [])
      byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + r.totalCents);
    const months: string[] = [];
    for (let m = this.from().slice(0, 7); m <= this.to().slice(0, 7); m = addMonths(m, 1))
      months.push(m);
    return months.map((m) => {
      const value = byMonth.get(m) ?? 0;
      return {
        label: formatDate(`${m}-01T12:00:00`, 'MMMM y', this.locale),
        value,
        text: this.money.transform(value),
        tone: 'brand',
      };
    });
  });

  protected statusSegments = computed<DonutSegment[]>(() =>
    (this.overview.value()?.playersByStatus ?? []).map((s) => ({
      label: STATUS_LABELS[s.status],
      value: s.count,
      tone: STATUS_CHART_TONE[s.status],
      link: { path: '/admin/players', query: { status: s.status } },
    })),
  );

  protected chargeBars = computed<Bar[]>(() =>
    (this.overview.value()?.chargesByStatus ?? []).map((c) => ({
      label: CHARGE_STATUS_LABELS[c.status],
      value: c.count,
      text:
        `${c.count} ${c.count === 1 ? 'cargo' : 'cargos'} · ` +
        (c.status === 'PAGADO'
          ? `${this.money.transform(c.netCents)} cubiertos`
          : `saldo ${this.money.transform(c.balanceCents)}`),
      tone: CHARGE_CHART_TONE[c.status],
      link: { path: '/admin/billing/charges', query: { status: c.status } },
    })),
  );

  /** No capacity (null) = no limit; capacity 0 is told apart (full from the start). Full or over → amber. */
  protected occupancyBars = computed<Bar[]>(() =>
    (this.overview.value()?.categories ?? []).map((c) => ({
      label: c.name,
      value: c.occupancy,
      max: c.capacity ?? undefined,
      text:
        c.capacity === null
          ? `${c.occupancy} · sin límite de cupo`
          : c.capacity === 0
            ? `${c.occupancy} · cupo 0`
            : `${c.occupancy} de ${c.capacity}`,
      tone: c.capacity === null ? 'neutral' : c.occupancy >= c.capacity ? 'warn' : 'brand',
      link: { path: `/sports/categories/${c.id}` },
    })),
  );

  setMonth(): void {
    this.from.set(`${today().slice(0, 7)}-01`);
    this.to.set(today());
  }

  setLastMonths(n: number): void {
    this.from.set(`${addMonths(today().slice(0, 7), -(n - 1))}-01`);
    this.to.set(today());
  }
}

const STATUS_CHART_TONE: Record<PlayerStatus, ChartTone> = {
  ACTIVO: 'ok',
  BAJA_TEMPORAL: 'warn',
  BAJA_DEFINITIVA: 'danger',
};

const CHARGE_CHART_TONE: Record<OpenChargeStatus, ChartTone> = {
  PENDIENTE: 'warn',
  PARCIAL: 'warnSoft',
  VENCIDO: 'danger',
  PAGADO: 'ok',
};

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
  protected total = computed(() => sumCents((this.income.value() ?? []).map((r) => r.totalCents)));
}

/**
 * HU-068: global agenda of trainings and matches — month calendar (default) or list; filters by type, category and
 * coach; shows venue and time. Trainings and matches are told apart by colour and label.
 */
@Component({
  selector: 'app-agenda-page',
  imports: [FormsModule, LoadState, DatePipe],
  template: `
    <h1>Agenda</h1>
    <div class="filters">
      <div class="seg" role="radiogroup" aria-label="Vista">
        <label [class.on]="view() === 'calendar'"
          ><input
            type="radio"
            name="view"
            value="calendar"
            [checked]="view() === 'calendar'"
            (change)="view.set('calendar')"
          />
          Calendario</label
        >
        <label [class.on]="view() === 'list'"
          ><input
            type="radio"
            name="view"
            value="list"
            [checked]="view() === 'list'"
            (change)="view.set('list')"
          />
          Lista</label
        >
      </div>
      @if (view() === 'calendar') {
        <div class="actions">
          <button
            type="button"
            class="secondary"
            (click)="month.set(shift(-1))"
            aria-label="Mes anterior"
          >
            ‹
          </button>
          <strong class="month-title">{{ month() + '-01' | date: 'MMMM y' }}</strong>
          <button
            type="button"
            class="secondary"
            (click)="month.set(shift(1))"
            aria-label="Mes siguiente"
          >
            ›
          </button>
        </div>
      } @else {
        <label
          >Desde <input type="date" [ngModel]="from()" (ngModelChange)="from.set($event)"
        /></label>
        <label>Hasta <input type="date" [ngModel]="to()" (ngModelChange)="to.set($event)" /></label>
      }
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
    @if (view() === 'calendar') {
      <app-load-state [res]="agenda" [empty]="false"
        ><ng-template>
          <div class="table-wrap">
            <table class="calendar" aria-label="Calendario mensual">
              <thead>
                <tr>
                  @for (d of weekdays; track d) {
                    <th scope="col">{{ d }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (week of grid(); track week[0]) {
                  <tr>
                    @for (day of week; track day) {
                      <td
                        [class.out]="day.slice(0, 7) !== month()"
                        [class.today]="day === todayDate"
                      >
                        <span class="day-number">{{ +day.slice(8) }}</span>
                        @for (e of byDay().get(day) ?? []; track $index) {
                          <span
                            class="event"
                            [class.match]="e.kind === 'match'"
                            [class.muted]="e.status === 'CANCELADO'"
                            [title]="e.detail + ' · ' + e.venueName + ' · ' + e.coachNames"
                            >{{ e.start }} {{ e.kind === 'match' ? '⚽' : '🏃' }}
                            {{ e.categoryName }}</span
                          >
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="muted">
            ⚽ partido · 🏃 entrenamiento. Pasa el cursor sobre un evento para ver sede y
            entrenador.
          </p>
        </ng-template></app-load-state
      >
    } @else {
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
    }
  `,
})
export class AgendaPage {
  private service = inject(ReportService);
  private categoryService = inject(CategoryService);
  private coachService = inject(CoachService);
  protected idOrNull = idOrNull;
  protected weekdays = WEEKDAYS.slice(1);
  protected todayDate = today();
  protected categories = resource({
    loader: () => this.categoryService.list({ onlyActive: true }),
  });
  protected coaches = resource({ loader: () => this.coachService.list() });
  protected view = signal<'calendar' | 'list'>('calendar');
  protected month = signal(today().slice(0, 7));
  protected grid = computed(() => monthGrid(this.month()));
  protected from = signal(today());
  protected to = signal(addDays(today(), 14));
  protected kind = signal('');
  protected category = signal<Id | null>(null);
  protected coach = signal<Id | null>(null);
  protected agenda = resource({
    params: () => {
      if (this.view() === 'list') return { from: this.from(), to: this.to() };
      const weeks = this.grid();
      return { from: weeks[0][0], to: weeks.at(-1)![6] };
    },
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
  protected byDay = computed(() => {
    const map = new Map<string, ReturnType<typeof this.filtered>>();
    for (const e of this.filtered()) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return map;
  });
  protected days = computed(() =>
    [...this.byDay().entries()].map(([date, items]) => ({ date, items })),
  );

  shift(n: number): string {
    return addMonths(this.month(), n);
  }
}

import { sumCents } from '../../shared/money';
import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { DatePipe, formatDate } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Id, MatchStatus, PlayerStatus } from '../../core/models';
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
import { PLAYER_TONE } from '../../shared/status-tone';
import { idOrNull } from '../../shared/ui';
import { CoachService } from '../coaches/coach.service';
import { AuthService } from '../../core/auth/auth.service';
import { QUICK_TASKS } from '../../layout/nav';
import { Bar, BarChart, ChartTone, DonutChart, DonutSegment } from '../../shared/charts';
import { CHARGE_STATUS_LABELS } from '../billing/billing.service';
import { MATCH_STATUS_LABELS } from '../matches/match.service';
import { OpenChargeStatus, ReportService } from './report.service';

const EVENT_STATUS_LABELS: Record<string, string> = {
  ...MATCH_STATUS_LABELS,
  REALIZADO: 'Realizado',
};

/**
 * HU-065 · Tablero, the main page of the office: today's indicators, quick tasks, the income of a period, four charts
 * from the API and upcoming matches. Only the income depends on the period; everything else is a snapshot of today
 * and is not reloaded when the period changes. Colours keep one meaning (docs/DEVELOPMENT.md § 5.3).
 */
@Component({
  selector: 'app-dashboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, LoadState, MoneyPipe, DatePipe, DonutChart, BarChart],
  template: `
    <div class="page-head">
      <div>
        <h1>Tablero</h1>
        <p class="page-subtitle">
          Resumen operativo y financiero al {{ todayDate | date: 'fullDate' }}.
        </p>
      </div>
      <div class="actions">
        <a class="button secondary sm" routerLink="/sports/agenda">Ver agenda</a>
      </div>
    </div>

    <app-load-state [res]="overview"
      ><ng-template>
        @if (overview.value(); as d) {
          <section aria-labelledby="kpi-title">
            <h2 id="kpi-title" class="sr-only">Indicadores</h2>
            <div class="kpis six">
              @for (k of todayKpis(); track k.key) {
                <a
                  class="kpi"
                  [class.danger]="isOverdueKey(k.key) && k.value > 0"
                  [class.kpi-ok]="isOverdueKey(k.key) && k.value === 0"
                  [routerLink]="k.link"
                >
                  <span>{{ k.label }}</span>
                  <strong>{{ k.money ? (k.value | money) : k.value }}</strong>
                  <small class="muted">{{ k.hint }}</small>
                  <div class="kpi-foot"><em class="kpi-scope">Al día de hoy</em></div>
                </a>
              }
              <a class="kpi kpi-period" routerLink="/admin/reports/income">
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
                <div class="kpi-foot"><em class="kpi-scope period">Según periodo</em></div>
              </a>
            </div>
          </section>

          @if (tasks().length) {
            <section class="quick-section" aria-labelledby="tasks-title">
              <div class="section-head">
                <h2 id="tasks-title">Accesos rápidos</h2>
                <span class="muted section-note">Operaciones frecuentes</span>
              </div>
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

          <section class="panel income-panel" aria-labelledby="income-title">
            <div class="income-head">
              <div>
                <div class="title-row">
                  <h2 id="income-title">Ingresos por mes</h2>
                  <span class="period-pill">{{ periodText() }}</span>
                </div>
                <p class="muted panel-sub">Pagos registrados {{ periodText() }}, por mes.</p>
              </div>
              <div class="income-summary">
                <span class="income-summary-label">Ingresos del periodo</span>
                <strong class="tabular income-summary-value">
                  @if (income.hasValue()) {
                    {{ incomeTotal() | money }}
                  } @else if (income.error()) {
                    <span class="kpi-error">No disponible</span>
                  } @else {
                    …
                  }
                </strong>
              </div>
            </div>

            <div class="income-toolbar">
              <div class="filters-inline">
                <label
                  >Desde <input type="date" [ngModel]="from()" (ngModelChange)="from.set($event)"
                /></label>
                <label
                  >Hasta <input type="date" [ngModel]="to()" (ngModelChange)="to.set($event)"
                /></label>
              </div>
              <div class="actions">
                <button
                  type="button"
                  class="secondary sm"
                  [class.active]="isCurrentMonth()"
                  [attr.aria-pressed]="isCurrentMonth()"
                  (click)="setMonth()"
                >
                  Mes actual
                </button>
                <button
                  type="button"
                  class="secondary sm"
                  [class.active]="isLastSixMonths()"
                  [attr.aria-pressed]="isLastSixMonths()"
                  (click)="setLastMonths(6)"
                >
                  Últimos 6 meses
                </button>
                <a class="button secondary sm" routerLink="/admin/reports/income">Ver desglose</a>
              </div>
            </div>

            @if (validPeriod()) {
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
              <div class="panel-title-group">
                <h2 id="status-title">Jugadores por estatus</h2>
                <p class="muted panel-sub">Distribución vigente de la plantilla.</p>
              </div>
              <app-donut [segments]="statusSegments()" unit="jugadores" empty="No hay jugadores." />
            </section>

            <section class="panel" aria-labelledby="charges-title">
              <div class="panel-title-group">
                <h2 id="charges-title">Estado de cobranza</h2>
                <p class="muted panel-sub">Todos los cargos no cancelados, por estado.</p>
              </div>
              <app-bars
                [rows]="chargeBars()"
                label="Cargos por estado"
                empty="No hay cargos registrados."
              />
            </section>

            <section class="panel" aria-labelledby="occupancy-title">
              <div class="panel-title-group">
                <h2 id="occupancy-title">Ocupación por categoría</h2>
                <p class="muted panel-sub">
                  Categorías activas de la temporada actual: integrantes con inscripción vigente
                  frente a su cupo.
                </p>
              </div>
              <app-bars
                [rows]="occupancyBars()"
                label="Ocupación por categoría"
                [hideZeros]="false"
                empty="No hay categorías activas en la temporada actual."
              />
            </section>

            <section class="panel" aria-labelledby="matches-title">
              <div class="page-head compact">
                <div>
                  <h2 id="matches-title">Próximos partidos (14 días)</h2>
                  <p class="muted panel-sub">
                    {{
                      d.upcoming.length
                        ? 'Encuentros programados y reprogramados.'
                        : 'Agenda de encuentros en los próximos 14 días.'
                    }}
                  </p>
                </div>
                @if (auth.can('partidos.consultar')) {
                  <a class="button secondary sm" routerLink="/sports/matches">Ver partidos</a>
                }
              </div>
              @if (d.upcoming.length) {
                <ul class="match-list">
                  @for (m of d.upcoming; track $index) {
                    <li class="match-row">
                      <div class="match-when">
                        <strong class="cap">{{ m.date | date: 'EEE d MMM' }}</strong>
                        <small class="tabular muted">{{ m.time }}</small>
                      </div>
                      <div class="match-info">
                        <strong>{{ m.title }}</strong>
                        <small class="muted">{{ m.venueName ?? 'Sede por definir' }}</small>
                      </div>
                      <span class="tag" [class.warn]="m.status === 'REPROGRAMADO'">{{
                        matchStatusLabel(m.status)
                      }}</span>
                    </li>
                  }
                </ul>
              } @else {
                <p class="muted chart-empty">
                  No hay partidos programados en los próximos 14 días.
                </p>
              }
            </section>
          </div>
        }
      </ng-template></app-load-state
    >
  `,
})
export class DashboardPage {
  private service = inject(ReportService);
  protected auth = inject(AuthService);
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
  protected isCurrentMonth = computed(() => {
    const now = today();
    return this.from() === `${now.slice(0, 7)}-01` && this.to() === now;
  });
  protected isLastSixMonths = computed(() => {
    const now = today();
    return this.from() === `${addMonths(now.slice(0, 7), -5)}-01` && this.to() === now;
  });
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

  protected isOverdueKey(key: string): boolean {
    return key === 'overdue' || key === 'overduePlayers';
  }

  protected matchStatusLabel(status: string): string {
    return MATCH_STATUS_LABELS[status as MatchStatus] ?? status;
  }

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
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, LoadState, DatePipe],
  template: `
    <div class="print-only print-header">
      <strong>Escuela Formativa Charales · Jugadores por categoría</strong>
      <span class="muted">Generado el {{ todayDate | date: 'fullDate' }}</span>
    </div>

    <div class="page-head">
      <div>
        <h1>Jugadores por categoría</h1>
        <p class="page-subtitle">
          Distribución vigente por categoría con tutor principal y datos de contacto.
        </p>
      </div>
      <div class="actions no-print">
        <button type="button" class="secondary" (click)="print()">Imprimir</button>
      </div>
    </div>

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
      @if (categoryId() !== null || status() !== 'ACTIVO') {
        <button type="button" class="secondary sm" (click)="resetFilters()">Restablecer</button>
      }
    </div>

    <app-load-state [res]="rows" emptyText="Sin jugadores."
      ><ng-template>
        <div class="report-summary no-print">
          <strong class="tabular"
            >{{ total() }} {{ total() === 1 ? 'jugador' : 'jugadores' }}</strong
          >
          <span class="muted">
            en {{ (rows.value() ?? []).length }}
            {{ (rows.value() ?? []).length === 1 ? 'categoría' : 'categorías' }}
          </span>
        </div>

        @for (g of rows.value() ?? []; track g.categoryName) {
          <section class="report-group">
            <div class="report-group-head">
              <h2>{{ g.categoryName }}</h2>
              <span class="tag neutral tabular">{{ g.players.length }}</span>
            </div>
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
                      <td class="mono">{{ p.identifier }}</td>
                      <td class="num">{{ p.age }}</td>
                      <td>
                        <span class="tag" [class]="playerTone[p.status]">{{
                          statusLabels[p.status]
                        }}</span>
                      </td>
                      <td>{{ p.tutor ?? '—' }}</td>
                      <td>{{ p.contact ?? '—' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }
        <p class="report-total">
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
  protected todayDate = today();
  protected statusLabels = STATUS_LABELS;
  protected playerTone = PLAYER_TONE;
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

  resetFilters(): void {
    this.categoryId.set(null);
    this.status.set('ACTIVO');
  }

  print(): void {
    window.print();
  }
}

/** HU-067 */
@Component({
  selector: 'app-income-report-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, LoadState, MoneyPipe, DatePipe],
  template: `
    <div class="print-only print-header">
      <strong>Escuela Formativa Charales · Ingresos por periodo y concepto</strong>
      <span class="muted">{{ periodText() }}</span>
    </div>

    <div class="page-head">
      <div>
        <h1>Ingresos por periodo y concepto</h1>
        <p class="page-subtitle">
          Pagos aplicados (los cancelados se excluyen), por fecha de pago.
        </p>
      </div>
      <div class="actions no-print">
        <button type="button" class="secondary" (click)="print()">Imprimir</button>
      </div>
    </div>

    <div class="filters no-print">
      <label
        >Desde <input type="date" [ngModel]="from()" (ngModelChange)="from.set($event)"
      /></label>
      <label>Hasta <input type="date" [ngModel]="to()" (ngModelChange)="to.set($event)" /></label>
      <div class="actions">
        <button
          type="button"
          class="secondary sm"
          [class.active]="isCurrentYear()"
          [attr.aria-pressed]="isCurrentYear()"
          (click)="setYear()"
        >
          Año actual
        </button>
        <button
          type="button"
          class="secondary sm"
          [class.active]="isCurrentMonth()"
          [attr.aria-pressed]="isCurrentMonth()"
          (click)="setMonth()"
        >
          Mes actual
        </button>
        <button
          type="button"
          class="secondary sm"
          [class.active]="isLastSixMonths()"
          [attr.aria-pressed]="isLastSixMonths()"
          (click)="setLastMonths(6)"
        >
          Últimos 6 meses
        </button>
      </div>
    </div>

    @if (validPeriod()) {
      <app-load-state [res]="income" emptyText="Sin ingresos en el periodo."
        ><ng-template>
          <dl class="summary">
            <div>
              <dt>Total del periodo</dt>
              <dd class="tabular">{{ total() | money }}</dd>
            </div>
            <div>
              <dt>Periodo</dt>
              <dd>{{ periodText() }}</dd>
            </div>
            <div>
              <dt>Conceptos agrupados</dt>
              <dd class="tabular">{{ (income.value() ?? []).length }}</dd>
            </div>
          </dl>

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
                    <td class="cap">{{ r.month + '-01T12:00:00' | date: 'MMMM y' }}</td>
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
    } @else {
      <p class="alert error" role="status">
        Ingresa un periodo válido: la fecha final no puede ser anterior a la inicial.
      </p>
    }
  `,
})
export class IncomeReportPage {
  private service = inject(ReportService);
  protected from = signal(`${today().slice(0, 4)}-01-01`);
  protected to = signal(today());
  protected validPeriod = computed(
    () => isISODate(this.from()) && isISODate(this.to()) && this.from() <= this.to(),
  );
  protected periodText = computed(
    () => (this.validPeriod() && dateRangeLabel(this.from(), this.to())) || 'en el periodo elegido',
  );
  protected isCurrentYear = computed(() => {
    const now = today();
    return this.from() === `${now.slice(0, 4)}-01-01` && this.to() === now;
  });
  protected isCurrentMonth = computed(() => {
    const now = today();
    return this.from() === `${now.slice(0, 7)}-01` && this.to() === now;
  });
  protected isLastSixMonths = computed(() => {
    const now = today();
    return this.from() === `${addMonths(now.slice(0, 7), -5)}-01` && this.to() === now;
  });
  protected income = resource({
    params: () => (this.validPeriod() ? { from: this.from(), to: this.to() } : undefined),
    loader: ({ params }) => this.service.income(params.from, params.to),
  });
  protected total = computed(() => sumCents((this.income.value() ?? []).map((r) => r.totalCents)));

  setYear(): void {
    this.from.set(`${today().slice(0, 4)}-01-01`);
    this.to.set(today());
  }

  setMonth(): void {
    this.from.set(`${today().slice(0, 7)}-01`);
    this.to.set(today());
  }

  setLastMonths(n: number): void {
    this.from.set(`${addMonths(today().slice(0, 7), -(n - 1))}-01`);
    this.to.set(today());
  }

  print(): void {
    window.print();
  }
}

/**
 * HU-068: global agenda of trainings and matches — month calendar (default) or list; filters by type, category and
 * coach; shows venue and time. Trainings and matches are told apart by colour and label.
 */
@Component({
  selector: 'app-agenda-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, LoadState, DatePipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Agenda</h1>
        <p class="page-subtitle">
          Calendario global de entrenamientos y partidos por categoría y entrenador.
        </p>
      </div>
      <span class="tag neutral tabular"
        >{{ filtered().length }} {{ filtered().length === 1 ? 'evento' : 'eventos' }}</span
      >
    </div>

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
            class="secondary sm"
            (click)="month.set(shift(-1))"
            aria-label="Mes anterior"
          >
            ‹
          </button>
          <strong class="month-title">{{ month() + '-01' | date: 'MMMM y' }}</strong>
          <button
            type="button"
            class="secondary sm"
            (click)="month.set(shift(1))"
            aria-label="Mes siguiente"
          >
            ›
          </button>
          @if (month() !== todayDate.slice(0, 7)) {
            <button type="button" class="secondary sm" (click)="goToday()">Hoy</button>
          }
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
      @if (hasFilters()) {
        <button type="button" class="secondary sm" (click)="resetFilters()">Limpiar filtros</button>
      }
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
          <div class="agenda-legend muted">
            <span><span class="legend-chip training" aria-hidden="true"></span> Entrenamiento</span>
            <span><span class="legend-chip match" aria-hidden="true"></span> Partido</span>
            <span class="legend-tip">
              Pasa el cursor sobre un evento para ver sede y entrenador.
            </span>
          </div>
        </ng-template></app-load-state
      >
    } @else if (!validListRange()) {
      <p class="alert error" role="status">
        Ingresa un periodo válido: la fecha final no puede ser anterior a la inicial.
      </p>
    } @else {
      <app-load-state [res]="agenda" [empty]="!filtered().length" emptyText="Sin eventos."
        ><ng-template>
          @for (day of days(); track day.date) {
            <h2 class="cap">{{ day.date | date: 'EEEE d MMMM' }}</h2>
            <ul class="agenda">
              @for (e of day.items; track $index) {
                <li [class.match]="e.kind === 'match'" [class.muted]="e.status === 'CANCELADO'">
                  <div class="agenda-row">
                    <div class="agenda-main">
                      <strong class="tabular">{{ e.start }}{{ e.end ? '–' + e.end : '' }}</strong>
                      <span class="tag" [class.warn]="e.kind === 'match'">{{
                        e.kind === 'match' ? 'Partido' : 'Entrenamiento'
                      }}</span>
                      <span class="agenda-title">{{ e.categoryName }} · {{ e.detail }}</span>
                      @if (e.status === 'CANCELADO' || e.status === 'REPROGRAMADO') {
                        <span
                          class="tag"
                          [class.off]="e.status === 'CANCELADO'"
                          [class.warn]="e.status === 'REPROGRAMADO'"
                          >{{ statusLabel(e.status) }}</span
                        >
                      }
                    </div>
                    <small class="muted">{{ e.venueName }} · {{ e.coachNames }}</small>
                  </div>
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
  protected validListRange = computed(
    () =>
      this.view() !== 'list' ||
      (isISODate(this.from()) && isISODate(this.to()) && this.from() <= this.to()),
  );
  protected kind = signal('');
  protected category = signal<Id | null>(null);
  protected coach = signal<Id | null>(null);
  protected hasFilters = computed(
    () => !!this.kind() || this.category() !== null || this.coach() !== null,
  );
  protected agenda = resource({
    params: () => {
      if (this.view() === 'list') {
        return this.validListRange() ? { from: this.from(), to: this.to() } : undefined;
      }
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

  goToday(): void {
    this.month.set(today().slice(0, 7));
  }

  resetFilters(): void {
    this.kind.set('');
    this.category.set(null);
    this.coach.set(null);
  }

  protected statusLabel(status: string): string {
    return EVENT_STATUS_LABELS[status] ?? status;
  }
}

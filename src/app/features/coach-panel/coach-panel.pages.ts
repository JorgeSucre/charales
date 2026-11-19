import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Id } from '../../core/models';
import { COMPETITION_STATUS_LABELS, TYPE_LABELS } from '../../core/services/competition.service';
import { WEEKDAYS, addDays, today } from '../../shared/dates';
import { LoadState } from '../../shared/load-state';
import { COMPETITION_TONE, MATCH_TONE, TRAINING_TONE } from '../../shared/status-tone';
import { idOrNull } from '../../shared/ui';
import { MATCH_STATUS_LABELS } from '../matches/match.service';
import { TRAINING_STATUS_LABELS } from '../trainings/training.service';
import { CoachPanelService } from './coach-panel.service';

/** HU-024 (my categories and players, read-only) + HU-025 (weekly calendar with overlaps). */
@Component({
  selector: 'app-coach-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LoadState, DatePipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Panel de entrenador</h1>
        <p class="page-subtitle">
          Tus próximas sesiones para pasar lista, calendario semanal, partidos y planteles
          asignados.
        </p>
      </div>
      <a class="button" routerLink="/coach/sessions">Mis entrenamientos</a>
    </div>

    <div class="kpis">
      <div class="kpi">
        <span>Categorías asignadas</span>
        <strong>{{ (categories.value() ?? []).length }}</strong>
      </div>
      <div class="kpi">
        <span>Jugadores activos</span>
        <strong>{{ totalPlayers() }}</strong>
      </div>
      <div class="kpi">
        <span>Sesiones (próx. 7 días)</span>
        <strong>{{ upcomingSessions().length }}</strong>
      </div>
      <div class="kpi">
        <span>Próximos partidos</span>
        <strong>{{ upcomingMatches().length }}</strong>
      </div>
    </div>

    <section class="panel" aria-labelledby="coach-upcoming-sessions">
      <div class="panel-head-row">
        <div class="panel-title-group">
          <h2 id="coach-upcoming-sessions">Sesiones de hoy y próximos 7 días</h2>
          <p class="muted panel-sub">Accede directo al pase de lista de tus categorías.</p>
        </div>
        <a class="button secondary sm" routerLink="/coach/sessions">Ver calendario completo</a>
      </div>
      <app-load-state
        [res]="upcoming"
        emptyText="No hay sesiones programadas para los próximos 7 días."
      >
        <ng-template>
          <ul class="cards-list">
            @for (s of upcomingSessions().slice(0, 6); track s.id) {
              <li class="card-row">
                <div>
                  <strong>{{ s.date | date: 'EEEE d MMM' }}</strong> ·
                  <span class="tabular">{{ s.startTime }}–{{ s.endTime }}</span>
                  @if (s.date === currentDate) {
                    <span class="tag ok">Hoy</span>
                  }
                  <div class="cell-sub">{{ s.categoryName }} · {{ s.venueName }}</div>
                </div>
                <div class="row-actions">
                  <span class="tag {{ trainingTone[s.status] }}">{{
                    trainingLabels[s.status]
                  }}</span>
                  <a
                    class="button sm"
                    [class.secondary]="s.status !== 'PROGRAMADO'"
                    [routerLink]="['/coach/sessions', s.id]"
                  >
                    {{ s.status === 'PROGRAMADO' ? 'Pasar lista' : 'Ver sesión' }}
                  </a>
                </div>
              </li>
            }
          </ul>
        </ng-template>
      </app-load-state>
    </section>

    <div class="two-col">
      <section class="panel" aria-labelledby="coach-next-matches">
        <div class="panel-head-row">
          <h2 id="coach-next-matches">Próximos partidos</h2>
          <a class="link" routerLink="/coach/competitions">Ver todos</a>
        </div>
        <app-load-state [res]="competitions" emptyText="Sin partidos próximos asignados.">
          <ng-template>
            @if (upcomingMatches().length === 0) {
              <p class="muted">Sin partidos próximos en tus competencias.</p>
            } @else {
              <ul class="match-list">
                @for (m of upcomingMatches().slice(0, 4); track m.id) {
                  <li class="match-row">
                    <div class="match-when">
                      <strong>{{ m.date | date: 'EEE d MMM' }}</strong>
                      <span class="muted tabular">{{ m.time }}</span>
                    </div>
                    <div class="match-info">
                      <strong>vs {{ m.opponentName }}</strong>
                      <span class="muted"
                        >{{ m.categoryName }} · {{ m.venueName ?? 'Sede por definir' }}</span
                      >
                    </div>
                    <span class="tag {{ matchTone[m.status] }}">{{ matchLabels[m.status] }}</span>
                  </li>
                }
              </ul>
            }
          </ng-template>
        </app-load-state>
      </section>

      <section class="panel" aria-labelledby="coach-recent-notices">
        <div class="panel-head-row">
          <h2 id="coach-recent-notices">Avisos vigentes</h2>
          <a class="link" routerLink="/coach/notices">Ver todos</a>
        </div>
        <app-load-state [res]="notices" emptyText="Sin avisos vigentes.">
          <ng-template>
            <ul class="list clean-list">
              @for (n of (notices.value() ?? []).slice(0, 3); track n.id) {
                <li class="notice-mini">
                  <strong>{{ n.title }}</strong>
                  <div class="cell-sub">
                    {{ n.publishedAt | date: 'd MMM y' }} · {{ n.audience.join(', ') }}
                  </div>
                </li>
              }
            </ul>
          </ng-template>
        </app-load-state>
      </section>
    </div>

    <section aria-labelledby="coach-weekly-heading">
      <h2 id="coach-weekly-heading">Horario semanal</h2>
      <app-load-state [res]="week" emptyText="Sin horarios asignados."
        ><ng-template>
          <div class="week">
            @for (d of days; track d) {
              <section class="day">
                <h3>{{ weekdays[d] }}</h3>
                @for (s of byDay()[d] ?? []; track s.id) {
                  <p class="slot" [class.overlap]="s.overlap">
                    <strong class="tabular">{{ s.startTime }}–{{ s.endTime }}</strong
                    ><br />{{ s.categoryName }}<br /><small>{{ s.venueName }}</small>
                    @if (s.overlap) {
                      <br /><small class="danger">⚠ Se traslapa</small>
                    }
                  </p>
                } @empty {
                  <p class="muted">—</p>
                }
              </section>
            }
          </div>
        </ng-template></app-load-state
      >
    </section>

    <section aria-labelledby="coach-categories-heading">
      <h2 id="coach-categories-heading">Mis categorías</h2>
      <app-load-state [res]="categories" emptyText="No tienes categorías asignadas."
        ><ng-template>
          <div class="coach-category-grid">
            @for (c of categories.value() ?? []; track c.categoryId) {
              <article class="panel">
                <div class="panel-head-row">
                  <h3>{{ c.name }}</h3>
                  @if (c.responsibility) {
                    <span class="tag neutral">{{ c.responsibility }}</span>
                  }
                </div>
                <p class="muted">
                  <strong class="tabular">{{ c.members.length }}</strong>
                  {{ c.members.length === 1 ? 'jugador activo' : 'jugadores activos' }}
                </p>
                <ul class="list">
                  @for (m of c.members; track m.playerId) {
                    <li>
                      {{ m.name }} <span class="muted">· {{ m.age }} años</span>
                    </li>
                  } @empty {
                    <li class="muted">Sin jugadores registrados en esta categoría.</li>
                  }
                </ul>
              </article>
            }
          </div>
        </ng-template></app-load-state
      >
    </section>
  `,
})
export class CoachHomePage {
  private service = inject(CoachPanelService);
  protected weekdays = WEEKDAYS;
  protected days = [1, 2, 3, 4, 5, 6, 7];
  protected currentDate = today();
  protected trainingLabels = TRAINING_STATUS_LABELS;
  protected trainingTone = TRAINING_TONE;
  protected matchLabels = MATCH_STATUS_LABELS;
  protected matchTone = MATCH_TONE;
  protected categories = resource({ loader: () => this.service.myCategories() });
  protected week = resource({ loader: () => this.service.weeklySchedule() });
  protected upcoming = resource({
    loader: () => this.service.sessions(today(), addDays(today(), 7)),
  });
  protected competitions = resource({ loader: () => this.service.myCompetitions() });
  protected notices = resource({ loader: () => this.service.notices() });

  protected totalPlayers = computed(() =>
    (this.categories.value() ?? []).reduce((sum, c) => sum + c.members.length, 0),
  );
  protected upcomingSessions = computed(() =>
    (this.upcoming.value() ?? []).filter((s) => s.status !== 'CANCELADO'),
  );
  protected upcomingMatches = computed(() =>
    (this.competitions.value() ?? [])
      .flatMap((c) => c.nextMatches)
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)),
  );
  protected byDay = computed(() => {
    const out: Record<number, NonNullable<ReturnType<typeof this.week.value>>> = {};
    for (const s of this.week.value() ?? []) (out[s.weekday] ??= []).push(s);
    return out;
  });
}

/** HU-029: my sessions by date with status; opens the attendance capture (HU-030/031). */
@Component({
  selector: 'app-coach-sessions-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, LoadState, DatePipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Mis entrenamientos</h1>
        <p class="page-subtitle">
          Sesiones de tus categorías asignadas; abre cualquier sesión para capturar asistencia o
          bitácora.
        </p>
      </div>
    </div>
    <div class="filters">
      <label
        >Desde <input type="date" [ngModel]="from()" (ngModelChange)="from.set($event)"
      /></label>
      <label>Hasta <input type="date" [ngModel]="to()" (ngModelChange)="to.set($event)" /></label>
      <button type="button" class="secondary sm" (click)="resetRange()">Últimos y próx. 14 días</button>
    </div>
    <app-load-state [res]="sessions" emptyText="Sin sesiones en el rango seleccionado."
      ><ng-template>
        <div class="list-meta">
          <p class="muted">
            Mostrando <strong class="tabular">{{ (sessions.value() ?? []).length }}</strong>
            {{ (sessions.value() ?? []).length === 1 ? 'sesión' : 'sesiones' }}
          </p>
        </div>
        <ul class="cards-list">
          @for (s of sessions.value() ?? []; track s.id) {
            <li class="card-row">
              <div>
                <strong>{{ s.date | date: 'EEEE d MMM' }}</strong> ·
                <span class="tabular">{{ s.startTime }}–{{ s.endTime }}</span>
                <div class="cell-sub">{{ s.categoryName }} · {{ s.venueName }}</div>
              </div>
              <div class="row-actions">
                <span class="tag {{ trainingTone[s.status] }}">{{ labels[s.status] }}</span>
                <a
                  class="button sm"
                  [class.secondary]="s.status !== 'PROGRAMADO'"
                  [routerLink]="['/coach/sessions', s.id]"
                  >{{ s.status === 'PROGRAMADO' ? 'Pasar lista' : 'Ver' }}</a
                >
              </div>
            </li>
          }
        </ul>
      </ng-template></app-load-state
    >
  `,
})
export class CoachSessionsPage {
  private service = inject(CoachPanelService);
  protected labels = TRAINING_STATUS_LABELS;
  protected trainingTone = TRAINING_TONE;
  protected from = signal(addDays(today(), -14));
  protected to = signal(addDays(today(), 14));
  protected sessions = resource({
    params: () => ({ from: this.from(), to: this.to() }),
    loader: ({ params }) => this.service.sessions(params.from, params.to),
  });

  resetRange(): void {
    this.from.set(addDays(today(), -14));
    this.to.set(addDays(today(), 14));
  }
}

/** HU-027 (my competitions), HU-038 (calendar, upcoming vs past, reschedules) and HU-041 (results, sortable). */
@Component({
  selector: 'app-coach-competitions-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, LoadState, DatePipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Competencias y partidos</h1>
        <p class="page-subtitle">
          Torneos asignados, calendario de encuentros y resultados registrados.
        </p>
      </div>
    </div>
    <h2>Mis competencias</h2>
    <app-load-state [res]="competitions" emptyText="No estás asignado a competencias."
      ><ng-template>
        <div class="coach-category-grid">
          @for (c of competitions.value() ?? []; track c.id) {
            <article class="panel">
              <div class="panel-head-row">
                <h3>{{ c.competitionName }}</h3>
                <span class="tag {{ competitionTone[c.competitionStatus] }}">{{
                  competitionStatusLabels[c.competitionStatus]
                }}</span>
              </div>
              <p class="muted">
                {{ types[c.competitionType] }} · <strong>{{ c.categoryName }}</strong> ·
                <span class="tabular">{{ c.startDate ?? '¿?' }} – {{ c.endDate ?? '¿?' }}</span>
              </p>
              <ul class="list">
                @for (m of c.nextMatches; track m.id) {
                  <li>
                    <strong>{{ m.date | date: 'EEE d MMM' }}</strong>
                    <span class="tabular">{{ m.time }}</span> vs {{ m.opponentName }} ·
                    {{ m.venueName ?? 'sede por definir' }}
                  </li>
                } @empty {
                  <li class="muted">Sin partidos próximos.</li>
                }
              </ul>
            </article>
          }
        </div>
      </ng-template></app-load-state
    >

    <h2>Calendario de mis categorías</h2>
    <div class="filters">
      <label
        >Categoría
        <select [ngModel]="categoryId()" (ngModelChange)="categoryId.set(idOrNull($event))">
          <option [ngValue]="null">Todas</option>
          @for (c of categoryOptions.value() ?? []; track c.id) {
            <option [ngValue]="c.id">{{ c.name }}</option>
          }
        </select>
      </label>
      <label
        >Competencia
        <select [ngModel]="competitionId()" (ngModelChange)="competitionId.set(idOrNull($event))">
          <option [ngValue]="null">Todas</option>
          @for (c of options.value() ?? []; track c.id) {
            <option [ngValue]="c.id">{{ c.name }}</option>
          }
        </select>
      </label>
      <label
        >Desde <input type="date" [ngModel]="from()" (ngModelChange)="from.set($event)"
      /></label>
      <label>Hasta <input type="date" [ngModel]="to()" (ngModelChange)="to.set($event)" /></label>
      <label
        >Orden
        <select [ngModel]="order()" (ngModelChange)="order.set($event)">
          <option value="asc">Más antiguos primero</option>
          <option value="desc">Más recientes primero</option>
        </select>
      </label>
      @if (hasFilters()) {
        <button type="button" class="secondary sm" (click)="clearFilters()">Limpiar filtros</button>
      }
    </div>
    <app-load-state [res]="matches" emptyText="Sin partidos en el periodo seleccionado."
      ><ng-template>
        <div class="list-meta">
          <p class="muted">
            Mostrando <strong class="tabular">{{ (matches.value() ?? []).length }}</strong>
            {{ (matches.value() ?? []).length === 1 ? 'partido' : 'partidos' }}
          </p>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Competencia</th>
                <th>Categoría</th>
                <th>Rival</th>
                <th>Sede</th>
                <th>Estado</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              @for (m of matches.value() ?? []; track m.id) {
                <tr [class.muted]="!m.upcoming && m.status !== 'JUGADO'">
                  <td class="tabular">
                    {{ m.date | date: 'EEE d MMM' }} {{ m.time }}
                    @if (m.upcoming) {
                      <span class="tag ok">Próximo</span>
                    }
                  </td>
                  <td>{{ m.competitionName }}</td>
                  <td>{{ m.categoryName }}</td>
                  <td>
                    <strong>{{ m.opponentName }}</strong>
                  </td>
                  <td>{{ m.venueName ?? 'Por definir' }}</td>
                  <td>
                    <span class="tag {{ matchTone[m.status] }}">{{ statusLabels[m.status] }}</span>
                    @if (m.rescheduleReason) {
                      <div class="cell-sub">{{ m.rescheduleReason }}</div>
                    }
                  </td>
                  <td class="tabular">
                    {{ m.goalsFor !== null ? m.goalsFor + ' – ' + m.goalsAgainst : '—' }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </ng-template></app-load-state
    >
  `,
})
export class CoachCompetitionsPage {
  private service = inject(CoachPanelService);
  protected idOrNull = idOrNull;
  protected types = TYPE_LABELS;
  protected competitionStatusLabels = COMPETITION_STATUS_LABELS;
  protected competitionTone = COMPETITION_TONE;
  protected statusLabels = MATCH_STATUS_LABELS;
  protected matchTone = MATCH_TONE;
  protected competitions = resource({ loader: () => this.service.myCompetitions() });
  protected options = resource({ loader: () => this.service.competitionOptions() });
  protected competitionId = signal<Id | null>(null);
  protected categoryId = signal<Id | null>(null);
  protected categoryOptions = resource({ loader: () => this.service.categoryOptions() });
  protected from = signal(addDays(today(), -60));
  protected to = signal(addDays(today(), 90));
  protected order = signal<'asc' | 'desc'>('asc');
  protected hasFilters = computed(
    () =>
      this.categoryId() !== null ||
      this.competitionId() !== null ||
      this.order() !== 'asc' ||
      this.from() !== addDays(today(), -60) ||
      this.to() !== addDays(today(), 90),
  );
  protected matches = resource({
    params: () => ({
      competitionId: this.competitionId(),
      categoryId: this.categoryId(),
      from: this.from(),
      to: this.to(),
      order: this.order(),
    }),
    loader: ({ params }) => this.service.myMatches(params),
  });

  clearFilters(): void {
    this.categoryId.set(null);
    this.competitionId.set(null);
    this.from.set(addDays(today(), -60));
    this.to.set(addDays(today(), 90));
    this.order.set('asc');
  }
}

/** HU-060: current notices — general + my categories, newest first, read-only. */
@Component({
  selector: 'app-coach-notices-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LoadState, DatePipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Avisos</h1>
        <p class="page-subtitle">Comunicados generales y de tus categorías asignadas.</p>
      </div>
    </div>
    <app-load-state [res]="notices" emptyText="Sin avisos vigentes."
      ><ng-template>
        <div class="list-meta">
          <p class="muted">
            <strong class="tabular">{{ (notices.value() ?? []).length }}</strong>
            {{ (notices.value() ?? []).length === 1 ? 'aviso vigente' : 'avisos vigentes' }}
          </p>
        </div>
        @for (n of notices.value() ?? []; track n.id) {
          <article class="panel">
            <div class="panel-head-row">
              <h3>{{ n.title }}</h3>
              <span class="tag neutral">{{ n.audience.join(', ') }}</span>
            </div>
            <p class="pre">{{ n.message }}</p>
            <p class="muted">Publicado el {{ n.publishedAt | date: 'd MMM y' }}</p>
          </article>
        }
      </ng-template></app-load-state
    >
  `,
})
export class CoachNoticesPage {
  private service = inject(CoachPanelService);
  protected notices = resource({ loader: () => this.service.notices() });
}

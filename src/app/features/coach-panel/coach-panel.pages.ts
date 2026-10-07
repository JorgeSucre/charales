import { Component, computed, inject, resource, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Id } from '../../core/models';
import { TYPE_LABELS } from '../../core/services/competition.service';
import { WEEKDAYS, addDays, today } from '../../shared/dates';
import { LoadState } from '../../shared/load-state';
import { idOrNull } from '../../shared/ui';
import { MATCH_STATUS_LABELS } from '../matches/match.service';
import { TRAINING_STATUS_LABELS } from '../trainings/training.service';
import { CoachPanelService } from './coach-panel.service';

/** HU-024 (my categories and players, read-only) + HU-025 (weekly calendar with overlaps). */
@Component({
  selector: 'app-coach-home-page',
  imports: [LoadState],
  template: `
    <h1>Mis categorías</h1>
    <h2>Horario semanal</h2>
    <app-load-state [res]="week" emptyText="Sin horarios asignados."
      ><ng-template>
        <div class="week">
          @for (d of days; track d) {
            <section class="day">
              <h3>{{ weekdays[d] }}</h3>
              @for (s of byDay()[d] ?? []; track s.id) {
                <p class="slot" [class.overlap]="s.overlap">
                  <strong>{{ s.startTime }}–{{ s.endTime }}</strong
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
    <app-load-state [res]="categories" emptyText="No tienes categorías asignadas."
      ><ng-template>
        @for (c of categories.value() ?? []; track c.categoryId) {
          <article class="panel">
            <h2>
              {{ c.name }} <span class="muted">{{ c.responsibility ?? '' }}</span>
            </h2>
            <p class="muted">{{ c.members.length }} jugadores activos</p>
            <ul class="list">
              @for (m of c.members; track m.playerId) {
                <li>
                  {{ m.name }} <span class="muted">· {{ m.age }} años</span>
                </li>
              }
            </ul>
          </article>
        }
      </ng-template></app-load-state
    >
  `,
})
export class CoachHomePage {
  private service = inject(CoachPanelService);
  protected weekdays = WEEKDAYS;
  protected days = [1, 2, 3, 4, 5, 6, 7];
  protected categories = resource({ loader: () => this.service.myCategories() });
  protected week = resource({ loader: () => this.service.weeklySchedule() });
  protected byDay = computed(() => {
    const out: Record<number, NonNullable<ReturnType<typeof this.week.value>>> = {};
    for (const s of this.week.value() ?? []) (out[s.weekday] ??= []).push(s);
    return out;
  });
}

/** HU-029: my sessions by date with status; opens the attendance capture (HU-030/031). */
@Component({
  selector: 'app-coach-sessions-page',
  imports: [FormsModule, RouterLink, LoadState, DatePipe],
  template: `
    <h1>Mis entrenamientos</h1>
    <div class="filters">
      <label
        >Desde <input type="date" [ngModel]="from()" (ngModelChange)="from.set($event)"
      /></label>
      <label>Hasta <input type="date" [ngModel]="to()" (ngModelChange)="to.set($event)" /></label>
    </div>
    <app-load-state [res]="sessions" emptyText="Sin sesiones en el rango."
      ><ng-template>
        <ul class="cards-list">
          @for (s of sessions.value() ?? []; track s.id) {
            <li class="card-row">
              <div>
                <strong>{{ s.date | date: 'EEEE d MMM' }}</strong> · {{ s.startTime }}–{{ s.endTime
                }}<br />
                {{ s.categoryName }} · {{ s.venueName }}
              </div>
              <span class="tag" [class.off]="s.status === 'CANCELADO'">{{ labels[s.status] }}</span>
              <a class="button secondary" [routerLink]="['/coach/sessions', s.id]">{{
                s.status === 'PROGRAMADO' ? 'Pasar lista' : 'Ver'
              }}</a>
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
  protected from = signal(addDays(today(), -14));
  protected to = signal(addDays(today(), 14));
  protected sessions = resource({
    params: () => ({ from: this.from(), to: this.to() }),
    loader: ({ params }) => this.service.sessions(params.from, params.to),
  });
}

/** HU-027 (my competitions), HU-038 (calendar, upcoming vs past, reschedules) and HU-041 (results, sortable). */
@Component({
  selector: 'app-coach-competitions-page',
  imports: [FormsModule, LoadState, DatePipe],
  template: `
    <h1>Competencias y partidos</h1>
    <h2>Mis competencias</h2>
    <app-load-state [res]="competitions" emptyText="No estás asignado a competencias."
      ><ng-template>
        @for (c of competitions.value() ?? []; track c.id) {
          <article class="panel">
            <h3>
              {{ c.competitionName }}
              <span class="muted">{{ types[c.competitionType] }} · {{ c.categoryName }}</span>
            </h3>
            <p class="muted">
              {{ c.startDate ?? '¿?' }} – {{ c.endDate ?? '¿?' }} · {{ c.competitionStatus }}
            </p>
            <ul>
              @for (m of c.nextMatches; track m.id) {
                <li>
                  {{ m.date | date: 'EEE d MMM' }} {{ m.time }} vs {{ m.opponentName }} ·
                  {{ m.venueName ?? 'sede por definir' }}
                </li>
              } @empty {
                <li class="muted">Sin partidos próximos.</li>
              }
            </ul>
          </article>
        }
      </ng-template></app-load-state
    >

    <h2>Calendario de mis categorías</h2>
    <div class="filters">
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
    </div>
    <app-load-state [res]="matches" emptyText="Sin partidos."
      ><ng-template>
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
                  <td>
                    {{ m.date | date: 'EEE d MMM' }} {{ m.time }}
                    @if (m.upcoming) {
                      <span class="tag">Próximo</span>
                    }
                  </td>
                  <td>{{ m.competitionName }}</td>
                  <td>{{ m.categoryName }}</td>
                  <td>{{ m.opponentName }}</td>
                  <td>{{ m.venueName ?? 'Por definir' }}</td>
                  <td>
                    {{ statusLabels[m.status] }}
                    @if (m.rescheduleReason) {
                      <br /><small>{{ m.rescheduleReason }}</small>
                    }
                  </td>
                  <td>{{ m.goalsFor !== null ? m.goalsFor + ' – ' + m.goalsAgainst : '' }}</td>
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
  protected statusLabels = MATCH_STATUS_LABELS;
  protected competitions = resource({ loader: () => this.service.myCompetitions() });
  protected options = resource({ loader: () => this.service.competitionOptions() });
  protected competitionId = signal<Id | null>(null);
  protected from = signal(addDays(today(), -60));
  protected to = signal(addDays(today(), 90));
  protected order = signal<'asc' | 'desc'>('asc');
  protected matches = resource({
    params: () => ({
      competitionId: this.competitionId(),
      from: this.from(),
      to: this.to(),
      order: this.order(),
    }),
    loader: ({ params }) => this.service.myMatches(params),
  });
}

/** HU-060: current notices — general + my categories, newest first, read-only. */
@Component({
  selector: 'app-coach-notices-page',
  imports: [LoadState, DatePipe],
  template: `
    <h1>Avisos</h1>
    <app-load-state [res]="notices" emptyText="Sin avisos vigentes."
      ><ng-template>
        @for (n of notices.value() ?? []; track n.id) {
          <article class="panel">
            <h3>{{ n.title }}</h3>
            <p class="pre">{{ n.message }}</p>
            <p class="muted">{{ n.publishedAt | date: 'd MMM y' }} · {{ n.audience.join(', ') }}</p>
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

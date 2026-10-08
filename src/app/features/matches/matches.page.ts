import { Component, computed, inject, resource, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/auth/auth.service';
import { Id, MatchStatus } from '../../core/models';
import { CompetitionService } from '../../core/services/competition.service';
import { addDays, today } from '../../shared/dates';
import { LoadState } from '../../shared/load-state';
import { Submission } from '../../shared/submission';
import { SubmissionAlert, idOrNull } from '../../shared/ui';
import { VenueService } from '../venues/venue.service';
import { MATCH_STATUS_LABELS, MatchService, MatchView } from './match.service';

type Action = { kind: 'reschedule' | 'result' | 'cancel'; match: MatchView };

/** HU-037 (calendar, schedule, reschedule, cancel), HU-040 (results) and the opponents catalog. */
@Component({
  selector: 'app-matches-page',
  imports: [FormsModule, LoadState, SubmissionAlert, DatePipe],
  template: `
    <h1>Partidos</h1>
    <app-submission-alert [submission]="submission" />
    @if (auth.can('partidos.crear')) {
      <div class="two-col">
        <form class="grid-form" (ngSubmit)="schedule()" novalidate>
          <h2>Programar partido</h2>
          <label
            >Competencia · categoría inscrita
            <select name="cc" [(ngModel)]="draft.competitionCategoryId">
              <option [ngValue]="null">Selecciona…</option>
              @for (p of participations(); track p.id) {
                <option [ngValue]="p.id">{{ p.competitionName }} · {{ p.categoryName }}</option>
              }
            </select>
          </label>
          <label
            >Rival
            <select name="opp" [(ngModel)]="draft.opponentId">
              <option [ngValue]="null">Selecciona…</option>
              @for (o of opponents.value() ?? []; track o.id) {
                <option [ngValue]="o.id">{{ o.name }}</option>
              }
            </select>
          </label>
          <div class="two-col">
            <label>Fecha <input type="date" name="date" [(ngModel)]="draft.date" /></label>
            <label>Hora <input type="time" name="time" [(ngModel)]="draft.time" /></label>
          </div>
          <label
            >Sede
            <select name="venue" [(ngModel)]="draft.venueId">
              <option [ngValue]="null">Por definir</option>
              @for (v of venues.value() ?? []; track v.id) {
                <option [ngValue]="v.id">{{ v.name }}</option>
              }
            </select>
          </label>
          <label
            >Condición
            <select name="ha" [(ngModel)]="draft.homeAway">
              <option value="LOCAL">Local</option>
              <option value="VISITANTE">Visitante</option>
            </select>
          </label>
          <button
            type="submit"
            [disabled]="submission.busy() || !draft.competitionCategoryId || !draft.opponentId"
          >
            Programar
          </button>
        </form>
        <form class="grid-form" (ngSubmit)="addOpponent()" novalidate>
          <h2>Rivales</h2>
          <label>Nombre <input name="oname" [(ngModel)]="opponentName" /></label>
          <label>Contacto <input name="ocontact" [(ngModel)]="opponentContact" /></label>
          <button type="submit" [disabled]="submission.busy() || !opponentName">
            Agregar rival
          </button>
          <p class="muted">{{ (opponents.value() ?? []).length }} rivales registrados.</p>
        </form>
      </div>
    }

    @if (action(); as a) {
      <form class="grid-form" (ngSubmit)="apply(a)" novalidate>
        <h2>
          @switch (a.kind) {
            @case ('reschedule') {
              Reprogramar
            }
            @case ('result') {
              Registrar resultado
            }
            @case ('cancel') {
              Cancelar partido
            }
          }
          · {{ a.match.categoryName }} vs {{ a.match.opponentName }}
        </h2>
        @if (a.kind === 'reschedule') {
          <div class="two-col">
            <label>Nueva fecha <input type="date" name="rdate" [(ngModel)]="form.date" /></label>
            <label>Nueva hora <input type="time" name="rtime" [(ngModel)]="form.time" /></label>
          </div>
          <label
            >Sede
            <select name="rvenue" [(ngModel)]="form.venueId">
              <option [ngValue]="null">Por definir</option>
              @for (v of venues.value() ?? []; track v.id) {
                <option [ngValue]="v.id">{{ v.name }}</option>
              }
            </select>
          </label>
        }
        @if (a.kind === 'result') {
          <div class="two-col">
            <label
              >Goles a favor <input type="number" min="0" name="gf" [(ngModel)]="form.goalsFor"
            /></label>
            <label
              >Goles en contra
              <input type="number" min="0" name="ga" [(ngModel)]="form.goalsAgainst"
            /></label>
          </div>
        }
        <label
          >{{ a.kind === 'result' ? 'Observaciones (opcional)' : 'Motivo' }}
          <input name="reason" [(ngModel)]="form.text"
        /></label>
        <div class="actions">
          <button type="submit" [disabled]="submission.busy()">Guardar</button>
          <button type="button" class="secondary" (click)="action.set(null)">Cerrar</button>
        </div>
      </form>
    }

    <div class="filters">
      <label
        >Desde <input type="date" [ngModel]="from()" (ngModelChange)="from.set($event)"
      /></label>
      <label>Hasta <input type="date" [ngModel]="to()" (ngModelChange)="to.set($event)" /></label>
      <label
        >Competencia
        <select [ngModel]="competitionId()" (ngModelChange)="competitionId.set(idOrNull($event))">
          <option [ngValue]="null">Todas</option>
          @for (c of competitions.value() ?? []; track c.id) {
            <option [ngValue]="c.id">{{ c.name }}</option>
          }
        </select>
      </label>
      <label
        >Estado
        <select [ngModel]="status()" (ngModelChange)="status.set($event)">
          <option value="">Todos</option>
          @for (s of statuses; track s[0]) {
            <option [value]="s[0]">{{ s[1] }}</option>
          }
        </select>
      </label>
    </div>
    <app-load-state [res]="matches" emptyText="Sin partidos en el rango."
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
                <th>Marcador</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (m of matches.value() ?? []; track m.id) {
                <tr>
                  <td>{{ m.date | date: 'EEE d MMM' }} {{ m.time }}</td>
                  <td>{{ m.competitionName }}</td>
                  <td>{{ m.categoryName }}</td>
                  <td>{{ m.opponentName ?? '—' }} ({{ m.homeAway === 'LOCAL' ? 'L' : 'V' }})</td>
                  <td>{{ m.venueName ?? 'Por definir' }}</td>
                  <td>
                    <span
                      class="tag"
                      [class.off]="m.status === 'CANCELADO'"
                      [title]="m.rescheduleReason ?? ''"
                      >{{ labels[m.status] }}</span
                    >
                  </td>
                  <td>{{ m.goalsFor !== null ? m.goalsFor + ' – ' + m.goalsAgainst : '' }}</td>
                  <td class="row-actions">
                    @if (auth.can('partidos.editar') && m.status !== 'CANCELADO') {
                      @if (m.status !== 'JUGADO') {
                        <button type="button" class="link" (click)="open('reschedule', m)">
                          Reprogramar
                        </button>
                        <button type="button" class="link danger" (click)="open('cancel', m)">
                          Cancelar
                        </button>
                      }
                      @if (m.date <= todayDate) {
                        <button type="button" class="link" (click)="open('result', m)">
                          Resultado
                        </button>
                      }
                    }
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
export class MatchesPage {
  private service = inject(MatchService);
  private competitionService = inject(CompetitionService);
  private venueService = inject(VenueService);
  protected auth = inject(AuthService);
  protected idOrNull = idOrNull;
  protected todayDate = today();
  protected labels = MATCH_STATUS_LABELS;
  protected statuses = Object.entries(MATCH_STATUS_LABELS) as [MatchStatus, string][];
  protected competitions = resource({ loader: () => this.competitionService.list() });
  private allParticipations = resource({ loader: () => this.competitionService.participations() });
  protected participations = computed(() =>
    (this.allParticipations.value() ?? []).filter((p) => p.status === 'INSCRITA'),
  );
  protected opponents = resource({ loader: () => this.service.opponents(true) });
  protected venues = resource({ loader: () => this.venueService.list(true) });
  protected from = signal(addDays(today(), -30));
  protected to = signal(addDays(today(), 60));
  protected competitionId = signal<Id | null>(null);
  protected status = signal<MatchStatus | ''>('');
  protected matches = resource({
    params: () => ({
      from: this.from(),
      to: this.to(),
      competitionId: this.competitionId(),
      status: this.status(),
    }),
    loader: ({ params }) => this.service.list(params),
  });
  protected submission = new Submission();
  protected draft = this.blank();
  protected opponentName = '';
  protected opponentContact = '';
  protected action = signal<Action | null>(null);
  protected form = {
    date: '',
    time: '',
    venueId: null as Id | null,
    goalsFor: 0,
    goalsAgainst: 0,
    text: '',
  };

  private blank() {
    return {
      competitionCategoryId: null as Id | null,
      opponentId: null as Id | null,
      venueId: null as Id | null,
      date: today(),
      time: '10:00',
      homeAway: 'LOCAL' as 'LOCAL' | 'VISITANTE',
      notes: null,
    };
  }

  async schedule(): Promise<void> {
    const d = this.draft;
    if (
      await this.submission.run(
        () => this.service.schedule({ ...d, competitionCategoryId: d.competitionCategoryId! }),
        'Partido programado.',
      )
    ) {
      this.draft = this.blank();
      this.matches.reload();
    }
  }

  async addOpponent(): Promise<void> {
    const ok = await this.submission.run(
      () =>
        this.service.saveOpponent({
          name: this.opponentName,
          contact: this.opponentContact,
          notes: null,
        }),
      'Rival agregado.',
    );
    if (ok) {
      this.opponentName = this.opponentContact = '';
      this.opponents.reload();
    }
  }

  open(kind: Action['kind'], match: MatchView): void {
    this.form = {
      date: match.date,
      time: match.time,
      venueId: match.venueId,
      goalsFor: match.goalsFor ?? 0,
      goalsAgainst: match.goalsAgainst ?? 0,
      text: '',
    };
    this.action.set({ kind, match });
  }

  async apply(a: Action): Promise<void> {
    const f = this.form;
    const run: () => Promise<unknown> = {
      reschedule: () =>
        this.service.reschedule(a.match.id, {
          date: f.date,
          time: f.time,
          venueId: f.venueId,
          reason: f.text,
        }),
      cancel: () => this.service.cancel(a.match.id, f.text),
      result: () =>
        this.service.recordResult(a.match.id, {
          goalsFor: Number(f.goalsFor),
          goalsAgainst: Number(f.goalsAgainst),
          notes: f.text || null,
        }),
    }[a.kind];
    if (await this.submission.run(run, 'Partido actualizado.')) {
      this.action.set(null);
      this.matches.reload();
    }
  }
}

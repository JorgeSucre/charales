import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Id, MatchStatus } from '../../core/models';
import { CompetitionService } from '../../core/services/competition.service';
import { addDays, today } from '../../shared/dates';
import { FormPanel } from '../../shared/form-panel';
import { LoadState } from '../../shared/load-state';
import { PromptDialog } from '../../shared/prompt-dialog';
import { MATCH_TONE } from '../../shared/status-tone';
import { Submission } from '../../shared/submission';
import { SubmissionAlert, idOrNull } from '../../shared/ui';
import { VenueService } from '../venues/venue.service';
import { MATCH_STATUS_LABELS, MatchService, MatchView } from './match.service';

type Action = { kind: 'reschedule' | 'result'; match: MatchView };

/** HU-037 (calendar, schedule, reschedule, cancel), HU-040 (results) and the opponents catalog. */
@Component({
  selector: 'app-matches-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, LoadState, SubmissionAlert, PromptDialog, DatePipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Partidos</h1>
        <p class="page-subtitle">
          Calendario de encuentros por competencia, sedes, reprogramaciones, resultados y catálogo de
          rivales.
        </p>
      </div>
      @if (auth.can('partidos.crear')) {
        <div class="actions">
          <button
            type="button"
            class="secondary"
            (click)="openOpponent()"
            [attr.aria-expanded]="opponentPanel.open()"
            aria-controls="opponent-form"
          >
            Nuevo rival
          </button>
          <button
            type="button"
            (click)="openSchedule()"
            [attr.aria-expanded]="schedulePanel.open()"
            aria-controls="schedule-form"
          >
            Programar partido
          </button>
        </div>
      }
    </div>
    <app-submission-alert [submission]="submission" />

    @if (schedulePanel.open()) {
      <form
        id="schedule-form"
        class="grid-form"
        (ngSubmit)="schedule()"
        (keydown.escape)="closeSchedule()"
        novalidate
      >
        <h2>Programar partido</h2>
        <p class="field-hint">
          Solo aparecen categorías actualmente inscritas en una competencia vigente.
        </p>
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
        <div class="two-col">
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
        </div>
        <div class="actions">
          <button
            type="submit"
            [disabled]="submission.busy() || !draft.competitionCategoryId || !draft.opponentId"
          >
            {{ submission.busy() ? 'Guardando…' : 'Programar' }}
          </button>
          <button type="button" class="secondary" (click)="closeSchedule()">Cancelar</button>
        </div>
      </form>
    }

    @if (opponentPanel.open()) {
      <form
        id="opponent-form"
        class="grid-form"
        (ngSubmit)="addOpponent()"
        (keydown.escape)="closeOpponent()"
        novalidate
      >
        <h2>Rivales</h2>
        <label
          >Nombre
          <input name="oname" [(ngModel)]="opponentName" placeholder="Ej. Academia Chapala FC"
        /></label>
        <label
          >Contacto
          <input name="ocontact" [(ngModel)]="opponentContact" placeholder="Teléfono o responsable"
        /></label>
        <p class="field-hint">{{ (opponents.value() ?? []).length }} rivales activos registrados.</p>
        <div class="actions">
          <button type="submit" [disabled]="submission.busy() || !opponentName">
            {{ submission.busy() ? 'Guardando…' : 'Agregar rival' }}
          </button>
          <button type="button" class="secondary" (click)="closeOpponent()">Cancelar</button>
        </div>
      </form>
    }

    @if (action(); as a) {
      <form
        #actionFormEl
        id="match-action-form"
        class="grid-form"
        (ngSubmit)="apply(a)"
        (keydown.escape)="closeAction()"
        novalidate
      >
        <h2>
          {{ a.kind === 'reschedule' ? 'Reprogramar partido' : 'Registrar resultado' }}
          · {{ a.match.categoryName }} vs {{ a.match.opponentName }}
        </h2>
        <p class="field-hint">
          {{ a.match.competitionName }} · {{ a.match.date | date: 'EEE d MMM' }} {{ a.match.time }}
        </p>
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
              >Goles a favor
              <input type="number" min="0" max="99" name="gf" [(ngModel)]="form.goalsFor"
            /></label>
            <label
              >Goles en contra
              <input type="number" min="0" max="99" name="ga" [(ngModel)]="form.goalsAgainst"
            /></label>
          </div>
        }
        <label
          >{{ a.kind === 'result' ? 'Observaciones (opcional)' : 'Motivo de reprogramación' }}
          <input
            name="reason"
            [(ngModel)]="form.text"
            [placeholder]="
              a.kind === 'result' ? 'Incidencias o resumen' : 'Ej. cambio de sede o clima'
            "
          />
        </label>
        @if (actionError(); as err) {
          <small class="field-error" role="alert">{{ err }}</small>
        }
        <div class="actions">
          <button type="submit" [disabled]="submission.busy()">
            {{ submission.busy() ? 'Guardando…' : 'Guardar' }}
          </button>
          <button type="button" class="secondary" (click)="closeAction()">Cancelar</button>
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
      @if (hasFilters()) {
        <button type="button" class="secondary sm" (click)="clearFilters()">Limpiar filtros</button>
      }
    </div>

    <app-load-state [res]="matches" emptyText="Sin partidos en el rango seleccionado."
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
                <th>Fecha y hora</th>
                <th>Competencia y categoría</th>
                <th>Rival y condición</th>
                <th>Sede</th>
                <th>Estado</th>
                <th>Marcador</th>
                <th><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (m of matches.value() ?? []; track m.id) {
                <tr [class.muted]="m.status === 'CANCELADO'">
                  <td>
                    <strong class="cap">{{ m.date | date: 'EEE d MMM' }}</strong>
                    <div class="cell-sub tabular">{{ m.time }}</div>
                  </td>
                  <td>
                    <strong>{{ m.categoryName }}</strong>
                    <div class="cell-sub">{{ m.competitionName }}</div>
                  </td>
                  <td>
                    <strong>{{ m.opponentName ?? 'Por definir' }}</strong>
                    <div class="cell-sub">
                      {{ m.homeAway === 'LOCAL' ? 'Local' : 'Visitante' }}
                    </div>
                  </td>
                  <td>{{ m.venueName ?? 'Por definir' }}</td>
                  <td class="wrap">
                    <span class="tag {{ matchTone[m.status] }}">{{ labels[m.status] }}</span>
                    @if (m.rescheduleReason) {
                      <div class="cell-sub">{{ m.rescheduleReason }}</div>
                    }
                  </td>
                  <td class="tabular">
                    @if (m.goalsFor !== null) {
                      <strong>{{ m.goalsFor }} – {{ m.goalsAgainst }}</strong>
                    } @else {
                      <span class="muted">—</span>
                    }
                  </td>
                  <td class="row-actions">
                    @if (auth.can('partidos.editar') && m.status !== 'CANCELADO') {
                      @if (m.status !== 'JUGADO') {
                        <button
                          type="button"
                          class="link"
                          (click)="open('reschedule', m, $event)"
                          [attr.aria-expanded]="
                            action()?.match?.id === m.id && action()?.kind === 'reschedule'
                          "
                          aria-controls="match-action-form"
                        >
                          Reprogramar
                        </button>
                        <button type="button" class="link danger" (click)="cancelMatch(m)">
                          Cancelar
                        </button>
                      }
                      @if (m.date <= todayDate) {
                        <button
                          type="button"
                          class="link"
                          (click)="open('result', m, $event)"
                          [attr.aria-expanded]="
                            action()?.match?.id === m.id && action()?.kind === 'result'
                          "
                          aria-controls="match-action-form"
                        >
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
    <app-prompt-dialog #cancelDialog />
  `,
})
export class MatchesPage {
  private cancelDialog = viewChild.required<PromptDialog>('cancelDialog');
  private actionFormEl = viewChild<ElementRef<HTMLFormElement>>('actionFormEl');
  private service = inject(MatchService);
  private competitionService = inject(CompetitionService);
  private venueService = inject(VenueService);
  protected auth = inject(AuthService);
  /** `?nuevo=1` (a quick task of the Tablero) opens the create form at once, if the role may create. */
  private openOnArrival = inject(ActivatedRoute).snapshot.queryParamMap.has('nuevo')
    ? setTimeout(() => this.auth.can('partidos.crear') && this.openSchedule())
    : null;
  protected idOrNull = idOrNull;
  protected todayDate = today();
  protected labels = MATCH_STATUS_LABELS;
  protected matchTone = MATCH_TONE;
  protected statuses = Object.entries(MATCH_STATUS_LABELS) as [MatchStatus, string][];
  protected competitions = resource({ loader: () => this.competitionService.list() });
  private allParticipations = resource({ loader: () => this.competitionService.participations() });
  protected participations = computed(() =>
    (this.allParticipations.value() ?? []).filter((p) => p.status === 'INSCRITA'),
  );
  protected opponents = resource({ loader: () => this.service.opponents(true) });
  protected venues = resource({ loader: () => this.venueService.list(true) });
  private readonly defaultFrom = addDays(today(), -30);
  private readonly defaultTo = addDays(today(), 60);
  protected from = signal(this.defaultFrom);
  protected to = signal(this.defaultTo);
  protected competitionId = signal<Id | null>(null);
  protected status = signal<MatchStatus | ''>('');
  protected hasFilters = computed(
    () =>
      this.competitionId() !== null ||
      !!this.status() ||
      this.from() !== this.defaultFrom ||
      this.to() !== this.defaultTo,
  );
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
  protected actionError = signal<string | null>(null);
  private actionReturnFocus: HTMLElement | null = null;
  protected form = {
    date: '',
    time: '',
    venueId: null as Id | null,
    goalsFor: 0,
    goalsAgainst: 0,
    text: '',
  };

  private opened = '';
  protected schedulePanel = new FormPanel(
    'schedule-form',
    () => JSON.stringify(this.draft) !== this.opened,
  );
  protected opponentPanel = new FormPanel(
    'opponent-form',
    () => !!(this.opponentName || this.opponentContact),
  );

  clearFilters(): void {
    this.from.set(this.defaultFrom);
    this.to.set(this.defaultTo);
    this.competitionId.set(null);
    this.status.set('');
  }

  /** One form at a time: opening one closes the other (asking first if it has unsaved changes). */
  private closeForms(): boolean {
    if (!this.schedulePanel.close() || !this.opponentPanel.close()) return false;
    this.draft = this.blank();
    this.opponentName = this.opponentContact = '';
    this.action.set(null);
    this.actionError.set(null);
    this.submission.result.set(null);
    return true;
  }

  openSchedule(): void {
    if (!this.closeForms()) return;
    this.opened = JSON.stringify(this.draft);
    this.schedulePanel.show();
  }

  openOpponent(): void {
    if (this.closeForms()) this.opponentPanel.show();
  }

  closeSchedule(): void {
    if (this.schedulePanel.close()) this.draft = this.blank();
  }

  closeOpponent(): void {
    if (this.opponentPanel.close()) this.opponentName = this.opponentContact = '';
  }

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
      this.schedulePanel.done();
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
      this.opponentPanel.done();
      this.opponentName = this.opponentContact = '';
      this.opponents.reload();
    }
  }

  open(kind: Action['kind'], match: MatchView, event?: Event): void {
    if (!this.closeForms()) return;
    this.actionReturnFocus =
      event?.currentTarget instanceof HTMLElement
        ? event.currentTarget
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    this.form = {
      date: match.date,
      time: match.time,
      venueId: match.venueId,
      goalsFor: match.goalsFor ?? 0,
      goalsAgainst: match.goalsAgainst ?? 0,
      text: '',
    };
    this.actionError.set(null);
    this.action.set({ kind, match });
    setTimeout(() => {
      const formEl = this.actionFormEl()?.nativeElement;
      const first = formEl?.querySelector<HTMLElement>('input, select, textarea');
      first?.focus();
    });
  }

  closeAction(): void {
    this.action.set(null);
    this.actionError.set(null);
    const back = this.actionReturnFocus;
    this.actionReturnFocus = null;
    if (back?.isConnected) setTimeout(() => back.focus());
  }

  async cancelMatch(match: MatchView): Promise<void> {
    const reason = await this.cancelDialog().open({
      title: 'Cancelar partido',
      message: `${match.categoryName} vs ${match.opponentName ?? 'rival'} · ${match.date} ${match.time}`,
      label: 'Motivo de la cancelación',
      placeholder: 'Ej. suspensión de jornada o cancha no disponible',
      confirmText: 'Cancelar partido',
      tone: 'danger',
      required: true,
    });
    if (!reason) return;
    if (
      await this.submission.run(
        () => this.service.cancel(match.id, reason),
        'Partido cancelado.',
      )
    )
      this.matches.reload();
  }

  async apply(a: Action): Promise<void> {
    if (a.kind === 'reschedule' && !this.form.text.trim()) {
      this.actionError.set('Ingresa el motivo de la reprogramación.');
      this.actionFormEl()?.nativeElement.querySelector<HTMLInputElement>('input[name=reason]')?.focus();
      return;
    }
    this.actionError.set(null);
    const f = this.form;
    const run: () => Promise<unknown> = {
      reschedule: () =>
        this.service.reschedule(a.match.id, {
          date: f.date,
          time: f.time,
          venueId: f.venueId,
          reason: f.text,
        }),
      result: () =>
        this.service.recordResult(a.match.id, {
          goalsFor: Number(f.goalsFor),
          goalsAgainst: Number(f.goalsAgainst),
          notes: f.text || null,
        }),
    }[a.kind];
    if (await this.submission.run(run, 'Partido actualizado.')) {
      this.closeAction();
      this.matches.reload();
    }
  }
}

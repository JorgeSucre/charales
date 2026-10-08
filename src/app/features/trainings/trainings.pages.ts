import {
  Component,
  inject,
  input,
  linkedSignal,
  numberAttribute,
  resource,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AttendanceStatus, Id, TrainingStatus } from '../../core/models';
import { CategoryService } from '../../core/services/category.service';
import { PlayerService } from '../../core/services/player.service';
import { addDays, today } from '../../shared/dates';
import { LoadState } from '../../shared/load-state';
import { Submission } from '../../shared/submission';
import { SubmissionAlert, idOrNull } from '../../shared/ui';
import { CoachService } from '../coaches/coach.service';
import { VenueService } from '../venues/venue.service';
import { ATTENDANCE_LABELS, AttendanceService } from './attendance.service';
import { ScheduleService } from './schedule.service';
import { TRAINING_STATUS_LABELS, TrainingService } from './training.service';

/** HU-028: programmed sessions (manual or from recurring schedules), filters and status. */
@Component({
  selector: 'app-trainings-page',
  imports: [FormsModule, RouterLink, LoadState, SubmissionAlert, DatePipe],
  template: `
    <h1>Sesiones de entrenamiento</h1>
    <app-submission-alert [submission]="submission" />
    @if (auth.can('entrenamientos.crear')) {
      <div class="two-col">
        <form class="grid-form" (ngSubmit)="program()" novalidate>
          <h2>Programar sesión</h2>
          <label
            >Categoría
            <select
              name="cat"
              [ngModel]="draft.categoryId"
              (ngModelChange)="draft.categoryId = $event; draft.scheduleId = null"
            >
              <option [ngValue]="null">Selecciona…</option>
              @for (c of categories.value() ?? []; track c.id) {
                <option [ngValue]="c.id">{{ c.name }}</option>
              }
            </select>
          </label>
          <label
            >Desde un horario recurrente (opcional)
            <select name="sch" [ngModel]="draft.scheduleId" (ngModelChange)="pickSchedule($event)">
              <option [ngValue]="null">Ninguno</option>
              @for (s of schedulesOf(draft.categoryId); track s.id) {
                <option [ngValue]="s.id">
                  {{ s.venueName }} · día {{ s.weekday }} {{ s.startTime }}–{{ s.endTime }}
                </option>
              }
            </select>
          </label>
          <label>Fecha <input type="date" name="date" [(ngModel)]="draft.date" /></label>
          <div class="two-col">
            <label>Inicio <input type="time" name="start" [(ngModel)]="draft.startTime" /></label>
            <label>Fin <input type="time" name="end" [(ngModel)]="draft.endTime" /></label>
          </div>
          <label
            >Sede
            <select name="venue" [(ngModel)]="draft.venueId">
              <option [ngValue]="null">Selecciona…</option>
              @for (v of venues.value() ?? []; track v.id) {
                <option [ngValue]="v.id">{{ v.name }}</option>
              }
            </select>
          </label>
          <label
            >Entrenador
            <select name="coach" [(ngModel)]="draft.coachId">
              <option [ngValue]="null">Sin asignar</option>
              @for (c of coaches.value() ?? []; track c.id) {
                <option [ngValue]="c.id">{{ c.name }}</option>
              }
            </select>
          </label>
          <label>Objetivo / tema <input name="obj" [(ngModel)]="draft.objective" /></label>
          <button
            type="submit"
            [disabled]="submission.busy() || !draft.categoryId || !draft.venueId"
          >
            Programar
          </button>
        </form>
        <form class="grid-form" (ngSubmit)="generate()" novalidate>
          <h2>Generar desde horarios</h2>
          <p class="muted">
            Crea las sesiones de cada horario activo en el rango; las que ya existen no se duplican.
          </p>
          <label>Desde <input type="date" name="gfrom" [(ngModel)]="genFrom" /></label>
          <label>Hasta <input type="date" name="gto" [(ngModel)]="genTo" /></label>
          <button type="submit" [disabled]="submission.busy()">Generar</button>
        </form>
      </div>
    }
    <div class="filters">
      <label
        >Desde <input type="date" [ngModel]="from()" (ngModelChange)="from.set($event)"
      /></label>
      <label>Hasta <input type="date" [ngModel]="to()" (ngModelChange)="to.set($event)" /></label>
      <label
        >Categoría
        <select [ngModel]="categoryId()" (ngModelChange)="categoryId.set(idOrNull($event))">
          <option [ngValue]="null">Todas</option>
          @for (c of categories.value() ?? []; track c.id) {
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
    <app-load-state [res]="sessions" emptyText="Sin sesiones en el rango."
      ><ng-template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Horario</th>
                <th>Categoría</th>
                <th>Sede</th>
                <th>Entrenador</th>
                <th>Estado</th>
                <th class="num">Asistencias</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (s of sessions.value() ?? []; track s.id) {
                <tr>
                  <td>{{ s.date | date: 'EEE d MMM' }}</td>
                  <td>{{ s.startTime }}–{{ s.endTime }}</td>
                  <td>{{ s.categoryName }}</td>
                  <td>{{ s.venueName }}</td>
                  <td>{{ s.coachName ?? '—' }}</td>
                  <td>
                    <span class="tag" [class.off]="s.status === 'CANCELADO'">{{
                      labels[s.status]
                    }}</span>
                  </td>
                  <td class="num">{{ s.recorded }}</td>
                  <td class="row-actions">
                    <a [routerLink]="['/sports/trainings', s.id]">Abrir</a>
                    @if (auth.can('entrenamientos.editar') && s.status === 'PROGRAMADO') {
                      <button type="button" class="link danger" (click)="cancel(s.id)">
                        Cancelar
                      </button>
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
export class TrainingsPage {
  private service = inject(TrainingService);
  private scheduleService = inject(ScheduleService);
  private categoryService = inject(CategoryService);
  private venueService = inject(VenueService);
  private coachService = inject(CoachService);
  protected auth = inject(AuthService);
  protected idOrNull = idOrNull;
  protected labels = TRAINING_STATUS_LABELS;
  protected statuses = Object.entries(TRAINING_STATUS_LABELS) as [TrainingStatus, string][];
  protected categories = resource({
    loader: () => this.categoryService.list({ onlyActive: true }),
  });
  protected venues = resource({ loader: () => this.venueService.list(true) });
  protected coaches = resource({ loader: () => this.coachService.list({ onlyActive: true }) });
  protected schedules = resource({ loader: () => this.scheduleService.list({ onlyActive: true }) });
  protected from = signal(addDays(today(), -7));
  protected to = signal(addDays(today(), 14));
  protected categoryId = signal<Id | null>(null);
  protected status = signal<TrainingStatus | ''>('');
  protected sessions = resource({
    params: () => ({
      from: this.from(),
      to: this.to(),
      categoryId: this.categoryId(),
      status: this.status(),
    }),
    loader: ({ params }) => this.service.list(params),
  });
  protected submission = new Submission();
  protected draft = this.emptyDraft();
  protected genFrom = today();
  protected genTo = addDays(today(), 13);

  private emptyDraft() {
    return {
      categoryId: null as Id | null,
      scheduleId: null as Id | null,
      venueId: null as Id | null,
      coachId: null as Id | null,
      date: today(),
      startTime: '17:00',
      endTime: '18:30',
      objective: '',
    };
  }

  schedulesOf(categoryId: Id | null) {
    return (this.schedules.value() ?? []).filter((s) => s.categoryId === categoryId);
  }

  pickSchedule(id: Id | null): void {
    this.draft.scheduleId = id;
    const s = this.schedules.value()?.find((x) => x.id === id);
    if (s)
      Object.assign(this.draft, { venueId: s.venueId, startTime: s.startTime, endTime: s.endTime });
  }

  async program(): Promise<void> {
    const d = this.draft;
    const ok = await this.submission.run(
      () =>
        this.service.program({
          ...d,
          categoryId: d.categoryId!,
          venueId: d.venueId!,
          objective: d.objective || null,
        }),
      'Sesión programada.',
    );
    if (ok) {
      this.draft = this.emptyDraft();
      this.sessions.reload();
    }
  }

  async generate(): Promise<void> {
    if (
      await this.submission.run(
        () => this.service.generateFromSchedules(this.genFrom, this.genTo),
        (r) => `Se crearon ${r.created} sesiones (${r.skipped} ya existían).`,
      )
    )
      this.sessions.reload();
  }

  async cancel(id: Id): Promise<void> {
    const reason = prompt('Motivo de la cancelación:')?.trim();
    if (!reason) return;
    await this.submission.run(
      () => this.service.setStatus(id, 'CANCELADO', reason),
      'Sesión cancelada.',
    );
    this.sessions.reload();
  }
}

/**
 * HU-029/030/031: one session — group, attendance capture (mobile-friendly, one per player, corrections audited) and
 * objective/notes. Shared by /sports/trainings/:id (office) and /coach/sessions/:id (coach); the service checks scope.
 */
@Component({
  selector: 'app-session-page',
  imports: [FormsModule, LoadState, SubmissionAlert, DatePipe],
  template: `
    <app-load-state [res]="session"
      ><ng-template>
        @if (session.value(); as s) {
          <h1>{{ s.categoryName }} · {{ s.date | date: 'EEEE d MMM' }}</h1>
          <p>
            {{ s.startTime }}–{{ s.endTime }} · {{ s.venueName }} ·
            {{ s.coachName ?? 'sin entrenador' }} ·
            <span class="tag" [class.off]="s.status === 'CANCELADO'">{{ labels[s.status] }}</span>
          </p>
          <app-submission-alert [submission]="submission" />

          <form class="grid-form" (ngSubmit)="saveNotes()" novalidate>
            <h2>Bitácora de la sesión</h2>
            <label
              >Objetivo / tema
              <input
                name="objective"
                [ngModel]="objective()"
                (ngModelChange)="objective.set($event)"
                [disabled]="!s.canRecord"
            /></label>
            <label
              >Observaciones
              <textarea
                name="notes"
                rows="3"
                [ngModel]="notes()"
                (ngModelChange)="notes.set($event)"
                [disabled]="!s.canRecord"
              ></textarea>
            </label>
            @if (s.canRecord) {
              <button type="submit" [disabled]="submission.busy()">Guardar bitácora</button>
            }
          </form>

          <h2>Asistencia ({{ s.players.length }} jugadores)</h2>
          @if (s.canRecord && s.status !== 'CANCELADO') {
            <div class="actions no-print">
              <button type="button" class="secondary" (click)="markAll('PRESENTE')">
                Todos presentes
              </button>
            </div>
          }
          <ul class="attendance">
            @for (p of s.players; track p.playerId) {
              <li>
                <span class="name">{{ p.name }}</span>
                <div class="seg" role="radiogroup" [attr.aria-label]="'Asistencia de ' + p.name">
                  @for (st of states; track st[0]) {
                    <label [class.on]="marks()[p.playerId] === st[0]">
                      <input
                        type="radio"
                        [name]="'a' + p.playerId"
                        [value]="st[0]"
                        [checked]="marks()[p.playerId] === st[0]"
                        (change)="mark(p.playerId, st[0])"
                        [disabled]="!s.canRecord || s.status === 'CANCELADO'"
                      />{{ st[1] }}
                    </label>
                  }
                </div>
                <input
                  class="note"
                  [value]="notesBy()[p.playerId] ?? ''"
                  (input)="note(p.playerId, $any($event.target).value)"
                  placeholder="Observación"
                  [attr.aria-label]="'Observación de ' + p.name"
                  [disabled]="!s.canRecord"
                />
              </li>
            } @empty {
              <li class="muted">La categoría no tenía jugadores activos en esa fecha.</li>
            }
          </ul>
          @if (s.canRecord && s.status !== 'CANCELADO') {
            <button type="button" (click)="saveAttendance()" [disabled]="submission.busy()">
              Guardar asistencia
            </button>
          }
        }
      </ng-template></app-load-state
    >
  `,
})
export class SessionPage {
  readonly id = input.required<Id, unknown>({ transform: numberAttribute });
  private service = inject(TrainingService);
  private attendance = inject(AttendanceService);
  protected labels = TRAINING_STATUS_LABELS;
  protected states = Object.entries(ATTENDANCE_LABELS) as [AttendanceStatus, string][];
  protected session = resource({
    params: () => this.id(),
    loader: ({ params }) => this.service.get(params),
  });
  protected submission = new Submission();
  // Editable copies of the loaded session; reset whenever it (re)loads.
  protected objective = linkedSignal(() => this.session.value()?.objective ?? '');
  protected notes = linkedSignal(() => this.session.value()?.notes ?? '');
  protected marks = linkedSignal<Record<Id, AttendanceStatus | null>>(() =>
    Object.fromEntries((this.session.value()?.players ?? []).map((p) => [p.playerId, p.status])),
  );
  protected notesBy = linkedSignal<Record<Id, string>>(() =>
    Object.fromEntries(
      (this.session.value()?.players ?? []).map((p) => [p.playerId, p.notes ?? '']),
    ),
  );

  mark(playerId: Id, status: AttendanceStatus): void {
    this.marks.update((m) => ({ ...m, [playerId]: status }));
  }

  note(playerId: Id, text: string): void {
    this.notesBy.update((m) => ({ ...m, [playerId]: text }));
  }

  markAll(status: AttendanceStatus): void {
    this.marks.update((m) => Object.fromEntries(Object.keys(m).map((id) => [id, status])));
  }

  async saveAttendance(): Promise<void> {
    const entries = Object.entries(this.marks())
      .filter(([, status]) => status)
      .map(([playerId, status]) => ({
        playerId: Number(playerId),
        status: status!,
        notes: this.notesBy()[Number(playerId)] || null,
      }));
    if (
      await this.submission.run(
        () => this.attendance.record(this.id(), entries),
        `Asistencia guardada (${entries.length}).`,
      )
    )
      this.session.reload();
  }

  async saveNotes(): Promise<void> {
    if (
      await this.submission.run(
        () =>
          this.service.saveNotes(this.id(), { objective: this.objective(), notes: this.notes() }),
        'Bitácora guardada.',
      )
    )
      this.session.reload();
  }
}

/** HU-032: attendance by player/category/period with % and justified absences shown apart. */
@Component({
  selector: 'app-attendance-report-page',
  imports: [FormsModule, LoadState],
  template: `
    <h1>Reporte de asistencia</h1>
    <div class="filters">
      <label
        >Desde <input type="date" [ngModel]="from()" (ngModelChange)="from.set($event)"
      /></label>
      <label>Hasta <input type="date" [ngModel]="to()" (ngModelChange)="to.set($event)" /></label>
      <label
        >Categoría
        <select [ngModel]="categoryId()" (ngModelChange)="categoryId.set(idOrNull($event))">
          <option [ngValue]="null">Todas</option>
          @for (c of categories.value() ?? []; track c.id) {
            <option [ngValue]="c.id">{{ c.name }}</option>
          }
        </select>
      </label>
      <label
        >Jugador
        <select [ngModel]="playerId()" (ngModelChange)="playerId.set(idOrNull($event))">
          <option [ngValue]="null">Todos</option>
          @for (p of players.value() ?? []; track p.id) {
            <option [ngValue]="p.id">{{ p.name }}</option>
          }
        </select>
      </label>
    </div>
    <p class="muted">
      Ordenado de menor a mayor asistencia para detectar inasistencias frecuentes.
    </p>
    <app-load-state [res]="rows" emptyText="Sin asistencias registradas en el periodo."
      ><ng-template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Jugador</th>
                <th>Categoría</th>
                <th class="num">Sesiones</th>
                <th class="num">Presente</th>
                <th class="num">Ausente</th>
                <th class="num">Justificado</th>
                <th class="num">% asistencia</th>
                <th class="num">% con justificadas</th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows.value() ?? []; track r.playerId) {
                <tr>
                  <td>{{ r.playerName }}</td>
                  <td>{{ r.categoryName }}</td>
                  <td class="num">{{ r.total }}</td>
                  <td class="num">{{ r.present }}</td>
                  <td class="num">{{ r.absent }}</td>
                  <td class="num">{{ r.justified }}</td>
                  <td class="num" [class.danger]="r.presentPct < 75">{{ r.presentPct }}%</td>
                  <td class="num">{{ r.presentOrJustifiedPct }}%</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </ng-template></app-load-state
    >
  `,
})
export class AttendanceReportPage {
  private service = inject(AttendanceService);
  private categoryService = inject(CategoryService);
  private playerService = inject(PlayerService);
  protected idOrNull = idOrNull;
  protected categories = resource({ loader: () => this.categoryService.list() });
  protected players = resource({ loader: () => this.playerService.options() });
  protected from = signal(addDays(today(), -30));
  protected to = signal(today());
  protected categoryId = signal<Id | null>(null);
  protected playerId = signal<Id | null>(null);
  protected rows = resource({
    params: () => ({
      from: this.from(),
      to: this.to(),
      categoryId: this.categoryId(),
      playerId: this.playerId(),
    }),
    loader: ({ params }) => this.service.report(params),
  });
}

import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  input,
  linkedSignal,
  numberAttribute,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { AttendanceStatus, Id, TrainingStatus } from '../../core/models';
import { CategoryService } from '../../core/services/category.service';
import { PlayerService } from '../../core/services/player.service';
import { addDays, today } from '../../shared/dates';
import { FormPanel } from '../../shared/form-panel';
import { LoadState } from '../../shared/load-state';
import { PromptDialog } from '../../shared/prompt-dialog';
import { TRAINING_TONE } from '../../shared/status-tone';
import { Submission } from '../../shared/submission';
import { SubmissionAlert, idOrNull } from '../../shared/ui';
import { CoachService } from '../coaches/coach.service';
import { VenueService } from '../venues/venue.service';
import { ATTENDANCE_LABELS, AttendanceService } from './attendance.service';
import { ScheduleService } from './schedule.service';
import { SessionView, TRAINING_STATUS_LABELS, TrainingService } from './training.service';

/** HU-028: programmed sessions (manual or from recurring schedules), filters and status. */
@Component({
  selector: 'app-trainings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, LoadState, SubmissionAlert, PromptDialog, DatePipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Sesiones de entrenamiento</h1>
        <p class="page-subtitle">
          Programación de prácticas por categoría, generación desde horarios y pase de lista.
        </p>
      </div>
      @if (auth.can('entrenamientos.crear')) {
        <div class="actions">
          <button
            type="button"
            class="secondary"
            (click)="openGenerate()"
            [attr.aria-expanded]="generatePanel.open()"
            aria-controls="generate-form"
          >
            Generar desde horarios
          </button>
          <button
            type="button"
            (click)="openProgram()"
            [attr.aria-expanded]="programPanel.open()"
            aria-controls="program-form"
          >
            Programar sesión
          </button>
        </div>
      }
    </div>
    <app-submission-alert [submission]="submission" />

    @if (programPanel.open()) {
      <form
        id="program-form"
        class="grid-form"
        (ngSubmit)="program()"
        (keydown.escape)="closeProgram()"
        novalidate
      >
        <h2>Programar sesión</h2>
        <p class="field-hint">
          Selecciona la categoría y opcionalmente un horario recurrente para completar sede y
          horario.
        </p>
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
        <div class="two-col">
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
        </div>
        <label
          >Objetivo / tema
          <input
            name="obj"
            [(ngModel)]="draft.objective"
            placeholder="Ej. control orientado y definición"
        /></label>
        <div class="actions">
          <button
            type="submit"
            [disabled]="submission.busy() || !draft.categoryId || !draft.venueId"
          >
            {{ submission.busy() ? 'Guardando…' : 'Programar' }}
          </button>
          <button type="button" class="secondary" (click)="closeProgram()">Cancelar</button>
        </div>
      </form>
    }

    @if (generatePanel.open()) {
      <form
        id="generate-form"
        class="grid-form"
        (ngSubmit)="generate()"
        (keydown.escape)="generatePanel.close()"
        novalidate
      >
        <h2>Generar desde horarios</h2>
        <p class="field-hint">
          Crea las sesiones de cada horario activo en el rango; las que ya existen no se duplican.
        </p>
        <div class="two-col">
          <label>Desde <input type="date" name="gfrom" [(ngModel)]="genFrom" /></label>
          <label>Hasta <input type="date" name="gto" [(ngModel)]="genTo" /></label>
        </div>
        <div class="actions">
          <button type="submit" [disabled]="submission.busy()">
            {{ submission.busy() ? 'Generando…' : 'Generar' }}
          </button>
          <button type="button" class="secondary" (click)="generatePanel.close()">Cancelar</button>
        </div>
      </form>
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
      @if (hasFilters()) {
        <button type="button" class="secondary sm" (click)="clearFilters()">Limpiar filtros</button>
      }
    </div>

    <app-load-state [res]="sessions" emptyText="Sin sesiones en el rango seleccionado."
      ><ng-template>
        <div class="list-meta">
          <p class="muted">
            Mostrando <strong class="tabular">{{ (sessions.value() ?? []).length }}</strong>
            {{ (sessions.value() ?? []).length === 1 ? 'sesión' : 'sesiones' }}
          </p>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha y horario</th>
                <th>Categoría</th>
                <th>Sede</th>
                <th>Entrenador</th>
                <th>Estado</th>
                <th class="num">Asistencias</th>
                <th><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (s of sessions.value() ?? []; track s.id) {
                <tr [class.muted]="s.status === 'CANCELADO'">
                  <td>
                    <strong class="cap">{{ s.date | date: 'EEE d MMM' }}</strong>
                    <div class="cell-sub tabular">{{ s.startTime }}–{{ s.endTime }}</div>
                  </td>
                  <td>
                    {{ s.categoryName }}
                    @if (s.objective) {
                      <div class="cell-sub">{{ s.objective }}</div>
                    }
                  </td>
                  <td>{{ s.venueName }}</td>
                  <td>{{ s.coachName ?? 'Sin asignar' }}</td>
                  <td>
                    <span class="tag {{ trainingTone[s.status] }}">{{ labels[s.status] }}</span>
                  </td>
                  <td class="num">{{ s.recorded }}</td>
                  <td class="row-actions">
                    <a [routerLink]="['/sports/trainings', s.id]">Abrir</a>
                    @if (auth.can('entrenamientos.editar') && s.status === 'PROGRAMADO') {
                      <button type="button" class="link danger" (click)="cancel(s)">
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
    <app-prompt-dialog #cancelDialog />
  `,
})
export class TrainingsPage {
  private cancelDialog = viewChild.required<PromptDialog>('cancelDialog');
  private service = inject(TrainingService);
  private scheduleService = inject(ScheduleService);
  private categoryService = inject(CategoryService);
  private venueService = inject(VenueService);
  private coachService = inject(CoachService);
  protected auth = inject(AuthService);
  /** `?nuevo=1` (a quick task of the Tablero) opens the create form at once, if the role may create. */
  private openOnArrival = inject(ActivatedRoute).snapshot.queryParamMap.has('nuevo')
    ? setTimeout(() => this.auth.can('entrenamientos.crear') && this.openProgram())
    : null;
  protected idOrNull = idOrNull;
  protected labels = TRAINING_STATUS_LABELS;
  protected trainingTone = TRAINING_TONE;
  protected statuses = Object.entries(TRAINING_STATUS_LABELS) as [TrainingStatus, string][];
  protected categories = resource({
    loader: () => this.categoryService.list({ onlyActive: true }),
  });
  protected venues = resource({ loader: () => this.venueService.list(true) });
  protected coaches = resource({ loader: () => this.coachService.list({ onlyActive: true }) });
  protected schedules = resource({ loader: () => this.scheduleService.list({ onlyActive: true }) });
  private readonly defaultFrom = addDays(today(), -7);
  private readonly defaultTo = addDays(today(), 14);
  protected from = signal(this.defaultFrom);
  protected to = signal(this.defaultTo);
  protected categoryId = signal<Id | null>(null);
  protected status = signal<TrainingStatus | ''>('');
  protected hasFilters = computed(
    () =>
      this.categoryId() !== null ||
      !!this.status() ||
      this.from() !== this.defaultFrom ||
      this.to() !== this.defaultTo,
  );
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

  private opened = '';
  protected programPanel = new FormPanel(
    'program-form',
    () => JSON.stringify(this.draft) !== this.opened,
  );
  protected generatePanel = new FormPanel('generate-form');

  clearFilters(): void {
    this.from.set(this.defaultFrom);
    this.to.set(this.defaultTo);
    this.categoryId.set(null);
    this.status.set('');
  }

  openProgram(): void {
    if (!this.generatePanel.close() || !this.programPanel.close()) return;
    this.draft = this.emptyDraft();
    this.opened = JSON.stringify(this.draft);
    this.submission.result.set(null);
    this.programPanel.show();
  }

  /** Closes the form without programming anything (asks first if it has unsaved changes). */
  closeProgram(): void {
    if (this.programPanel.close()) this.draft = this.emptyDraft();
  }

  openGenerate(): void {
    if (!this.programPanel.close()) return;
    this.draft = this.emptyDraft();
    this.genFrom = today();
    this.genTo = addDays(today(), 13);
    this.submission.result.set(null);
    this.generatePanel.show();
  }

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
      this.programPanel.done();
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
    ) {
      this.generatePanel.done();
      this.sessions.reload();
    }
  }

  async cancel(s: SessionView): Promise<void> {
    const reason = await this.cancelDialog().open({
      title: 'Cancelar sesión',
      message: `${s.categoryName} · ${s.date} (${s.startTime}–${s.endTime})`,
      label: 'Motivo de la cancelación',
      placeholder: 'Ej. lluvia intensa o cancha no disponible',
      confirmText: 'Cancelar sesión',
      tone: 'danger',
      required: true,
    });
    if (!reason) return;
    if (
      await this.submission.run(
        () => this.service.setStatus(s.id, 'CANCELADO', reason),
        'Sesión cancelada.',
      )
    )
      this.sessions.reload();
  }
}

/**
 * HU-029/030/031: one session — group, attendance capture (mobile-friendly, one per player, corrections audited) and
 * objective/notes. Shared by /sports/trainings/:id (office) and /coach/sessions/:id (coach); the service checks scope.
 */
@Component({
  selector: 'app-session-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, LoadState, SubmissionAlert, DatePipe],
  template: `
    <a class="back-link" [routerLink]="backLink()">
      {{ auth.can('entrenamientos.consultar') ? '← Sesiones' : '← Mi panel' }}
    </a>
    <app-load-state [res]="session"
      ><ng-template>
        @if (session.value(); as s) {
          <div class="page-head">
            <div>
              <div class="title-row">
                <h1>{{ s.categoryName }} · {{ s.date | date: 'EEEE d MMM' }}</h1>
                <span class="tag {{ trainingTone[s.status] }}">{{ labels[s.status] }}</span>
              </div>
              <p class="page-subtitle">
                <span class="tabular">{{ s.startTime }}–{{ s.endTime }}</span> ·
                {{ s.venueName }} · Entrenador: {{ s.coachName ?? 'Sin asignar' }}
              </p>
            </div>
          </div>
          <app-submission-alert [submission]="submission" />

          <section class="session-attendance-section" aria-labelledby="attendance-heading">
            <div class="page-head compact">
              <div>
                <h2 id="attendance-heading">Asistencia ({{ s.players.length }} jugadores)</h2>
                <p class="field-hint">
                  Marca el estado de cada jugador; los cambios se conservan al presionar Guardar
                  asistencia.
                </p>
              </div>
              @if (dirtyAttendance()) {
                <span class="tag warn" role="status">Cambios sin guardar</span>
              }
            </div>

            <dl class="attendance-stats" aria-label="Resumen de asistencia">
              <div class="stat-ok">
                <dt>Presentes</dt>
                <dd>{{ counts().present }}</dd>
              </div>
              <div class="stat-danger">
                <dt>Ausentes</dt>
                <dd>{{ counts().absent }}</dd>
              </div>
              <div class="stat-warn">
                <dt>Justificados</dt>
                <dd>{{ counts().justified }}</dd>
              </div>
              <div class="stat-neutral">
                <dt>Sin marcar</dt>
                <dd>{{ counts().unmarked }}</dd>
              </div>
            </dl>

            @if (s.canRecord && s.status !== 'CANCELADO' && s.players.length) {
              <div class="attendance-toolbar no-print">
                <div class="actions">
                  <button type="button" class="secondary" (click)="markAll('PRESENTE')">
                    Todos presentes
                  </button>
                  @if (dirtyAttendance()) {
                    <button type="button" class="secondary" (click)="resetAttendance()">
                      Descartar cambios
                    </button>
                  }
                </div>
                <button
                  type="button"
                  (click)="saveAttendance()"
                  [disabled]="submission.busy() || counts().marked === 0"
                >
                  {{
                    submission.busy()
                      ? 'Guardando…'
                      : 'Guardar asistencia (' + counts().marked + ')'
                  }}
                </button>
              </div>
            }

            <ul class="attendance">
              @for (p of s.players; track p.playerId) {
                <li [class.unmarked]="!marks()[p.playerId]">
                  <div class="attendance-player">
                    <span class="name">{{ p.name }}</span>
                    @if (!marks()[p.playerId]) {
                      <span class="tag neutral">Sin marcar</span>
                    }
                  </div>
                  <div class="seg" role="radiogroup" [attr.aria-label]="'Asistencia de ' + p.name">
                    @for (st of states; track st[0]) {
                      <label
                        [class.on]="marks()[p.playerId] === st[0]"
                        [class.seg-present]="st[0] === 'PRESENTE'"
                        [class.seg-absent]="st[0] === 'AUSENTE'"
                        [class.seg-justified]="st[0] === 'JUSTIFICADO'"
                      >
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
                    [disabled]="!s.canRecord || s.status === 'CANCELADO'"
                  />
                </li>
              } @empty {
                <li class="muted">La categoría no tenía jugadores activos en esa fecha.</li>
              }
            </ul>

            @if (s.canRecord && s.status !== 'CANCELADO' && s.players.length) {
              <div class="attendance-footer no-print">
                <button
                  type="button"
                  (click)="saveAttendance()"
                  [disabled]="submission.busy() || counts().marked === 0"
                >
                  {{ submission.busy() ? 'Guardando…' : 'Guardar asistencia' }}
                </button>
                @if (dirtyAttendance()) {
                  <span class="field-hint">Tienes cambios de asistencia pendientes por guardar.</span>
                }
              </div>
            }
          </section>

          <form class="grid-form" (ngSubmit)="saveNotes()" novalidate>
            <h2>Bitácora de la sesión</h2>
            @if (!s.canRecord) {
              <p class="field-hint">
                Solo el entrenador asignado o personal autorizado puede editar la bitácora.
              </p>
            }
            <label
              >Objetivo / tema
              <input
                name="objective"
                [ngModel]="objective()"
                (ngModelChange)="objective.set($event)"
                [disabled]="!s.canRecord"
                placeholder="Ej. presión tras pérdida y transiciones"
              />
            </label>
            <label
              >Observaciones
              <textarea
                name="notes"
                rows="3"
                [ngModel]="notes()"
                (ngModelChange)="notes.set($event)"
                [disabled]="!s.canRecord"
                placeholder="Notas de desempeño, incidencias o recomendaciones…"
              ></textarea>
            </label>
            @if (s.canRecord) {
              <div class="actions">
                <button type="submit" [disabled]="submission.busy()">
                  {{ submission.busy() ? 'Guardando…' : 'Guardar bitácora' }}
                </button>
              </div>
            }
          </form>
        }
      </ng-template></app-load-state
    >
  `,
})
export class SessionPage {
  readonly id = input.required<Id, unknown>({ transform: numberAttribute });
  private service = inject(TrainingService);
  private attendance = inject(AttendanceService);
  protected auth = inject(AuthService);
  protected labels = TRAINING_STATUS_LABELS;
  protected trainingTone = TRAINING_TONE;
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

  protected counts = computed(() => {
    const players = this.session.value()?.players ?? [];
    const m = this.marks();
    let present = 0;
    let absent = 0;
    let justified = 0;
    let unmarked = 0;
    for (const p of players) {
      const st = m[p.playerId];
      if (st === 'PRESENTE') present++;
      else if (st === 'AUSENTE') absent++;
      else if (st === 'JUSTIFICADO') justified++;
      else unmarked++;
    }
    return {
      present,
      absent,
      justified,
      unmarked,
      marked: present + absent + justified,
    };
  });

  protected dirtyAttendance = computed(() => {
    const players = this.session.value()?.players ?? [];
    const m = this.marks();
    const n = this.notesBy();
    return players.some((p) => m[p.playerId] !== p.status || (n[p.playerId] ?? '') !== (p.notes ?? ''));
  });

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirtyAttendance()) event.preventDefault();
  }

  protected backLink(): string {
    return this.auth.can('entrenamientos.consultar') ? '/sports/trainings' : '/coach';
  }

  mark(playerId: Id, status: AttendanceStatus): void {
    this.marks.update((m) => ({ ...m, [playerId]: status }));
  }

  note(playerId: Id, text: string): void {
    this.notesBy.update((m) => ({ ...m, [playerId]: text }));
  }

  markAll(status: AttendanceStatus): void {
    this.marks.update((m) => Object.fromEntries(Object.keys(m).map((id) => [id, status])));
  }

  resetAttendance(): void {
    const players = this.session.value()?.players ?? [];
    this.marks.set(Object.fromEntries(players.map((p) => [p.playerId, p.status])));
    this.notesBy.set(Object.fromEntries(players.map((p) => [p.playerId, p.notes ?? ''])));
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
        `Asistencia guardada (${entries.length} jugadores).`,
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, LoadState],
  template: `
    <div class="page-head">
      <div>
        <h1>Reporte de asistencia</h1>
        <p class="page-subtitle">
          Ordenado de menor a mayor porcentaje de asistencia para detectar inasistencias frecuentes.
        </p>
      </div>
    </div>

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
      @if (hasFilters()) {
        <button type="button" class="secondary sm" (click)="clearFilters()">Limpiar filtros</button>
      }
    </div>

    <app-load-state [res]="rows" emptyText="Sin asistencias registradas en el periodo."
      ><ng-template>
        <div class="list-meta">
          <p class="muted">
            Jugadores en el periodo:
            <strong class="tabular">{{ (rows.value() ?? []).length }}</strong>
            @if (belowThreshold() > 0) {
              ·
              <span class="tag danger">{{ belowThreshold() }} bajo 75%</span>
            }
          </p>
        </div>
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
                  <td>
                    <strong>{{ r.playerName }}</strong>
                  </td>
                  <td>{{ r.categoryName }}</td>
                  <td class="num">{{ r.total }}</td>
                  <td class="num">{{ r.present }}</td>
                  <td class="num">{{ r.absent }}</td>
                  <td class="num">{{ r.justified }}</td>
                  <td class="num">
                    <span
                      class="tag"
                      [class.danger]="r.presentPct < 75"
                      [class.warn]="r.presentPct >= 75 && r.presentPct < 90"
                      [class.ok]="r.presentPct >= 90"
                    >
                      {{ r.presentPct }}%
                    </span>
                  </td>
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
  private readonly defaultFrom = addDays(today(), -30);
  private readonly defaultTo = today();
  protected from = signal(this.defaultFrom);
  protected to = signal(this.defaultTo);
  protected categoryId = signal<Id | null>(null);
  protected playerId = signal<Id | null>(null);
  protected hasFilters = computed(
    () =>
      this.categoryId() !== null ||
      this.playerId() !== null ||
      this.from() !== this.defaultFrom ||
      this.to() !== this.defaultTo,
  );
  protected rows = resource({
    params: () => ({
      from: this.from(),
      to: this.to(),
      categoryId: this.categoryId(),
      playerId: this.playerId(),
    }),
    loader: ({ params }) => this.service.report(params),
  });
  protected belowThreshold = computed(
    () => (this.rows.value() ?? []).filter((r) => r.presentPct < 75).length,
  );

  clearFilters(): void {
    this.from.set(this.defaultFrom);
    this.to.set(this.defaultTo);
    this.categoryId.set(null);
    this.playerId.set(null);
  }
}

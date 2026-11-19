import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  numberAttribute,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  FormBuilder,
  FormControl,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { CompetitionType, Id, PaymentMethod, PlayerStatus, Sex } from '../../core/models';
import { CategoryService } from '../../core/services/category.service';
import { TYPE_LABELS } from '../../core/services/competition.service';
import {
  PlayerDraft,
  PlayerService,
  SEX_LABELS,
  STATUS_LABELS,
} from '../../core/services/player.service';
import { ageOn, today } from '../../shared/dates';
import { FieldA11y, FieldError } from '../../shared/field-error';
import { focusFirstInvalid } from '../../shared/focus';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { Submission } from '../../shared/submission';
import {
  CHARGE_TONE,
  ENROLLMENT_TONE,
  ORDER_TONE,
  PAYMENT_TONE,
  PLAYER_TONE,
  toneOf,
} from '../../shared/status-tone';
import { Paginator, SubmissionAlert, catalogParam, idOrNull } from '../../shared/ui';
import { emailValidator, personNameValidator, phoneValidator } from '../../shared/validate';
import { CHARGE_STATUS_LABELS, METHOD_LABELS } from '../billing/billing.service';
import { ENROLLMENT_LABELS } from '../enrollments/enrollment.service';
import { ORDER_STATUS_LABELS } from '../uniforms/uniform.service';
import { PlayerCategoryService } from '../enrollments/player-category.service';
import { TutorService } from '../tutors/tutor.service';

const STATUSES = Object.entries(STATUS_LABELS) as [PlayerStatus, string][];

/** HU-014: partial search by name, combinable filters (category, status), pagination, link to the record. */
@Component({
  selector: 'app-players-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, LoadState, Paginator],
  template: `
    <div class="page-head">
      <div>
        <h1>Jugadores</h1>
        <p class="page-subtitle">
          Directorio de jugadores inscritos, categoría vigente y estado en la escuela.
        </p>
      </div>
      @if (auth.can('jugadores.crear')) {
        <a class="button" routerLink="/admin/players/new">Registrar jugador</a>
      }
    </div>

    <div class="filters">
      <label class="filter-grow"
        >Nombre o identificador
        <input
          type="search"
          placeholder="Buscar por nombre o J-0001…"
          [ngModel]="query()"
          (ngModelChange)="query.set($event); page.set(1)"
        />
      </label>
      <label
        >Categoría
        <select
          [ngModel]="categoryId()"
          (ngModelChange)="categoryId.set(idOrNull($event)); page.set(1)"
        >
          <option [ngValue]="null">Todas</option>
          @for (c of categories.value() ?? []; track c.id) {
            <option [ngValue]="c.id">{{ c.name }} · {{ c.seasonName }}</option>
          }
        </select>
      </label>
      <label
        >Estatus
        <select [ngModel]="status()" (ngModelChange)="status.set($event); page.set(1)">
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

    <app-load-state [res]="result" emptyText="Sin resultados."
      ><ng-template>
        <div class="list-meta">
          <p class="muted">
            Resultados:
            <strong class="tabular">{{ result.value()?.total }}</strong>
            {{ result.value()?.total === 1 ? 'jugador' : 'jugadores' }}
          </p>
          @if (activeFilterLabels().length) {
            <div class="filter-tags" aria-label="Filtros activos">
              @for (f of activeFilterLabels(); track f) {
                <span class="tag">{{ f }}</span>
              }
            </div>
          }
        </div>
        <div class="table-wrap">
          <table>
            <caption class="sr-only">
              Jugadores encontrados: identificador, nombre, edad, categoría y estatus
            </caption>
            <thead>
              <tr>
                <th>Identificador</th>
                <th>Nombre</th>
                <th class="num">Edad</th>
                <th>Categoría</th>
                <th>Estatus</th>
                <th><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (r of result.value()?.items ?? []; track r.player.id) {
                <tr>
                  <td class="mono">{{ r.player.identifier }}</td>
                  <td>
                    <a [routerLink]="['/admin/players', r.player.id]">{{ r.name }}</a>
                    @if (r.player.phone || r.player.email) {
                      <div class="cell-sub">
                        {{ contactSummary(r.player.phone, r.player.email) }}
                      </div>
                    }
                  </td>
                  <td class="num">{{ r.age }}</td>
                  <td>{{ r.categoryName ?? 'Sin categoría' }}</td>
                  <td>
                    <span class="tag {{ playerTone[r.player.status] }}">{{
                      labels[r.player.status]
                    }}</span>
                  </td>
                  <td class="row-actions">
                    <a [routerLink]="['/admin/players', r.player.id]">Expediente</a>
                    @if (auth.can('jugadores.editar')) {
                      <a [routerLink]="['/admin/players', r.player.id, 'edit']">Editar</a>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <app-paginator [page]="result.value()" (go)="page.set($event)" /> </ng-template
    ></app-load-state>
  `,
})
export class PlayersPage {
  private service = inject(PlayerService);
  protected auth = inject(AuthService);
  private categoryService = inject(CategoryService);
  protected idOrNull = idOrNull;
  protected labels = STATUS_LABELS;
  protected playerTone = PLAYER_TONE;
  protected statuses = STATUSES;
  protected categories = resource({ loader: () => this.categoryService.list() });
  protected query = signal('');
  protected categoryId = signal<Id | null>(null);
  /** `?status=` preselects the filter (links from the Tablero). */
  protected status = signal<PlayerStatus | ''>(
    catalogParam(inject(ActivatedRoute).snapshot.queryParamMap.get('status'), STATUS_LABELS),
  );
  protected page = signal(1);
  protected hasFilters = computed(
    () => !!this.query().trim() || this.categoryId() !== null || !!this.status(),
  );
  protected activeFilterLabels = computed(() => {
    const items: string[] = [];
    const q = this.query().trim();
    if (q) items.push(`Búsqueda: "${q}"`);
    const cid = this.categoryId();
    if (cid !== null) {
      const cat = (this.categories.value() ?? []).find((c) => c.id === cid);
      if (cat) items.push(`Categoría: ${cat.name}`);
    }
    const st = this.status();
    if (st) items.push(`Estatus: ${STATUS_LABELS[st]}`);
    return items;
  });
  protected result = resource({
    params: () => ({
      query: this.query(),
      categoryId: this.categoryId(),
      status: this.status(),
      page: this.page(),
    }),
    loader: ({ params }) => this.service.search(params),
  });

  clearFilters(): void {
    this.query.set('');
    this.categoryId.set(null);
    this.status.set('');
    this.page.set(1);
  }

  protected contactSummary(phone: string | null, email: string | null): string {
    return [phone, email].filter(Boolean).join(' · ');
  }
}

/** HU-008 (create, with generated identifier and age) and HU-009 (edit keeping id/identifier). */
@Component({
  selector: 'app-player-form-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, FieldError, FieldA11y, SubmissionAlert],
  template: `
    <a class="back-link" [routerLink]="id() ? ['/admin/players', id()] : '/admin/players'"
      >← Volver</a
    >
    <div class="page-head">
      <div>
        <h1>{{ id() ? 'Editar jugador' : 'Registrar jugador' }}</h1>
        <p class="page-subtitle">
          {{
            id()
              ? 'Actualiza los datos personales o de contacto del jugador.'
              : 'Se generará un identificador único al guardar. Los campos con * son obligatorios.'
          }}
        </p>
      </div>
    </div>

    <form #formEl [formGroup]="form" (ngSubmit)="submit()" novalidate class="grid-form">
      <fieldset class="stack">
        <legend>Datos personales</legend>
        <div>
          <label
            ><span
              >Nombre(s) <span class="req" aria-hidden="true">*</span
              ><span class="sr-only"> (obligatorio)</span></span
            >
            <input formControlName="firstName" autocomplete="off"
          /></label>
          <app-field-error [control]="form.controls.firstName" />
        </div>
        <div class="two-col">
          <div>
            <label
              ><span
                >Apellido paterno <span class="req" aria-hidden="true">*</span
                ><span class="sr-only"> (obligatorio)</span></span
              >
              <input formControlName="lastName1" autocomplete="off"
            /></label>
            <app-field-error [control]="form.controls.lastName1" />
          </div>
          <div>
            <label>Apellido materno <input formControlName="lastName2" autocomplete="off" /></label>
            <app-field-error [control]="form.controls.lastName2" />
          </div>
        </div>
        <div class="two-col">
          <div>
            <label
              ><span
                >Fecha de nacimiento <span class="req" aria-hidden="true">*</span
                ><span class="sr-only"> (obligatorio)</span></span
              >
              <input type="date" formControlName="birthDate" [max]="maxDate"
            /></label>
            <app-field-error [control]="form.controls.birthDate" />
          </div>
          <label
            >Sexo (opcional)
            <select formControlName="sex">
              @for (s of sexes; track s[0]) {
                <option [value]="s[0]">{{ s[1] }}</option>
              }
            </select>
          </label>
        </div>
        @if (age() !== null) {
          <p class="field-hint tabular">Edad calculada al día de hoy: {{ age() }} años</p>
        }
      </fieldset>

      <fieldset class="stack">
        <legend>Contacto del jugador</legend>
        <div class="two-col">
          <div>
            <label
              >Teléfono del jugador
              <input
                type="tel"
                formControlName="phone"
                placeholder="33 1234 5678"
                autocomplete="off"
              />
            </label>
            <app-field-error [control]="form.controls.phone" />
          </div>
          <div>
            <label
              >Correo del jugador
              <input
                type="email"
                formControlName="email"
                placeholder="jugador@ejemplo.com"
                autocomplete="off"
              />
            </label>
            <app-field-error [control]="form.controls.email" />
          </div>
        </div>
        <label>Dirección <input formControlName="address" autocomplete="off" /></label>
      </fieldset>

      @if (!id()) {
        <div class="form-block">
          <label
            >Estatus inicial
            <select [formControl]="initialStatus">
              @for (s of statuses; track s[0]) {
                <option [value]="s[0]">{{ s[1] }}</option>
              }
            </select>
          </label>
          <p class="field-hint">El contacto de la familia se vincula después en Tutores.</p>
        </div>
      } @else {
        <p class="field-hint">El contacto de la familia se administra en Tutores.</p>
      }

      <app-submission-alert [submission]="submission" />
      <div class="actions">
        <button type="submit" [disabled]="submission.busy() || (!!id() && player.isLoading())">
          {{ submission.busy() ? 'Guardando…' : 'Guardar' }}
        </button>
        <a
          class="button secondary"
          [routerLink]="id() ? ['/admin/players', id()] : '/admin/players'"
          >Cancelar</a
        >
      </div>
    </form>
  `,
})
export class PlayerFormPage {
  private formEl = viewChild.required<ElementRef<HTMLFormElement>>('formEl');
  readonly id = input<Id | undefined, unknown>(undefined, {
    transform: (v) => (v == null ? undefined : numberAttribute(v)),
  });
  private service = inject(PlayerService);
  private router = inject(Router);
  protected sexes = Object.entries(SEX_LABELS) as [Sex, string][];
  protected statuses = STATUSES;
  /** HU-008.1: status captured at registration (changes afterwards go through HU-010 with history). */
  protected initialStatus = new FormControl<PlayerStatus>('ACTIVO', { nonNullable: true });
  protected maxDate = today();
  protected submission = new Submission();
  protected form = inject(FormBuilder).nonNullable.group({
    firstName: ['', [Validators.required, Validators.maxLength(100), personNameValidator]],
    lastName1: ['', [Validators.required, Validators.maxLength(100), personNameValidator]],
    lastName2: ['', [Validators.maxLength(100), personNameValidator]],
    birthDate: ['', Validators.required],
    sex: ['NO_ESPECIFICADO' as Sex],
    phone: ['', phoneValidator],
    email: ['', emailValidator],
    address: [''],
  });
  private birthDate = signal('');
  protected age = computed(() => (this.birthDate() ? ageOn(this.birthDate(), today()) : null));
  protected player = resource({
    params: () => this.id(),
    loader: ({ params }) => this.service.get(params),
  });

  constructor() {
    this.form.controls.birthDate.valueChanges.subscribe((v) => this.birthDate.set(v));
    effect(() => {
      const p = this.player.value();
      if (p)
        this.form.setValue({
          firstName: p.firstName,
          lastName1: p.lastName1,
          lastName2: p.lastName2 ?? '',
          birthDate: p.birthDate,
          sex: p.sex,
          phone: p.phone ?? '',
          email: p.email ?? '',
          address: p.address ?? '',
        });
    });
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focusFirstInvalid(this.formEl().nativeElement);
      return;
    }
    const draft: PlayerDraft = { ...this.form.getRawValue() };
    const status = this.initialStatus.value;
    const id = this.id();
    let savedId: Id | null = null;
    const ok = await this.submission.run(
      async () => {
        const p = id
          ? await this.service.update(id, draft)
          : await this.service.create(draft, status);
        savedId = p.id;
        return p;
      },
      (p) => (id ? 'Cambios guardados.' : `Jugador registrado con identificador ${p.identifier}.`),
    );
    if (ok && savedId) this.router.navigate(['/admin/players', savedId]);
  }
}

type Tab = 'datos' | 'tutores' | 'categorias' | 'pagos' | 'uniformes' | 'competencias' | 'estatus';

/** HU-013 record + HU-010 status change + HU-017/019 category membership. */
@Component({
  selector: 'app-player-record-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    LoadState,
    MoneyPipe,
    DatePipe,
    SubmissionAlert,
  ],
  template: `
    <a class="back-link" routerLink="/admin/players">← Jugadores</a>
    <app-load-state [res]="record"
      ><ng-template>
        @if (record.value(); as r) {
          <div class="page-head">
            <div class="record-identity">
              <div class="title-row">
                <h1>{{ r.name }}</h1>
                <span class="tag neutral mono">{{ r.player.identifier }}</span>
              </div>
              @if (primaryTutor(r.tutors); as pt) {
                <p class="page-subtitle">
                  Contacto principal: <strong>{{ pt.name }}</strong> ({{ pt.relationship }})
                  @if (pt.phone || pt.email) {
                    · {{ contactSummary(pt.phone, pt.email) }}
                  }
                </p>
              }
            </div>
            <div class="actions">
              @if (auth.can('pagos.crear')) {
                <a
                  class="button"
                  [class.secondary]="r.balanceCents === 0"
                  routerLink="/admin/billing/payments/new"
                  [queryParams]="{ player: r.player.id }"
                >
                  Registrar pago
                </a>
              }
              @if (auth.can('jugadores.editar')) {
                <a class="button secondary" [routerLink]="['/admin/players', r.player.id, 'edit']"
                  >Editar datos</a
                >
              }
            </div>
          </div>

          <dl class="summary">
            <div>
              <dt>Estatus</dt>
              <dd>
                <span class="tag {{ playerTone[r.player.status] }}">{{
                  statusLabels[r.player.status]
                }}</span>
              </dd>
            </div>
            <div>
              <dt>Edad</dt>
              <dd>{{ r.age }} años</dd>
            </div>
            <div>
              <dt>Categoría</dt>
              <dd>
                {{
                  r.categories[0] && !r.categories[0].endDate
                    ? r.categories[0].categoryName
                    : 'Sin categoría'
                }}
              </dd>
            </div>
            <div>
              <dt>Saldo</dt>
              <dd>
                {{ r.balanceCents | money }}
                @if (r.overdueCents) {
                  <span class="tag danger">Vencido {{ r.overdueCents | money }}</span>
                }
              </dd>
            </div>
          </dl>
          <app-submission-alert [submission]="submission" />

          <div class="tabs" role="tablist" aria-label="Secciones del expediente">
            @for (t of tabs; track t[0]) {
              <button
                type="button"
                role="tab"
                [id]="'tab-' + t[0]"
                aria-controls="record-panel"
                [attr.aria-selected]="tab() === t[0]"
                [class.active]="tab() === t[0]"
                (click)="tab.set(t[0])"
              >
                {{ t[1] }}
              </button>
            }
          </div>

          <div id="record-panel" role="tabpanel" [attr.aria-labelledby]="'tab-' + tab()">
            @switch (tab()) {
              @case ('datos') {
                <div class="two-col">
                  <section class="panel">
                    <h2>Información personal</h2>
                    <dl class="facts">
                      <dt>Fecha de nacimiento</dt>
                      <dd class="tabular">{{ r.player.birthDate }}</dd>
                      <dt>Sexo</dt>
                      <dd>{{ sexLabels[r.player.sex] }}</dd>
                      <dt>Teléfono</dt>
                      <dd class="tabular">{{ r.player.phone ?? '—' }}</dd>
                      <dt>Correo</dt>
                      <dd>{{ r.player.email ?? '—' }}</dd>
                      <dt>Dirección</dt>
                      <dd>{{ r.player.address ?? '—' }}</dd>
                      <dt>Alta</dt>
                      <dd>{{ r.player.createdAt | date: 'd MMM y' }}</dd>
                      <dt>Última modificación</dt>
                      <dd>{{ r.player.updatedAt | date: 'd MMM y, HH:mm' }}</dd>
                    </dl>
                  </section>

                  <section class="panel">
                    <h2>Asistencia acumulada</h2>
                    <dl class="facts">
                      <dt>Sesiones registradas</dt>
                      <dd class="tabular">{{ r.attendance.total }}</dd>
                      <dt>Presentes</dt>
                      <dd class="tabular">{{ r.attendance.present }}</dd>
                      <dt>Ausencias</dt>
                      <dd class="tabular">{{ r.attendance.absent }}</dd>
                      <dt>Justificadas</dt>
                      <dd class="tabular">{{ r.attendance.justified }}</dd>
                    </dl>
                  </section>
                </div>

                <h2>Inscripción administrativa</h2>
                @if (r.enrollments.length) {
                  <div class="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Temporada</th>
                          <th>Fecha de inscripción</th>
                          <th class="num">Importe</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (e of r.enrollments; track e.id) {
                          <tr>
                            <td>{{ e.seasonName }}</td>
                            <td class="tabular">{{ e.enrolledOn }}</td>
                            <td class="num">{{ e.amountCents | money }}</td>
                            <td>
                              <span class="tag {{ toneOf(enrollmentTone, e.status) }}">{{
                                $any(enrollmentLabels)[e.status] ?? e.status
                              }}</span>
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                } @else {
                  <p class="empty">Sin inscripciones administrativas registradas.</p>
                }
              }

              @case ('tutores') {
                <div class="record-bar">
                  <div class="actions">
                    @if (r.tutors.length && !hasPrimary(r.tutors)) {
                      <span class="tag warn">Sin contacto principal.</span>
                    }
                    <span class="muted">
                      {{ r.tutors.length }}
                      {{ r.tutors.length === 1 ? 'tutor vinculado' : 'tutores vinculados' }}
                    </span>
                  </div>
                  @if (auth.can('tutores.consultar')) {
                    <a class="button secondary sm" routerLink="/admin/tutors"
                      >Administrar en Tutores</a
                    >
                  }
                </div>

                @if (r.tutors.length) {
                  <ul class="tutor-cards">
                    @for (t of r.tutors; track t.tutorId) {
                      <li class="panel tutor-card" [class.primary-tutor]="t.isPrimary">
                        <div class="tutor-card-head">
                          <div>
                            <strong>{{ t.name }}</strong>
                            <span class="muted"> · {{ t.relationship }}</span>
                          </div>
                          @if (t.isPrimary) {
                            <span class="tag ok">Contacto principal</span>
                          } @else if (auth.can('tutores.editar')) {
                            <button
                              type="button"
                              class="secondary sm"
                              [disabled]="submission.busy()"
                              (click)="makePrimary(t.tutorId)"
                            >
                              Hacer contacto principal
                            </button>
                          }
                        </div>
                        <div class="tutor-card-contact">
                          <span class="tabular">{{ t.phone ?? 'Sin teléfono' }}</span>
                          <span class="muted">·</span>
                          <span>{{ t.email ?? 'Sin correo' }}</span>
                        </div>
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="empty">Sin tutores. Regístralos en Tutores.</p>
                }
              }

              @case ('categorias') {
                @if (auth.can('inscripciones.crear') && r.player.status === 'ACTIVO') {
                  <form
                    class="grid-form"
                    (ngSubmit)="saveCategory(r.categories[0] && !r.categories[0].endDate)"
                    novalidate
                  >
                    <h2>
                      {{
                        r.categories[0] && !r.categories[0].endDate
                          ? 'Cambiar de categoría'
                          : 'Inscribir a categoría'
                      }}
                    </h2>
                    <label
                      >Categoría
                      <select
                        name="cat"
                        [ngModel]="catId()"
                        (ngModelChange)="catId.set(idOrNull($event))"
                      >
                        <option [ngValue]="null">Selecciona…</option>
                        @for (c of categories.value() ?? []; track c.id) {
                          <option [ngValue]="c.id">
                            {{ c.name }} ({{ c.minAge }}–{{ c.maxAge }} años) · {{ c.occupancy }}/{{
                              c.maxCapacity ?? '∞'
                            }}
                          </option>
                        }
                      </select>
                    </label>
                    <label
                      >Fecha de inicio
                      <input
                        type="date"
                        name="date"
                        [ngModel]="catDate()"
                        (ngModelChange)="catDate.set($event)"
                    /></label>
                    @if (eligibility.value(); as e) {
                      @if (!e.ageOk) {
                        <p class="alert error">
                          Edad {{ e.age }}: fuera del rango de la categoría. Requiere excepción
                          autorizada.
                        </p>
                      }
                      @if (e.full) {
                        <p class="alert error">
                          Cupo lleno ({{ e.occupancy }}/{{ e.capacity }}). Requiere excepción
                          autorizada.
                        </p>
                      } @else if (e.capacity !== null && e.occupancy + 1 >= e.capacity) {
                        <p class="alert info">
                          Con este jugador la categoría llega a su cupo ({{ e.occupancy + 1 }}/{{
                            e.capacity
                          }}).
                        </p>
                      }
                    }
                    @if (r.categories[0] && !r.categories[0].endDate) {
                      <label
                        >Motivo del cambio <input name="reason" [(ngModel)]="catReason"
                      /></label>
                    }
                    <label
                      >Motivo de excepción (sólo si aplica)
                      <input name="exception" [(ngModel)]="catException"
                    /></label>
                    <button type="submit" [disabled]="submission.busy() || !catId()">
                      {{ submission.busy() ? 'Guardando…' : 'Guardar' }}
                    </button>
                  </form>
                }

                <h2>Historial de categorías</h2>
                @if (r.categories.length) {
                  <div class="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Categoría</th>
                          <th>Temporada</th>
                          <th>Desde</th>
                          <th>Hasta</th>
                          <th>Excepción</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (c of r.categories; track c.id) {
                          <tr>
                            <td>{{ c.categoryName }}</td>
                            <td>{{ c.seasonName ?? '—' }}</td>
                            <td class="tabular">{{ c.startDate }}</td>
                            <td>
                              @if (c.endDate) {
                                <span class="tabular">{{ c.endDate }}</span>
                              } @else {
                                <span class="tag ok">Vigente</span>
                              }
                            </td>
                            <td>{{ c.exceptionReason ?? (c.isAgeException ? 'Edad' : '—') }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                } @else {
                  <p class="empty">El jugador aún no tiene historial de categorías.</p>
                }

                @if (r.categoryChanges.length) {
                  <h2>Cambios registrados</h2>
                  <ul class="cards-list">
                    @for (h of r.categoryChanges; track $index) {
                      <li class="card-row">
                        <span>
                          <strong>{{ h.from ?? '—' }} → {{ h.to }}</strong>
                          <span class="muted"> · {{ h.reason ?? 'sin motivo' }}</span>
                        </span>
                        <small class="muted">{{ h.changedAt | date: 'd MMM y' }}</small>
                      </li>
                    }
                  </ul>
                }
              }

              @case ('pagos') {
                <div class="record-bar">
                  <span class="muted">
                    Cargos registrados:
                    <strong class="tabular">{{ r.charges.length }}</strong> · Pagos aplicados:
                    <strong class="tabular">{{ r.payments.length }}</strong>
                  </span>
                  @if (auth.can('pagos.crear')) {
                    <a
                      class="button sm"
                      [class.secondary]="r.balanceCents === 0"
                      routerLink="/admin/billing/payments/new"
                      [queryParams]="{ player: r.player.id }"
                      >Registrar pago</a
                    >
                  }
                </div>

                <h2>Cargos y adeudos</h2>
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Cargo</th>
                        <th>Vence</th>
                        <th class="num">Importe</th>
                        <th class="num">Pagado</th>
                        <th class="num">Saldo</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (c of r.charges; track c.id) {
                        <tr>
                          <td>{{ c.label }}</td>
                          <td class="tabular">{{ c.dueDate ?? '—' }}</td>
                          <td class="num">{{ c.netCents | money }}</td>
                          <td class="num">{{ c.paidCents | money }}</td>
                          <td class="num">{{ c.balanceCents | money }}</td>
                          <td>
                            <span class="tag {{ chargeTone[c.status] }}">{{
                              chargeLabels[c.status]
                            }}</span>
                          </td>
                        </tr>
                      } @empty {
                        <tr>
                          <td colspan="6" class="muted">Sin cargos.</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>

                <h2>Historial de pagos</h2>
                @if (r.payments.length) {
                  <div class="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Folio</th>
                          <th>Fecha</th>
                          <th>Forma de pago</th>
                          <th class="num">Importe</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (p of r.payments; track p.id) {
                          <tr [class.muted]="p.status === 'CANCELADO'">
                            <td class="mono">
                              <a [routerLink]="['/admin/billing/receipts', p.id]">{{ p.folio }}</a>
                            </td>
                            <td>{{ p.paidAt | date: 'd MMM y' }}</td>
                            <td>{{ methodLabel(p.method) }}</td>
                            <td class="num">{{ p.amountCents | money }}</td>
                            <td>
                              <span class="tag {{ toneOf(paymentTone, p.status) }}">{{
                                p.status === 'CANCELADO' ? 'Cancelado' : 'Aplicado'
                              }}</span>
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                } @else {
                  <p class="empty">Sin pagos registrados.</p>
                }
              }

              @case ('uniformes') {
                @if (r.uniforms.length) {
                  <div class="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Fecha de solicitud</th>
                          <th>Artículos</th>
                          <th class="num">Total</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (u of r.uniforms; track u.id) {
                          <tr>
                            <td class="tabular">{{ u.requestedOn }}</td>
                            <td class="wrap">{{ u.items.join(', ') }}</td>
                            <td class="num">{{ u.totalCents | money }}</td>
                            <td>
                              <span class="tag {{ toneOf(orderTone, u.status) }}">{{
                                $any(orderLabels)[u.status] ?? u.status
                              }}</span>
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                } @else {
                  <p class="empty">Sin pedidos de uniforme registrados.</p>
                }
              }

              @case ('competencias') {
                @if (r.competitions.length) {
                  <div class="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Competencia</th>
                          <th>Tipo</th>
                          <th>Categoría</th>
                          <th>Ingreso</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (c of r.competitions; track $index) {
                          <tr>
                            <td>{{ c.competitionName }}</td>
                            <td>{{ competitionTypeLabel(c.type) }}</td>
                            <td>{{ c.categoryName }}</td>
                            <td class="tabular">{{ c.joinedOn }}</td>
                            <td>
                              @if (c.active) {
                                <span class="tag ok">Activa</span>
                              } @else {
                                <span class="tag neutral">Baja {{ c.leftOn }}</span>
                              }
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                } @else {
                  <p class="empty">No participa en competencias.</p>
                }
              }

              @case ('estatus') {
                @if (auth.can('jugadores.editar')) {
                  <form
                    class="grid-form"
                    (ngSubmit)="changeStatus(r.name, r.player.status)"
                    novalidate
                  >
                    <h2>Cambiar estatus</h2>
                    <label
                      >Nuevo estatus
                      <select name="status" [(ngModel)]="newStatus">
                        @for (s of statuses; track s[0]) {
                          <option [value]="s[0]" [disabled]="s[0] === r.player.status">
                            {{ s[1] }}
                          </option>
                        }
                      </select>
                    </label>
                    <label>Motivo <input name="statusReason" [(ngModel)]="statusReason" /></label>
                    <p class="field-hint">
                      La baja no borra historial: pagos, partidos y categorías se conservan.
                    </p>
                    <button type="submit" [disabled]="submission.busy()">
                      {{ submission.busy() ? 'Actualizando…' : 'Cambiar estatus' }}
                    </button>
                  </form>
                }

                <h2>Historial de estatus</h2>
                @if (r.statusHistory.length) {
                  <div class="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Transición</th>
                          <th>Motivo</th>
                          <th>Registrado por</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (h of r.statusHistory; track h.id) {
                          <tr>
                            <td>{{ h.changedAt | date: 'd MMM y, HH:mm' }}</td>
                            <td>
                              {{ h.previousStatus ? statusLabels[h.previousStatus] : '—' }} →
                              <span class="tag {{ playerTone[h.newStatus] }}">{{
                                statusLabels[h.newStatus]
                              }}</span>
                            </td>
                            <td class="wrap">{{ h.reason ?? '—' }}</td>
                            <td>{{ h.changedByEmail ?? '—' }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                } @else {
                  <p class="empty">Sin cambios de estatus registrados.</p>
                }
              }
            }
          </div>
        }
      </ng-template></app-load-state
    >
  `,
})
export class PlayerRecordPage {
  readonly id = input.required<Id, unknown>({ transform: numberAttribute });
  private service = inject(PlayerService);
  private membership = inject(PlayerCategoryService);
  private categoryService = inject(CategoryService);
  private tutors = inject(TutorService);
  protected auth = inject(AuthService);
  protected idOrNull = idOrNull;
  protected statusLabels = STATUS_LABELS;
  protected sexLabels = SEX_LABELS;
  protected chargeLabels = CHARGE_STATUS_LABELS;
  protected enrollmentLabels = ENROLLMENT_LABELS;
  protected orderLabels = ORDER_STATUS_LABELS;
  protected playerTone = PLAYER_TONE;
  protected chargeTone = CHARGE_TONE;
  protected paymentTone = PAYMENT_TONE;
  protected orderTone = ORDER_TONE;
  protected enrollmentTone = ENROLLMENT_TONE;
  protected toneOf = toneOf;
  protected statuses = STATUSES;
  protected tabs: [Tab, string][] = [
    ['datos', 'Datos'],
    ['tutores', 'Tutores'],
    ['categorias', 'Categorías'],
    ['pagos', 'Pagos y adeudos'],
    ['uniformes', 'Uniformes'],
    ['competencias', 'Competencias'],
    ['estatus', 'Estatus'],
  ];
  protected tab = signal<Tab>('datos');
  protected submission = new Submission();
  protected record = resource({
    params: () => this.id(),
    loader: ({ params }) => this.service.record(params),
  });
  protected categories = resource({
    loader: () => this.categoryService.list({ onlyActive: true }),
  });
  protected catId = signal<Id | null>(null);
  protected catDate = signal(today());
  protected catReason = '';
  protected catException = '';
  protected newStatus: PlayerStatus = 'BAJA_TEMPORAL';
  protected statusReason = '';
  protected eligibility = resource({
    params: () => (this.catId() ? { categoryId: this.catId()!, date: this.catDate() } : undefined),
    loader: ({ params }) => this.membership.eligibility(this.id(), params.categoryId, params.date),
  });

  async saveCategory(change: boolean | undefined): Promise<void> {
    const draft = {
      playerId: this.id(),
      categoryId: this.catId()!,
      date: this.catDate(),
      exceptionReason: this.catException || null,
    };
    const ok = await this.submission.run(
      () =>
        change
          ? this.membership.change({ ...draft, reason: this.catReason })
          : this.membership.assign(draft),
      change
        ? 'Cambio de categoría registrado; el historial se conserva.'
        : 'Jugador inscrito a la categoría.',
    );
    if (ok) {
      this.catId.set(null);
      this.catReason = this.catException = '';
      this.record.reload();
      this.categories.reload();
    }
  }

  async changeStatus(name: string, current: PlayerStatus): Promise<void> {
    if (this.newStatus === current) return;
    if (!confirm(`¿Cambiar el estatus de ${name} a «${STATUS_LABELS[this.newStatus]}»?`)) return;
    if (
      await this.submission.run(
        () => this.service.changeStatus(this.id(), this.newStatus, this.statusReason),
        'Estatus actualizado.',
      )
    ) {
      this.statusReason = '';
      this.record.reload();
    }
  }

  protected hasPrimary(tutors: { isPrimary: boolean }[]): boolean {
    return tutors.some((t) => t.isPrimary);
  }

  protected primaryTutor<T extends { isPrimary: boolean }>(tutors: T[]): T | null {
    return tutors.find((t) => t.isPrimary) ?? null;
  }

  protected methodLabel(method: string): string {
    return METHOD_LABELS[method as PaymentMethod] ?? method;
  }

  protected competitionTypeLabel(type: string): string {
    return TYPE_LABELS[type as CompetitionType] ?? type;
  }

  protected contactSummary(phone: string | null, email: string | null): string {
    return [phone, email].filter(Boolean).join(' · ');
  }

  /** HU-011: one operation replaces the current primary contact (TutorService.setPrimary). */
  async makePrimary(tutorId: Id): Promise<void> {
    if (
      await this.submission.run(
        () => this.tutors.setPrimary(this.id(), tutorId),
        'Contacto principal actualizado.',
      )
    )
      this.record.reload();
  }
}

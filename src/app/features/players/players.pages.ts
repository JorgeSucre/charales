import {
  Component,
  computed,
  effect,
  inject,
  input,
  numberAttribute,
  resource,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  FormBuilder,
  FormControl,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Id, PlayerStatus, Sex } from '../../core/models';
import { CategoryService } from '../../core/services/category.service';
import {
  PlayerDraft,
  PlayerService,
  SEX_LABELS,
  STATUS_LABELS,
} from '../../core/services/player.service';
import { ageOn, today } from '../../shared/dates';
import { FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { Submission } from '../../shared/submission';
import { Paginator, SubmissionAlert, idOrNull } from '../../shared/ui';
import { PHONE_PATTERN } from '../../shared/validate';
import { CHARGE_STATUS_LABELS } from '../billing/billing.service';
import { PlayerCategoryService } from '../enrollments/player-category.service';

const STATUSES = Object.entries(STATUS_LABELS) as [PlayerStatus, string][];

/** HU-014: partial search by name, combinable filters (category, status), pagination, link to the record. */
@Component({
  selector: 'app-players-page',
  imports: [FormsModule, RouterLink, LoadState, Paginator],
  template: `
    <div class="page-head">
      <h1>Jugadores</h1>
      @if (auth.can('jugadores.crear')) {
        <a class="button" routerLink="/admin/players/new">Registrar jugador</a>
      }
    </div>
    <div class="filters">
      <label
        >Nombre o identificador
        <input type="search" [ngModel]="query()" (ngModelChange)="query.set($event); page.set(1)" />
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
    </div>
    <app-load-state [res]="result" emptyText="Sin resultados."
      ><ng-template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Identificador</th>
                <th>Nombre</th>
                <th class="num">Edad</th>
                <th>Categoría</th>
                <th>Estatus</th>
              </tr>
            </thead>
            <tbody>
              @for (r of result.value()?.items ?? []; track r.player.id) {
                <tr>
                  <td>{{ r.player.identifier }}</td>
                  <td>
                    <a [routerLink]="['/admin/players', r.player.id]">{{ r.name }}</a>
                  </td>
                  <td class="num">{{ r.age }}</td>
                  <td>{{ r.categoryName ?? '—' }}</td>
                  <td>
                    <span class="tag" [class.off]="r.player.status !== 'ACTIVO'">{{
                      labels[r.player.status]
                    }}</span>
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
  protected statuses = STATUSES;
  protected categories = resource({ loader: () => this.categoryService.list() });
  protected query = signal('');
  protected categoryId = signal<Id | null>(null);
  protected status = signal<PlayerStatus | ''>('');
  protected page = signal(1);
  protected result = resource({
    params: () => ({
      query: this.query(),
      categoryId: this.categoryId(),
      status: this.status(),
      page: this.page(),
    }),
    loader: ({ params }) => this.service.search(params),
  });
}

/** HU-008 (create, with generated identifier and age) and HU-009 (edit keeping id/identifier). */
@Component({
  selector: 'app-player-form-page',
  imports: [ReactiveFormsModule, RouterLink, FieldError, SubmissionAlert],
  template: `
    <a [routerLink]="id() ? ['/admin/players', id()] : '/admin/players'">← Volver</a>
    <h1>{{ id() ? 'Editar jugador' : 'Registrar jugador' }}</h1>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="grid-form">
      <label>Nombre(s) <input formControlName="firstName" autocomplete="off" /></label>
      <app-field-error [control]="form.controls.firstName" />
      <div class="two-col">
        <label>Apellido paterno <input formControlName="lastName1" autocomplete="off" /></label>
        <label>Apellido materno <input formControlName="lastName2" autocomplete="off" /></label>
      </div>
      <app-field-error [control]="form.controls.lastName1" />
      <div class="two-col">
        <label
          >Fecha de nacimiento <input type="date" formControlName="birthDate" [max]="maxDate"
        /></label>
        <label
          >Sexo (opcional)
          <select formControlName="sex">
            @for (s of sexes; track s[0]) {
              <option [value]="s[0]">{{ s[1] }}</option>
            }
          </select>
        </label>
      </div>
      <app-field-error [control]="form.controls.birthDate" />
      @if (age() !== null) {
        <p class="muted">Edad: {{ age() }} años</p>
      }
      <div class="two-col">
        <label
          >Teléfono del jugador <input type="tel" formControlName="phone" autocomplete="off"
        /></label>
        <label
          >Correo del jugador <input type="email" formControlName="email" autocomplete="off"
        /></label>
      </div>
      <app-field-error [control]="form.controls.phone" />
      <app-field-error [control]="form.controls.email" />
      <label>Dirección <input formControlName="address" autocomplete="off" /></label>
      @if (!id()) {
        <label
          >Estatus inicial
          <select [formControl]="initialStatus">
            @for (s of statuses; track s[0]) {
              <option [value]="s[0]">{{ s[1] }}</option>
            }
          </select>
        </label>
      }
      <p class="muted">El contacto de la familia se registra en Tutores.</p>
      <app-submission-alert [submission]="submission" />
      <button type="submit" [disabled]="submission.busy() || (!!id() && player.isLoading())">
        Guardar
      </button>
    </form>
  `,
})
export class PlayerFormPage {
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
    firstName: ['', [Validators.required, Validators.maxLength(100)]],
    lastName1: ['', [Validators.required, Validators.maxLength(100)]],
    lastName2: [''],
    birthDate: ['', Validators.required],
    sex: ['NO_ESPECIFICADO' as Sex],
    phone: ['', Validators.pattern(PHONE_PATTERN)],
    email: ['', Validators.email],
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
    if (this.form.invalid) return this.form.markAllAsTouched();
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
    <a routerLink="/admin/players">← Jugadores</a>
    <app-load-state [res]="record"
      ><ng-template>
        @if (record.value(); as r) {
          <div class="page-head">
            <h1>
              {{ r.name }} <span class="muted">{{ r.player.identifier }}</span>
            </h1>
            @if (auth.can('jugadores.editar')) {
              <a class="button secondary" [routerLink]="['/admin/players', r.player.id, 'edit']"
                >Editar datos</a
              >
            }
          </div>
          <p>
            <span class="tag" [class.off]="r.player.status !== 'ACTIVO'">{{
              statusLabels[r.player.status]
            }}</span>
            · {{ r.age }} años · Categoría:
            <strong>{{
              r.categories[0] && !r.categories[0].endDate
                ? r.categories[0].categoryName
                : 'sin categoría'
            }}</strong>
            · Saldo: <strong>{{ r.balanceCents | money }}</strong>
            @if (r.overdueCents) {
              <span class="tag off">Vencido {{ r.overdueCents | money }}</span>
            }
          </p>
          <app-submission-alert [submission]="submission" />

          <div class="tabs" role="tablist">
            @for (t of tabs; track t[0]) {
              <button
                type="button"
                role="tab"
                [attr.aria-selected]="tab() === t[0]"
                [class.active]="tab() === t[0]"
                (click)="tab.set(t[0])"
              >
                {{ t[1] }}
              </button>
            }
          </div>

          @switch (tab()) {
            @case ('datos') {
              <dl class="facts">
                <dt>Fecha de nacimiento</dt>
                <dd>{{ r.player.birthDate }}</dd>
                <dt>Sexo</dt>
                <dd>{{ sexLabels[r.player.sex] }}</dd>
                <dt>Teléfono</dt>
                <dd>{{ r.player.phone ?? '—' }}</dd>
                <dt>Correo</dt>
                <dd>{{ r.player.email ?? '—' }}</dd>
                <dt>Dirección</dt>
                <dd>{{ r.player.address ?? '—' }}</dd>
                <dt>Alta</dt>
                <dd>{{ r.player.createdAt | date: 'd MMM y' }}</dd>
                <dt>Última modificación</dt>
                <dd>{{ r.player.updatedAt | date: 'd MMM y, HH:mm' }}</dd>
                <dt>Asistencia</dt>
                <dd>
                  {{ r.attendance.present }} presentes · {{ r.attendance.absent }} ausencias ·
                  {{ r.attendance.justified }} justificadas
                </dd>
              </dl>
              <h2>Inscripción administrativa</h2>
              <ul>
                @for (e of r.enrollments; track e.id) {
                  <li>
                    {{ e.seasonName }} — {{ e.status }} desde {{ e.enrolledOn }} ({{
                      e.amountCents | money
                    }})
                  </li>
                } @empty {
                  <li class="muted">Sin inscripciones.</li>
                }
              </ul>
            }
            @case ('tutores') {
              <ul class="list">
                @for (t of r.tutors; track t.tutorId) {
                  <li>
                    <strong>{{ t.name }}</strong> ({{ t.relationship }})
                    @if (t.isPrimary) {
                      <span class="tag">Contacto principal</span>
                    }
                    <br /><span class="muted">{{ t.phone ?? '' }} {{ t.email ?? '' }}</span>
                  </li>
                } @empty {
                  <li class="muted">Sin tutores. Regístralos en Tutores.</li>
                }
              </ul>
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
                    <label>Motivo del cambio <input name="reason" [(ngModel)]="catReason" /></label>
                  }
                  <label
                    >Motivo de excepción (sólo si aplica)
                    <input name="exception" [(ngModel)]="catException"
                  /></label>
                  <button type="submit" [disabled]="submission.busy() || !catId()">Guardar</button>
                </form>
              }
              <h2>Historial de categorías</h2>
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
                        <td>{{ c.startDate }}</td>
                        <td>{{ c.endDate ?? 'vigente' }}</td>
                        <td>{{ c.exceptionReason ?? (c.isAgeException ? 'Edad' : '—') }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <ul class="muted">
                @for (h of r.categoryChanges; track $index) {
                  <li>
                    {{ h.changedAt | date: 'd MMM y' }}: {{ h.from ?? '—' }} → {{ h.to }} ({{
                      h.reason ?? 'sin motivo'
                    }})
                  </li>
                }
              </ul>
            }
            @case ('pagos') {
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
                        <td>{{ c.dueDate ?? '—' }}</td>
                        <td class="num">{{ c.netCents | money }}</td>
                        <td class="num">{{ c.paidCents | money }}</td>
                        <td class="num">{{ c.balanceCents | money }}</td>
                        <td>
                          <span class="tag" [class.off]="c.status === 'VENCIDO'">{{
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
              <h2>Pagos</h2>
              <ul>
                @for (p of r.payments; track p.id) {
                  <li>
                    <a [routerLink]="['/admin/billing/receipts', p.id]">{{ p.folio }}</a> ·
                    {{ p.paidAt | date: 'd MMM y' }} ·
                    {{ p.amountCents | money }}
                    @if (p.status === 'CANCELADO') {
                      <span class="tag off">Cancelado</span>
                    }
                  </li>
                } @empty {
                  <li class="muted">Sin pagos.</li>
                }
              </ul>
            }
            @case ('uniformes') {
              <ul>
                @for (u of r.uniforms; track u.id) {
                  <li>
                    {{ u.requestedOn }} · {{ u.items.join(', ') }} · {{ u.totalCents | money }} ·
                    {{ u.status }}
                  </li>
                } @empty {
                  <li class="muted">Sin pedidos.</li>
                }
              </ul>
            }
            @case ('competencias') {
              <ul>
                @for (c of r.competitions; track $index) {
                  <li>
                    {{ c.competitionName }} ({{ c.type }}) · {{ c.categoryName }} · desde
                    {{ c.joinedOn }}
                    @if (!c.active) {
                      <span class="tag off">Baja {{ c.leftOn }}</span>
                    }
                  </li>
                } @empty {
                  <li class="muted">No participa en competencias.</li>
                }
              </ul>
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
                  <p class="muted">
                    La baja no borra historial: pagos, partidos y categorías se conservan.
                  </p>
                  <button type="submit" [disabled]="submission.busy()">Cambiar estatus</button>
                </form>
              }
              <ul>
                @for (h of r.statusHistory; track h.id) {
                  <li>
                    {{ h.changedAt | date: 'd MMM y, HH:mm' }}:
                    {{ h.previousStatus ? statusLabels[h.previousStatus] : '—' }} →
                    {{ statusLabels[h.newStatus] }} · {{ h.reason ?? '' }}
                    <span class="muted">{{ h.changedByEmail ?? '' }}</span>
                  </li>
                }
              </ul>
            }
          }
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
  protected auth = inject(AuthService);
  protected idOrNull = idOrNull;
  protected statusLabels = STATUS_LABELS;
  protected sexLabels = SEX_LABELS;
  protected chargeLabels = CHARGE_STATUS_LABELS;
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
}

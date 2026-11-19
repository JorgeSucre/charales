import { ChangeDetectionStrategy, Component, inject, input, numberAttribute, resource, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Id } from '../../core/models';
import { CategoryService, CategoryView } from '../../core/services/category.service';
import { WEEKDAYS } from '../../shared/dates';
import { catalogNameValidator } from '../../shared/validate';
import { FormPanel } from '../../shared/form-panel';
import { focusFirstInvalid } from '../../shared/focus';
import { FieldA11y, FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { Submission } from '../../shared/submission';
import { SubmissionAlert, idOrNull } from '../../shared/ui';
import { SeasonService } from '../seasons/season.service';
import { ScheduleService } from '../trainings/schedule.service';
import { VenueService } from '../venues/venue.service';

/** HU-015 (categories: name per season, age range, status) + HU-021 (capacity and occupancy). */
@Component({
  selector: 'app-categories-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    FieldError,
    FieldA11y,
    LoadState,
    SubmissionAlert,
  ],
  template: `
    <div class="page-head">
      <div>
        <h1>Categorías</h1>
        <p class="page-subtitle">
          Grupos por rango de edad y temporada, ocupación actual y horarios de entrenamiento.
        </p>
      </div>
      @if (auth.can('categorias.crear')) {
        <button
          type="button"
          (click)="create()"
          [attr.aria-expanded]="panel.open() && !editingId()"
          aria-controls="category-form"
        >
          Nueva categoría
        </button>
      }
    </div>
    <app-submission-alert [submission]="submission" />
    @if (panel.open()) {
      <form
        id="category-form"
        [formGroup]="form"
        (ngSubmit)="submit()"
        novalidate
        class="grid-form"
        (keydown.escape)="cancel()"
      >
        <h2>{{ editingId() ? 'Editar categoría' : 'Nueva categoría' }}</h2>
        <p class="field-hint">
          Los campos con <span class="req" aria-hidden="true">*</span> son obligatorios.
        </p>
        <div class="two-col">
          <label
            >Temporada
            <select formControlName="seasonId">
              <option [ngValue]="null">Sin temporada</option>
              @for (s of seasons.value() ?? []; track s.id) {
                <option [ngValue]="s.id">{{ s.name }}</option>
              }
            </select>
          </label>
          <div>
            <label
              ><span
                >Nombre <span class="req" aria-hidden="true">*</span
                ><span class="sr-only"> (obligatorio)</span></span
              >
              <input formControlName="name" placeholder="Sub-10"
            /></label>
            <app-field-error [control]="form.controls.name" />
          </div>
        </div>
        <div class="two-col">
          <div>
            <label
              ><span
                >Edad mínima <span class="req" aria-hidden="true">*</span
                ><span class="sr-only"> (obligatorio)</span></span
              >
              <input type="number" min="0" max="99" formControlName="minAge"
            /></label>
            <app-field-error [control]="form.controls.minAge" />
          </div>
          <div>
            <label
              ><span
                >Edad máxima <span class="req" aria-hidden="true">*</span
                ><span class="sr-only"> (obligatorio)</span></span
              >
              <input type="number" min="0" max="99" formControlName="maxAge"
            /></label>
            <app-field-error [control]="form.controls.maxAge" />
          </div>
        </div>
        <label
          >Cupo máximo (vacío = sin límite)
          <input type="number" min="1" formControlName="maxCapacity"
        /></label>
        <div class="actions">
          <button type="submit" [disabled]="submission.busy()">
            {{ submission.busy() ? 'Guardando…' : 'Guardar' }}
          </button>
          <button type="button" class="secondary" (click)="cancel()">Cancelar</button>
        </div>
      </form>
    }
    <div class="filters">
      <label
        >Temporada
        <select [ngModel]="seasonId()" (ngModelChange)="seasonId.set(idOrNull($event))">
          <option [ngValue]="null">Todas</option>
          @for (s of seasons.value() ?? []; track s.id) {
            <option [ngValue]="s.id">{{ s.name }}</option>
          }
        </select>
      </label>
      @if (seasonId() !== null) {
        <button type="button" class="secondary sm" (click)="seasonId.set(null)">
          Limpiar filtro
        </button>
      }
    </div>
    <app-load-state [res]="categories" emptyText="Sin categorías registradas."
      ><ng-template>
        <div class="list-meta">
          <p class="muted">
            Mostrando <strong class="tabular">{{ (categories.value() ?? []).length }}</strong>
            {{ (categories.value() ?? []).length === 1 ? 'categoría' : 'categorías' }}
          </p>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Categoría</th>
                <th>Temporada</th>
                <th>Edades</th>
                <th class="num">Ocupación</th>
                <th>Estado</th>
                <th><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (c of categories.value() ?? []; track c.id) {
                <tr [class.muted]="!c.active">
                  <td>
                    <a [routerLink]="['/sports/categories', c.id]"
                      ><strong>{{ c.name }}</strong></a
                    >
                  </td>
                  <td>{{ c.seasonName ?? '—' }}</td>
                  <td class="tabular">{{ c.minAge }}–{{ c.maxAge }} años</td>
                  <td class="num">
                    <span class="tabular">{{ c.occupancy }} / {{ c.maxCapacity ?? '∞' }}</span>
                    @if (c.full) {
                      <span class="tag danger">Lleno</span>
                    }
                  </td>
                  <td>
                    <span class="tag" [class.ok]="c.active" [class.off]="!c.active">{{
                      c.active ? 'Activa' : 'Inactiva'
                    }}</span>
                  </td>
                  <td class="row-actions">
                    @if (auth.can('categorias.editar')) {
                      <button type="button" class="link" (click)="edit(c)">Editar</button>
                      <button
                        type="button"
                        class="link"
                        [class.danger]="c.active"
                        (click)="toggle(c)"
                      >
                        {{ c.active ? 'Desactivar' : 'Activar' }}
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
export class CategoriesPage {
  private service = inject(CategoryService);
  private seasonService = inject(SeasonService);
  protected auth = inject(AuthService);
  protected idOrNull = idOrNull;
  protected seasons = resource({ loader: () => this.seasonService.list() });
  protected seasonId = signal<Id | null>(null);
  protected categories = resource({
    params: () => this.seasonId(),
    loader: ({ params }) => this.service.list({ seasonId: params }),
  });
  protected submission = new Submission();
  protected editingId = signal<Id | null>(null);
  protected form = inject(FormBuilder).group({
    seasonId: [null as Id | null],
    name: ['', [Validators.required, catalogNameValidator]],
    minAge: [8, [Validators.required, Validators.min(0)]],
    maxAge: [10, [Validators.required, Validators.min(0)]],
    maxCapacity: [null as number | null, Validators.min(1)],
  });

  protected panel = new FormPanel('category-form', () => this.form.dirty);

  edit(c: CategoryView): void {
    if (!this.panel.close()) return;
    this.reset();
    this.submission.result.set(null);
    this.editingId.set(c.id);
    this.form.setValue({
      seasonId: c.seasonId,
      name: c.name,
      minAge: c.minAge,
      maxAge: c.maxAge,
      maxCapacity: c.maxCapacity,
    });
    this.form.markAsPristine();
    this.panel.show();
  }

  /** Opens an empty form (asks first if the open one has unsaved changes). */
  create(): void {
    if (!this.panel.close()) return;
    this.reset();
    this.submission.result.set(null);
    this.panel.show();
  }

  /** Closes the form without saving (asks first if it has unsaved changes); the record is untouched. */
  cancel(): void {
    if (this.panel.close()) this.reset();
  }

  private reset(): void {
    this.editingId.set(null);
    this.form.reset({ seasonId: null, name: '', minAge: 8, maxAge: 10, maxCapacity: null });
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      setTimeout(() => focusFirstInvalid(document.getElementById('category-form')!));
      return;
    }
    const v = this.form.getRawValue();
    const draft = {
      id: this.editingId() ?? undefined,
      seasonId: v.seasonId,
      name: v.name ?? '',
      minAge: Number(v.minAge),
      maxAge: Number(v.maxAge),
      maxCapacity:
        v.maxCapacity === null || (v.maxCapacity as unknown) === '' ? null : Number(v.maxCapacity),
    };
    if (await this.submission.run(() => this.service.save(draft), 'Categoría guardada.')) {
      this.panel.done();
      this.reset();
      this.categories.reload();
    }
  }

  async toggle(c: CategoryView): Promise<void> {
    await this.submission.run(() => this.service.setActive(c.id, !c.active), 'Estado actualizado.');
    this.categories.reload();
  }
}

/** HU-018 (members with age, primary tutor, total), HU-016 (weekly schedules) and assigned coaches of one category. */
@Component({
  selector: 'app-category-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, LoadState, SubmissionAlert],
  template: `
    <a class="back-link" routerLink="/sports/categories">← Categorías</a>
    <app-load-state [res]="category"
      ><ng-template>
        @if (category.value(); as c) {
          <div class="page-head">
            <div>
              <h1>
                {{ c.name }} <span class="muted">{{ c.seasonName ?? '' }}</span>
              </h1>
              <p class="page-subtitle">
                <span class="tabular">{{ c.minAge }}–{{ c.maxAge }} años</span> · Ocupación
                <strong class="tabular">{{ c.occupancy }} / {{ c.maxCapacity ?? '∞' }}</strong>
                @if (c.full) {
                  <span class="tag danger">Cupo lleno</span>
                }
              </p>
            </div>
          </div>

          <h2>Jugadores activos ({{ members.value()?.length ?? 0 }})</h2>
          <div class="filters">
            <label class="filter-grow"
              >Buscar jugador
              <input
                type="search"
                placeholder="Nombre del jugador…"
                [ngModel]="query()"
                (ngModelChange)="query.set($event)"
            /></label>
            @if (query().trim()) {
              <button type="button" class="secondary sm" (click)="query.set('')">Limpiar</button>
            }
          </div>
          <app-load-state [res]="members" emptyText="Sin jugadores activos."
            ><ng-template>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Jugador</th>
                      <th class="num">Edad</th>
                      <th>Desde</th>
                      <th>Tutor principal</th>
                      <th>Contacto</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (m of members.value() ?? []; track m.playerId) {
                      <tr>
                        <td>
                          <a [routerLink]="['/admin/players', m.playerId]"
                            ><strong>{{ m.name }}</strong></a
                          >
                          @if (m.isAgeException) {
                            <span class="tag warn">Excepción</span>
                          }
                        </td>
                        <td class="num">{{ m.age }}</td>
                        <td class="tabular">{{ m.since }}</td>
                        <td>{{ m.primaryTutor ?? '—' }}</td>
                        <td class="tabular">{{ m.primaryPhone ?? '—' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </ng-template></app-load-state
          >

          <section class="panel">
            <h2>Entrenadores asignados</h2>
            <ul class="list clean-list">
              @for (co of coaches.value() ?? []; track co.coachId) {
                <li class="portal-row-item">
                  <strong>{{ co.name }}</strong>
                  <span class="muted"
                    >{{ co.responsibility ?? 'Sin rol específico' }} · desde {{ co.since }}</span
                  >
                </li>
              } @empty {
                <li class="muted">Sin entrenadores asignados.</li>
              }
            </ul>
          </section>

          <div class="page-head">
            <h2>Horarios de entrenamiento</h2>
            @if (auth.can('categorias.editar')) {
              <button
                type="button"
                class="secondary"
                (click)="openSchedule()"
                [attr.aria-expanded]="panel.open()"
                aria-controls="schedule-form"
              >
                Agregar horario
              </button>
            }
          </div>
          <app-submission-alert [submission]="submission" />
          @if (panel.open()) {
            <form
              id="schedule-form"
              class="grid-form"
              (ngSubmit)="addSchedule(c.id)"
              (keydown.escape)="closeSchedule()"
              novalidate
            >
              <div class="two-col">
                <label
                  >Día
                  <select name="day" [(ngModel)]="weekday">
                    @for (d of days; track d[0]) {
                      <option [ngValue]="d[0]">{{ d[1] }}</option>
                    }
                  </select>
                </label>
                <label
                  ><span
                    >Sede <span class="req" aria-hidden="true">*</span
                    ><span class="sr-only"> (obligatorio)</span></span
                  >
                  <select name="venue" [(ngModel)]="venueId">
                    <option [ngValue]="null">Selecciona…</option>
                    @for (v of venues.value() ?? []; track v.id) {
                      <option [ngValue]="v.id">{{ v.name }}</option>
                    }
                  </select>
                </label>
                <label>Inicio <input type="time" name="start" [(ngModel)]="startTime" /></label>
                <label>Fin <input type="time" name="end" [(ngModel)]="endTime" /></label>
              </div>
              <div class="actions">
                <button type="submit" [disabled]="submission.busy() || !venueId">
                  {{ submission.busy() ? 'Agregando…' : 'Agregar horario' }}
                </button>
                <button type="button" class="secondary" (click)="closeSchedule()">Cancelar</button>
              </div>
            </form>
          }
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Día</th>
                  <th>Horario</th>
                  <th>Sede</th>
                  <th>Estado</th>
                  <th><span class="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                @for (s of schedules.value() ?? []; track s.id) {
                  <tr [class.muted]="!s.active">
                    <td>
                      <strong>{{ dayName(s.weekday) }}</strong>
                    </td>
                    <td class="tabular">{{ s.startTime }}–{{ s.endTime }}</td>
                    <td>{{ s.venueName }}</td>
                    <td>
                      <span class="tag" [class.ok]="s.active" [class.off]="!s.active">{{
                        s.active ? 'Activo' : 'Inactivo'
                      }}</span>
                    </td>
                    <td class="row-actions">
                      @if (auth.can('categorias.editar')) {
                        <button
                          type="button"
                          class="link"
                          [class.danger]="s.active"
                          (click)="toggleSchedule(s.id, !s.active)"
                        >
                          {{ s.active ? 'Desactivar' : 'Activar' }}
                        </button>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5" class="muted">Sin horarios registrados.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </ng-template></app-load-state
    >
  `,
})
export class CategoryDetailPage {
  readonly id = input.required<Id, unknown>({ transform: numberAttribute });
  private service = inject(CategoryService);
  private scheduleService = inject(ScheduleService);
  private venueService = inject(VenueService);
  protected auth = inject(AuthService);
  protected days = WEEKDAYS.map((d, i) => [i, d] as [number, string]).slice(1);
  protected query = signal('');
  protected category = resource({
    params: () => this.id(),
    loader: ({ params }) => this.service.get(params),
  });
  protected members = resource({
    params: () => ({ id: this.id(), q: this.query() }),
    loader: ({ params }) => this.service.members(params.id, params.q),
  });
  protected coaches = resource({
    params: () => this.id(),
    loader: ({ params }) => this.service.coaches(params),
  });
  protected schedules = resource({
    params: () => this.id(),
    loader: ({ params }) => this.scheduleService.list({ categoryIds: [params] }),
  });
  protected venues = resource({ loader: () => this.venueService.list(true) });
  protected submission = new Submission();
  protected weekday = 1;
  protected venueId: Id | null = null;
  protected startTime = '17:00';
  protected endTime = '18:30';

  dayName(n: number): string {
    return WEEKDAYS[n];
  }

  private opened = '';
  private snapshot = () =>
    JSON.stringify([this.weekday, this.venueId, this.startTime, this.endTime]);
  protected panel = new FormPanel('schedule-form', () => this.snapshot() !== this.opened);

  openSchedule(): void {
    if (!this.panel.close()) return;
    this.resetSchedule();
    this.opened = this.snapshot();
    this.submission.result.set(null);
    this.panel.show();
  }

  /** Closes the form without adding a schedule (asks first if it has unsaved changes). */
  closeSchedule(): void {
    if (this.panel.close()) this.resetSchedule();
  }

  private resetSchedule(): void {
    this.weekday = 1;
    this.venueId = null;
    this.startTime = '17:00';
    this.endTime = '18:30';
  }

  async addSchedule(categoryId: Id): Promise<void> {
    const ok = await this.submission.run(
      () =>
        this.scheduleService.save({
          categoryId,
          venueId: this.venueId!,
          weekday: this.weekday,
          startTime: this.startTime,
          endTime: this.endTime,
        }),
      'Horario agregado.',
    );
    if (ok) {
      this.panel.done();
      this.resetSchedule();
      this.schedules.reload();
    }
  }

  async toggleSchedule(id: Id, active: boolean): Promise<void> {
    await this.submission.run(
      () => this.scheduleService.setActive(id, active),
      'Horario actualizado.',
    );
    this.schedules.reload();
  }
}

import { Component, inject, input, numberAttribute, resource, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Id } from '../../core/models';
import { CategoryService, CategoryView } from '../../core/services/category.service';
import { WEEKDAYS } from '../../shared/dates';
import { FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { Submission } from '../../shared/submission';
import { SubmissionAlert, idOrNull } from '../../shared/ui';
import { SeasonService } from '../seasons/season.service';
import { ScheduleService } from '../trainings/schedule.service';
import { VenueService } from '../venues/venue.service';

/** HU-015 (categories: name per season, age range, status) + HU-021 (capacity and occupancy). */
@Component({
  selector: 'app-categories-page',
  imports: [ReactiveFormsModule, FormsModule, RouterLink, FieldError, LoadState, SubmissionAlert],
  template: `
    <h1>Categorías</h1>
    @if (auth.can('categorias.crear') || editingId()) {
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="grid-form">
        <h2>{{ editingId() ? 'Editar categoría' : 'Nueva categoría' }}</h2>
        <label
          >Temporada
          <select formControlName="seasonId">
            <option [ngValue]="null">Sin temporada</option>
            @for (s of seasons.value() ?? []; track s.id) {
              <option [ngValue]="s.id">{{ s.name }}</option>
            }
          </select>
        </label>
        <label>Nombre <input formControlName="name" placeholder="Sub-10" /></label>
        <app-field-error [control]="form.controls.name" />
        <div class="two-col">
          <label
            >Edad mínima <input type="number" min="0" max="99" formControlName="minAge"
          /></label>
          <label
            >Edad máxima <input type="number" min="0" max="99" formControlName="maxAge"
          /></label>
        </div>
        <app-field-error [control]="form.controls.minAge" />
        <label
          >Cupo máximo (vacío = sin límite)
          <input type="number" min="1" formControlName="maxCapacity"
        /></label>
        <app-submission-alert [submission]="submission" />
        <div class="actions">
          <button type="submit" [disabled]="submission.busy()">Guardar</button>
          @if (editingId()) {
            <button type="button" class="secondary" (click)="cancel()">Cancelar</button>
          }
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
    </div>
    <app-load-state [res]="categories"
      ><ng-template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Categoría</th>
                <th>Temporada</th>
                <th>Edades</th>
                <th class="num">Ocupación</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (c of categories.value() ?? []; track c.id) {
                <tr>
                  <td>
                    <a [routerLink]="['/sports/categories', c.id]">{{ c.name }}</a>
                  </td>
                  <td>{{ c.seasonName ?? '—' }}</td>
                  <td>{{ c.minAge }}–{{ c.maxAge }} años</td>
                  <td class="num">
                    {{ c.occupancy }} / {{ c.maxCapacity ?? '∞' }}
                    @if (c.full) {
                      <span class="tag off">Lleno</span>
                    }
                  </td>
                  <td>
                    <span class="tag" [class.off]="!c.active">{{
                      c.active ? 'Activa' : 'Inactiva'
                    }}</span>
                  </td>
                  <td class="row-actions">
                    @if (auth.can('categorias.editar')) {
                      <button type="button" class="link" (click)="edit(c)">Editar</button>
                      <button type="button" class="link" (click)="toggle(c)">
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
    name: ['', Validators.required],
    minAge: [8, [Validators.required, Validators.min(0)]],
    maxAge: [10, [Validators.required, Validators.min(0)]],
    maxCapacity: [null as number | null, Validators.min(1)],
  });

  edit(c: CategoryView): void {
    this.editingId.set(c.id);
    this.form.setValue({
      seasonId: c.seasonId,
      name: c.name,
      minAge: c.minAge,
      maxAge: c.maxAge,
      maxCapacity: c.maxCapacity,
    });
  }

  cancel(): void {
    this.editingId.set(null);
    this.form.reset({ seasonId: null, name: '', minAge: 8, maxAge: 10, maxCapacity: null });
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
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
      this.cancel();
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
  imports: [FormsModule, RouterLink, LoadState, SubmissionAlert],
  template: `
    <a routerLink="/sports/categories">← Categorías</a>
    <app-load-state [res]="category"
      ><ng-template>
        @if (category.value(); as c) {
          <h1>
            {{ c.name }} <span class="muted">{{ c.seasonName ?? '' }}</span>
          </h1>
          <p>
            {{ c.minAge }}–{{ c.maxAge }} años · Ocupación {{ c.occupancy }} /
            {{ c.maxCapacity ?? '∞' }}
            @if (c.full) {
              <span class="tag off">Cupo lleno</span>
            }
          </p>

          <h2>Jugadores activos ({{ members.value()?.length ?? 0 }})</h2>
          <div class="filters">
            <label
              >Buscar <input type="search" [ngModel]="query()" (ngModelChange)="query.set($event)"
            /></label>
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
                          <a [routerLink]="['/admin/players', m.playerId]">{{ m.name }}</a>
                          @if (m.isAgeException) {
                            <span class="tag">Excepción</span>
                          }
                        </td>
                        <td class="num">{{ m.age }}</td>
                        <td>{{ m.since }}</td>
                        <td>{{ m.primaryTutor ?? '—' }}</td>
                        <td>{{ m.primaryPhone ?? '—' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </ng-template></app-load-state
          >

          <h2>Entrenadores</h2>
          <ul>
            @for (co of coaches.value() ?? []; track co.coachId) {
              <li>{{ co.name }} · {{ co.responsibility ?? 'sin rol' }} · desde {{ co.since }}</li>
            } @empty {
              <li class="muted">Sin entrenadores asignados.</li>
            }
          </ul>

          <h2>Horarios de entrenamiento</h2>
          @if (auth.can('categorias.editar')) {
            <form class="grid-form" (ngSubmit)="addSchedule(c.id)" novalidate>
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
                  >Sede
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
              <app-submission-alert [submission]="submission" />
              <button type="submit" [disabled]="submission.busy() || !venueId">
                Agregar horario
              </button>
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (s of schedules.value() ?? []; track s.id) {
                  <tr>
                    <td>{{ dayName(s.weekday) }}</td>
                    <td>{{ s.startTime }}–{{ s.endTime }}</td>
                    <td>{{ s.venueName }}</td>
                    <td>
                      <span class="tag" [class.off]="!s.active">{{
                        s.active ? 'Activo' : 'Inactivo'
                      }}</span>
                    </td>
                    <td>
                      @if (auth.can('categorias.editar')) {
                        <button
                          type="button"
                          class="link"
                          (click)="toggleSchedule(s.id, !s.active)"
                        >
                          {{ s.active ? 'Desactivar' : 'Activar' }}
                        </button>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5" class="muted">Sin horarios.</td>
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
    if (ok) this.schedules.reload();
  }

  async toggleSchedule(id: Id, active: boolean): Promise<void> {
    await this.submission.run(
      () => this.scheduleService.setActive(id, active),
      'Horario actualizado.',
    );
    this.schedules.reload();
  }
}

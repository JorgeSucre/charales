import { Component, inject, resource, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Id } from '../../core/models';
import { CategoryService } from '../../core/services/category.service';
import { CompetitionService } from '../../core/services/competition.service';
import { today } from '../../shared/dates';
import { FormPanel } from '../../shared/form-panel';
import { focusFirstInvalid } from '../../shared/focus';
import { FieldA11y, FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { Submission } from '../../shared/submission';
import { SubmissionAlert, idOrNull } from '../../shared/ui';
import { emailValidator, personNameValidator, phoneValidator } from '../../shared/validate';
import { CoachService, CoachView } from './coach.service';

/** HU-022: coaches with contact, sporting status and optional login account. */
@Component({
  selector: 'app-coaches-page',
  imports: [ReactiveFormsModule, FormsModule, FieldError, FieldA11y, LoadState, SubmissionAlert],
  template: `
    <div class="page-head">
      <h1>Entrenadores</h1>
      @if (auth.can('entrenadores.crear')) {
        <button
          type="button"
          (click)="create()"
          [attr.aria-expanded]="panel.open() && !editing()"
          aria-controls="coach-form"
        >
          Registrar entrenador
        </button>
      }
    </div>
    <app-submission-alert [submission]="submission" />
    @if (panel.open()) {
      <form
        id="coach-form"
        [formGroup]="form"
        (ngSubmit)="submit()"
        novalidate
        class="grid-form"
        (keydown.escape)="cancel()"
      >
        <h2>{{ editing() ? 'Editar entrenador' : 'Registrar entrenador' }}</h2>
        <label>Nombre(s) <input formControlName="firstName" autocomplete="off" /></label>
        <app-field-error [control]="form.controls.firstName" />
        <div class="two-col">
          <div>
            <label>Apellido paterno <input formControlName="lastName1" autocomplete="off" /></label>
            <app-field-error [control]="form.controls.lastName1" />
          </div>
          <div>
            <label>Apellido materno <input formControlName="lastName2" autocomplete="off" /></label>
            <app-field-error [control]="form.controls.lastName2" />
          </div>
        </div>
        <div class="two-col">
          <div>
            <label>Teléfono <input type="tel" formControlName="phone" autocomplete="off" /></label>
            <app-field-error [control]="form.controls.phone" />
          </div>
          <div>
            <label>Correo <input type="email" formControlName="email" autocomplete="off" /></label>
            <app-field-error [control]="form.controls.email" />
          </div>
        </div>
        <div class="actions">
          <button type="submit" [disabled]="submission.busy()">Guardar</button>
          <button type="button" class="secondary" (click)="cancel()">Cancelar</button>
        </div>
      </form>
    }
    @if (panel.open() && editing(); as c) {
      <section class="grid-form">
        <h2>Cuenta de acceso</h2>
        @if (c.accountEmail) {
          <p>
            Vinculada: <strong>{{ c.accountEmail }}</strong>
          </p>
          <button type="button" class="secondary" (click)="unlink(c)">Desvincular</button>
        } @else {
          <label
            >Correo de acceso <input type="email" [(ngModel)]="accountEmail" name="accountEmail"
          /></label>
          <button type="button" (click)="link(c)" [disabled]="submission.busy()">
            Vincular cuenta
          </button>
        }
      </section>
    }
    <div class="filters">
      <label
        >Buscar <input type="search" [ngModel]="query()" (ngModelChange)="query.set($event)"
      /></label>
    </div>
    <app-load-state [res]="coaches"
      ><ng-template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Contacto</th>
                <th>Categorías vigentes</th>
                <th>Cuenta</th>
                <th>Estado</th>
                <th><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (c of coaches.value() ?? []; track c.id) {
                <tr>
                  <td>{{ c.name }}</td>
                  <td>{{ c.phone ?? '' }} {{ c.email ?? '' }}</td>
                  <td>{{ c.categories.join(', ') || '—' }}</td>
                  <td>{{ c.accountEmail ?? '—' }}</td>
                  <td>
                    <span class="tag" [class.off]="!c.active">{{
                      c.active ? 'Activo' : 'Inactivo'
                    }}</span>
                  </td>
                  <td class="row-actions">
                    @if (auth.can('entrenadores.editar')) {
                      <button type="button" class="link" (click)="edit(c)">Editar</button>
                      <button
                        type="button"
                        class="link"
                        [class.danger]="c.active"
                        (click)="toggle(c)"
                      >
                        {{ c.active ? 'Dar de baja' : 'Reactivar' }}
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
export class CoachesPage {
  private service = inject(CoachService);
  protected auth = inject(AuthService);
  /** `?nuevo=1` (a quick task of the Tablero) opens the create form at once, if the role may create. */
  private openOnArrival = inject(ActivatedRoute).snapshot.queryParamMap.has('nuevo')
    ? setTimeout(() => this.auth.can('entrenadores.crear') && this.create())
    : null;
  protected query = signal('');
  protected coaches = resource({
    params: () => this.query(),
    loader: ({ params }) => this.service.list({ query: params }),
  });
  protected submission = new Submission();
  protected editing = signal<CoachView | null>(null);
  protected accountEmail = '';
  protected form = inject(FormBuilder).nonNullable.group({
    firstName: ['', [Validators.required, personNameValidator]],
    lastName1: ['', [Validators.required, personNameValidator]],
    lastName2: ['', personNameValidator],
    phone: ['', phoneValidator],
    email: ['', emailValidator],
  });

  protected panel = new FormPanel('coach-form', () => this.form.dirty);

  edit(c: CoachView): void {
    if (!this.panel.close()) return;
    this.reset();
    this.submission.result.set(null);
    this.editing.set(c);
    this.accountEmail = c.email ?? '';
    this.form.setValue({
      firstName: c.firstName,
      lastName1: c.lastName1,
      lastName2: c.lastName2 ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
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
    this.editing.set(null);
    this.form.reset();
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      setTimeout(() => focusFirstInvalid(document.getElementById('coach-form')!));
      return;
    }
    const draft = { ...this.form.getRawValue(), id: this.editing()?.id };
    if (
      await this.submission.run(
        () => this.service.save(draft),
        draft.id ? 'Entrenador actualizado.' : 'Entrenador registrado.',
      )
    ) {
      this.panel.done();
      this.reset();
      this.coaches.reload();
    }
  }

  async toggle(c: CoachView): Promise<void> {
    if (c.active && !confirm(`¿Dar de baja a ${c.name}? Conservará su historial.`)) return;
    await this.submission.run(() => this.service.setActive(c.id, !c.active), 'Estado actualizado.');
    this.coaches.reload();
  }

  async link(c: CoachView): Promise<void> {
    const ok = await this.submission.run(
      () => this.service.linkAccount(c.id, this.accountEmail),
      (r) =>
        r.created
          ? `Cuenta creada; se envió el acceso inicial a ${r.email}.`
          : `Cuenta existente ${r.email} vinculada.`,
    );
    if (ok) await this.refresh(c.id);
  }

  async unlink(c: CoachView): Promise<void> {
    if (await this.submission.run(() => this.service.unlinkAccount(c.id), 'Cuenta desvinculada.'))
      await this.refresh(c.id);
  }

  private async refresh(id: Id): Promise<void> {
    this.coaches.reload();
    this.editing.set((await this.service.list()).find((c) => c.id === id) ?? null);
  }
}

/** HU-023: several coaches per category, optional responsibility and validity (start/end). */
@Component({
  selector: 'app-coach-categories-page',
  imports: [FormsModule, LoadState, SubmissionAlert],
  template: `
    <div class="page-head">
      <h1>Entrenadores por categoría</h1>
      @if (auth.can('entrenadores.editar')) {
        <button
          type="button"
          (click)="open()"
          [attr.aria-expanded]="panel.open()"
          aria-controls="category-assignment-form"
        >
          Asignar entrenador
        </button>
      }
    </div>
    <app-submission-alert [submission]="submission" />
    @if (panel.open()) {
      <form
        id="category-assignment-form"
        class="grid-form"
        (ngSubmit)="assign()"
        (keydown.escape)="closeForm()"
        novalidate
      >
        <h2>Asignar entrenador</h2>
        <label
          >Entrenador
          <select name="coach" [(ngModel)]="coachId">
            <option [ngValue]="null">Selecciona…</option>
            @for (c of coaches.value() ?? []; track c.id) {
              <option [ngValue]="c.id">{{ c.name }}</option>
            }
          </select>
        </label>
        <label
          >Categoría
          <select name="category" [(ngModel)]="categoryId">
            <option [ngValue]="null">Selecciona…</option>
            @for (c of categories.value() ?? []; track c.id) {
              <option [ngValue]="c.id">{{ c.name }} · {{ c.seasonName }}</option>
            }
          </select>
        </label>
        <label
          >Rol / responsabilidad (opcional)
          <input
            name="resp"
            [(ngModel)]="responsibility"
            placeholder="Principal, auxiliar, porteros…"
        /></label>
        <label>Desde <input type="date" name="start" [(ngModel)]="startDate" /></label>
        <div class="actions">
          <button type="submit" [disabled]="submission.busy() || !coachId || !categoryId">
            Asignar
          </button>
          <button type="button" class="secondary" (click)="closeForm()">Cancelar</button>
        </div>
      </form>
    }
    <div class="filters">
      <label
        >Categoría
        <select [ngModel]="filterCategory()" (ngModelChange)="filterCategory.set(idOrNull($event))">
          <option [ngValue]="null">Todas</option>
          @for (c of categories.value() ?? []; track c.id) {
            <option [ngValue]="c.id">{{ c.name }}</option>
          }
        </select>
      </label>
    </div>
    <app-load-state [res]="rows"
      ><ng-template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Categoría</th>
                <th>Entrenador</th>
                <th>Responsabilidad</th>
                <th>Desde</th>
                <th>Hasta</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (a of rows.value() ?? []; track a.id) {
                <tr>
                  <td>{{ a.categoryName }}</td>
                  <td>{{ a.coachName }}</td>
                  <td>{{ a.responsibility ?? '—' }}</td>
                  <td>{{ a.startDate }}</td>
                  <td>{{ a.endDate ?? 'vigente' }}</td>
                  <td>
                    @if (a.current && auth.can('entrenadores.editar')) {
                      <button type="button" class="link danger" (click)="end(a.id)">
                        Terminar
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
export class CoachCategoriesPage {
  private service = inject(CoachService);
  private categoryService = inject(CategoryService);
  protected auth = inject(AuthService);
  protected idOrNull = idOrNull;
  protected coaches = resource({ loader: () => this.service.list({ onlyActive: true }) });
  protected categories = resource({
    loader: () => this.categoryService.list({ onlyActive: true }),
  });
  protected filterCategory = signal<Id | null>(null);
  protected rows = resource({
    params: () => this.filterCategory(),
    loader: ({ params }) => this.service.categoryAssignments({ categoryId: params }),
  });
  protected submission = new Submission();
  protected coachId: Id | null = null;
  protected categoryId: Id | null = null;
  protected responsibility = '';
  protected startDate = today();

  private opened = '';
  private snapshot = () =>
    JSON.stringify([this.coachId, this.categoryId, this.responsibility, this.startDate]);
  protected panel = new FormPanel(
    'category-assignment-form',
    () => this.snapshot() !== this.opened,
  );

  open(): void {
    if (!this.panel.close()) return;
    this.reset();
    this.opened = this.snapshot();
    this.submission.result.set(null);
    this.panel.show();
  }

  /** Closes the form without assigning (asks first if it has unsaved changes). */
  closeForm(): void {
    if (this.panel.close()) this.reset();
  }

  private reset(): void {
    this.coachId = this.categoryId = null;
    this.responsibility = '';
    this.startDate = today();
  }

  async assign(): Promise<void> {
    const ok = await this.submission.run(
      () =>
        this.service.assignCategory({
          coachId: this.coachId!,
          categoryId: this.categoryId!,
          responsibility: this.responsibility,
          startDate: this.startDate,
        }),
      'Asignación guardada.',
    );
    if (ok) {
      this.panel.done();
      this.reset();
      this.rows.reload();
    }
  }

  async end(id: Id): Promise<void> {
    if (!confirm('¿Terminar esta asignación hoy? Queda en el historial.')) return;
    await this.submission.run(
      () => this.service.endCategoryAssignment(id),
      'Asignación terminada.',
    );
    this.rows.reload();
  }
}

/** HU-026: coach per competition participation (competition + category), only with a current category assignment. */
@Component({
  selector: 'app-assignments-page',
  imports: [FormsModule, LoadState, SubmissionAlert],
  template: `
    <div class="page-head">
      <h1>Entrenadores por torneo / liga</h1>
      @if (auth.can('competencias.editar')) {
        <button
          type="button"
          (click)="open()"
          [attr.aria-expanded]="panel.open()"
          aria-controls="competition-assignment-form"
        >
          Asignar entrenador
        </button>
      }
    </div>
    <app-submission-alert [submission]="submission" />
    @if (panel.open()) {
      <form
        id="competition-assignment-form"
        class="grid-form"
        (ngSubmit)="assign()"
        (keydown.escape)="closeForm()"
        novalidate
      >
        <h2>Asignar entrenador</h2>
        <label
          >Participación (competencia · categoría)
          <select name="cc" [(ngModel)]="participationId">
            <option [ngValue]="null">Selecciona…</option>
            @for (p of participations.value() ?? []; track p.id) {
              <option
                [ngValue]="p.id"
                [disabled]="p.status === 'BAJA' || p.status === 'FINALIZADA'"
              >
                {{ p.competitionName }} · {{ p.categoryName }} ({{ p.status }})
              </option>
            }
          </select>
        </label>
        <label
          >Entrenador
          <select name="coach" [(ngModel)]="coachId">
            <option [ngValue]="null">Selecciona…</option>
            @for (c of coaches.value() ?? []; track c.id) {
              <option [ngValue]="c.id">
                {{ c.name }} ({{ c.categories.join(', ') || 'sin categoría' }})
              </option>
            }
          </select>
        </label>
        <label>Desde <input type="date" name="start" [(ngModel)]="startDate" /></label>
        <p class="muted">
          Sólo se aceptan entrenadores con asignación vigente a la categoría de la participación.
        </p>
        <div class="actions">
          <button type="submit" [disabled]="submission.busy() || !coachId || !participationId">
            Asignar
          </button>
          <button type="button" class="secondary" (click)="closeForm()">Cancelar</button>
        </div>
      </form>
    }
    <app-load-state [res]="assignments"
      ><ng-template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Competencia</th>
                <th>Categoría</th>
                <th>Entrenador</th>
                <th>Desde</th>
                <th>Hasta</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (a of assignments.value() ?? []; track a.id) {
                <tr>
                  <td>{{ a.competitionName }}</td>
                  <td>{{ a.categoryName }}</td>
                  <td>{{ a.coachName }}</td>
                  <td>{{ a.startDate }}</td>
                  <td>{{ a.endDate ?? 'vigente' }}</td>
                  <td>
                    @if (a.current && auth.can('competencias.editar')) {
                      <button type="button" class="link danger" (click)="end(a.id)">
                        Terminar
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
export class AssignmentsPage {
  private service = inject(CoachService);
  private competitions = inject(CompetitionService);
  protected auth = inject(AuthService);
  protected coaches = resource({ loader: () => this.service.list({ onlyActive: true }) });
  protected participations = resource({ loader: () => this.competitions.participations() });
  protected assignments = resource({ loader: () => this.service.competitionAssignments() });
  protected submission = new Submission();
  protected coachId: Id | null = null;
  protected participationId: Id | null = null;
  protected startDate = today();

  private opened = '';
  private snapshot = () => JSON.stringify([this.coachId, this.participationId, this.startDate]);
  protected panel = new FormPanel(
    'competition-assignment-form',
    () => this.snapshot() !== this.opened,
  );

  open(): void {
    if (!this.panel.close()) return;
    this.reset();
    this.opened = this.snapshot();
    this.submission.result.set(null);
    this.panel.show();
  }

  /** Closes the form without assigning (asks first if it has unsaved changes). */
  closeForm(): void {
    if (this.panel.close()) this.reset();
  }

  private reset(): void {
    this.coachId = this.participationId = null;
    this.startDate = today();
  }

  async assign(): Promise<void> {
    const ok = await this.submission.run(
      () =>
        this.service.assignCompetition({
          coachId: this.coachId!,
          competitionCategoryId: this.participationId!,
          startDate: this.startDate,
        }),
      'Asignación guardada.',
    );
    if (ok) {
      this.panel.done();
      this.reset();
      this.assignments.reload();
    }
  }

  async end(id: Id): Promise<void> {
    if (!confirm('¿Terminar esta asignación hoy?')) return;
    await this.submission.run(
      () => this.service.endCompetitionAssignment(id),
      'Asignación terminada.',
    );
    this.assignments.reload();
  }
}

import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, FormsModule, FieldError, FieldA11y, LoadState, SubmissionAlert],
  template: `
    <div class="page-head">
      <div>
        <h1>Entrenadores</h1>
        <p class="page-subtitle">
          Directorio del cuerpo técnico, categorías vigentes y acceso al panel de entrenador.
        </p>
      </div>
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
      <section
        class="panel tutor-workspace"
        [class.with-portal]="!!editing()"
        (keydown.escape)="cancel()"
      >
        <div class="tutor-workspace-grid">
          <form
            id="coach-form"
            [formGroup]="form"
            (ngSubmit)="submit()"
            novalidate
            class="grid-form"
          >
            <h2>{{ editing() ? 'Editar entrenador' : 'Registrar entrenador' }}</h2>
            <p class="field-hint">
              Los campos con <span class="req" aria-hidden="true">*</span> son obligatorios. Al
              guardar podrás vincular o administrar su cuenta de acceso al panel de entrenador.
            </p>
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
                <label
                  >Apellido materno <input formControlName="lastName2" autocomplete="off"
                /></label>
                <app-field-error [control]="form.controls.lastName2" />
              </div>
            </div>
            <div class="two-col">
              <div>
                <label
                  >Teléfono <input type="tel" formControlName="phone" autocomplete="off"
                /></label>
                <app-field-error [control]="form.controls.phone" />
              </div>
              <div>
                <label
                  >Correo <input type="email" formControlName="email" autocomplete="off"
                /></label>
                <app-field-error [control]="form.controls.email" />
              </div>
            </div>
            <div class="actions">
              <button type="submit" [disabled]="submission.busy()">
                {{ submission.busy() ? 'Guardando…' : 'Guardar' }}
              </button>
              <button type="button" class="secondary" (click)="cancel()">Cancelar</button>
            </div>
          </form>

          @if (editing(); as c) {
            <aside class="portal-panel" aria-labelledby="coach-account-heading">
              <div class="portal-panel-head">
                <h2 id="coach-account-heading">Cuenta de acceso</h2>
                <span class="tag" [class.ok]="!!c.accountEmail" [class.neutral]="!c.accountEmail">
                  {{ c.accountEmail ? 'Vinculada' : 'Sin acceso' }}
                </span>
              </div>
              @if (c.accountEmail) {
                <p>
                  El entrenador puede ingresar al <strong>Panel de entrenador</strong> para pasar
                  lista y consultar sus categorías y partidos.
                </p>
                <div class="account-box">
                  <span class="account-box-label">Usuario vinculado</span>
                  <strong class="mono">{{ c.accountEmail }}</strong>
                </div>
                <div class="actions">
                  <button
                    type="button"
                    class="secondary"
                    (click)="unlink(c)"
                    [disabled]="submission.busy()"
                  >
                    Desvincular cuenta
                  </button>
                </div>
              } @else {
                <p class="muted">
                  Vincula un correo para habilitar su acceso al pase de lista y panel de entrenador.
                </p>
                <label
                  >Correo de acceso
                  <input
                    type="email"
                    [(ngModel)]="accountEmail"
                    name="accountEmail"
                    placeholder="entrenador@ejemplo.com"
                /></label>
                <div class="actions">
                  <button type="button" (click)="link(c)" [disabled]="submission.busy()">
                    Vincular cuenta
                  </button>
                </div>
              }
            </aside>
          }
        </div>
      </section>
    }
    <div class="filters">
      <label class="filter-grow"
        >Buscar
        <input
          type="search"
          placeholder="Nombre, teléfono o correo…"
          [ngModel]="query()"
          (ngModelChange)="query.set($event)"
      /></label>
      @if (query().trim()) {
        <button type="button" class="secondary sm" (click)="query.set('')">Limpiar</button>
      }
    </div>
    <app-load-state [res]="coaches" emptyText="Sin entrenadores que coincidan con la búsqueda."
      ><ng-template>
        <div class="list-meta">
          <p class="muted">
            Mostrando <strong class="tabular">{{ (coaches.value() ?? []).length }}</strong>
            {{ (coaches.value() ?? []).length === 1 ? 'entrenador' : 'entrenadores' }}
          </p>
        </div>
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
                <tr [class.muted]="!c.active">
                  <td>
                    <strong>{{ c.name }}</strong>
                  </td>
                  <td>
                    @if (c.phone || c.email) {
                      <span>{{ c.phone ?? '' }}</span>
                      @if (c.email) {
                        <div class="cell-sub mono">{{ c.email }}</div>
                      }
                    } @else {
                      <span class="muted">—</span>
                    }
                  </td>
                  <td>{{ c.categories.join(', ') || '—' }}</td>
                  <td>
                    @if (c.accountEmail) {
                      <span class="mono">{{ c.accountEmail }}</span>
                    } @else {
                      <span class="muted">—</span>
                    }
                  </td>
                  <td>
                    <span class="tag" [class.ok]="c.active" [class.off]="!c.active">{{
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, LoadState, SubmissionAlert],
  template: `
    <div class="page-head">
      <div>
        <h1>Entrenadores por categoría</h1>
        <p class="page-subtitle">
          Asignaciones vigentes e historial de cuerpo técnico asignado a cada categoría.
        </p>
      </div>
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
        <p class="field-hint">
          Los campos con <span class="req" aria-hidden="true">*</span> son obligatorios.
        </p>
        <div class="two-col">
          <label
            ><span
              >Entrenador <span class="req" aria-hidden="true">*</span
              ><span class="sr-only"> (obligatorio)</span></span
            >
            <select name="coach" [(ngModel)]="coachId">
              <option [ngValue]="null">Selecciona…</option>
              @for (c of coaches.value() ?? []; track c.id) {
                <option [ngValue]="c.id">{{ c.name }}</option>
              }
            </select>
          </label>
          <label
            ><span
              >Categoría <span class="req" aria-hidden="true">*</span
              ><span class="sr-only"> (obligatorio)</span></span
            >
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
        </div>
        <div class="actions">
          <button type="submit" [disabled]="submission.busy() || !coachId || !categoryId">
            {{ submission.busy() ? 'Asignando…' : 'Asignar' }}
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
      @if (filterCategory() !== null) {
        <button type="button" class="secondary sm" (click)="filterCategory.set(null)">
          Limpiar filtro
        </button>
      }
    </div>
    <app-load-state [res]="rows" emptyText="Sin asignaciones registradas."
      ><ng-template>
        <div class="list-meta">
          <p class="muted">
            Mostrando <strong class="tabular">{{ (rows.value() ?? []).length }}</strong>
            {{ (rows.value() ?? []).length === 1 ? 'asignación' : 'asignaciones' }}
          </p>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Categoría</th>
                <th>Entrenador</th>
                <th>Responsabilidad</th>
                <th>Desde</th>
                <th>Hasta / Vigencia</th>
                <th><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (a of rows.value() ?? []; track a.id) {
                <tr [class.muted]="!a.current">
                  <td>
                    <strong>{{ a.categoryName }}</strong>
                  </td>
                  <td>{{ a.coachName }}</td>
                  <td>{{ a.responsibility ?? '—' }}</td>
                  <td class="tabular">{{ a.startDate }}</td>
                  <td>
                    @if (a.current && !a.endDate) {
                      <span class="tag ok">Vigente</span>
                    } @else {
                      <span class="tabular">{{ a.endDate }}</span>
                    }
                  </td>
                  <td class="row-actions">
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, LoadState, SubmissionAlert],
  template: `
    <div class="page-head">
      <div>
        <h1>Entrenadores por torneo / liga</h1>
        <p class="page-subtitle">
          Cuerpo técnico responsable en cada participación; requiere asignación vigente en la
          categoría.
        </p>
      </div>
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
        <p class="field-hint">
          Sólo se aceptan entrenadores con asignación vigente a la categoría de la participación.
        </p>
        <label
          ><span
            >Participación (competencia · categoría) <span class="req" aria-hidden="true">*</span
            ><span class="sr-only"> (obligatorio)</span></span
          >
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
        <div class="two-col">
          <label
            ><span
              >Entrenador <span class="req" aria-hidden="true">*</span
              ><span class="sr-only"> (obligatorio)</span></span
            >
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
        </div>
        <div class="actions">
          <button type="submit" [disabled]="submission.busy() || !coachId || !participationId">
            {{ submission.busy() ? 'Asignando…' : 'Asignar' }}
          </button>
          <button type="button" class="secondary" (click)="closeForm()">Cancelar</button>
        </div>
      </form>
    }
    <div class="filters">
      <label
        >Vigencia
        <select [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)">
          <option value="ALL">Todas</option>
          <option value="CURRENT">Solo vigentes</option>
        </select>
      </label>
      @if (statusFilter() !== 'ALL') {
        <button type="button" class="secondary sm" (click)="statusFilter.set('ALL')">
          Limpiar filtro
        </button>
      }
    </div>
    <app-load-state [res]="assignments" emptyText="Sin asignaciones de torneo registradas."
      ><ng-template>
        <div class="list-meta">
          <p class="muted">
            Mostrando <strong class="tabular">{{ filteredAssignments().length }}</strong>
            {{ filteredAssignments().length === 1 ? 'asignación' : 'asignaciones' }}
          </p>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Competencia</th>
                <th>Categoría</th>
                <th>Entrenador</th>
                <th>Desde</th>
                <th>Hasta / Vigencia</th>
                <th><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (a of filteredAssignments(); track a.id) {
                <tr [class.muted]="!a.current">
                  <td>
                    <strong>{{ a.competitionName }}</strong>
                  </td>
                  <td>{{ a.categoryName }}</td>
                  <td>{{ a.coachName }}</td>
                  <td class="tabular">{{ a.startDate }}</td>
                  <td>
                    @if (a.current && !a.endDate) {
                      <span class="tag ok">Vigente</span>
                    } @else {
                      <span class="tabular">{{ a.endDate }}</span>
                    }
                  </td>
                  <td class="row-actions">
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
  protected statusFilter = signal<'ALL' | 'CURRENT'>('ALL');
  protected filteredAssignments = computed(() => {
    const all = this.assignments.value() ?? [];
    return this.statusFilter() === 'CURRENT' ? all.filter((a) => a.current) : all;
  });
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

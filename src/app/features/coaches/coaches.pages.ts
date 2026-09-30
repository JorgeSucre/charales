import { Component, inject, resource } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { Submission } from '../../shared/submission';
import { CategoryService } from '../../core/services/category.service';
import { CompetitionService } from '../../core/services/competition.service';
import { CoachService } from './coach.service';

/** HU-022 */
@Component({
  selector: 'app-coaches-page',
  imports: [ReactiveFormsModule, FieldError, LoadState],
  template: `
    <h1>Entrenadores</h1>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="grid-form">
      <h2>Registrar entrenador</h2>
      <label>Nombre completo <input formControlName="fullName" /></label>
      <app-field-error [control]="form.controls.fullName" />
      <label>Teléfono <input type="tel" formControlName="phone" /></label>
      <app-field-error [control]="form.controls.phone" />
      <label>Correo <input type="email" formControlName="email" /></label>
      <app-field-error [control]="form.controls.email" />
      @if (submission.result(); as r) {
        <p class="alert" [class.ok]="r.ok" [class.error]="!r.ok" role="status">{{ r.text }}</p>
      }
      <button type="submit" [disabled]="submission.busy()">Guardar</button>
    </form>
    <app-load-state [res]="coaches" [empty]="!coaches.value()?.length">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Teléfono</th>
              <th>Correo</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            @for (c of coaches.value() ?? []; track c.id) {
              <tr>
                <td>{{ c.fullName }}</td>
                <td>{{ c.phone }}</td>
                <td>{{ c.email }}</td>
                <td>
                  <span class="tag" [class.off]="!c.active">{{
                    c.active ? 'Activo' : 'Inactivo'
                  }}</span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </app-load-state>
  `,
})
export class CoachesPage {
  private service = inject(CoachService);
  protected coaches = resource({ loader: () => this.service.list() });
  protected submission = new Submission();
  protected form = inject(FormBuilder).nonNullable.group({
    fullName: ['', Validators.required],
    phone: ['', [Validators.required, Validators.pattern(/^\+?\d{10,13}$/)]],
    email: ['', [Validators.required, Validators.email]],
  });

  async submit(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    if (
      await this.submission.run(
        () => this.service.save({ ...this.form.getRawValue(), active: true }),
        'Entrenador registrado.',
      )
    ) {
      this.form.reset();
      this.coaches.reload();
    }
  }
}

/** HU-026 */
@Component({
  selector: 'app-assignments-page',
  imports: [ReactiveFormsModule, FieldError, LoadState],
  template: `
    <h1>Asignación a torneos y ligas</h1>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="grid-form">
      <label
        >Entrenador
        <select formControlName="coachId">
          <option value="" disabled>Selecciona…</option>
          @for (c of coaches.value() ?? []; track c.id) {
            <option [value]="c.id">{{ c.fullName }}</option>
          }
        </select>
      </label>
      <app-field-error [control]="form.controls.coachId" />
      <label
        >Torneo / liga
        <select formControlName="competitionId">
          <option value="" disabled>Selecciona…</option>
          @for (c of competitions.value() ?? []; track c.id) {
            <option [value]="c.id">{{ c.name }}</option>
          }
        </select>
      </label>
      <app-field-error [control]="form.controls.competitionId" />
      <label
        >Categoría
        <select formControlName="categoryId">
          <option value="" disabled>Selecciona…</option>
          @for (c of categories.value() ?? []; track c.id) {
            <option [value]="c.id">{{ c.name }}</option>
          }
        </select>
      </label>
      <app-field-error [control]="form.controls.categoryId" />
      @if (submission.result(); as r) {
        <p class="alert" [class.ok]="r.ok" [class.error]="!r.ok" role="status">{{ r.text }}</p>
      }
      <button type="submit" [disabled]="submission.busy()">Asignar</button>
    </form>
    <app-load-state [res]="assignments" [empty]="!assignments.value()?.length">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Entrenador</th>
              <th>Torneo / liga</th>
              <th>Categoría</th>
              <th><span class="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            @for (a of assignments.value() ?? []; track a.id) {
              <tr>
                <td>{{ a.coachName }}</td>
                <td>{{ a.competitionName }}</td>
                <td>{{ a.categoryName }}</td>
                <td>
                  <button type="button" class="link danger" (click)="remove(a.id)">Quitar</button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </app-load-state>
  `,
})
export class AssignmentsPage {
  private service = inject(CoachService);
  protected coaches = resource({ loader: () => this.service.list() });
  private competitionService = inject(CompetitionService);
  protected competitions = resource({ loader: () => this.competitionService.list() });
  private categoryService = inject(CategoryService);
  protected categories = resource({ loader: () => this.categoryService.list() });
  protected assignments = resource({ loader: () => this.service.assignments() });
  protected submission = new Submission();
  protected form = inject(FormBuilder).nonNullable.group({
    coachId: ['', Validators.required],
    competitionId: ['', Validators.required],
    categoryId: ['', Validators.required],
  });

  async submit(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    if (
      await this.submission.run(
        () => this.service.assign(this.form.getRawValue()),
        'Asignación guardada.',
      )
    ) {
      this.form.reset();
      this.assignments.reload();
    }
  }

  async remove(id: string): Promise<void> {
    if (!confirm('¿Quitar esta asignación?')) return;
    await this.submission.run(() => this.service.unassign(id), 'Asignación eliminada.');
    this.assignments.reload();
  }
}

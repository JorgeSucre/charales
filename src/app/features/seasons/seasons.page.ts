import { Component, inject, resource, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../core/auth/auth.service';
import { Id } from '../../core/models';
import { catalogNameValidator } from '../../shared/validate';
import { FormPanel } from '../../shared/form-panel';
import { focusFirstInvalid } from '../../shared/focus';
import { FieldA11y, FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { Submission } from '../../shared/submission';
import { SubmissionAlert } from '../../shared/ui';
import { SeasonService, SeasonView } from './season.service';

/** HU-070: seasons; one can be marked current; closed seasons stay queryable with their linked data. */
@Component({
  selector: 'app-seasons-page',
  imports: [ReactiveFormsModule, FieldError, FieldA11y, LoadState, SubmissionAlert],
  template: `
    <div class="page-head">
      <h1>Temporadas</h1>
      @if (auth.can('temporadas.crear')) {
        <button
          type="button"
          (click)="create()"
          [attr.aria-expanded]="panel.open() && !editingId()"
          aria-controls="season-form"
        >
          Nueva temporada
        </button>
      }
    </div>
    <app-submission-alert [submission]="submission" />
    @if (panel.open()) {
      <form
        id="season-form"
        [formGroup]="form"
        (ngSubmit)="submit()"
        novalidate
        class="grid-form"
        (keydown.escape)="cancel()"
      >
        <h2>{{ editingId() ? 'Editar temporada' : 'Nueva temporada' }}</h2>
        <label>Nombre <input formControlName="name" placeholder="Temporada 2027-2028" /></label>
        <app-field-error [control]="form.controls.name" />
        <div class="two-col">
          <div>
            <label>Inicio <input type="date" formControlName="startDate" /></label>
            <app-field-error [control]="form.controls.startDate" />
          </div>
          <div>
            <label>Fin <input type="date" formControlName="endDate" /></label>
            <app-field-error [control]="form.controls.endDate" />
          </div>
        </div>
        <label class="check"
          ><input type="checkbox" formControlName="active" /> Activa (abierta)</label
        >
        <label class="check"
          ><input type="checkbox" formControlName="isCurrent" /> Temporada actual</label
        >
        <div class="actions">
          <button type="submit" [disabled]="submission.busy()">Guardar</button>
          <button type="button" class="secondary" (click)="cancel()">Cancelar</button>
        </div>
      </form>
    }
    <app-load-state [res]="seasons"
      ><ng-template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Inicio</th>
                <th>Fin</th>
                <th>Estado</th>
                <th class="num">Categorías</th>
                <th class="num">Competencias</th>
                <th class="num">Inscripciones</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (s of seasons.value() ?? []; track s.id) {
                <tr>
                  <td>
                    {{ s.name }}
                    @if (s.isCurrent) {
                      <span class="tag">Actual</span>
                    }
                  </td>
                  <td>{{ s.startDate }}</td>
                  <td>{{ s.endDate }}</td>
                  <td>
                    <span class="tag" [class.off]="!s.active">{{
                      s.active ? 'Activa' : 'Cerrada'
                    }}</span>
                  </td>
                  <td class="num">{{ s.categories }}</td>
                  <td class="num">{{ s.competitions }}</td>
                  <td class="num">{{ s.enrollments }}</td>
                  <td>
                    @if (auth.can('temporadas.editar')) {
                      <button type="button" class="link" (click)="edit(s)">Editar</button>
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
export class SeasonsPage {
  private service = inject(SeasonService);
  protected auth = inject(AuthService);
  protected seasons = resource({ loader: () => this.service.list() });
  protected submission = new Submission();
  protected editingId = signal<Id | null>(null);
  protected form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, catalogNameValidator]],
    startDate: ['', Validators.required],
    endDate: ['', Validators.required],
    active: [true],
    isCurrent: [false],
  });

  protected panel = new FormPanel('season-form', () => this.form.dirty);

  edit(s: SeasonView): void {
    if (!this.panel.close()) return;
    this.reset();
    this.submission.result.set(null);
    this.editingId.set(s.id);
    this.form.setValue({
      name: s.name,
      startDate: s.startDate,
      endDate: s.endDate,
      active: s.active,
      isCurrent: s.isCurrent,
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
    this.form.reset();
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      setTimeout(() => focusFirstInvalid(document.getElementById('season-form')!));
      return;
    }
    const draft = { ...this.form.getRawValue(), id: this.editingId() ?? undefined };
    if (await this.submission.run(() => this.service.save(draft), 'Temporada guardada.')) {
      this.panel.done();
      this.reset();
      this.seasons.reload();
    }
  }
}

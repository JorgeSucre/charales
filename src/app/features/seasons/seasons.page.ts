import { Component, inject, resource, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../core/auth/auth.service';
import { Id } from '../../core/models';
import { FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { Submission } from '../../shared/submission';
import { SubmissionAlert } from '../../shared/ui';
import { SeasonService, SeasonView } from './season.service';

/** HU-070: seasons; one can be marked current; closed seasons stay queryable with their linked data. */
@Component({
  selector: 'app-seasons-page',
  imports: [ReactiveFormsModule, FieldError, LoadState, SubmissionAlert],
  template: `
    <h1>Temporadas</h1>
    @if (auth.can('temporadas.crear') || editingId()) {
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="grid-form">
        <h2>{{ editingId() ? 'Editar temporada' : 'Nueva temporada' }}</h2>
        <label>Nombre <input formControlName="name" placeholder="Temporada 2027-2028" /></label>
        <app-field-error [control]="form.controls.name" />
        <div class="two-col">
          <label>Inicio <input type="date" formControlName="startDate" /></label>
          <label>Fin <input type="date" formControlName="endDate" /></label>
        </div>
        <app-field-error [control]="form.controls.startDate" />
        <app-field-error [control]="form.controls.endDate" />
        <label class="check"
          ><input type="checkbox" formControlName="active" /> Activa (abierta)</label
        >
        <label class="check"
          ><input type="checkbox" formControlName="isCurrent" /> Temporada actual</label
        >
        <app-submission-alert [submission]="submission" />
        <div class="actions">
          <button type="submit" [disabled]="submission.busy()">Guardar</button>
          @if (editingId()) {
            <button type="button" class="secondary" (click)="cancel()">Cancelar</button>
          }
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
    name: ['', Validators.required],
    startDate: ['', Validators.required],
    endDate: ['', Validators.required],
    active: [true],
    isCurrent: [false],
  });

  edit(s: SeasonView): void {
    this.editingId.set(s.id);
    this.form.setValue({
      name: s.name,
      startDate: s.startDate,
      endDate: s.endDate,
      active: s.active,
      isCurrent: s.isCurrent,
    });
  }

  cancel(): void {
    this.editingId.set(null);
    this.form.reset();
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    const draft = { ...this.form.getRawValue(), id: this.editingId() ?? undefined };
    if (await this.submission.run(() => this.service.save(draft), 'Temporada guardada.')) {
      this.cancel();
      this.seasons.reload();
    }
  }
}

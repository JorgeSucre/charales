import { Component, inject, resource } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { Submission } from '../../shared/submission';
import { SeasonService } from './season.service';

/** HU-070 */
@Component({
  selector: 'app-seasons-page',
  imports: [ReactiveFormsModule, FieldError, LoadState],
  template: `
    <h1>Temporadas</h1>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="grid-form">
      <h2>Nueva temporada</h2>
      <label>Nombre <input formControlName="name" placeholder="Temporada 2027-2028" /></label>
      <app-field-error [control]="form.controls.name" />
      <label>Inicio <input type="date" formControlName="startDate" /></label>
      <app-field-error [control]="form.controls.startDate" />
      <label>Fin <input type="date" formControlName="endDate" /></label>
      <app-field-error [control]="form.controls.endDate" />
      <label class="check"
        ><input type="checkbox" formControlName="active" /> Marcar como temporada activa</label
      >
      @if (submission.result(); as r) {
        <p class="alert" [class.ok]="r.ok" [class.error]="!r.ok" role="status">{{ r.text }}</p>
      }
      <button type="submit" [disabled]="submission.busy()">Guardar</button>
    </form>
    <app-load-state [res]="seasons" [empty]="!seasons.value()?.length">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Inicio</th>
              <th>Fin</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            @for (s of seasons.value() ?? []; track s.id) {
              <tr>
                <td>{{ s.name }}</td>
                <td>{{ s.startDate }}</td>
                <td>{{ s.endDate }}</td>
                <td>
                  <span class="tag" [class.off]="!s.active">{{
                    s.active ? 'Activa' : 'Cerrada'
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
export class SeasonsPage {
  private service = inject(SeasonService);
  protected seasons = resource({ loader: () => this.service.list() });
  protected submission = new Submission();
  protected form = inject(FormBuilder).nonNullable.group({
    name: ['', Validators.required],
    startDate: ['', Validators.required],
    endDate: ['', Validators.required],
    active: [false],
  });

  async submit(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    if (
      await this.submission.run(
        () => this.service.save(this.form.getRawValue()),
        'Temporada guardada.',
      )
    ) {
      this.form.reset();
      this.seasons.reload();
    }
  }
}

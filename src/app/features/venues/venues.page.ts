import { Component, inject, resource, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../core/auth/auth.service';
import { Id } from '../../core/models';
import { FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { Submission } from '../../shared/submission';
import { SubmissionAlert } from '../../shared/ui';
import { VenueService, VenueView } from './venue.service';

/** HU-069: venues/pitches reused by schedules, sessions and matches; deactivated, never deleted. */
@Component({
  selector: 'app-venues-page',
  imports: [ReactiveFormsModule, FieldError, LoadState, SubmissionAlert],
  template: `
    <h1>Sedes y canchas</h1>
    @if (auth.can('sedes.crear') || editingId()) {
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="grid-form">
        <h2>{{ editingId() ? 'Editar sede' : 'Nueva sede' }}</h2>
        <label>Nombre <input formControlName="name" /></label>
        <app-field-error [control]="form.controls.name" />
        <label>Ubicación <input formControlName="location" placeholder="Dirección" /></label>
        <label
          >Referencia
          <input formControlName="reference" placeholder="Cancha 2, junto al estacionamiento…"
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
    <app-load-state [res]="venues"
      ><ng-template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Ubicación</th>
                <th>Referencia</th>
                <th class="num">Usos</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (v of venues.value() ?? []; track v.id) {
                <tr>
                  <td>{{ v.name }}</td>
                  <td>{{ v.location ?? '—' }}</td>
                  <td>{{ v.reference ?? '—' }}</td>
                  <td class="num">{{ v.uses }}</td>
                  <td>
                    <span class="tag" [class.off]="!v.active">{{
                      v.active ? 'Activa' : 'Inactiva'
                    }}</span>
                  </td>
                  <td class="row-actions">
                    @if (auth.can('sedes.editar')) {
                      <button type="button" class="link" (click)="edit(v)">Editar</button>
                      <button type="button" class="link" (click)="toggle(v)">
                        {{ v.active ? 'Desactivar' : 'Activar' }}
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
export class VenuesPage {
  private service = inject(VenueService);
  protected auth = inject(AuthService);
  protected venues = resource({ loader: () => this.service.list() });
  protected submission = new Submission();
  protected editingId = signal<Id | null>(null);
  protected form = inject(FormBuilder).nonNullable.group({
    name: ['', Validators.required],
    location: [''],
    reference: [''],
  });

  edit(v: VenueView): void {
    this.editingId.set(v.id);
    this.form.setValue({ name: v.name, location: v.location ?? '', reference: v.reference ?? '' });
  }

  cancel(): void {
    this.editingId.set(null);
    this.form.reset();
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    if (
      await this.submission.run(
        () => this.service.save({ ...this.form.getRawValue(), id: this.editingId() ?? undefined }),
        'Sede guardada.',
      )
    ) {
      this.cancel();
      this.venues.reload();
    }
  }

  async toggle(v: VenueView): Promise<void> {
    await this.submission.run(() => this.service.setActive(v.id, !v.active), 'Estado actualizado.');
    this.venues.reload();
  }
}

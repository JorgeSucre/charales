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
import { VenueService, VenueView } from './venue.service';

/** HU-069: venues/pitches reused by schedules, sessions and matches; deactivated, never deleted. */
@Component({
  selector: 'app-venues-page',
  imports: [ReactiveFormsModule, FieldError, FieldA11y, LoadState, SubmissionAlert],
  template: `
    <div class="page-head">
      <h1>Sedes y canchas</h1>
      @if (auth.can('sedes.crear')) {
        <button
          type="button"
          (click)="create()"
          [attr.aria-expanded]="panel.open() && !editingId()"
          aria-controls="venue-form"
        >
          Nueva sede
        </button>
      }
    </div>
    <app-submission-alert [submission]="submission" />
    @if (panel.open()) {
      <form
        id="venue-form"
        [formGroup]="form"
        (ngSubmit)="submit()"
        novalidate
        class="grid-form"
        (keydown.escape)="cancel()"
      >
        <h2>{{ editingId() ? 'Editar sede' : 'Nueva sede' }}</h2>
        <label>Nombre <input formControlName="name" /></label>
        <app-field-error [control]="form.controls.name" />
        <label>Ubicación <input formControlName="location" placeholder="Dirección" /></label>
        <label
          >Referencia
          <input formControlName="reference" placeholder="Cancha 2, junto al estacionamiento…"
        /></label>
        <div class="actions">
          <button type="submit" [disabled]="submission.busy()">Guardar</button>
          <button type="button" class="secondary" (click)="cancel()">Cancelar</button>
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
    name: ['', [Validators.required, catalogNameValidator]],
    location: [''],
    reference: [''],
  });

  protected panel = new FormPanel('venue-form', () => this.form.dirty);

  edit(v: VenueView): void {
    if (!this.panel.close()) return;
    this.reset();
    this.submission.result.set(null);
    this.editingId.set(v.id);
    this.form.setValue({ name: v.name, location: v.location ?? '', reference: v.reference ?? '' });
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
      setTimeout(() => focusFirstInvalid(document.getElementById('venue-form')!));
      return;
    }
    if (
      await this.submission.run(
        () => this.service.save({ ...this.form.getRawValue(), id: this.editingId() ?? undefined }),
        'Sede guardada.',
      )
    ) {
      this.panel.done();
      this.reset();
      this.venues.reload();
    }
  }

  async toggle(v: VenueView): Promise<void> {
    await this.submission.run(() => this.service.setActive(v.id, !v.active), 'Estado actualizado.');
    this.venues.reload();
  }
}

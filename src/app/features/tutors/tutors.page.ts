import { Component, inject, resource } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { PlayerService } from '../../core/services/player.service';
import { FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { Submission } from '../../shared/submission';
import { TutorService } from './tutor.service';

/** HU-011: one or more tutors per player (a tutor can also have several players). */
@Component({
  selector: 'app-tutors-page',
  imports: [ReactiveFormsModule, FieldError, LoadState],
  template: `
    <h1>Padres / tutores</h1>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="grid-form">
      <h2>Registrar tutor</h2>
      <label>Nombre completo <input formControlName="fullName" autocomplete="name" /></label>
      <app-field-error [control]="form.controls.fullName" />
      <label
        >Parentesco <input formControlName="relationship" placeholder="Madre, padre, abuelo…"
      /></label>
      <app-field-error [control]="form.controls.relationship" />
      <label>Teléfono <input type="tel" formControlName="phone" autocomplete="tel" /></label>
      <app-field-error [control]="form.controls.phone" />
      <label>Correo (opcional) <input type="email" formControlName="email" /></label>
      <app-field-error [control]="form.controls.email" />
      <label
        >Jugadores a cargo
        <select multiple formControlName="playerIds" size="4">
          @for (p of players.value() ?? []; track p.id) {
            <option [value]="p.id">{{ p.fullName }}</option>
          }
        </select>
      </label>
      <app-field-error [control]="form.controls.playerIds" />
      @if (submission.result(); as r) {
        <p class="alert" [class.ok]="r.ok" [class.error]="!r.ok" role="status">{{ r.text }}</p>
      }
      <button type="submit" [disabled]="submission.busy()">Guardar</button>
    </form>
    <app-load-state [res]="tutors" [empty]="!tutors.value()?.length">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Parentesco</th>
              <th>Teléfono</th>
              <th>Jugadores</th>
            </tr>
          </thead>
          <tbody>
            @for (t of tutors.value() ?? []; track t.id) {
              <tr>
                <td>{{ t.fullName }}</td>
                <td>{{ t.relationship }}</td>
                <td>{{ t.phone }}</td>
                <td>{{ playerNames(t.playerIds) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </app-load-state>
  `,
})
export class TutorsPage {
  private service = inject(TutorService);
  private playerService = inject(PlayerService);
  protected players = resource({ loader: () => this.playerService.list() });
  protected tutors = resource({ loader: () => this.service.list() });
  protected submission = new Submission();
  protected form = inject(FormBuilder).nonNullable.group({
    fullName: ['', Validators.required],
    relationship: ['', Validators.required],
    phone: ['', [Validators.required, Validators.pattern(/^\+?\d{10,13}$/)]],
    email: ['', Validators.email],
    playerIds: [[] as string[], Validators.required],
  });

  playerNames(ids: string[]): string {
    return (this.players.value() ?? [])
      .filter((p) => ids.includes(p.id))
      .map((p) => p.fullName)
      .join(', ');
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    const { email, ...rest } = this.form.getRawValue();
    if (
      await this.submission.run(
        () => this.service.save({ ...rest, email: email || undefined }),
        'Tutor registrado.',
      )
    ) {
      this.form.reset();
      this.tutors.reload();
    }
  }
}

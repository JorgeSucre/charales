import { Component, inject, resource } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { PlayerService } from '../../core/services/player.service';
import { FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { Submission } from '../../shared/submission';
import { SeasonService } from '../seasons/season.service';
import { EnrollmentService } from './enrollment.service';

/** HU-020: administrative enrollment per season. Assigning the category is a separate concept (PlayerCategory). */
@Component({
  selector: 'app-enrollments-page',
  imports: [ReactiveFormsModule, FieldError, LoadState],
  template: `
    <h1>Inscripción anual</h1>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="grid-form">
      <h2>Nueva inscripción</h2>
      <label
        >Jugador
        <select formControlName="playerId">
          <option value="" disabled>Selecciona…</option>
          @for (p of players.value() ?? []; track p.id) {
            <option [value]="p.id">{{ p.fullName }}</option>
          }
        </select>
      </label>
      <app-field-error [control]="form.controls.playerId" />
      <label
        >Temporada
        <select formControlName="seasonId">
          <option value="" disabled>Selecciona…</option>
          @for (s of seasons.value() ?? []; track s.id) {
            <option [value]="s.id">{{ s.name }}</option>
          }
        </select>
      </label>
      <app-field-error [control]="form.controls.seasonId" />
      <label>Notas <textarea formControlName="notes" rows="2"></textarea></label>
      @if (submission.result(); as r) {
        <p class="alert" [class.ok]="r.ok" [class.error]="!r.ok" role="status">{{ r.text }}</p>
      }
      <button type="submit" [disabled]="submission.busy()">Inscribir</button>
    </form>
    <app-load-state [res]="enrollments" [empty]="!enrollments.value()?.length">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Jugador</th>
              <th>Temporada</th>
              <th>Fecha</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            @for (e of enrollments.value() ?? []; track e.id) {
              <tr>
                <td>{{ e.playerName }}</td>
                <td>{{ e.seasonName }}</td>
                <td>{{ e.enrolledAt }}</td>
                <td>
                  <span class="tag" [class.off]="e.status !== 'active'">{{
                    e.status === 'active' ? 'Activa' : 'Cancelada'
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
export class EnrollmentsPage {
  private service = inject(EnrollmentService);
  private playerService = inject(PlayerService);
  protected players = resource({ loader: () => this.playerService.list() });
  private seasonService = inject(SeasonService);
  protected seasons = resource({ loader: () => this.seasonService.list() });
  protected enrollments = resource({ loader: () => this.service.list() });
  protected submission = new Submission();
  protected form = inject(FormBuilder).nonNullable.group({
    playerId: ['', Validators.required],
    seasonId: ['', Validators.required],
    notes: [''],
  });

  async submit(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    if (
      await this.submission.run(
        () => this.service.enroll(this.form.getRawValue()),
        'Jugador inscrito.',
      )
    ) {
      this.form.reset();
      this.enrollments.reload();
    }
  }
}

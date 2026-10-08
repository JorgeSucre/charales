import { Component, computed, effect, inject, resource, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { EnrollmentStatus, Id } from '../../core/models';
import { PlayerService } from '../../core/services/player.service';
import { today } from '../../shared/dates';
import { FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { Submission } from '../../shared/submission';
import { SubmissionAlert, centsFromInput, idOrNull } from '../../shared/ui';
import { BillingService, CHARGE_STATUS_LABELS } from '../billing/billing.service';
import { SeasonService } from '../seasons/season.service';
import { ENROLLMENT_LABELS, EnrollmentService, EnrollmentView } from './enrollment.service';

/**
 * HU-020: administrative enrollment per season (date, amount, status, optional fee charge). Category membership
 * is a different thing and is managed from the player's record (HU-017).
 */
@Component({
  selector: 'app-enrollments-page',
  imports: [
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    FieldError,
    LoadState,
    MoneyPipe,
    SubmissionAlert,
  ],
  template: `
    <h1>Inscripción anual</h1>
    @if (auth.can('inscripciones.crear')) {
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="grid-form">
        <h2>Nueva inscripción</h2>
        <label
          >Jugador
          <select formControlName="playerId">
            <option [ngValue]="null" disabled>Selecciona…</option>
            @for (p of players.value() ?? []; track p.id) {
              <option [ngValue]="p.id">{{ p.name }}</option>
            }
          </select>
        </label>
        <app-field-error [control]="form.controls.playerId" />
        <label
          >Temporada
          <select formControlName="seasonId">
            @for (s of openSeasons(); track s.id) {
              <option [ngValue]="s.id">{{ s.name }}{{ s.isCurrent ? ' (actual)' : '' }}</option>
            }
          </select>
        </label>
        <div class="two-col">
          <label>Fecha <input type="date" formControlName="enrolledOn" /></label>
          <label
            >Monto (MXN)
            <input type="number" min="0" step="0.01" inputmode="decimal" formControlName="amount"
          /></label>
        </div>
        <app-field-error [control]="form.controls.amount" />
        <label
          >Estatus inicial
          <select formControlName="status">
            <option value="PENDIENTE">Pendiente</option>
            <option value="ACTIVA">Activa</option>
          </select>
        </label>
        <label
          >Generar cargo con el concepto (opcional)
          <select formControlName="conceptId">
            <option [ngValue]="null">No generar cargo</option>
            @for (c of concepts(); track c.id) {
              <option [ngValue]="c.id">{{ c.name }}</option>
            }
          </select>
        </label>
        @if (form.controls.conceptId.value) {
          <label>Vence <input type="date" formControlName="dueDate" /></label>
        }
        <app-submission-alert [submission]="submission" />
        <button type="submit" [disabled]="submission.busy()">Inscribir</button>
      </form>
    }
    <div class="filters">
      <label
        >Buscar <input type="search" [ngModel]="query()" (ngModelChange)="query.set($event)"
      /></label>
      <label
        >Temporada
        <select [ngModel]="seasonFilter()" (ngModelChange)="seasonFilter.set(idOrNull($event))">
          <option [ngValue]="null">Todas</option>
          @for (s of seasons.value() ?? []; track s.id) {
            <option [ngValue]="s.id">{{ s.name }}</option>
          }
        </select>
      </label>
      <label
        >Estatus
        <select [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)">
          <option value="">Todos</option>
          @for (s of statuses; track s[0]) {
            <option [value]="s[0]">{{ s[1] }}</option>
          }
        </select>
      </label>
    </div>
    <app-load-state [res]="enrollments"
      ><ng-template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Jugador</th>
                <th>Temporada</th>
                <th>Fecha</th>
                <th class="num">Monto</th>
                <th>Cobro</th>
                <th>Estatus</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (e of enrollments.value() ?? []; track e.id) {
                <tr>
                  <td>
                    <a [routerLink]="['/admin/players', e.playerId]">{{ e.playerName }}</a>
                  </td>
                  <td>{{ e.seasonName }}</td>
                  <td>{{ e.enrolledOn }}</td>
                  <td class="num">{{ e.amountCents | money }}</td>
                  <td>
                    {{
                      e.charge
                        ? chargeLabels[e.charge.status] +
                          ' · saldo ' +
                          (e.charge.balanceCents | money)
                        : '—'
                    }}
                  </td>
                  <td>
                    <span class="tag" [class.off]="e.status === 'CANCELADA'">{{
                      labels[e.status]
                    }}</span>
                  </td>
                  <td class="row-actions">
                    @if (auth.can('inscripciones.editar')) {
                      @if (e.status === 'PENDIENTE') {
                        <button type="button" class="link" (click)="set(e, 'ACTIVA')">
                          Activar
                        </button>
                      }
                      @if (e.status === 'ACTIVA') {
                        <button type="button" class="link" (click)="set(e, 'FINALIZADA')">
                          Finalizar
                        </button>
                      }
                      @if (e.status === 'PENDIENTE' || e.status === 'ACTIVA') {
                        <button type="button" class="link danger" (click)="set(e, 'CANCELADA')">
                          Cancelar
                        </button>
                      }
                      @if (e.status === 'CANCELADA') {
                        <button type="button" class="link" (click)="set(e, 'ACTIVA')">
                          Reactivar
                        </button>
                      }
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
export class EnrollmentsPage {
  private service = inject(EnrollmentService);
  private playerService = inject(PlayerService);
  private seasonService = inject(SeasonService);
  private billing = inject(BillingService);
  protected auth = inject(AuthService);
  protected idOrNull = idOrNull;
  protected labels = ENROLLMENT_LABELS;
  protected chargeLabels = CHARGE_STATUS_LABELS;
  protected statuses = Object.entries(ENROLLMENT_LABELS) as [EnrollmentStatus, string][];
  protected players = resource({ loader: () => this.playerService.options(true) });
  protected seasons = resource({ loader: () => this.seasonService.list() });
  protected openSeasons = computed(() => (this.seasons.value() ?? []).filter((s) => s.active));
  private conceptList = resource({ loader: () => this.billing.concepts() });
  protected concepts = computed(() =>
    (this.conceptList.value() ?? []).filter((c) => c.active && !c.recurring),
  );
  protected query = signal('');
  protected seasonFilter = signal<Id | null>(null);
  protected statusFilter = signal<EnrollmentStatus | ''>('');
  protected enrollments = resource({
    params: () => ({
      query: this.query(),
      seasonId: this.seasonFilter(),
      status: this.statusFilter(),
    }),
    loader: ({ params }) => this.service.list(params),
  });
  protected submission = new Submission();
  protected form = inject(FormBuilder).nonNullable.group({
    playerId: [null as Id | null, Validators.required],
    seasonId: [null as Id | null, Validators.required],
    enrolledOn: [today(), Validators.required],
    amount: [1200, [Validators.required, Validators.min(0)]],
    status: ['ACTIVA' as 'PENDIENTE' | 'ACTIVA'],
    conceptId: [null as Id | null],
    dueDate: [today()],
  });

  constructor() {
    // Default to the current season once seasons load.
    effect(() => {
      const current = this.openSeasons().find((s) => s.isCurrent);
      if (current && this.form.controls.seasonId.value === null)
        this.form.controls.seasonId.setValue(current.id);
    });
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    const v = this.form.getRawValue();
    const draft = {
      playerId: v.playerId!,
      seasonId: v.seasonId!,
      enrolledOn: v.enrolledOn,
      amountCents: centsFromInput(v.amount),
      status: v.status,
      conceptId: v.conceptId,
      dueDate: v.conceptId ? v.dueDate : null,
    };
    if (await this.submission.run(() => this.service.enroll(draft), 'Jugador inscrito.')) {
      this.form.patchValue({ playerId: null });
      this.form.markAsUntouched();
      this.enrollments.reload();
    }
  }

  async set(e: EnrollmentView, status: EnrollmentStatus): Promise<void> {
    let reason = '';
    if (status === 'CANCELADA') {
      reason = prompt(`Motivo para cancelar la inscripción de ${e.playerName}:`)?.trim() ?? '';
      if (!reason) return;
    }
    await this.submission.run(
      () => this.service.setStatus(e.id, status, reason),
      'Inscripción actualizada.',
    );
    this.enrollments.reload();
  }
}

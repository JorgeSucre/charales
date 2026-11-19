import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { EnrollmentStatus, Id } from '../../core/models';
import { PlayerService } from '../../core/services/player.service';
import { today } from '../../shared/dates';
import { FieldA11y, FieldError } from '../../shared/field-error';
import { focusFirstInvalid } from '../../shared/focus';
import { FormPanel } from '../../shared/form-panel';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { PromptDialog } from '../../shared/prompt-dialog';
import { CHARGE_TONE, ENROLLMENT_TONE } from '../../shared/status-tone';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    FieldError,
    FieldA11y,
    LoadState,
    MoneyPipe,
    SubmissionAlert,
    PromptDialog,
  ],
  template: `
    <div class="page-head">
      <div>
        <h1>Inscripción anual</h1>
        <p class="page-subtitle">
          Registro administrativo por temporada y generación opcional del cargo de inscripción.
        </p>
      </div>
      @if (auth.can('inscripciones.crear')) {
        <button
          type="button"
          (click)="create()"
          [attr.aria-expanded]="panel.open()"
          aria-controls="enrollment-form"
        >
          Nueva inscripción
        </button>
      }
    </div>
    <app-submission-alert [submission]="submission" />

    @if (panel.open()) {
      <form
        id="enrollment-form"
        [formGroup]="form"
        (ngSubmit)="submit()"
        (keydown.escape)="cancel()"
        novalidate
        class="grid-form"
      >
        <h2>Nueva inscripción</h2>
        <div>
          <label
            ><span
              >Jugador <span class="req" aria-hidden="true">*</span
              ><span class="sr-only"> (obligatorio)</span></span
            >
            <select formControlName="playerId">
              <option [ngValue]="null" disabled>Selecciona…</option>
              @for (p of players.value() ?? []; track p.id) {
                <option [ngValue]="p.id">{{ p.name }}</option>
              }
            </select>
          </label>
          <app-field-error [control]="form.controls.playerId" />
        </div>
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
          <div>
            <label
              ><span
                >Monto (MXN) <span class="req" aria-hidden="true">*</span
                ><span class="sr-only"> (obligatorio)</span></span
              >
              <input type="number" min="0" step="0.01" inputmode="decimal" formControlName="amount"
            /></label>
            <app-field-error [control]="form.controls.amount" />
          </div>
        </div>
        <div class="two-col">
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
        </div>
        @if (form.controls.conceptId.value) {
          <label>Vence <input type="date" formControlName="dueDate" /></label>
        }
        <div class="actions">
          <button type="submit" [disabled]="submission.busy()">
            {{ submission.busy() ? 'Inscribiendo…' : 'Inscribir' }}
          </button>
          <button type="button" class="secondary" (click)="cancel()">Cancelar</button>
        </div>
      </form>
    }

    <div class="filters">
      <label class="filter-grow"
        >Buscar
        <input
          type="search"
          placeholder="Buscar jugador…"
          [ngModel]="query()"
          (ngModelChange)="query.set($event)"
        />
      </label>
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
      @if (hasFilters()) {
        <button type="button" class="secondary sm" (click)="clearFilters()">Limpiar filtros</button>
      }
    </div>

    <app-load-state [res]="enrollments" emptyText="Sin inscripciones con esos filtros."
      ><ng-template>
        <div class="list-meta">
          <p class="muted">
            Mostrando <strong class="tabular">{{ (enrollments.value() ?? []).length }}</strong>
            {{ (enrollments.value() ?? []).length === 1 ? 'inscripción' : 'inscripciones' }}
          </p>
        </div>
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
                <th><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (e of enrollments.value() ?? []; track e.id) {
                <tr [class.muted]="e.status === 'CANCELADA'">
                  <td>
                    <a [routerLink]="['/admin/players', e.playerId]">{{ e.playerName }}</a>
                  </td>
                  <td>{{ e.seasonName }}</td>
                  <td class="tabular">{{ e.enrolledOn }}</td>
                  <td class="num">{{ e.amountCents | money }}</td>
                  <td>
                    @if (e.charge) {
                      <span class="tag {{ chargeTone[e.charge.status] }}">{{
                        chargeLabels[e.charge.status]
                      }}</span>
                      <div class="cell-sub tabular">
                        Saldo {{ e.charge.balanceCents | money }}
                      </div>
                    } @else {
                      <span class="muted">—</span>
                    }
                  </td>
                  <td>
                    <span class="tag {{ enrollmentTone[e.status] }}">{{ labels[e.status] }}</span>
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
    <app-prompt-dialog #cancelDialog />
  `,
})
export class EnrollmentsPage {
  private cancelDialog = viewChild.required<PromptDialog>('cancelDialog');
  private service = inject(EnrollmentService);
  private playerService = inject(PlayerService);
  private seasonService = inject(SeasonService);
  private billing = inject(BillingService);
  protected auth = inject(AuthService);
  protected idOrNull = idOrNull;
  protected labels = ENROLLMENT_LABELS;
  protected enrollmentTone = ENROLLMENT_TONE;
  protected chargeLabels = CHARGE_STATUS_LABELS;
  protected chargeTone = CHARGE_TONE;
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
  protected hasFilters = computed(
    () => !!this.query().trim() || this.seasonFilter() !== null || !!this.statusFilter(),
  );
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

  protected panel = new FormPanel('enrollment-form', () => this.form.dirty);

  constructor() {
    // Default to the current season once seasons load.
    effect(() => {
      const current = this.openSeasons().find((s) => s.isCurrent);
      if (current && this.form.controls.seasonId.value === null)
        this.form.controls.seasonId.setValue(current.id);
    });
  }

  clearFilters(): void {
    this.query.set('');
    this.seasonFilter.set(null);
    this.statusFilter.set('');
  }

  /** Opens an empty form. */
  create(): void {
    if (!this.panel.close()) return;
    this.reset();
    this.submission.result.set(null);
    this.panel.show();
  }

  /** Back to the defaults: today, the current season, no player. */
  cancel(): void {
    if (this.panel.close()) this.reset();
  }

  private reset(): void {
    this.form.reset();
    this.form.controls.seasonId.setValue(this.openSeasons().find((s) => s.isCurrent)?.id ?? null);
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      setTimeout(() => focusFirstInvalid(document.getElementById('enrollment-form')!));
      return;
    }
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
      this.panel.done();
      this.reset();
      this.enrollments.reload();
    }
  }

  async set(e: EnrollmentView, status: EnrollmentStatus): Promise<void> {
    let reason = '';
    if (status === 'CANCELADA') {
      reason =
        (await this.cancelDialog().open({
          title: 'Cancelar inscripción',
          message: `Se cancelará la inscripción de ${e.playerName} (${e.seasonName}).`,
          label: 'Motivo de la cancelación',
          placeholder: 'Ej. baja antes de iniciar temporada',
          confirmText: 'Cancelar inscripción',
          tone: 'danger',
          required: true,
        })) ?? '';
      if (!reason) return;
    }
    if (
      await this.submission.run(
        () => this.service.setStatus(e.id, status, reason),
        'Inscripción actualizada.',
      )
    )
      this.enrollments.reload();
  }
}

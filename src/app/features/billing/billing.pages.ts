import { Component, computed, inject, resource, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ChargeStatus, Id } from '../../core/models';
import { PlayerService } from '../../core/services/player.service';
import { addDays, today } from '../../shared/dates';
import { FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { Submission } from '../../shared/submission';
import { Paginator, SubmissionAlert, centsFromInput, idOrNull } from '../../shared/ui';
import { BillingService, CHARGE_STATUS_LABELS, ChargeView } from './billing.service';

const STATUSES = Object.entries(CHARGE_STATUS_LABELS) as [ChargeStatus, string][];

/** HU-043: concepts with suggested amount, recurring flag and status; editing the amount never touches past charges. */
@Component({
  selector: 'app-concepts-page',
  imports: [ReactiveFormsModule, FieldError, LoadState, MoneyPipe, SubmissionAlert],
  template: `
    <h1>Conceptos de cobro</h1>
    @if (auth.can('cobranza.crear') || editingId()) {
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="grid-form">
        <h2>{{ editingId() ? 'Editar concepto' : 'Nuevo concepto' }}</h2>
        <label
          >Nombre <input formControlName="name" placeholder="Mensualidad, Inscripción, Uniforme…"
        /></label>
        <app-field-error [control]="form.controls.name" />
        <label
          >Importe sugerido (MXN)
          <input type="number" min="0" step="0.01" inputmode="decimal" formControlName="amount"
        /></label>
        <app-field-error [control]="form.controls.amount" />
        <label class="check"
          ><input type="checkbox" formControlName="recurring" /> Recurrente (se usa para generar
          mensualidades)</label
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
    <app-load-state [res]="concepts"
      ><ng-template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th class="num">Importe sugerido</th>
                <th>Recurrente</th>
                <th class="num">Cargos</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (c of concepts.value() ?? []; track c.id) {
                <tr>
                  <td>{{ c.name }}</td>
                  <td class="num">{{ c.suggestedAmountCents | money }}</td>
                  <td>{{ c.recurring ? 'Sí' : 'No' }}</td>
                  <td class="num">{{ c.used }}</td>
                  <td>
                    <span class="tag" [class.off]="!c.active">{{
                      c.active ? 'Activo' : 'Inactivo'
                    }}</span>
                  </td>
                  <td class="row-actions">
                    @if (auth.can('cobranza.editar')) {
                      <button type="button" class="link" (click)="edit(c)">Editar</button>
                      <button type="button" class="link" (click)="toggle(c.id, !c.active)">
                        {{ c.active ? 'Desactivar' : 'Activar' }}
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
export class ConceptsPage {
  private service = inject(BillingService);
  protected auth = inject(AuthService);
  protected concepts = resource({ loader: () => this.service.concepts() });
  protected submission = new Submission();
  protected editingId = signal<Id | null>(null);
  protected form = inject(FormBuilder).nonNullable.group({
    name: ['', Validators.required],
    amount: [0, [Validators.required, Validators.min(0)]],
    recurring: [false],
  });

  edit(c: { id: Id; name: string; suggestedAmountCents: number; recurring: boolean }): void {
    this.editingId.set(c.id);
    this.form.setValue({
      name: c.name,
      amount: c.suggestedAmountCents / 100,
      recurring: c.recurring,
    });
  }

  cancel(): void {
    this.editingId.set(null);
    this.form.reset();
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    const { name, amount, recurring } = this.form.getRawValue();
    const draft = {
      id: this.editingId() ?? undefined,
      name,
      recurring,
      suggestedAmountCents: centsFromInput(amount),
    };
    if (
      await this.submission.run(
        () => this.service.saveConcept(draft),
        'Concepto guardado. Los cargos existentes conservan su importe.',
      )
    ) {
      this.cancel();
      this.concepts.reload();
    }
  }

  async toggle(id: Id, active: boolean): Promise<void> {
    await this.submission.run(
      () => this.service.setConceptActive(id, active),
      'Concepto actualizado.',
    );
    this.concepts.reload();
  }
}

/** HU-044 list: charges with derived paid/balance/status; manual charge and cancellation of unpaid charges. */
@Component({
  selector: 'app-charges-page',
  imports: [FormsModule, RouterLink, LoadState, MoneyPipe, Paginator, SubmissionAlert],
  template: `
    <div class="page-head">
      <h1>Cargos</h1>
      @if (auth.can('cobranza.crear')) {
        <a class="button secondary" routerLink="/admin/billing/monthly">Generar mensualidades</a>
      }
    </div>
    <app-submission-alert [submission]="submission" />
    @if (auth.can('cobranza.crear')) {
      <form class="grid-form" (ngSubmit)="create()" novalidate>
        <h2>Cargo manual</h2>
        <div class="two-col">
          <label
            >Jugador
            <select name="player" [(ngModel)]="draft.playerId">
              <option [ngValue]="null">Selecciona…</option>
              @for (p of players.value() ?? []; track p.id) {
                <option [ngValue]="p.id">{{ p.name }}</option>
              }
            </select>
          </label>
          <label
            >Concepto
            <select
              name="concept"
              [ngModel]="draft.conceptId"
              (ngModelChange)="pickConcept($event)"
            >
              <option [ngValue]="null">Selecciona…</option>
              @for (c of activeConcepts(); track c.id) {
                <option [ngValue]="c.id">{{ c.name }}</option>
              }
            </select>
          </label>
          <label
            >Importe (MXN)
            <input type="number" min="0.01" step="0.01" name="amount" [(ngModel)]="draft.amount"
          /></label>
          <label>Vence <input type="date" name="due" [(ngModel)]="draft.dueDate" /></label>
        </div>
        <label>Referencia (opcional) <input name="ref" [(ngModel)]="draft.reference" /></label>
        <button type="submit" [disabled]="submission.busy() || !draft.playerId || !draft.conceptId">
          Crear cargo
        </button>
      </form>
    }
    <div class="filters">
      <label
        >Jugador
        <input type="search" [ngModel]="query()" (ngModelChange)="query.set($event); page.set(1)"
      /></label>
      <label
        >Estado
        <select [ngModel]="status()" (ngModelChange)="status.set($event); page.set(1)">
          <option value="">Todos</option>
          @for (s of statuses; track s[0]) {
            <option [value]="s[0]">{{ s[1] }}</option>
          }
        </select>
      </label>
      <label
        >Concepto
        <select
          [ngModel]="conceptId()"
          (ngModelChange)="conceptId.set(idOrNull($event)); page.set(1)"
        >
          <option [ngValue]="null">Todos</option>
          @for (c of concepts.value() ?? []; track c.id) {
            <option [ngValue]="c.id">{{ c.name }}</option>
          }
        </select>
      </label>
      <label
        >Periodo
        <input type="month" [ngModel]="period()" (ngModelChange)="period.set($event); page.set(1)"
      /></label>
    </div>
    <app-load-state [res]="charges" emptyText="Sin cargos."
      ><ng-template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Jugador</th>
                <th>Cargo</th>
                <th>Vence</th>
                <th class="num">Original</th>
                <th class="num">Descuento</th>
                <th class="num">Pagado</th>
                <th class="num">Saldo</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (c of charges.value()?.items ?? []; track c.id) {
                <tr>
                  <td>
                    <a [routerLink]="['/admin/players', c.playerId]">{{ c.playerName }}</a>
                  </td>
                  <td>{{ c.label }}</td>
                  <td>{{ c.dueDate ?? '—' }}</td>
                  <td class="num">{{ c.originalAmountCents | money }}</td>
                  <td class="num">{{ c.discountCents ? (c.discountCents | money) : '' }}</td>
                  <td class="num">{{ c.paidCents | money }}</td>
                  <td class="num">{{ c.balanceCents | money }}</td>
                  <td>
                    <span
                      class="tag"
                      [class.off]="c.status === 'VENCIDO' || c.status === 'CANCELADO'"
                      >{{ labels[c.status] }}</span
                    >
                  </td>
                  <td>
                    @if (
                      auth.can('cobranza.cancelar') && c.status !== 'CANCELADO' && !c.paidCents
                    ) {
                      <button type="button" class="link danger" (click)="cancelCharge(c)">
                        Cancelar
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <app-paginator [page]="charges.value()" (go)="page.set($event)" /> </ng-template
    ></app-load-state>
  `,
})
export class ChargesPage {
  private service = inject(BillingService);
  private playerService = inject(PlayerService);
  protected auth = inject(AuthService);
  protected idOrNull = idOrNull;
  protected labels = CHARGE_STATUS_LABELS;
  protected statuses = STATUSES;
  protected players = resource({ loader: () => this.playerService.options() });
  protected concepts = resource({ loader: () => this.service.concepts() });
  protected activeConcepts = computed(() => (this.concepts.value() ?? []).filter((c) => c.active));
  protected query = signal('');
  protected status = signal<ChargeStatus | ''>('');
  protected conceptId = signal<Id | null>(null);
  protected period = signal('');
  protected page = signal(1);
  protected charges = resource({
    params: () => ({
      query: this.query(),
      status: this.status(),
      conceptId: this.conceptId(),
      period: this.period(),
      page: this.page(),
    }),
    loader: ({ params }) => this.service.charges(params),
  });
  protected submission = new Submission();
  protected draft = this.blank();

  private blank() {
    return {
      playerId: null as Id | null,
      conceptId: null as Id | null,
      amount: 0,
      dueDate: addDays(today(), 10),
      reference: '',
    };
  }

  pickConcept(id: Id | null): void {
    this.draft.conceptId = id;
    const c = this.concepts.value()?.find((x) => x.id === id);
    if (c) this.draft.amount = c.suggestedAmountCents / 100;
  }

  async create(): Promise<void> {
    const d = this.draft;
    const draft = {
      playerId: d.playerId!,
      conceptId: d.conceptId!,
      amountCents: centsFromInput(d.amount),
      dueDate: d.dueDate || null,
      reference: d.reference,
    };
    if (await this.submission.run(() => this.service.createCharge(draft), 'Cargo creado.')) {
      this.draft = this.blank();
      this.charges.reload();
    }
  }

  async cancelCharge(c: ChargeView): Promise<void> {
    const reason = prompt(`Motivo para cancelar «${c.label}» de ${c.playerName}:`)?.trim();
    if (!reason) return;
    await this.submission.run(
      () => this.service.cancelCharge(c.id, reason),
      'Cargo cancelado (se conserva en el historial).',
    );
    this.charges.reload();
  }
}

/** HU-044: monthly fees for active, enrolled players; unique per period; authorized exclusions with a reason. */
@Component({
  selector: 'app-monthly-fees-page',
  imports: [FormsModule, LoadState, SubmissionAlert],
  template: `
    <h1>Generar mensualidades</h1>
    <p class="muted">
      Un cargo por jugador activo con inscripción ACTIVA en la temporada actual. Si ya existe para
      el concepto y periodo, no se duplica.
    </p>
    <form class="grid-form" (ngSubmit)="submit()" novalidate>
      <label
        >Concepto recurrente
        <select name="concept" [(ngModel)]="conceptId">
          <option [ngValue]="null">Selecciona…</option>
          @for (c of monthlyConcepts(); track c.id) {
            <option [ngValue]="c.id">{{ c.name }}</option>
          }
        </select>
      </label>
      <div class="two-col">
        <label>Periodo <input type="month" name="period" [(ngModel)]="period" /></label>
        <label>Fecha límite de pago <input type="date" name="due" [(ngModel)]="dueDate" /></label>
      </div>
      <fieldset>
        <legend>Excluir (regla autorizada, p. ej. beca completa)</legend>
        <app-load-state [res]="candidates" emptyText="No hay jugadores elegibles."
          ><ng-template>
            <div class="checks">
              @for (p of candidates.value() ?? []; track p.id) {
                <label class="check"
                  ><input type="checkbox" [checked]="excluded.has(p.id)" (change)="toggle(p.id)" />
                  {{ p.name }}</label
                >
              }
            </div>
          </ng-template></app-load-state
        >
        @if (excluded.size) {
          <label>Regla / motivo de la exclusión <input name="why" [(ngModel)]="reason" /></label>
        }
      </fieldset>
      <app-submission-alert [submission]="submission" />
      <button type="submit" [disabled]="submission.busy() || !conceptId">Generar</button>
    </form>
  `,
})
export class MonthlyFeesPage {
  private service = inject(BillingService);
  private concepts = resource({ loader: () => this.service.concepts() });
  protected monthlyConcepts = computed(() =>
    (this.concepts.value() ?? []).filter((c) => c.recurring && c.active),
  );
  protected candidates = resource({ loader: () => this.service.monthlyCandidates() });
  protected submission = new Submission();
  protected conceptId: Id | null = null;
  protected period = today().slice(0, 7);
  protected dueDate = `${today().slice(0, 7)}-10`;
  protected excluded = new Set<Id>();
  protected reason = '';

  toggle(id: Id): void {
    if (this.excluded.has(id)) this.excluded.delete(id);
    else this.excluded.add(id);
  }

  submit(): void {
    this.submission.run(
      () =>
        this.service.generateMonthlyFees({
          conceptId: this.conceptId!,
          period: this.period,
          dueDate: this.dueDate,
          excludedPlayerIds: [...this.excluded],
          exclusionReason: this.reason || null,
        }),
      (r) => `Se generaron ${r.created} cargo(s) para ${this.period}; ${r.skipped} ya existían.`,
    );
  }
}

/** HU-051: discounts and scholarships per charge (keeps original and final amount; authorized users only). */
@Component({
  selector: 'app-discounts-page',
  imports: [FormsModule, LoadState, MoneyPipe, SubmissionAlert, DatePipe],
  template: `
    <h1>Descuentos y becas</h1>
    @if (auth.can('descuentos.crear')) {
      <form class="grid-form" (ngSubmit)="submit()" novalidate>
        <h2>Registrar ajuste</h2>
        <label
          >Jugador
          <select
            name="player"
            [ngModel]="playerId()"
            (ngModelChange)="playerId.set($event); chargeId = null"
          >
            <option [ngValue]="null">Selecciona…</option>
            @for (p of players.value() ?? []; track p.id) {
              <option [ngValue]="p.id">{{ p.name }}</option>
            }
          </select>
        </label>
        <label
          >Cargo con saldo
          <select name="charge" [(ngModel)]="chargeId">
            <option [ngValue]="null">Selecciona…</option>
            @for (c of openCharges.value() ?? []; track c.id) {
              <option [ngValue]="c.id">{{ c.label }} · saldo {{ c.balanceCents | money }}</option>
            }
          </select>
        </label>
        <div class="two-col">
          <label
            >Tipo
            <select name="type" [(ngModel)]="type">
              <option value="DESCUENTO">Descuento</option>
              <option value="BECA">Beca</option>
            </select>
          </label>
          <label
            >Ajuste (MXN)
            <input type="number" min="0.01" step="0.01" name="adj" [(ngModel)]="adjustment"
          /></label>
        </div>
        <label>Motivo <input name="reason" [(ngModel)]="reason" /></label>
        <app-submission-alert [submission]="submission" />
        <button type="submit" [disabled]="submission.busy() || !chargeId">Aplicar</button>
      </form>
    }
    <app-load-state [res]="discounts" emptyText="Sin descuentos registrados."
      ><ng-template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Jugador</th>
                <th>Cargo</th>
                <th>Tipo</th>
                <th>Motivo</th>
                <th class="num">Original</th>
                <th class="num">Ajuste</th>
                <th class="num">Final</th>
                <th>Autorizó</th>
              </tr>
            </thead>
            <tbody>
              @for (d of discounts.value() ?? []; track d.id) {
                <tr>
                  <td>{{ d.createdAt | date: 'd MMM y' }}</td>
                  <td>{{ d.playerName }}</td>
                  <td>{{ d.label }}</td>
                  <td>{{ d.type === 'BECA' ? 'Beca' : 'Descuento' }}</td>
                  <td>{{ d.reason }}</td>
                  <td class="num">{{ d.originalAmountCents | money }}</td>
                  <td class="num">{{ d.adjustmentCents | money }}</td>
                  <td class="num">{{ d.finalAmountCents | money }}</td>
                  <td>{{ d.authorizedByEmail ?? '—' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </ng-template></app-load-state
    >
  `,
})
export class DiscountsPage {
  private service = inject(BillingService);
  private playerService = inject(PlayerService);
  protected auth = inject(AuthService);
  protected players = resource({ loader: () => this.playerService.options() });
  protected discounts = resource({ loader: () => this.service.discounts() });
  protected playerId = signal<Id | null>(null);
  protected openCharges = resource({
    params: () => this.playerId() ?? undefined,
    loader: ({ params }) => this.service.openCharges(params),
  });
  protected submission = new Submission();
  protected chargeId: Id | null = null;
  protected type: 'DESCUENTO' | 'BECA' = 'BECA';
  protected adjustment = 0;
  protected reason = '';

  async submit(): Promise<void> {
    const draft = {
      chargeId: this.chargeId!,
      type: this.type,
      reason: this.reason,
      adjustmentCents: centsFromInput(this.adjustment),
    };
    if (
      await this.submission.run(
        () => this.service.addDiscount(draft),
        'Ajuste aplicado; el importe original se conserva.',
      )
    ) {
      this.chargeId = null;
      this.reason = '';
      this.discounts.reload();
      this.openCharges.reload();
    }
  }
}

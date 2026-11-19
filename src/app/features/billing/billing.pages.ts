import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ChargeStatus, Id } from '../../core/models';
import { PlayerService } from '../../core/services/player.service';
import { addDays, today } from '../../shared/dates';
import { catalogNameValidator } from '../../shared/validate';
import { FormPanel } from '../../shared/form-panel';
import { focusFirstInvalid } from '../../shared/focus';
import { FieldA11y, FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { sumCents } from '../../shared/money';
import { MoneyPipe } from '../../shared/money.pipe';
import { PromptDialog } from '../../shared/prompt-dialog';
import { CHARGE_TONE } from '../../shared/status-tone';
import { Submission } from '../../shared/submission';
import {
  Paginator,
  SubmissionAlert,
  catalogParam,
  centsFromInput,
  idOrNull,
} from '../../shared/ui';
import { BillingService, CHARGE_STATUS_LABELS, ChargeView } from './billing.service';

const STATUSES = Object.entries(CHARGE_STATUS_LABELS) as [ChargeStatus, string][];

/** HU-043: concepts with suggested amount, recurring flag and status; editing the amount never touches past charges. */
@Component({
  selector: 'app-concepts-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, FieldError, FieldA11y, LoadState, MoneyPipe, SubmissionAlert],
  template: `
    <div class="page-head">
      <div>
        <h1>Conceptos de cobro</h1>
        <p class="page-subtitle">
          Catálogo de importes sugeridos para mensualidades, inscripciones y cargos manuales.
        </p>
      </div>
      @if (auth.can('cobranza.crear')) {
        <button
          type="button"
          (click)="create()"
          [attr.aria-expanded]="panel.open() && !editingId()"
          aria-controls="concept-form"
        >
          Nuevo concepto
        </button>
      }
    </div>
    <app-submission-alert [submission]="submission" />

    @if (panel.open()) {
      <form
        id="concept-form"
        [formGroup]="form"
        (ngSubmit)="submit()"
        novalidate
        class="grid-form"
        (keydown.escape)="cancel()"
      >
        <h2>{{ editingId() ? 'Editar concepto' : 'Nuevo concepto' }}</h2>
        <p class="field-hint">
          Modificar el importe sugerido aplica únicamente a cargos nuevos; los cargos previos
          conservan su importe.
        </p>
        <div>
          <label
            ><span
              >Nombre <span class="req" aria-hidden="true">*</span
              ><span class="sr-only"> (obligatorio)</span></span
            >
            <input formControlName="name" placeholder="Mensualidad, Inscripción, Uniforme…"
          /></label>
          <app-field-error [control]="form.controls.name" />
        </div>
        <div>
          <label
            ><span
              >Importe sugerido (MXN) <span class="req" aria-hidden="true">*</span
              ><span class="sr-only"> (obligatorio)</span></span
            >
            <input type="number" min="0" step="0.01" inputmode="decimal" formControlName="amount"
          /></label>
          <app-field-error [control]="form.controls.amount" />
        </div>
        <label class="check"
          ><input type="checkbox" formControlName="recurring" /> Recurrente (se usa para generar
          mensualidades)</label
        >
        <div class="actions">
          <button type="submit" [disabled]="submission.busy()">
            {{ submission.busy() ? 'Guardando…' : 'Guardar' }}
          </button>
          <button type="button" class="secondary" (click)="cancel()">Cancelar</button>
        </div>
      </form>
    }

    <app-load-state [res]="concepts" emptyText="Sin conceptos registrados."
      ><ng-template>
        <div class="list-meta">
          <p class="muted">
            Mostrando <strong class="tabular">{{ (concepts.value() ?? []).length }}</strong>
            {{ (concepts.value() ?? []).length === 1 ? 'concepto' : 'conceptos' }}
          </p>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th class="num">Importe sugerido</th>
                <th>Recurrente</th>
                <th class="num">Cargos</th>
                <th>Estado</th>
                <th><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (c of concepts.value() ?? []; track c.id) {
                <tr [class.muted]="!c.active">
                  <td>
                    <strong>{{ c.name }}</strong>
                  </td>
                  <td class="num">{{ c.suggestedAmountCents | money }}</td>
                  <td>{{ c.recurring ? 'Sí' : 'No' }}</td>
                  <td class="num">{{ c.used }}</td>
                  <td>
                    <span class="tag" [class.ok]="c.active" [class.off]="!c.active">{{
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
    name: ['', [Validators.required, catalogNameValidator]],
    amount: [0, [Validators.required, Validators.min(0)]],
    recurring: [false],
  });

  protected panel = new FormPanel('concept-form', () => this.form.dirty);

  edit(c: { id: Id; name: string; suggestedAmountCents: number; recurring: boolean }): void {
    if (!this.panel.close()) return;
    this.reset();
    this.submission.result.set(null);
    this.editingId.set(c.id);
    this.form.setValue({
      name: c.name,
      amount: c.suggestedAmountCents / 100,
      recurring: c.recurring,
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
      setTimeout(() => focusFirstInvalid(document.getElementById('concept-form')!));
      return;
    }
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
      this.panel.done();
      this.reset();
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, LoadState, MoneyPipe, Paginator, SubmissionAlert, PromptDialog],
  template: `
    <div class="page-head">
      <div>
        <h1>Cargos</h1>
        <p class="page-subtitle">
          Control de cobros por jugador, descuentos aplicados, abonos y saldos pendientes.
        </p>
      </div>
      @if (auth.can('cobranza.crear')) {
        <div class="actions">
          <a class="button secondary" routerLink="/admin/billing/monthly">Generar mensualidades</a>
          <button
            type="button"
            (click)="open()"
            [attr.aria-expanded]="panel.open()"
            aria-controls="charge-form"
          >
            Nuevo cargo manual
          </button>
        </div>
      }
    </div>
    <app-submission-alert [submission]="submission" />

    @if (panel.open()) {
      <!-- Closed by default; its result shows in the alert above, so it is never hidden in here. -->
      <form
        id="charge-form"
        class="grid-form"
        (ngSubmit)="create()"
        (keydown.escape)="cancel()"
        novalidate
      >
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
        <label
          >Referencia (opcional)
          <input name="ref" [(ngModel)]="draft.reference" placeholder="Ej. folio o periodo"
        /></label>
        <div class="actions">
          <button
            type="submit"
            [disabled]="submission.busy() || !draft.playerId || !draft.conceptId"
          >
            {{ submission.busy() ? 'Creando…' : 'Crear cargo' }}
          </button>
          <button type="button" class="secondary" (click)="cancel()">Cancelar</button>
        </div>
      </form>
    }

    <div class="filters">
      <label class="filter-grow"
        >Jugador
        <input
          type="search"
          placeholder="Buscar jugador…"
          [ngModel]="query()"
          (ngModelChange)="query.set($event); page.set(1)"
        />
      </label>
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
      @if (hasFilters()) {
        <button type="button" class="secondary sm" (click)="clearFilters()">Limpiar filtros</button>
      }
    </div>

    <app-load-state [res]="charges" emptyText="Sin cargos con los filtros seleccionados."
      ><ng-template>
        <div class="list-meta">
          <p class="muted">
            Mostrando <strong class="tabular">{{ (charges.value()?.items ?? []).length }}</strong> de
            <strong class="tabular">{{ charges.value()?.total }}</strong> cargos
          </p>
        </div>
        <div class="table-wrap">
          <table>
            <caption class="sr-only">
              Cargos: jugador, cargo, vencimiento, importes, saldo y estado
            </caption>
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
                <th><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (c of charges.value()?.items ?? []; track c.id) {
                <tr [class.muted]="c.status === 'CANCELADO'">
                  <td>
                    <a [routerLink]="['/admin/players', c.playerId]">{{ c.playerName }}</a>
                  </td>
                  <td>{{ c.label }}</td>
                  <td class="tabular">{{ c.dueDate ?? '—' }}</td>
                  <td class="num">{{ c.originalAmountCents | money }}</td>
                  <td class="num">{{ c.discountCents ? (c.discountCents | money) : '—' }}</td>
                  <td class="num">{{ c.paidCents | money }}</td>
                  <td class="num">
                    <strong>{{ c.balanceCents | money }}</strong>
                  </td>
                  <td>
                    <span class="tag {{ chargeTone[c.status] }}">{{ labels[c.status] }}</span>
                  </td>
                  <td class="row-actions">
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
            <tfoot>
              <tr>
                <th colspan="3">Total en página</th>
                <th class="num">{{ pageTotals().original | money }}</th>
                <th class="num">
                  {{ pageTotals().discount ? (pageTotals().discount | money) : '—' }}
                </th>
                <th class="num">{{ pageTotals().paid | money }}</th>
                <th class="num">{{ pageTotals().balance | money }}</th>
                <th colspan="2"></th>
              </tr>
            </tfoot>
          </table>
        </div>
        <app-paginator [page]="charges.value()" (go)="page.set($event)" /> </ng-template
    ></app-load-state>
    <app-prompt-dialog #cancelDialog />
  `,
})
export class ChargesPage {
  private cancelDialog = viewChild.required<PromptDialog>('cancelDialog');
  private service = inject(BillingService);
  private playerService = inject(PlayerService);
  protected auth = inject(AuthService);
  protected idOrNull = idOrNull;
  protected labels = CHARGE_STATUS_LABELS;
  protected chargeTone = CHARGE_TONE;
  protected statuses = STATUSES;
  protected players = resource({ loader: () => this.playerService.options() });
  protected concepts = resource({ loader: () => this.service.concepts() });
  protected activeConcepts = computed(() => (this.concepts.value() ?? []).filter((c) => c.active));
  protected query = signal('');
  /** `?status=` preselects the filter (links from the Tablero). */
  protected status = signal<ChargeStatus | ''>(
    catalogParam(inject(ActivatedRoute).snapshot.queryParamMap.get('status'), CHARGE_STATUS_LABELS),
  );
  protected conceptId = signal<Id | null>(null);
  protected period = signal('');
  protected page = signal(1);
  protected hasFilters = computed(
    () =>
      !!this.query().trim() ||
      !!this.status() ||
      this.conceptId() !== null ||
      !!this.period(),
  );
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
  protected pageTotals = computed(() => {
    const items = this.charges.value()?.items ?? [];
    return {
      original: sumCents(items.map((c) => c.originalAmountCents)),
      discount: sumCents(items.map((c) => c.discountCents)),
      paid: sumCents(items.map((c) => c.paidCents)),
      balance: sumCents(items.map((c) => c.balanceCents)),
    };
  });
  protected submission = new Submission();
  protected draft = this.blank();
  private opened = '';
  protected panel = new FormPanel('charge-form', () => JSON.stringify(this.draft) !== this.opened);

  clearFilters(): void {
    this.query.set('');
    this.status.set('');
    this.conceptId.set(null);
    this.period.set('');
    this.page.set(1);
  }

  open(): void {
    if (!this.panel.close()) return;
    this.draft = this.blank();
    this.opened = JSON.stringify(this.draft);
    this.submission.result.set(null);
    this.panel.show();
  }

  /** Closes the form without creating anything (asks first if it has unsaved changes). */
  cancel(): void {
    if (this.panel.close()) this.draft = this.blank();
  }

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
      this.panel.done();
      this.draft = this.blank();
      this.charges.reload();
    }
  }

  async cancelCharge(c: ChargeView): Promise<void> {
    const reason = await this.cancelDialog().open({
      title: 'Cancelar cargo',
      message: `Se cancelará «${c.label}» de ${c.playerName}. El registro se conserva en el historial.`,
      label: 'Motivo de la cancelación',
      placeholder: 'Ej. cargo duplicado o baja previa al periodo',
      confirmText: 'Cancelar cargo',
      tone: 'danger',
      required: true,
    });
    if (!reason) return;
    if (
      await this.submission.run(
        () => this.service.cancelCharge(c.id, reason),
        'Cargo cancelado (se conserva en el historial).',
      )
    )
      this.charges.reload();
  }
}

/** HU-044: monthly fees for active, enrolled players; unique per period; authorized exclusions with a reason. */
@Component({
  selector: 'app-monthly-fees-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, LoadState, SubmissionAlert],
  template: `
    <a class="back-link" routerLink="/admin/billing/charges">← Cargos</a>
    <div class="page-head">
      <div>
        <h1>Generar mensualidades</h1>
        <p class="page-subtitle">
          Un cargo por jugador activo con inscripción ACTIVA en la temporada actual. Si ya existe
          para el concepto y periodo, no se duplica.
        </p>
      </div>
    </div>
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
      <fieldset class="stack">
        <legend>Excluir (regla autorizada, p. ej. beca completa)</legend>
        <app-load-state [res]="candidates" emptyText="No hay jugadores elegibles."
          ><ng-template>
            <p class="field-hint">
              {{ (candidates.value() ?? []).length }} jugadores elegibles ·
              {{ excluded().size }} excluidos
            </p>
            <div class="checks">
              @for (p of candidates.value() ?? []; track p.id) {
                <label class="check"
                  ><input
                    type="checkbox"
                    [checked]="excluded().has(p.id)"
                    (change)="toggle(p.id)"
                  />
                  {{ p.name }}</label
                >
              }
            </div>
          </ng-template></app-load-state
        >
        @if (excluded().size) {
          <label
            >Regla / motivo de la exclusión
            <input
              name="why"
              [(ngModel)]="reason"
              placeholder="Ej. beca deportiva al 100% autorizada"
          /></label>
        }
      </fieldset>
      <app-submission-alert [submission]="submission" />
      <div class="actions">
        <button type="submit" [disabled]="submission.busy() || !conceptId">
          {{ submission.busy() ? 'Generando…' : 'Generar' }}
        </button>
        <a class="button secondary" routerLink="/admin/billing/charges">Cancelar</a>
      </div>
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
  protected excluded = signal(new Set<Id>());
  protected reason = '';

  toggle(id: Id): void {
    const next = new Set(this.excluded());
    if (!next.delete(id)) next.add(id);
    this.excluded.set(next);
  }

  submit(): void {
    this.submission.run(
      () =>
        this.service.generateMonthlyFees({
          conceptId: this.conceptId!,
          period: this.period,
          dueDate: this.dueDate,
          excludedPlayerIds: [...this.excluded()],
          exclusionReason: this.reason || null,
        }),
      (r) => `Se generaron ${r.created} cargo(s) para ${this.period}; ${r.skipped} ya existían.`,
    );
  }
}

/** HU-051: discounts and scholarships per charge (keeps original and final amount; authorized users only). */
@Component({
  selector: 'app-discounts-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, LoadState, MoneyPipe, SubmissionAlert, DatePipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Descuentos y becas</h1>
        <p class="page-subtitle">
          Ajustes autorizados sobre cargos abiertos; el importe original siempre se conserva.
        </p>
      </div>
      @if (auth.can('descuentos.crear')) {
        <button
          type="button"
          (click)="open()"
          [attr.aria-expanded]="panel.open()"
          aria-controls="discount-form"
        >
          Registrar ajuste
        </button>
      }
    </div>
    <app-submission-alert [submission]="submission" />

    @if (panel.open()) {
      <form
        id="discount-form"
        class="grid-form"
        (ngSubmit)="submit()"
        (keydown.escape)="cancel()"
        novalidate
      >
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
        <label
          >Motivo
          <input name="reason" [(ngModel)]="reason" placeholder="Ej. beca por hermanos o mérito"
        /></label>
        <div class="actions">
          <button type="submit" [disabled]="submission.busy() || !chargeId">
            {{ submission.busy() ? 'Aplicando…' : 'Aplicar' }}
          </button>
          <button type="button" class="secondary" (click)="cancel()">Cancelar</button>
        </div>
      </form>
    }

    <app-load-state [res]="discounts" emptyText="Sin descuentos registrados."
      ><ng-template>
        <div class="list-meta">
          <p class="muted">
            Mostrando <strong class="tabular">{{ (discounts.value() ?? []).length }}</strong>
            {{ (discounts.value() ?? []).length === 1 ? 'ajuste' : 'ajustes' }}
          </p>
        </div>
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
                  <td>
                    <span class="tag" [class.ok]="d.type === 'BECA'">
                      {{ d.type === 'BECA' ? 'Beca' : 'Descuento' }}
                    </span>
                  </td>
                  <td class="wrap">{{ d.reason }}</td>
                  <td class="num">{{ d.originalAmountCents | money }}</td>
                  <td class="num">{{ d.adjustmentCents | money }}</td>
                  <td class="num">
                    <strong>{{ d.finalAmountCents | money }}</strong>
                  </td>
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
  private opened = '';
  protected panel = new FormPanel('discount-form', () => this.snapshot() !== this.opened);

  private snapshot(): string {
    return JSON.stringify([
      this.playerId(),
      this.chargeId,
      this.type,
      this.adjustment,
      this.reason,
    ]);
  }

  open(): void {
    if (!this.panel.close()) return;
    this.reset();
    this.opened = this.snapshot();
    this.submission.result.set(null);
    this.panel.show();
  }

  /** Closes the form without applying anything (asks first if it has unsaved changes). */
  cancel(): void {
    if (this.panel.close()) this.reset();
  }

  private reset(): void {
    this.playerId.set(null);
    this.chargeId = null;
    this.type = 'BECA';
    this.adjustment = 0;
    this.reason = '';
  }

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
      this.panel.done();
      this.reset();
      this.discounts.reload();
      this.openCharges.reload();
    }
  }
}

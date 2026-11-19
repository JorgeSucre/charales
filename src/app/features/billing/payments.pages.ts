import { sumCents } from '../../shared/money';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  numberAttribute,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule, NgModel, ValidationErrors } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Id, PaymentMethod } from '../../core/models';
import { CategoryService } from '../../core/services/category.service';
import { PlayerService } from '../../core/services/player.service';
import { nowDateTime } from '../../shared/dates';
import { focusFirstInvalid } from '../../shared/focus';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { PromptDialog } from '../../shared/prompt-dialog';
import { CHARGE_TONE, PAYMENT_TONE } from '../../shared/status-tone';
import { Submission } from '../../shared/submission';
import { Paginator, SubmissionAlert, centsFromInput, idOrNull } from '../../shared/ui';
import {
  BillingService,
  CHARGE_STATUS_LABELS,
  METHODS_WITH_REFERENCE,
  METHOD_LABELS,
  REFERENCE_REQUIRED_MESSAGE,
} from './billing.service';

/** HU-045: payment capture — player, payer (one of their tutors), charges, amount (total or partial), method → folio. */
@Component({
  selector: 'app-payment-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, LoadState, MoneyPipe, SubmissionAlert],
  template: `
    <a class="back-link" routerLink="/admin/billing/receipts">← Recibos</a>
    <div class="page-head">
      <div>
        <h1>Registrar pago</h1>
        <p class="page-subtitle">
          Selecciona jugador, los cargos abiertos a cubrir y la forma de pago para generar el folio.
        </p>
      </div>
    </div>

    <form #formEl class="grid-form" (ngSubmit)="submit()" novalidate>
      <label
        >Jugador
        <select name="player" [ngModel]="playerId()" (ngModelChange)="selectPlayer($event)">
          <option [ngValue]="null">Selecciona…</option>
          @for (p of players.value() ?? []; track p.id) {
            <option [ngValue]="p.id">{{ p.name }}</option>
          }
        </select>
      </label>

      @if (playerId()) {
        <label
          >Quién paga
          <select name="tutor" [(ngModel)]="tutorId">
            <option [ngValue]="null">No especificado</option>
            @for (t of payers.value() ?? []; track t.id) {
              <option [ngValue]="t.id">{{ t.name }} ({{ t.relationship }})</option>
            }
          </select>
        </label>

        <fieldset class="stack">
          <legend>Cargos a pagar (se aplica del más antiguo al más reciente)</legend>
          <app-load-state [res]="open" emptyText="El jugador no tiene adeudos."
            ><ng-template>
              @if ((open.value() ?? []).length) {
                <div class="actions">
                  @if (hasOverdue()) {
                    <button type="button" class="secondary sm" (click)="selectOverdue()">
                      Seleccionar vencidos
                    </button>
                  }
                  <button type="button" class="secondary sm" (click)="selectAll()">
                    Seleccionar todos
                  </button>
                  @if (selected().size) {
                    <button type="button" class="link" (click)="clearSelection()">
                      Limpiar selección
                    </button>
                  }
                </div>
              }
              <div class="charge-pick-list">
                @for (c of open.value() ?? []; track c.id) {
                  <label class="check charge-pick" [class.selected]="selected().has(c.id)">
                    <input
                      type="checkbox"
                      [checked]="selected().has(c.id)"
                      (change)="toggle(c.id)"
                    />
                    <span class="charge-pick-main">
                      <strong>{{ c.label }}</strong>
                      <span class="cell-sub tabular">
                        Vence {{ c.dueDate ?? 'sin fecha' }} · saldo {{ c.balanceCents | money }}
                      </span>
                    </span>
                    <span class="tag {{ chargeTone[c.status] }}">{{ chargeLabels[c.status] }}</span>
                  </label>
                }
              </div>
              <p class="field-hint tabular">
                <strong>Saldo seleccionado: {{ due() | money }}</strong>
              </p>
            </ng-template></app-load-state
          >
        </fieldset>

        <div class="two-col">
          <!-- One .two-col cell; the error stays out of the label so it is not part of the field's name. -->
          <div>
            <label
              >Importe (MXN)
              <input
                type="number"
                required
                min="0.01"
                [max]="due() / 100"
                step="0.01"
                inputmode="decimal"
                name="amount"
                aria-describedby="amount-error"
                [attr.aria-invalid]="amountModel.touched && amountModel.invalid ? 'true' : null"
                [(ngModel)]="amount"
                #amountModel="ngModel"
              />
            </label>
            <small id="amount-error" class="field-error" role="alert">{{
              amountModel.touched ? amountError(amountModel.errors) : ''
            }}</small>
          </div>
          <label
            >Fecha y hora del pago
            <input type="datetime-local" name="paidAt" [(ngModel)]="paidAt" [max]="maxPaidAt" />
          </label>
          <label
            >Forma de pago
            <select name="method" [(ngModel)]="method">
              @for (m of methods; track m[0]) {
                <option [value]="m[0]">{{ m[1] }}</option>
              }
            </select>
          </label>
          @if (needsReference()) {
            <!-- HU-045: only for transfer and card; blank or spaces only is refused here and by the API. -->
            <div>
              <label
                >Referencia o número de comprobante
                <input
                  name="reference"
                  required
                  pattern=".*\\S.*"
                  maxlength="100"
                  autocomplete="off"
                  placeholder="Ej. SPEI-4821 o últimos 4 dígitos"
                  aria-describedby="reference-error"
                  [attr.aria-invalid]="
                    referenceModel.touched && referenceModel.invalid ? 'true' : null
                  "
                  [(ngModel)]="reference"
                  #referenceModel="ngModel"
                />
              </label>
              <small id="reference-error" class="field-error" role="alert">{{
                referenceModel.touched && referenceModel.invalid ? referenceRequired : ''
              }}</small>
            </div>
          }
        </div>

        <div class="actions">
          <button type="button" class="link" (click)="amount = due() / 100" [disabled]="!due()">
            Pagar el total seleccionado
          </button>
        </div>

        @if (selected().size) {
          <dl class="summary" aria-label="Resumen del pago">
            <div>
              <dt>Cargos</dt>
              <dd>{{ selectedLabels() }}</dd>
            </div>
            <div>
              <dt>Importe</dt>
              <dd>{{ previewCents() | money }}</dd>
            </div>
            <div>
              <dt>Forma de pago</dt>
              <dd>{{ methodLabels[method] }}</dd>
            </div>
            @if (needsReference()) {
              <div>
                <dt>Referencia</dt>
                <dd>{{ reference.trim() || '—' }}</dd>
              </div>
            }
            <div>
              <dt>Quién paga</dt>
              <dd>{{ payerName() }}</dd>
            </div>
          </dl>
        }
      }

      @if (!playerId() || !selected().size) {
        <p id="pay-hint" class="alert info">
          {{
            playerId()
              ? 'Selecciona al menos un cargo para habilitar «Registrar pago».'
              : 'Elige un jugador para ver sus cargos con saldo.'
          }}
        </p>
      }
      <app-submission-alert [submission]="submission" />
      <div class="actions">
        <button
          type="submit"
          aria-describedby="pay-hint"
          [disabled]="submission.busy() || !playerId() || !selected().size"
        >
          {{ submission.busy() ? 'Registrando…' : 'Registrar pago' }}
        </button>
      </div>
    </form>

    @if (lastId(); as id) {
      <p class="actions">
        <a class="button secondary" [routerLink]="['/admin/billing/receipts', id]">
          Ver / imprimir recibo
        </a>
      </p>
    }
  `,
})
export class PaymentPage {
  private service = inject(BillingService);
  private playerService = inject(PlayerService);
  protected chargeLabels = CHARGE_STATUS_LABELS;
  protected chargeTone = CHARGE_TONE;
  protected methodLabels = METHOD_LABELS;
  protected methods = Object.entries(METHOD_LABELS) as [PaymentMethod, string][];
  /** HU-045: kept while the form is open, but only sent with a transfer or card (never with cash). */
  protected reference = '';
  protected referenceRequired = REFERENCE_REQUIRED_MESSAGE;
  private formEl = viewChild.required<ElementRef<HTMLFormElement>>('formEl');
  private amountModel = viewChild<NgModel>('amountModel');
  private referenceModel = viewChild<NgModel>('referenceModel');
  private money = new MoneyPipe();
  protected players = resource({ loader: () => this.playerService.options() });
  protected playerId = signal<Id | null>(
    idOrNull(inject(ActivatedRoute).snapshot.queryParamMap.get('player')),
  );
  protected payers = resource({
    params: () => this.playerId() ?? undefined,
    loader: ({ params }) => this.service.payers(params),
  });
  protected open = resource({
    params: () => this.playerId() ?? undefined,
    loader: ({ params }) => this.service.openCharges(params),
  });
  protected selected = signal(new Set<Id>());
  protected hasOverdue = computed(() =>
    (this.open.value() ?? []).some((c) => c.status === 'VENCIDO'),
  );
  protected due = computed(() =>
    sumCents(
      (this.open.value() ?? []).filter((c) => this.selected().has(c.id)).map((c) => c.balanceCents),
    ),
  );
  protected selectedLabels = computed(() =>
    (this.open.value() ?? [])
      .filter((c) => this.selected().has(c.id))
      .map((c) => c.label)
      .join(', '),
  );
  protected tutorId: Id | null = null;
  protected amount: number | null = 0;
  protected method: PaymentMethod = 'EFECTIVO';
  protected maxPaidAt = nowDateTime().slice(0, 16);
  protected paidAt = this.maxPaidAt;
  protected lastId = signal<Id | null>(null);
  protected submission = new Submission();

  protected previewCents(): number {
    const n = Number(this.amount);
    return Number.isFinite(n) && n > 0 ? centsFromInput(n) : 0;
  }

  selectPlayer(id: Id | null): void {
    this.playerId.set(id);
    this.selected.set(new Set());
    this.tutorId = null;
    this.amount = 0;
    this.amountModel()?.control.markAsUntouched();
  }

  selectOverdue(): void {
    const overdueIds = (this.open.value() ?? [])
      .filter((c) => c.status === 'VENCIDO')
      .map((c) => c.id);
    this.selected.set(new Set(overdueIds));
  }

  selectAll(): void {
    this.selected.set(new Set((this.open.value() ?? []).map((c) => c.id)));
  }

  clearSelection(): void {
    this.selected.set(new Set());
  }

  needsReference(): boolean {
    return METHODS_WITH_REFERENCE.includes(this.method);
  }

  payerName(): string {
    return this.payers.value()?.find((t) => t.id === this.tutorId)?.name ?? 'No especificado';
  }

  /** Client check of the amount (required, ≥ $0.01, ≤ balance of the selected charges); the server still validates. */
  amountError(errors: ValidationErrors | null): string {
    if (errors?.['required']) return 'Este campo es obligatorio.';
    if (errors?.['min']) return 'Ingresa un importe de al menos $0.01.';
    if (errors?.['max'])
      return `El importe no puede superar el saldo de los cargos seleccionados (${this.money.transform(this.due())}).`;
    return '';
  }

  toggle(id: Id): void {
    const next = new Set(this.selected());
    if (!next.delete(id)) next.add(id);
    this.selected.set(next);
  }

  async submit(): Promise<void> {
    const field = this.amountModel()?.control;
    // The reference field exists only for transfer and card (HU-045); an invalid form never reaches the service.
    const reference = this.needsReference() ? this.referenceModel()?.control : undefined;
    if (field?.invalid || reference?.invalid) {
      field?.markAsTouched();
      reference?.markAsTouched();
      focusFirstInvalid(this.formEl().nativeElement);
      return;
    }
    if (!confirm(`¿Registrar el pago por $${this.amount}?`)) return;
    const draft = {
      playerId: this.playerId()!,
      tutorId: this.tutorId,
      amountCents: centsFromInput(this.amount),
      method: this.method,
      reference: this.needsReference() ? this.reference.trim() : null,
      chargeIds: [...this.selected()],
      paidAt: this.paidAt,
    };
    const ok = await this.submission.run(
      () => this.service.registerPayment(draft),
      (p) => {
        this.lastId.set(p.id);
        return `Pago registrado con folio ${p.folio}. El saldo se recalculó.`;
      },
    );
    if (ok) {
      this.selected.set(new Set());
      this.amount = 0;
      this.reference = '';
      field?.markAsUntouched();
      reference?.markAsUntouched();
      this.open.reload();
    }
  }
}

/** HU-048 list (search by folio/player) + HU-049 cancellation (authorized role, reason, keeps the payment). */
@Component({
  selector: 'app-receipts-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    LoadState,
    MoneyPipe,
    RouterLink,
    DatePipe,
    Paginator,
    SubmissionAlert,
    PromptDialog,
  ],
  template: `
    <div class="page-head">
      <div>
        <h1>Pagos y recibos</h1>
        <p class="page-subtitle">
          Historial de pagos aplicados o cancelados y acceso a recibos imprimibles por folio.
        </p>
      </div>
      @if (auth.can('pagos.crear')) {
        <a class="button" routerLink="/admin/billing/payments/new">Registrar pago</a>
      }
    </div>
    <app-submission-alert [submission]="submission" />

    <div class="filters">
      <label class="filter-grow"
        >Folio o jugador
        <input
          type="search"
          placeholder="Buscar por folio R-0001 o nombre…"
          [ngModel]="query()"
          (ngModelChange)="query.set($event); page.set(1)"
        />
      </label>
      <label
        >Estado
        <select [ngModel]="status()" (ngModelChange)="status.set($event); page.set(1)">
          <option value="">Todos</option>
          <option value="APLICADO">Aplicados</option>
          <option value="CANCELADO">Cancelados</option>
        </select>
      </label>
      @if (hasFilters()) {
        <button type="button" class="secondary sm" (click)="clearFilters()">Limpiar filtros</button>
      }
    </div>

    <app-load-state [res]="receipts" emptyText="Sin pagos registrados con esos filtros."
      ><ng-template>
        <div class="list-meta">
          <p class="muted">
            Mostrando
            <strong class="tabular">{{ (receipts.value()?.items ?? []).length }}</strong> de
            <strong class="tabular">{{ receipts.value()?.total }}</strong> recibos
          </p>
        </div>
        <div class="table-wrap">
          <table>
            <caption class="sr-only">
              Pagos y recibos: folio, fecha, jugador, quién pagó, forma de pago e importe
            </caption>
            <thead>
              <tr>
                <th>Folio</th>
                <th>Fecha</th>
                <th>Jugador</th>
                <th>Pagó</th>
                <th>Forma</th>
                <th class="num">Importe</th>
                <th><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (r of receipts.value()?.items ?? []; track r.payment.id) {
                <tr [class.muted]="r.payment.status === 'CANCELADO'">
                  <td>
                    <span class="mono">{{ r.payment.folio }}</span>
                    @if (r.payment.status === 'CANCELADO') {
                      <span class="tag {{ paymentTone[r.payment.status] }}">Cancelado</span>
                    } @else {
                      <span class="tag {{ paymentTone[r.payment.status] }}">Aplicado</span>
                    }
                  </td>
                  <td>{{ r.payment.paidAt | date: 'd MMM y, HH:mm' }}</td>
                  <td>
                    <a [routerLink]="['/admin/players', r.payment.playerId]">{{ r.playerName }}</a>
                  </td>
                  <td>{{ r.tutorName ?? '—' }}</td>
                  <td>
                    {{ methods[r.payment.method] }}
                    @if (r.payment.reference) {
                      <div class="cell-sub mono">{{ r.payment.reference }}</div>
                    }
                  </td>
                  <td class="num">
                    <strong>{{ r.payment.amountCents | money }}</strong>
                  </td>
                  <td class="row-actions">
                    <a [routerLink]="['/admin/billing/receipts', r.payment.id]">Ver / reimprimir</a>
                    @if (auth.can('pagos.cancelar') && r.payment.status === 'APLICADO') {
                      <button
                        type="button"
                        class="link danger"
                        (click)="cancel(r.payment.id, r.payment.folio, r.playerName)"
                      >
                        Cancelar
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <app-paginator [page]="receipts.value()" (go)="page.set($event)" /> </ng-template
    ></app-load-state>
    <app-prompt-dialog #cancelDialog />
  `,
})
export class ReceiptsPage {
  private cancelDialog = viewChild.required<PromptDialog>('cancelDialog');
  private service = inject(BillingService);
  protected auth = inject(AuthService);
  protected methods = METHOD_LABELS;
  protected paymentTone = PAYMENT_TONE;
  protected query = signal('');
  protected status = signal<'' | 'APLICADO' | 'CANCELADO'>('');
  protected page = signal(1);
  protected hasFilters = computed(() => !!this.query().trim() || !!this.status());
  protected receipts = resource({
    params: () => ({ query: this.query(), status: this.status(), page: this.page() }),
    loader: ({ params }) => this.service.receipts(params),
  });
  protected submission = new Submission();

  clearFilters(): void {
    this.query.set('');
    this.status.set('');
    this.page.set(1);
  }

  async cancel(id: Id, folio: string, playerName: string): Promise<void> {
    const reason = await this.cancelDialog().open({
      title: `Cancelar pago ${folio}`,
      message: `El pago de ${playerName} se conservará en el historial y los saldos pendientes se reabrirán.`,
      label: 'Motivo de la cancelación',
      placeholder: 'Ej. transferencia rechazada o error de captura',
      confirmText: 'Cancelar pago',
      tone: 'danger',
      required: true,
    });
    if (!reason) return;
    if (
      await this.submission.run(
        () => this.service.cancelPayment(id, reason),
        `Pago ${folio} cancelado; los saldos se reabrieron.`,
      )
    )
      this.receipts.reload();
  }
}

/** HU-048: receipt with folio, date, player, concepts, amount and method; printable; flags cancellation. */
@Component({
  selector: 'app-receipt-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LoadState, MoneyPipe, RouterLink, DatePipe],
  template: `
    <div class="page-head compact no-print">
      <a class="back-link" routerLink="/admin/billing/receipts">← Recibos</a>
      @if (receipt.value()) {
        <button type="button" (click)="print()">Imprimir recibo</button>
      }
    </div>
    <app-load-state [res]="receipt"
      ><ng-template>
        @if (receipt.value(); as r) {
          <article class="receipt">
            <header class="receipt-header">
              <div class="receipt-brand">
                <img src="/logo.png" alt="" class="receipt-logo" width="44" height="44" />
                <div>
                  <p class="receipt-org">Escuela Formativa Charales</p>
                  <p class="receipt-loc">Chapala, Jalisco</p>
                </div>
              </div>
              <div class="receipt-folio">
                <span class="receipt-folio-label">Recibo interno</span>
                <h1 class="mono">{{ r.payment.folio }}</h1>
              </div>
            </header>

            @if (r.payment.status === 'CANCELADO') {
              <p class="alert error">PAGO CANCELADO: {{ r.payment.cancellationReason }}</p>
            }

            <dl class="receipt-meta">
              <dt>Fecha de pago</dt>
              <dd class="tabular">{{ r.payment.paidAt | date: 'd MMM y, HH:mm' }}</dd>
              <dt>Jugador</dt>
              <dd>
                <strong>{{ r.playerName }}</strong>
              </dd>
              <dt>Recibido de</dt>
              <dd>{{ r.tutorName ?? 'No especificado' }}</dd>
              <dt>Forma de pago</dt>
              <dd>{{ methods[r.payment.method] }}</dd>
              @if (r.payment.reference) {
                <dt>Referencia</dt>
                <dd class="mono">{{ r.payment.reference }}</dd>
              }
            </dl>

            <div class="table-wrap receipt-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Concepto cubierto</th>
                    <th class="num">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  @for (l of r.lines; track $index) {
                    <tr>
                      <td>{{ l.label }}</td>
                      <td class="num">{{ l.amountCents | money }}</td>
                    </tr>
                  }
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total pagado</th>
                    <th class="num">{{ r.payment.amountCents | money }}</th>
                  </tr>
                </tfoot>
              </table>
            </div>

            <footer class="receipt-footer">
              <p class="muted">
                Comprobante interno de control escolar — No constituye comprobante fiscal.
              </p>
            </footer>
          </article>
        }
      </ng-template></app-load-state
    >
  `,
})
export class ReceiptPage {
  readonly id = input.required<Id, unknown>({ transform: numberAttribute });
  private service = inject(BillingService);
  protected methods = METHOD_LABELS;
  protected receipt = resource({
    params: () => this.id(),
    loader: ({ params }) => this.service.receipt(params),
  });

  print(): void {
    window.print();
  }
}

/** HU-046: one player's statement — charges and payments by period/concept, balance and overdue. */
@Component({
  selector: 'app-statement-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, LoadState, MoneyPipe, RouterLink, DatePipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Estado de cuenta</h1>
        <p class="page-subtitle">
          Detalle cronológico de cargos, descuentos, pagos y saldo vigente por jugador.
        </p>
      </div>
      @if (playerId() && statement.value()) {
        <button type="button" class="secondary no-print" (click)="print()">Imprimir</button>
      }
    </div>

    <div class="filters no-print">
      <label class="filter-grow"
        >Jugador
        <select [ngModel]="playerId()" (ngModelChange)="pick($event)">
          <option [ngValue]="null">Selecciona…</option>
          @for (p of players.value() ?? []; track p.id) {
            <option [ngValue]="p.id">{{ p.name }}</option>
          }
        </select>
      </label>
      <label
        >Desde <input type="date" [ngModel]="from()" (ngModelChange)="from.set($event)"
      /></label>
      <label>Hasta <input type="date" [ngModel]="to()" (ngModelChange)="to.set($event)" /></label>
      <label
        >Concepto
        <select [ngModel]="conceptId()" (ngModelChange)="conceptId.set(idOrNull($event))">
          <option [ngValue]="null">Todos</option>
          @for (c of concepts.value() ?? []; track c.id) {
            <option [ngValue]="c.id">{{ c.name }}</option>
          }
        </select>
      </label>
      @if (from() || to() || conceptId() !== null) {
        <button type="button" class="secondary sm" (click)="clearFilters()">Limpiar filtros</button>
      }
    </div>

    @if (playerId()) {
      <app-load-state [res]="statement"
        ><ng-template>
          @if (statement.value(); as s) {
            <div class="kpis">
              <div class="kpi">
                <span>Cargado</span><strong>{{ s.totals.chargedCents | money }}</strong>
              </div>
              <div class="kpi">
                <span>Descuentos</span><strong>{{ s.totals.discountCents | money }}</strong>
              </div>
              <div class="kpi kpi-ok">
                <span>Pagado</span><strong>{{ s.totals.paidCents | money }}</strong>
              </div>
              <div class="kpi">
                <span>Saldo</span><strong>{{ s.totals.balanceCents | money }}</strong>
              </div>
              <div class="kpi" [class.danger]="s.totals.overdueCents">
                <span>Vencido</span><strong>{{ s.totals.overdueCents | money }}</strong>
              </div>
            </div>
            @if (auth.can('pagos.crear') && s.totals.balanceCents) {
              <p class="actions no-print">
                <a
                  class="button"
                  [routerLink]="['/admin/billing/payments/new']"
                  [queryParams]="{ player: s.playerId }"
                  >Registrar pago</a
                >
              </p>
            }

            <h2>Cargos</h2>
            <div class="table-wrap">
              <table>
                <caption class="sr-only">
                  Cargos del jugador: fecha, vencimiento, importes, saldo y estado
                </caption>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Cargo</th>
                    <th>Vence</th>
                    <th class="num">Importe</th>
                    <th class="num">Descuento</th>
                    <th class="num">Pagado</th>
                    <th class="num">Saldo</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  @for (c of s.charges; track c.id) {
                    <tr [class.muted]="c.status === 'CANCELADO'">
                      <td class="tabular">{{ c.chargedOn }}</td>
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
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="8" class="muted">Sin cargos en el periodo.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <h2>Pagos</h2>
            <div class="table-wrap">
              <table>
                <caption class="sr-only">
                  Pagos del jugador: folio, fecha, cargos a los que se aplicó, importe y estado
                </caption>
                <thead>
                  <tr>
                    <th>Folio</th>
                    <th>Fecha</th>
                    <th>Aplicado a</th>
                    <th class="num">Importe</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of s.payments; track p.id) {
                    <tr [class.muted]="p.status === 'CANCELADO'">
                      <td>
                        <a class="mono" [routerLink]="['/admin/billing/receipts', p.id]">{{
                          p.folio
                        }}</a>
                      </td>
                      <td>{{ p.paidAt | date: 'd MMM y' }}</td>
                      <td class="wrap">
                        @for (a of p.applied; track $index) {
                          {{ a.label }} ({{ a.amountCents | money }})<br />
                        }
                      </td>
                      <td class="num">{{ p.amountCents | money }}</td>
                      <td>
                        <span class="tag {{ paymentTone[p.status] }}">{{
                          p.status === 'CANCELADO' ? 'Cancelado' : 'Aplicado'
                        }}</span>
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="5" class="muted">Sin pagos en el periodo.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </ng-template></app-load-state
      >
    } @else {
      <p class="alert info">Elige un jugador para ver sus cargos, pagos y saldo.</p>
    }
  `,
})
export class StatementPage {
  private service = inject(BillingService);
  private playerService = inject(PlayerService);
  private router = inject(Router);
  protected auth = inject(AuthService);
  protected idOrNull = idOrNull;
  protected labels = CHARGE_STATUS_LABELS;
  protected chargeTone = CHARGE_TONE;
  protected paymentTone = PAYMENT_TONE;
  protected players = resource({ loader: () => this.playerService.options() });
  protected concepts = resource({ loader: () => this.service.concepts() });
  protected playerId = signal<Id | null>(
    idOrNull(inject(ActivatedRoute).snapshot.queryParamMap.get('player')),
  );
  protected from = signal('');
  protected to = signal('');
  protected conceptId = signal<Id | null>(null);
  protected statement = resource({
    params: () =>
      this.playerId()
        ? { id: this.playerId()!, from: this.from(), to: this.to(), conceptId: this.conceptId() }
        : undefined,
    loader: ({ params }) => this.service.statement(params.id, params),
  });

  pick(id: Id | null): void {
    this.playerId.set(id);
    this.router.navigate([], { queryParams: { player: id }, replaceUrl: true });
  }

  clearFilters(): void {
    this.from.set('');
    this.to.set('');
    this.conceptId.set(null);
  }

  print(): void {
    window.print();
  }
}

/** HU-050: debts by player with primary tutor/contact and overdue balance; filters by period and category. */
@Component({
  selector: 'app-debts-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, LoadState, MoneyPipe, RouterLink],
  template: `
    <div class="page-head">
      <div>
        <h1>Adeudos</h1>
        <p class="page-subtitle">
          Saldos abiertos por jugador con contacto familiar prioritario y acceso directo al estado de
          cuenta.
        </p>
      </div>
    </div>

    <div class="filters">
      <label
        >Periodo del cargo
        <input type="month" [ngModel]="period()" (ngModelChange)="period.set($event)"
      /></label>
      <label
        >Categoría
        <select [ngModel]="categoryId()" (ngModelChange)="categoryId.set(idOrNull($event))">
          <option [ngValue]="null">Todas</option>
          @for (c of categories.value() ?? []; track c.id) {
            <option [ngValue]="c.id">{{ c.name }}</option>
          }
        </select>
      </label>
      <label class="check"
        ><input
          type="checkbox"
          [ngModel]="onlyOverdue()"
          (ngModelChange)="onlyOverdue.set($event)"
        />
        Sólo con saldo vencido</label
      >
      @if (period() || categoryId() !== null || !onlyOverdue()) {
        <button type="button" class="secondary sm" (click)="clearFilters()">Restablecer</button>
      }
    </div>

    <app-load-state [res]="debts" emptyText="No hay adeudos con esos filtros."
      ><ng-template>
        <div class="kpis">
          <div class="kpi" [class.danger]="overdue() > 0">
            <span>Vencido</span><strong>{{ overdue() | money }}</strong>
          </div>
          <div class="kpi">
            <span>Saldo total</span><strong>{{ total() | money }}</strong>
          </div>
        </div>
        <div class="list-meta">
          <p class="muted">
            Jugadores con saldo:
            <strong class="tabular">{{ (debts.value() ?? []).length }}</strong>
          </p>
        </div>
        <div class="table-wrap">
          <table>
            <caption class="sr-only">
              Adeudos por jugador: categoría, tutor principal, contacto, cargos, vencido y saldo
            </caption>
            <thead>
              <tr>
                <th>Jugador</th>
                <th>Categoría</th>
                <th>Tutor principal</th>
                <th>Contacto</th>
                <th class="num">Cargos</th>
                <th>Vence desde</th>
                <th class="num">Vencido</th>
                <th class="num">Saldo</th>
              </tr>
            </thead>
            <tbody>
              @for (d of debts.value() ?? []; track d.playerId) {
                <tr>
                  <td>
                    <a
                      routerLink="/admin/billing/statement"
                      [queryParams]="{ player: d.playerId }"
                      >{{ d.playerName }}</a
                    >
                  </td>
                  <td>{{ d.categoryName ?? '—' }}</td>
                  <td>{{ d.tutorName ?? '—' }}</td>
                  <td>{{ d.tutorContact ?? '—' }}</td>
                  <td class="num">{{ d.openCharges }}</td>
                  <td class="tabular">{{ d.oldestDueDate ?? '—' }}</td>
                  <td class="num" [class.danger]="d.overdueCents">{{ d.overdueCents | money }}</td>
                  <td class="num">
                    <strong>{{ d.balanceCents | money }}</strong>
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
export class DebtsPage {
  private service = inject(BillingService);
  private categoryService = inject(CategoryService);
  protected idOrNull = idOrNull;
  protected categories = resource({ loader: () => this.categoryService.list() });
  protected period = signal('');
  protected categoryId = signal<Id | null>(null);
  protected onlyOverdue = signal(true);
  protected debts = resource({
    params: () => ({
      period: this.period(),
      categoryId: this.categoryId(),
      onlyOverdue: this.onlyOverdue(),
    }),
    loader: ({ params }) => this.service.debts(params),
  });
  protected overdue = computed(() =>
    sumCents((this.debts.value() ?? []).map((d) => d.overdueCents)),
  );
  protected total = computed(() => sumCents((this.debts.value() ?? []).map((d) => d.balanceCents)));

  clearFilters(): void {
    this.period.set('');
    this.categoryId.set(null);
    this.onlyOverdue.set(true);
  }
}

import { sumCents } from '../../shared/money';
import {
  Component,
  computed,
  inject,
  input,
  numberAttribute,
  resource,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Id, PaymentMethod } from '../../core/models';
import { CategoryService } from '../../core/services/category.service';
import { PlayerService } from '../../core/services/player.service';
import { nowDateTime } from '../../shared/dates';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { Submission } from '../../shared/submission';
import { Paginator, SubmissionAlert, centsFromInput, idOrNull } from '../../shared/ui';
import { BillingService, CHARGE_STATUS_LABELS, METHOD_LABELS } from './billing.service';

/** HU-045: payment capture — player, payer (one of their tutors), charges, amount (total or partial), method → folio. */
@Component({
  selector: 'app-payment-page',
  imports: [FormsModule, RouterLink, LoadState, MoneyPipe, SubmissionAlert],
  template: `
    <h1>Registrar pago</h1>
    <form class="grid-form" (ngSubmit)="submit()" novalidate>
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
        <fieldset>
          <legend>Cargos a pagar (se aplica del más antiguo al más reciente)</legend>
          <app-load-state [res]="open" emptyText="El jugador no tiene adeudos."
            ><ng-template>
              @for (c of open.value() ?? []; track c.id) {
                <label class="check">
                  <input type="checkbox" [checked]="selected().has(c.id)" (change)="toggle(c.id)" />
                  {{ c.label }} · vence {{ c.dueDate ?? '—' }} · saldo {{ c.balanceCents | money }}
                  <span class="tag" [class.off]="c.status === 'VENCIDO'">{{
                    chargeLabels[c.status]
                  }}</span>
                </label>
              }
              <p>
                <strong>Saldo seleccionado: {{ due() | money }}</strong>
              </p>
            </ng-template></app-load-state
          >
        </fieldset>
        <div class="two-col">
          <label
            >Importe (MXN)
            <input
              type="number"
              min="0.01"
              step="0.01"
              inputmode="decimal"
              name="amount"
              [(ngModel)]="amount"
          /></label>
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
        </div>
        <button type="button" class="link" (click)="amount = due() / 100">
          Pagar el total seleccionado
        </button>
      }
      <app-submission-alert [submission]="submission" />
      <button type="submit" [disabled]="submission.busy() || !playerId() || !selected().size">
        Registrar pago
      </button>
    </form>
    @if (lastId(); as id) {
      <p><a [routerLink]="['/admin/billing/receipts', id]">Ver / imprimir recibo</a></p>
    }
  `,
})
export class PaymentPage {
  private service = inject(BillingService);
  private playerService = inject(PlayerService);
  protected chargeLabels = CHARGE_STATUS_LABELS;
  protected methods = Object.entries(METHOD_LABELS) as [PaymentMethod, string][];
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
  protected due = computed(() =>
    sumCents(
      (this.open.value() ?? []).filter((c) => this.selected().has(c.id)).map((c) => c.balanceCents),
    ),
  );
  protected tutorId: Id | null = null;
  protected amount = 0;
  protected method: PaymentMethod = 'EFECTIVO';
  protected maxPaidAt = nowDateTime().slice(0, 16);
  protected paidAt = this.maxPaidAt;
  protected lastId = signal<Id | null>(null);
  protected submission = new Submission();

  selectPlayer(id: Id | null): void {
    this.playerId.set(id);
    this.selected.set(new Set());
    this.tutorId = null;
    this.amount = 0;
  }

  toggle(id: Id): void {
    const next = new Set(this.selected());
    if (!next.delete(id)) next.add(id);
    this.selected.set(next);
  }

  async submit(): Promise<void> {
    if (!confirm(`¿Registrar el pago por $${this.amount}?`)) return;
    const draft = {
      playerId: this.playerId()!,
      tutorId: this.tutorId,
      amountCents: centsFromInput(this.amount),
      method: this.method,
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
      this.open.reload();
    }
  }
}

/** HU-048 list (search by folio/player) + HU-049 cancellation (authorized role, reason, keeps the payment). */
@Component({
  selector: 'app-receipts-page',
  imports: [FormsModule, LoadState, MoneyPipe, RouterLink, DatePipe, Paginator, SubmissionAlert],
  template: `
    <div class="page-head">
      <h1>Pagos y recibos</h1>
      @if (auth.can('pagos.crear')) {
        <a class="button" routerLink="/admin/billing/payments/new">Registrar pago</a>
      }
    </div>
    <app-submission-alert [submission]="submission" />
    <div class="filters">
      <label
        >Folio o jugador
        <input type="search" [ngModel]="query()" (ngModelChange)="query.set($event); page.set(1)"
      /></label>
      <label
        >Estado
        <select [ngModel]="status()" (ngModelChange)="status.set($event); page.set(1)">
          <option value="">Todos</option>
          <option value="APLICADO">Aplicados</option>
          <option value="CANCELADO">Cancelados</option>
        </select>
      </label>
    </div>
    <app-load-state [res]="receipts"
      ><ng-template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Folio</th>
                <th>Fecha</th>
                <th>Jugador</th>
                <th>Pagó</th>
                <th>Forma</th>
                <th class="num">Importe</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (r of receipts.value()?.items ?? []; track r.payment.id) {
                <tr>
                  <td>
                    {{ r.payment.folio }}
                    @if (r.payment.status === 'CANCELADO') {
                      <span class="tag off">Cancelado</span>
                    }
                  </td>
                  <td>{{ r.payment.paidAt | date: 'd MMM y, HH:mm' }}</td>
                  <td>{{ r.playerName }}</td>
                  <td>{{ r.tutorName ?? '—' }}</td>
                  <td>{{ methods[r.payment.method] }}</td>
                  <td class="num">{{ r.payment.amountCents | money }}</td>
                  <td class="row-actions">
                    <a [routerLink]="['/admin/billing/receipts', r.payment.id]">Ver / reimprimir</a>
                    @if (auth.can('pagos.cancelar') && r.payment.status === 'APLICADO') {
                      <button
                        type="button"
                        class="link danger"
                        (click)="cancel(r.payment.id, r.payment.folio)"
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
  `,
})
export class ReceiptsPage {
  private service = inject(BillingService);
  protected auth = inject(AuthService);
  protected methods = METHOD_LABELS;
  protected query = signal('');
  protected status = signal<'' | 'APLICADO' | 'CANCELADO'>('');
  protected page = signal(1);
  protected receipts = resource({
    params: () => ({ query: this.query(), status: this.status(), page: this.page() }),
    loader: ({ params }) => this.service.receipts(params),
  });
  protected submission = new Submission();

  async cancel(id: Id, folio: string): Promise<void> {
    const reason = prompt(
      `Motivo para cancelar el pago ${folio} (queda registrado y no se borra):`,
    )?.trim();
    if (!reason) return;
    await this.submission.run(
      () => this.service.cancelPayment(id, reason),
      `Pago ${folio} cancelado; los saldos se reabrieron.`,
    );
    this.receipts.reload();
  }
}

/** HU-048: receipt with folio, date, player, concepts, amount and method; printable; flags cancellation. */
@Component({
  selector: 'app-receipt-page',
  imports: [LoadState, MoneyPipe, RouterLink, DatePipe],
  template: `
    <a routerLink="/admin/billing/receipts" class="no-print">← Recibos</a>
    <app-load-state [res]="receipt"
      ><ng-template>
        @if (receipt.value(); as r) {
          <article class="receipt">
            <h1>Recibo {{ r.payment.folio }}</h1>
            @if (r.payment.status === 'CANCELADO') {
              <p class="alert error">PAGO CANCELADO: {{ r.payment.cancellationReason }}</p>
            }
            <p>Escuela de Fútbol Charales</p>
            <dl>
              <dt>Fecha</dt>
              <dd>{{ r.payment.paidAt | date: 'd MMM y, HH:mm' }}</dd>
              <dt>Jugador</dt>
              <dd>{{ r.playerName }}</dd>
              <dt>Pagó</dt>
              <dd>{{ r.tutorName ?? '—' }}</dd>
              <dt>Forma de pago</dt>
              <dd>{{ methods[r.payment.method] }}</dd>
            </dl>
            <table>
              <thead>
                <tr>
                  <th>Concepto</th>
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
                  <th>Total</th>
                  <th class="num">{{ r.payment.amountCents | money }}</th>
                </tr>
              </tfoot>
            </table>
          </article>
          <button type="button" class="no-print" (click)="print()">Imprimir</button>
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
  imports: [FormsModule, LoadState, MoneyPipe, RouterLink, DatePipe],
  template: `
    <h1>Estado de cuenta</h1>
    <div class="filters">
      <label
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
              <div class="kpi">
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
              <a
                class="button"
                [routerLink]="['/admin/billing/payments/new']"
                [queryParams]="{ player: s.playerId }"
                >Registrar pago</a
              >
            }
            <h2>Cargos</h2>
            <div class="table-wrap">
              <table>
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
                    <tr>
                      <td>{{ c.chargedOn }}</td>
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
                    <tr>
                      <td>
                        <a [routerLink]="['/admin/billing/receipts', p.id]">{{ p.folio }}</a>
                      </td>
                      <td>{{ p.paidAt | date: 'd MMM y' }}</td>
                      <td class="wrap">
                        @for (a of p.applied; track $index) {
                          {{ a.label }} ({{ a.amountCents | money }})<br />
                        }
                      </td>
                      <td class="num">{{ p.amountCents | money }}</td>
                      <td>
                        <span class="tag" [class.off]="p.status === 'CANCELADO'">{{
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
}

/** HU-050: debts by player with primary tutor/contact and overdue balance; filters by period and category. */
@Component({
  selector: 'app-debts-page',
  imports: [FormsModule, LoadState, MoneyPipe, RouterLink],
  template: `
    <h1>Adeudos</h1>
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
    </div>
    <app-load-state [res]="debts" emptyText="No hay adeudos con esos filtros."
      ><ng-template>
        <p>
          <strong>Vencido: {{ overdue() | money }}</strong> · Saldo total: {{ total() | money }}
        </p>
        <div class="table-wrap">
          <table>
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
                  <td>{{ d.oldestDueDate ?? '—' }}</td>
                  <td class="num" [class.danger]="d.overdueCents">{{ d.overdueCents | money }}</td>
                  <td class="num">{{ d.balanceCents | money }}</td>
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
}

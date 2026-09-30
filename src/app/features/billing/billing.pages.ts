import { Component, computed, inject, input, resource } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ConceptKind } from '../../core/models';
import { FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { Submission, today } from '../../shared/submission';
import { BillingService } from './billing.service';

const KIND_LABELS: Record<ConceptKind, string> = {
  monthly: 'Mensualidad',
  enrollment: 'Inscripción',
  uniform: 'Uniforme',
  other: 'Otro',
};

/** HU-043 */
@Component({
  selector: 'app-concepts-page',
  imports: [ReactiveFormsModule, FieldError, LoadState, MoneyPipe],
  template: `
    <h1>Conceptos de cobro</h1>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="grid-form">
      <h2>Nuevo concepto</h2>
      <label>Nombre <input formControlName="name" /></label>
      <app-field-error [control]="form.controls.name" />
      <label
        >Tipo
        <select formControlName="kind">
          @for (k of kinds; track k[0]) {
            <option [value]="k[0]">{{ k[1] }}</option>
          }
        </select>
      </label>
      <label
        >Monto por defecto (MXN)
        <input type="number" min="0" step="0.01" formControlName="amount" inputmode="decimal"
      /></label>
      <app-field-error [control]="form.controls.amount" />
      @if (submission.result(); as r) {
        <p class="alert" [class.ok]="r.ok" [class.error]="!r.ok" role="status">{{ r.text }}</p>
      }
      <button type="submit" [disabled]="submission.busy()">Guardar</button>
    </form>
    <app-load-state [res]="concepts" [empty]="!concepts.value()?.length">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Tipo</th>
              <th class="num">Monto</th>
              <th>Estado</th>
              <th><span class="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            @for (c of concepts.value() ?? []; track c.id) {
              <tr>
                <td>{{ c.name }}</td>
                <td>{{ kindLabels[c.kind] }}</td>
                <td class="num">{{ c.defaultAmountCents | money }}</td>
                <td>
                  <span class="tag" [class.off]="!c.active">{{
                    c.active ? 'Activo' : 'Inactivo'
                  }}</span>
                </td>
                <td>
                  <button type="button" class="link" (click)="toggle(c.id)">
                    {{ c.active ? 'Desactivar' : 'Activar' }}
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </app-load-state>
  `,
})
export class ConceptsPage {
  private service = inject(BillingService);
  protected kindLabels = KIND_LABELS;
  protected kinds = Object.entries(KIND_LABELS) as [ConceptKind, string][];
  protected concepts = resource({ loader: () => this.service.concepts() });
  protected submission = new Submission();
  protected form = inject(FormBuilder).nonNullable.group({
    name: ['', Validators.required],
    kind: ['other' as ConceptKind],
    amount: [0, [Validators.required, Validators.min(0)]],
  });

  async submit(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    const { name, kind, amount } = this.form.getRawValue();
    const draft = { name, kind, defaultAmountCents: Math.round(amount * 100), active: true };
    if (await this.submission.run(() => this.service.saveConcept(draft), 'Concepto guardado.')) {
      this.form.reset();
      this.concepts.reload();
    }
  }

  async toggle(id: string): Promise<void> {
    const concept = this.concepts.value()?.find((c) => c.id === id);
    if (!concept) return;
    await this.submission.run(
      () => this.service.saveConcept({ ...concept, active: !concept.active }),
      'Concepto actualizado.',
    );
    this.concepts.reload();
  }
}

/** HU-044 */
@Component({
  selector: 'app-monthly-fees-page',
  imports: [ReactiveFormsModule, FieldError],
  template: `
    <h1>Generar mensualidades</h1>
    <p class="muted">
      Crea un cargo por jugador activo inscrito en la temporada activa. Si ya existe para el
      periodo, no se duplica.
    </p>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="grid-form">
      <label
        >Concepto
        <select formControlName="conceptId">
          <option value="" disabled>Selecciona…</option>
          @for (c of monthlyConcepts(); track c.id) {
            <option [value]="c.id">{{ c.name }}</option>
          }
        </select>
      </label>
      <app-field-error [control]="form.controls.conceptId" />
      <label>Periodo <input type="month" formControlName="period" /></label>
      <app-field-error [control]="form.controls.period" />
      <label>Fecha límite de pago <input type="date" formControlName="dueDate" /></label>
      <app-field-error [control]="form.controls.dueDate" />
      @if (submission.result(); as r) {
        <p class="alert" [class.ok]="r.ok" [class.error]="!r.ok" role="status">{{ r.text }}</p>
      }
      <button type="submit" [disabled]="submission.busy()">Generar</button>
    </form>
  `,
})
export class MonthlyFeesPage {
  private service = inject(BillingService);
  private concepts = resource({ loader: () => this.service.concepts() });
  protected monthlyConcepts = computed(() =>
    (this.concepts.value() ?? []).filter((c) => c.kind === 'monthly' && c.active),
  );
  protected submission = new Submission();
  protected form = inject(FormBuilder).nonNullable.group({
    conceptId: ['', Validators.required],
    period: [today().slice(0, 7), Validators.required],
    dueDate: [today(), Validators.required],
  });

  submit(): void {
    if (this.form.invalid) return this.form.markAllAsTouched();
    const { conceptId, period, dueDate } = this.form.getRawValue();
    this.submission.run(
      () => this.service.generateMonthlyFees(conceptId, period, dueDate),
      (created) => `Se generaron ${created} cargo(s) para ${period}.`,
    );
  }
}

/** HU-048: list */
@Component({
  selector: 'app-receipts-page',
  imports: [LoadState, MoneyPipe, RouterLink],
  template: `
    <h1>Recibos</h1>
    <app-load-state [res]="receipts" [empty]="!receipts.value()?.length">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Folio</th>
              <th>Fecha</th>
              <th>Jugador</th>
              <th class="num">Monto</th>
              <th><span class="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            @for (r of receipts.value() ?? []; track r.payment.id) {
              <tr>
                <td>{{ r.payment.receiptNumber }}</td>
                <td>{{ r.payment.paidAt }}</td>
                <td>{{ r.playerName }}</td>
                <td class="num">{{ r.payment.amountCents | money }}</td>
                <td><a [routerLink]="r.payment.id">Ver / reimprimir</a></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </app-load-state>
  `,
})
export class ReceiptsPage {
  private service = inject(BillingService);
  protected receipts = resource({ loader: () => this.service.receipts() });
}

/** HU-048: detail + print */
@Component({
  selector: 'app-receipt-page',
  imports: [LoadState, MoneyPipe, RouterLink],
  template: `
    <a routerLink=".." class="no-print">← Recibos</a>
    <app-load-state [res]="receipt">
      @if (receipt.value(); as r) {
        <article class="receipt">
          <h1>Recibo {{ r.payment.receiptNumber }}</h1>
          <p>Escuela de Fútbol Charales</p>
          <dl>
            <dt>Fecha</dt>
            <dd>{{ r.payment.paidAt }}</dd>
            <dt>Jugador</dt>
            <dd>{{ r.playerName }}</dd>
            <dt>Método</dt>
            <dd>{{ methodLabels[r.payment.method] }}</dd>
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
                  <td>{{ l.description }}</td>
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
    </app-load-state>
  `,
})
export class ReceiptPage {
  private service = inject(BillingService);
  readonly id = input.required<string>();
  protected methodLabels = { cash: 'Efectivo', transfer: 'Transferencia', card: 'Tarjeta' };
  protected receipt = resource({
    params: () => this.id(),
    loader: ({ params }) => this.service.receipt(params),
  });

  print(): void {
    window.print();
  }
}

/** HU-050 */
@Component({
  selector: 'app-debts-page',
  imports: [LoadState, MoneyPipe],
  template: `
    <h1>Adeudos</h1>
    <app-load-state
      [res]="debts"
      [empty]="!debts.value()?.length"
      emptyText="No hay adeudos pendientes."
    >
      <p>
        <strong>Total por cobrar: {{ total() | money }}</strong>
      </p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Jugador</th>
              <th class="num">Cargos abiertos</th>
              <th>Vencimiento más antiguo</th>
              <th class="num">Saldo</th>
            </tr>
          </thead>
          <tbody>
            @for (d of debts.value() ?? []; track d.playerId) {
              <tr>
                <td>{{ d.playerName }}</td>
                <td class="num">{{ d.openCharges }}</td>
                <td>{{ d.oldestDueDate }}</td>
                <td class="num">{{ d.balanceCents | money }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </app-load-state>
  `,
})
export class DebtsPage {
  private service = inject(BillingService);
  protected debts = resource({ loader: () => this.service.debts() });
  protected total = computed(() =>
    (this.debts.value() ?? []).reduce((sum, d) => sum + d.balanceCents, 0),
  );
}

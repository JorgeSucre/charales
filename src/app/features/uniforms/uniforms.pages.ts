import { Component, computed, effect, inject, resource, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../core/auth/auth.service';
import { Id, UniformOrderStatus } from '../../core/models';
import { PlayerService } from '../../core/services/player.service';
import { FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { Submission } from '../../shared/submission';
import { SubmissionAlert, centsFromInput } from '../../shared/ui';
import { BillingService, CHARGE_STATUS_LABELS } from '../billing/billing.service';
import { ORDER_STATUS_LABELS, OrderView, UniformService, VariantView } from './uniform.service';

/** HU-052: products and their sizes/prices, editable; used items are deactivated, never deleted. */
@Component({
  selector: 'app-uniform-catalog-page',
  imports: [ReactiveFormsModule, FieldError, LoadState, MoneyPipe, SubmissionAlert],
  template: `
    <h1>Catálogo de uniformes</h1>
    @if (auth.can('uniformes.crear')) {
      <div class="two-col">
        <form [formGroup]="productForm" (ngSubmit)="addProduct()" novalidate class="grid-form">
          <h2>Nuevo producto</h2>
          <label>Nombre <input formControlName="name" /></label>
          <app-field-error [control]="productForm.controls.name" />
          <label>Descripción <input formControlName="description" /></label>
          <button type="submit" [disabled]="submission.busy()">Agregar producto</button>
        </form>
        <form [formGroup]="variantForm" (ngSubmit)="saveVariant()" novalidate class="grid-form">
          <h2>{{ editingVariant() ? 'Editar talla' : 'Nueva talla' }}</h2>
          <label
            >Producto
            <select formControlName="productId">
              <option [ngValue]="null" disabled>Selecciona…</option>
              @for (p of products.value() ?? []; track p.id) {
                <option [ngValue]="p.id">{{ p.name }}</option>
              }
            </select>
          </label>
          <app-field-error [control]="variantForm.controls.productId" />
          <label>Talla <input formControlName="size" placeholder="CH, M, G, 10…" /></label>
          <app-field-error [control]="variantForm.controls.size" />
          <label
            >Precio (MXN)
            <input type="number" min="0" step="0.01" inputmode="decimal" formControlName="price"
          /></label>
          <app-field-error [control]="variantForm.controls.price" />
          <p class="muted">
            Cambiar el precio no altera pedidos existentes: cada pedido guarda su precio.
          </p>
          <div class="actions">
            <button type="submit" [disabled]="submission.busy()">Guardar talla</button>
            @if (editingVariant()) {
              <button type="button" class="secondary" (click)="resetVariant()">Cancelar</button>
            }
          </div>
        </form>
      </div>
    }
    <app-submission-alert [submission]="submission" />
    <app-load-state [res]="variants"
      ><ng-template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Talla</th>
                <th class="num">Precio</th>
                <th class="num">En pedidos</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (v of variants.value() ?? []; track v.id) {
                <tr>
                  <td>{{ v.productName }}</td>
                  <td>{{ v.size }}</td>
                  <td class="num">{{ v.priceCents | money }}</td>
                  <td class="num">{{ v.used }}</td>
                  <td>
                    <span class="tag" [class.off]="!v.active">{{
                      v.active ? 'Activo' : 'Inactivo'
                    }}</span>
                  </td>
                  <td class="row-actions">
                    @if (auth.can('uniformes.editar')) {
                      <button type="button" class="link" (click)="editVariant(v)">Editar</button>
                      <button type="button" class="link" (click)="toggleVariant(v)">
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
    <h2>Productos</h2>
    <ul class="chips">
      @for (p of products.value() ?? []; track p.id) {
        <li>
          {{ p.name }}
          @if (auth.can('uniformes.editar')) {
            <button type="button" class="link" (click)="toggleProduct(p.id, !p.active)">
              {{ p.active ? 'Desactivar' : 'Activar' }}
            </button>
          }
        </li>
      }
    </ul>
  `,
})
export class UniformCatalogPage {
  private service = inject(UniformService);
  protected auth = inject(AuthService);
  private fb = inject(FormBuilder).nonNullable;
  protected products = resource({ loader: () => this.service.products() });
  protected variants = resource({ loader: () => this.service.variants() });
  protected submission = new Submission();
  protected editingVariant = signal<Id | null>(null);
  protected productForm = this.fb.group({ name: ['', Validators.required], description: [''] });
  protected variantForm = this.fb.group({
    productId: [null as Id | null, Validators.required],
    size: ['', Validators.required],
    price: [0, [Validators.required, Validators.min(0)]],
  });

  async addProduct(): Promise<void> {
    if (this.productForm.invalid) return this.productForm.markAllAsTouched();
    const { name, description } = this.productForm.getRawValue();
    if (
      await this.submission.run(
        () => this.service.saveProduct({ name, description }),
        'Producto agregado.',
      )
    ) {
      this.productForm.reset();
      this.products.reload();
    }
  }

  editVariant(v: VariantView): void {
    this.editingVariant.set(v.id);
    this.variantForm.setValue({ productId: v.productId, size: v.size, price: v.priceCents / 100 });
  }

  resetVariant(): void {
    this.editingVariant.set(null);
    this.variantForm.reset();
  }

  async saveVariant(): Promise<void> {
    if (this.variantForm.invalid) return this.variantForm.markAllAsTouched();
    const { productId, size, price } = this.variantForm.getRawValue();
    const draft = {
      id: this.editingVariant() ?? undefined,
      productId: productId!,
      size,
      priceCents: centsFromInput(price),
    };
    if (await this.submission.run(() => this.service.saveVariant(draft), 'Talla guardada.')) {
      this.resetVariant();
      this.variants.reload();
    }
  }

  async toggleVariant(v: VariantView): Promise<void> {
    await this.submission.run(
      () => this.service.setVariantActive(v.id, !v.active),
      'Talla actualizada.',
    );
    this.variants.reload();
  }

  async toggleProduct(id: Id, active: boolean): Promise<void> {
    await this.submission.run(
      () => this.service.setProductActive(id, active),
      'Producto actualizado.',
    );
    this.products.reload();
  }
}

/** HU-053 (order with price at the time), HU-054 (linked charge, PAGADO from its balance), HU-055 (delivery), cancel. */
@Component({
  selector: 'app-uniform-orders-page',
  imports: [ReactiveFormsModule, FormsModule, FieldError, LoadState, MoneyPipe, SubmissionAlert],
  template: `
    <h1>Pedidos de uniforme</h1>
    @if (auth.can('uniformes.crear')) {
      <form [formGroup]="form" (ngSubmit)="addItem()" novalidate class="grid-form">
        <h2>Nuevo pedido</h2>
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
        <div class="two-col">
          <label
            >Producto y talla
            <select formControlName="variantId">
              <option [ngValue]="null" disabled>Selecciona…</option>
              @for (v of variants.value() ?? []; track v.id) {
                <option [ngValue]="v.id">
                  {{ v.productName }} {{ v.size }} · {{ v.priceCents | money }}
                </option>
              }
            </select>
          </label>
          <label>Cantidad <input type="number" min="1" formControlName="quantity" /></label>
        </div>
        <app-field-error [control]="form.controls.variantId" />
        <button type="submit" class="secondary">Agregar artículo</button>
        @if (items().length) {
          <ul>
            @for (i of items(); track $index) {
              <li>
                {{ i.quantity }} × {{ labelOf(i.variantId) }}
                <button type="button" class="link danger" (click)="removeItem($index)">
                  Quitar
                </button>
              </li>
            }
          </ul>
          <p>
            <strong>Total: {{ total() | money }}</strong>
          </p>
          <label
            >Concepto del cargo
            <select formControlName="conceptId">
              @for (c of concepts(); track c.id) {
                <option [ngValue]="c.id">{{ c.name }}</option>
              }
            </select>
          </label>
          <button type="button" (click)="createOrder()" [disabled]="submission.busy()">
            Crear pedido y cargo
          </button>
        }
      </form>
    }
    <app-submission-alert [submission]="submission" />
    <div class="filters">
      <label
        >Estado
        <select [ngModel]="status()" (ngModelChange)="status.set($event)">
          <option value="">Todos</option>
          @for (s of statuses; track s[0]) {
            <option [value]="s[0]">{{ s[1] }}</option>
          }
        </select>
      </label>
    </div>
    <app-load-state [res]="orders" emptyText="Sin pedidos registrados."
      ><ng-template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Jugador</th>
                <th>Artículos</th>
                <th class="num">Total</th>
                <th>Cobro</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (o of orders.value() ?? []; track o.id) {
                <tr>
                  <td>{{ o.requestedOn }}</td>
                  <td>{{ o.playerName }}</td>
                  <td class="wrap">
                    @for (l of o.lines; track $index) {
                      {{ l.quantity }} × {{ l.product }} {{ l.size }} ({{
                        l.unitPriceCents | money
                      }})<br />
                    }
                  </td>
                  <td class="num">{{ o.totalCents | money }}</td>
                  <td>
                    {{
                      o.charge
                        ? chargeLabels[o.charge.status] +
                          ' · saldo ' +
                          (o.charge.balanceCents | money)
                        : 'Sin cargo'
                    }}
                  </td>
                  <td>
                    <span class="tag" [class.off]="o.status === 'CANCELADO'">{{
                      labels[o.status]
                    }}</span>
                    @if (o.status === 'ENTREGADO') {
                      <br /><small>{{ o.deliveredOn }} a {{ o.receivedBy }}</small>
                    }
                  </td>
                  <td class="row-actions">
                    @if (
                      auth.can('uniformes.editar') &&
                      (o.status === 'SOLICITADO' || o.status === 'PAGADO')
                    ) {
                      <button type="button" class="link" (click)="deliver(o)">Entregar</button>
                      <button type="button" class="link danger" (click)="cancel(o)">
                        Cancelar
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
export class UniformOrdersPage {
  private service = inject(UniformService);
  private playerService = inject(PlayerService);
  private billing = inject(BillingService);
  protected auth = inject(AuthService);
  protected labels = ORDER_STATUS_LABELS;
  protected chargeLabels = CHARGE_STATUS_LABELS;
  protected statuses = Object.entries(ORDER_STATUS_LABELS) as [UniformOrderStatus, string][];
  protected players = resource({ loader: () => this.playerService.options(true) });
  protected variants = resource({ loader: () => this.service.variants(true) });
  private conceptList = resource({ loader: () => this.billing.concepts() });
  /** cargos needs a concept; MariaDB has no "uniform" kind, so the user picks one (default: the one named like uniform). */
  protected concepts = computed(() =>
    (this.conceptList.value() ?? []).filter((c) => c.active && !c.recurring),
  );
  protected status = signal<UniformOrderStatus | ''>('');
  protected orders = resource({
    params: () => this.status(),
    loader: ({ params }) => this.service.orders({ status: params }),
  });
  protected items = signal<{ variantId: Id; quantity: number }[]>([]);
  protected total = computed(() =>
    this.items().reduce(
      (s, i) =>
        s +
        i.quantity * (this.variants.value()?.find((v) => v.id === i.variantId)?.priceCents ?? 0),
      0,
    ),
  );
  protected submission = new Submission();
  protected form = inject(FormBuilder).nonNullable.group({
    playerId: [null as Id | null, Validators.required],
    variantId: [null as Id | null, Validators.required],
    quantity: [1, [Validators.required, Validators.min(1)]],
    conceptId: [null as Id | null],
  });

  constructor() {
    effect(() => {
      const uniform = this.concepts().find((c) => /uniform/i.test(c.name)) ?? this.concepts()[0];
      if (uniform && this.form.controls.conceptId.value === null)
        this.form.controls.conceptId.setValue(uniform.id);
    });
  }

  labelOf(variantId: Id): string {
    const v = this.variants.value()?.find((x) => x.id === variantId);
    return v ? `${v.productName} ${v.size}` : '—';
  }

  addItem(): void {
    const { variantId, quantity } = this.form.getRawValue();
    if (!variantId || quantity < 1) return this.form.controls.variantId.markAsTouched();
    this.items.update((list) => [...list, { variantId, quantity }]);
    this.form.patchValue({ variantId: null, quantity: 1 });
    this.form.controls.variantId.markAsUntouched();
  }

  removeItem(index: number): void {
    this.items.update((list) => list.filter((_, i) => i !== index));
  }

  async createOrder(): Promise<void> {
    const { playerId, conceptId } = this.form.getRawValue();
    if (!playerId) return this.form.controls.playerId.markAsTouched();
    const ok = await this.submission.run(
      () => this.service.createOrder(playerId, this.items(), conceptId!),
      (o) =>
        o.chargeId
          ? 'Pedido creado; se generó el cargo en cobranza.'
          : 'Pedido creado (total $0, sin cargo).',
    );
    if (ok) {
      this.items.set([]);
      this.form.patchValue({ playerId: null });
      this.form.markAsUntouched();
      this.orders.reload();
    }
  }

  async deliver(o: OrderView): Promise<void> {
    const receivedBy = prompt(`¿Quién recibe el uniforme de ${o.playerName}?`)?.trim();
    if (!receivedBy) return;
    await this.submission.run(() => this.service.deliver(o.id, receivedBy), 'Entrega registrada.');
    this.orders.reload();
  }

  async cancel(o: OrderView): Promise<void> {
    const reason = prompt(`Motivo para cancelar el pedido de ${o.playerName}:`)?.trim();
    if (!reason) return;
    await this.submission.run(
      () => this.service.cancelOrder(o.id, reason),
      'Pedido cancelado; su cargo también.',
    );
    this.orders.reload();
  }
}

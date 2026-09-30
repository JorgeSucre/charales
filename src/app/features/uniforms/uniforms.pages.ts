import { Component, computed, inject, resource, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { PlayerService } from '../../core/services/player.service';
import { FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { Submission } from '../../shared/submission';
import { UniformService } from './uniform.service';

/** HU-052: products and their sizes/prices. */
@Component({
  selector: 'app-uniform-catalog-page',
  imports: [ReactiveFormsModule, FieldError, LoadState, MoneyPipe],
  template: `
    <h1>Catálogo de uniformes</h1>
    <div class="two-col">
      <form [formGroup]="productForm" (ngSubmit)="addProduct()" novalidate class="grid-form">
        <h2>Nuevo producto</h2>
        <label>Nombre <input formControlName="name" /></label>
        <app-field-error [control]="productForm.controls.name" />
        <button type="submit" [disabled]="submission.busy()">Agregar producto</button>
      </form>
      <form [formGroup]="variantForm" (ngSubmit)="addVariant()" novalidate class="grid-form">
        <h2>Nueva talla</h2>
        <label
          >Producto
          <select formControlName="productId">
            <option value="" disabled>Selecciona…</option>
            @for (p of products.value() ?? []; track p.id) {
              <option [value]="p.id">{{ p.name }}</option>
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
        <button type="submit" [disabled]="submission.busy()">Agregar talla</button>
      </form>
    </div>
    @if (submission.result(); as r) {
      <p class="alert" [class.ok]="r.ok" [class.error]="!r.ok" role="status">{{ r.text }}</p>
    }
    <app-load-state [res]="variants" [empty]="!rows().length">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Talla</th>
              <th class="num">Precio</th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.id) {
              <tr>
                <td>{{ r.product }}</td>
                <td>{{ r.size }}</td>
                <td class="num">{{ r.priceCents | money }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </app-load-state>
  `,
})
export class UniformCatalogPage {
  private service = inject(UniformService);
  private fb = inject(FormBuilder).nonNullable;
  protected products = resource({ loader: () => this.service.products() });
  protected variants = resource({ loader: () => this.service.variants() });
  protected rows = computed(() => {
    const products = this.products.value() ?? [];
    return (this.variants.value() ?? []).map((v) => ({
      ...v,
      product: products.find((p) => p.id === v.productId)?.name ?? '—',
    }));
  });
  protected submission = new Submission();
  protected productForm = this.fb.group({ name: ['', Validators.required] });
  protected variantForm = this.fb.group({
    productId: ['', Validators.required],
    size: ['', Validators.required],
    price: [0, [Validators.required, Validators.min(0)]],
  });

  async addProduct(): Promise<void> {
    if (this.productForm.invalid) return this.productForm.markAllAsTouched();
    if (
      await this.submission.run(
        () => this.service.saveProduct(this.productForm.getRawValue().name),
        'Producto agregado.',
      )
    ) {
      this.productForm.reset();
      this.products.reload();
    }
  }

  async addVariant(): Promise<void> {
    if (this.variantForm.invalid) return this.variantForm.markAllAsTouched();
    const { productId, size, price } = this.variantForm.getRawValue();
    const draft = {
      productId,
      size: size.trim().toUpperCase(),
      priceCents: Math.round(price * 100),
    };
    if (await this.submission.run(() => this.service.saveVariant(draft), 'Talla agregada.')) {
      this.variantForm.reset();
      this.variants.reload();
    }
  }
}

/** HU-053 (order), HU-054 (creates the billing charge), HU-055 (delivery). */
@Component({
  selector: 'app-uniform-orders-page',
  imports: [ReactiveFormsModule, FieldError, LoadState, MoneyPipe],
  template: `
    <h1>Pedidos de uniforme</h1>
    <form [formGroup]="form" (ngSubmit)="addItem()" novalidate class="grid-form">
      <h2>Nuevo pedido</h2>
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
        >Artículo
        <select formControlName="variantId">
          <option value="" disabled>Selecciona…</option>
          @for (v of variantOptions(); track v.id) {
            <option [value]="v.id">{{ v.label }}</option>
          }
        </select>
      </label>
      <app-field-error [control]="form.controls.variantId" />
      <label>Cantidad <input type="number" min="1" formControlName="quantity" /></label>
      <app-field-error [control]="form.controls.quantity" />
      <button type="submit" class="secondary">Agregar artículo</button>
      @if (items().length) {
        <ul>
          @for (i of items(); track $index) {
            <li>
              {{ i.quantity }} × {{ labelOf(i.variantId) }}
              <button type="button" class="link danger" (click)="removeItem($index)">Quitar</button>
            </li>
          }
        </ul>
        <button type="button" (click)="createOrder()" [disabled]="submission.busy()">
          Crear pedido y cargo
        </button>
      }
    </form>
    @if (submission.result(); as r) {
      <p class="alert" [class.ok]="r.ok" [class.error]="!r.ok" role="status">{{ r.text }}</p>
    }
    <app-load-state
      [res]="orders"
      [empty]="!orders.value()?.length"
      emptyText="Sin pedidos registrados."
    >
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Jugador</th>
              <th>Artículos</th>
              <th class="num">Total</th>
              <th>Entrega</th>
            </tr>
          </thead>
          <tbody>
            @for (o of orders.value() ?? []; track o.id) {
              <tr>
                <td>{{ o.createdAt }}</td>
                <td>{{ o.playerName }}</td>
                <td>{{ o.items.join(', ') }}</td>
                <td class="num">{{ o.totalCents | money }}</td>
                <td>
                  @if (o.status === 'delivered') {
                    Entregado a {{ o.deliveredTo }}
                  } @else {
                    <button type="button" class="link" (click)="deliver(o.id)">
                      Registrar entrega
                    </button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </app-load-state>
  `,
})
export class UniformOrdersPage {
  private service = inject(UniformService);
  private playerService = inject(PlayerService);
  protected players = resource({ loader: () => this.playerService.list() });
  private products = resource({ loader: () => this.service.products() });
  private variants = resource({ loader: () => this.service.variants() });
  protected orders = resource({ loader: () => this.service.orders() });
  protected variantOptions = computed(() => {
    const products = this.products.value() ?? [];
    return (this.variants.value() ?? [])
      .filter((v) => v.active)
      .map((v) => ({
        id: v.id,
        label: `${products.find((p) => p.id === v.productId)?.name ?? '—'} ${v.size}`,
      }));
  });
  protected items = signal<{ variantId: string; quantity: number }[]>([]);
  protected submission = new Submission();
  protected form = inject(FormBuilder).nonNullable.group({
    playerId: ['', Validators.required],
    variantId: ['', Validators.required],
    quantity: [1, [Validators.required, Validators.min(1)]],
  });

  labelOf(variantId: string): string {
    return this.variantOptions().find((v) => v.id === variantId)?.label ?? '—';
  }

  addItem(): void {
    if (this.form.invalid) return this.form.markAllAsTouched();
    const { variantId, quantity } = this.form.getRawValue();
    this.items.update((list) => [...list, { variantId, quantity }]);
    this.form.patchValue({ variantId: '', quantity: 1 });
    this.form.controls.variantId.markAsUntouched();
  }

  removeItem(index: number): void {
    this.items.update((list) => list.filter((_, i) => i !== index));
  }

  async createOrder(): Promise<void> {
    const playerId = this.form.getRawValue().playerId;
    if (!playerId) return this.form.controls.playerId.markAsTouched();
    const ok = await this.submission.run(
      () => this.service.createOrder(playerId, this.items()),
      'Pedido creado. Se generó el cargo en cobranza.',
    );
    if (ok) {
      this.items.set([]);
      this.form.reset();
      this.orders.reload();
    }
  }

  async deliver(orderId: string): Promise<void> {
    const deliveredTo = prompt('¿Quién recibe el uniforme?')?.trim();
    if (!deliveredTo) return;
    await this.submission.run(
      () => this.service.deliver(orderId, deliveredTo),
      'Entrega registrada.',
    );
    this.orders.reload();
  }
}

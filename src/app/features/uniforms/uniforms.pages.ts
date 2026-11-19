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
import { Id, UniformOrderStatus } from '../../core/models';
import { PlayerService } from '../../core/services/player.service';
import { catalogNameValidator } from '../../shared/validate';
import { FieldA11y, FieldError } from '../../shared/field-error';
import { FormPanel } from '../../shared/form-panel';
import { focusFirstInvalid } from '../../shared/focus';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { PromptDialog } from '../../shared/prompt-dialog';
import { CHARGE_TONE, ORDER_TONE } from '../../shared/status-tone';
import { Submission } from '../../shared/submission';
import { SubmissionAlert, centsFromInput } from '../../shared/ui';
import { BillingService, CHARGE_STATUS_LABELS } from '../billing/billing.service';
import { ORDER_STATUS_LABELS, OrderView, UniformService, VariantView } from './uniform.service';

/** HU-052: products and their sizes/prices, editable; used items are deactivated, never deleted. */
@Component({
  selector: 'app-uniform-catalog-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, FieldError, FieldA11y, LoadState, MoneyPipe, SubmissionAlert],
  template: `
    <div class="page-head">
      <div>
        <h1>Catálogo de uniformes</h1>
        <p class="page-subtitle">
          Prendas, tallas y precios vigentes; los pedidos previos conservan su precio histórico.
        </p>
      </div>
      @if (auth.can('uniformes.crear')) {
        <div class="actions">
          <button
            type="button"
            class="secondary"
            (click)="openProduct()"
            [attr.aria-expanded]="productPanel.open()"
            aria-controls="product-form"
          >
            Nuevo producto
          </button>
          <button
            type="button"
            (click)="openVariant()"
            [attr.aria-expanded]="variantPanel.open() && !editingVariant()"
            aria-controls="variant-form"
          >
            Nueva talla
          </button>
        </div>
      }
    </div>
    <app-submission-alert [submission]="submission" />

    @if (productPanel.open()) {
      <form
        id="product-form"
        [formGroup]="productForm"
        (ngSubmit)="addProduct()"
        (keydown.escape)="cancelProduct()"
        novalidate
        class="grid-form"
      >
        <h2>Nuevo producto</h2>
        <div>
          <label
            ><span
              >Nombre <span class="req" aria-hidden="true">*</span
              ><span class="sr-only"> (obligatorio)</span></span
            >
            <input formControlName="name" placeholder="Ej. Uniforme de juego o pants"
          /></label>
          <app-field-error [control]="productForm.controls.name" />
        </div>
        <label
          >Descripción
          <input formControlName="description" placeholder="Detalles opcionales del artículo"
        /></label>
        <div class="actions">
          <button type="submit" [disabled]="submission.busy()">
            {{ submission.busy() ? 'Guardando…' : 'Agregar producto' }}
          </button>
          <button type="button" class="secondary" (click)="cancelProduct()">Cancelar</button>
        </div>
      </form>
    }

    @if (variantPanel.open()) {
      <form
        id="variant-form"
        [formGroup]="variantForm"
        (ngSubmit)="saveVariant()"
        (keydown.escape)="cancelVariant()"
        novalidate
        class="grid-form"
      >
        <h2>{{ editingVariant() ? 'Editar talla' : 'Nueva talla' }}</h2>
        <div>
          <label
            ><span
              >Producto <span class="req" aria-hidden="true">*</span
              ><span class="sr-only"> (obligatorio)</span></span
            >
            <select formControlName="productId">
              <option [ngValue]="null" disabled>Selecciona…</option>
              @for (p of products.value() ?? []; track p.id) {
                <option [ngValue]="p.id">{{ p.name }}</option>
              }
            </select>
          </label>
          <app-field-error [control]="variantForm.controls.productId" />
        </div>
        <div class="two-col">
          <div>
            <label
              ><span
                >Talla <span class="req" aria-hidden="true">*</span
                ><span class="sr-only"> (obligatorio)</span></span
              >
              <input formControlName="size" placeholder="CH, M, G, 10…"
            /></label>
            <app-field-error [control]="variantForm.controls.size" />
          </div>
          <div>
            <label
              ><span
                >Precio (MXN) <span class="req" aria-hidden="true">*</span
                ><span class="sr-only"> (obligatorio)</span></span
              >
              <input type="number" min="0" step="0.01" inputmode="decimal" formControlName="price"
            /></label>
            <app-field-error [control]="variantForm.controls.price" />
          </div>
        </div>
        <p class="field-hint">
          Cambiar el precio no altera pedidos existentes: cada pedido guarda su precio.
        </p>
        <div class="actions">
          <button type="submit" [disabled]="submission.busy()">
            {{ submission.busy() ? 'Guardando…' : 'Guardar talla' }}
          </button>
          <button type="button" class="secondary" (click)="cancelVariant()">Cancelar</button>
        </div>
      </form>
    }

    <app-load-state [res]="variants" emptyText="Sin tallas registradas."
      ><ng-template>
        <div class="list-meta">
          <p class="muted">
            Mostrando <strong class="tabular">{{ (variants.value() ?? []).length }}</strong> tallas
            en catálogo
          </p>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Talla</th>
                <th class="num">Precio</th>
                <th class="num">En pedidos</th>
                <th>Estado</th>
                <th><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (v of variants.value() ?? []; track v.id) {
                <tr [class.muted]="!v.active">
                  <td>
                    <strong>{{ v.productName }}</strong>
                  </td>
                  <td>{{ v.size }}</td>
                  <td class="num">{{ v.priceCents | money }}</td>
                  <td class="num">{{ v.used }}</td>
                  <td>
                    <span class="tag" [class.ok]="v.active" [class.off]="!v.active">{{
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

    <h2>Productos registrados</h2>
    <ul class="chips">
      @for (p of products.value() ?? []; track p.id) {
        <li>
          <span>{{ p.name }}</span>
          <span class="tag" [class.ok]="p.active" [class.off]="!p.active">
            {{ p.active ? 'Activo' : 'Inactivo' }}
          </span>
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
  protected productForm = this.fb.group({
    name: ['', [Validators.required, catalogNameValidator]],
    description: [''],
  });
  protected variantForm = this.fb.group({
    productId: [null as Id | null, Validators.required],
    size: ['', Validators.required],
    price: [0, [Validators.required, Validators.min(0)]],
  });

  protected productPanel = new FormPanel('product-form', () => this.productForm.dirty);
  protected variantPanel = new FormPanel('variant-form', () => this.variantForm.dirty);

  /** One form at a time: opening one closes the other (asking first if it has unsaved changes). */
  private closeForms(): boolean {
    if (!this.productPanel.close() || !this.variantPanel.close()) return false;
    this.productForm.reset();
    this.resetVariant();
    this.submission.result.set(null);
    return true;
  }

  openProduct(): void {
    if (this.closeForms()) this.productPanel.show();
  }

  openVariant(): void {
    if (this.closeForms()) this.variantPanel.show();
  }

  cancelProduct(): void {
    if (this.productPanel.close()) this.productForm.reset();
  }

  cancelVariant(): void {
    if (this.variantPanel.close()) this.resetVariant();
  }

  async addProduct(): Promise<void> {
    if (this.productForm.invalid) {
      this.productForm.markAllAsTouched();
      setTimeout(() => focusFirstInvalid(document.getElementById('product-form')!));
      return;
    }
    const { name, description } = this.productForm.getRawValue();
    if (
      await this.submission.run(
        () => this.service.saveProduct({ name, description }),
        'Producto agregado.',
      )
    ) {
      this.productPanel.done();
      this.productForm.reset();
      this.products.reload();
    }
  }

  editVariant(v: VariantView): void {
    if (!this.closeForms()) return;
    this.editingVariant.set(v.id);
    this.variantForm.setValue({ productId: v.productId, size: v.size, price: v.priceCents / 100 });
    this.variantForm.markAsPristine();
    this.variantPanel.show();
  }

  private resetVariant(): void {
    this.editingVariant.set(null);
    this.variantForm.reset();
  }

  async saveVariant(): Promise<void> {
    if (this.variantForm.invalid) {
      this.variantForm.markAllAsTouched();
      setTimeout(() => focusFirstInvalid(document.getElementById('variant-form')!));
      return;
    }
    const { productId, size, price } = this.variantForm.getRawValue();
    const draft = {
      id: this.editingVariant() ?? undefined,
      productId: productId!,
      size,
      priceCents: centsFromInput(price),
    };
    if (await this.submission.run(() => this.service.saveVariant(draft), 'Talla guardada.')) {
      this.variantPanel.done();
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
        <h1>Pedidos de uniforme</h1>
        <p class="page-subtitle">
          Solicitudes por jugador, cobros vinculados en cobranza y control de entregas.
        </p>
      </div>
      @if (auth.can('uniformes.crear')) {
        <button
          type="button"
          (click)="open()"
          [attr.aria-expanded]="panel.open()"
          aria-controls="order-form"
        >
          Nuevo pedido
        </button>
      }
    </div>
    <app-submission-alert [submission]="submission" />

    @if (panel.open()) {
      <form
        id="order-form"
        [formGroup]="form"
        (ngSubmit)="addItem()"
        (keydown.escape)="closeForm()"
        novalidate
        class="grid-form"
      >
        <h2>Nuevo pedido</h2>
        <p class="field-hint">
          Agrega uno o más artículos y presiona <strong>Crear pedido y cargo</strong> para
          registrarlo.
        </p>
        <div>
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
        </div>
        <div class="two-col">
          <div>
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
            <app-field-error [control]="form.controls.variantId" />
          </div>
          <label>Cantidad <input type="number" min="1" formControlName="quantity" /></label>
        </div>
        <div>
          <button type="submit" class="secondary">Agregar artículo</button>
        </div>

        @if (items().length) {
          <ul class="cards-list">
            @for (i of items(); track $index) {
              <li class="card-row">
                <span>
                  <strong class="tabular">{{ i.quantity }} ×</strong> {{ labelOf(i.variantId) }}
                </span>
                <button type="button" class="link danger" (click)="removeItem($index)">
                  Quitar
                </button>
              </li>
            }
          </ul>
          <p class="tabular">
            <strong>Total del pedido: {{ total() | money }}</strong>
          </p>
          <label
            >Concepto del cargo
            <select formControlName="conceptId">
              @for (c of concepts(); track c.id) {
                <option [ngValue]="c.id">{{ c.name }}</option>
              }
            </select>
          </label>
        }

        <div class="actions">
          @if (items().length) {
            <button type="button" (click)="createOrder()" [disabled]="submission.busy()">
              {{ submission.busy() ? 'Creando…' : 'Crear pedido y cargo' }}
            </button>
          }
          <button type="button" class="secondary" (click)="closeForm()">Cancelar</button>
        </div>
      </form>
    }

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
      @if (status()) {
        <button type="button" class="secondary sm" (click)="status.set('')">Limpiar filtro</button>
      }
    </div>

    <app-load-state [res]="orders" emptyText="Sin pedidos registrados."
      ><ng-template>
        <div class="list-meta">
          <p class="muted">
            Mostrando <strong class="tabular">{{ (orders.value() ?? []).length }}</strong>
            {{ (orders.value() ?? []).length === 1 ? 'pedido' : 'pedidos' }}
          </p>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Jugador</th>
                <th>Artículos</th>
                <th class="num">Total</th>
                <th>Cobro</th>
                <th>Entrega</th>
                <th><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (o of orders.value() ?? []; track o.id) {
                <tr [class.muted]="o.status === 'CANCELADO'">
                  <td class="tabular">{{ o.requestedOn }}</td>
                  <td>
                    <a [routerLink]="['/admin/players', o.playerId]">{{ o.playerName }}</a>
                  </td>
                  <td class="wrap">
                    @for (l of o.lines; track $index) {
                      <div>
                        <span class="tabular">{{ l.quantity }} ×</span> {{ l.product }}
                        {{ l.size }}
                        <span class="muted">({{ l.unitPriceCents | money }})</span>
                      </div>
                    }
                  </td>
                  <td class="num">
                    <strong>{{ o.totalCents | money }}</strong>
                  </td>
                  <td>
                    @if (o.charge) {
                      <span class="tag {{ chargeTone[o.charge.status] }}">{{
                        chargeLabels[o.charge.status]
                      }}</span>
                      <div class="cell-sub tabular">
                        Saldo {{ o.charge.balanceCents | money }}
                      </div>
                    } @else {
                      <span class="muted">Sin cargo</span>
                    }
                  </td>
                  <td>
                    <span class="tag {{ orderTone[o.status] }}">{{ labels[o.status] }}</span>
                    @if (o.status === 'ENTREGADO') {
                      <div class="cell-sub">{{ o.deliveredOn }} · {{ o.receivedBy }}</div>
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
    <app-prompt-dialog #promptDialog />
  `,
})
export class UniformOrdersPage {
  private promptDialog = viewChild.required<PromptDialog>('promptDialog');
  private service = inject(UniformService);
  private playerService = inject(PlayerService);
  private billing = inject(BillingService);
  protected auth = inject(AuthService);
  protected labels = ORDER_STATUS_LABELS;
  protected orderTone = ORDER_TONE;
  protected chargeLabels = CHARGE_STATUS_LABELS;
  protected chargeTone = CHARGE_TONE;
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

  protected panel = new FormPanel('order-form', () => this.form.dirty || this.items().length > 0);

  open(): void {
    if (!this.panel.close()) return;
    this.reset();
    this.submission.result.set(null);
    this.panel.show();
  }

  /** Closes the form without creating the order (asks first if it has unsaved changes). */
  closeForm(): void {
    if (this.panel.close()) this.reset();
  }

  /** Empty order; the charge concept keeps its default. */
  private reset(): void {
    this.items.set([]);
    this.form.patchValue({ playerId: null, variantId: null, quantity: 1 });
    this.form.markAsPristine();
    this.form.markAsUntouched();
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
      this.panel.done();
      this.reset();
      this.orders.reload();
    }
  }

  async deliver(o: OrderView): Promise<void> {
    const receivedBy = await this.promptDialog().open({
      title: 'Registrar entrega de uniforme',
      message: `Pedido #${o.id} de ${o.playerName}.`,
      label: 'Nombre de quien recibe',
      placeholder: 'Ej. Teresa López (madre)',
      confirmText: 'Registrar entrega',
      tone: 'primary',
      required: true,
    });
    if (!receivedBy) return;
    if (
      await this.submission.run(
        () => this.service.deliver(o.id, receivedBy),
        'Entrega registrada.',
      )
    )
      this.orders.reload();
  }

  async cancel(o: OrderView): Promise<void> {
    const reason = await this.promptDialog().open({
      title: 'Cancelar pedido',
      message: `Se cancelará el pedido de ${o.playerName} y su cargo asociado si aplica.`,
      label: 'Motivo de la cancelación',
      placeholder: 'Ej. cambio de talla o solicitud familiar',
      confirmText: 'Cancelar pedido',
      tone: 'danger',
      required: true,
    });
    if (!reason) return;
    if (
      await this.submission.run(
        () => this.service.cancelOrder(o.id, reason),
        'Pedido cancelado; su cargo también.',
      )
    )
      this.orders.reload();
  }
}

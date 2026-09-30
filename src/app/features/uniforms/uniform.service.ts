import { Injectable, inject } from '@angular/core';
import { MockDb } from '../../core/data/mock-db';
import { UniformOrder, UniformProduct, UniformVariant } from '../../core/models';
import { BillingService } from '../billing/billing.service';

export interface OrderView extends UniformOrder {
  playerName: string;
  totalCents: number;
  items: string[];
}

@Injectable({ providedIn: 'root' })
export class UniformService {
  private db = inject(MockDb);
  private billing = inject(BillingService);

  // HU-052
  products(): Promise<UniformProduct[]> {
    return this.db.respond(this.db.uniformProducts);
  }

  variants(): Promise<UniformVariant[]> {
    return this.db.respond(this.db.uniformVariants);
  }

  async saveProduct(name: string): Promise<UniformProduct> {
    const product = { id: this.db.id('up'), name, active: true };
    this.db.uniformProducts = [...this.db.uniformProducts, product];
    return this.db.respond(product);
  }

  async saveVariant(draft: Omit<UniformVariant, 'id' | 'active'>): Promise<UniformVariant> {
    if (
      this.db.uniformVariants.some((v) => v.productId === draft.productId && v.size === draft.size)
    ) {
      throw new Error('Esa talla ya existe para el producto.');
    }
    const variant = { ...draft, id: this.db.id('uv'), active: true };
    this.db.uniformVariants = [...this.db.uniformVariants, variant];
    return this.db.respond(variant);
  }

  // HU-053 + HU-054: the order copies current prices and creates a billing charge.
  async createOrder(
    playerId: string,
    items: { variantId: string; quantity: number }[],
  ): Promise<UniformOrder> {
    if (!items.length) throw new Error('Agrega al menos un artículo.');
    const lines = items.map(({ variantId, quantity }) => {
      const variant = this.db.uniformVariants.find((v) => v.id === variantId && v.active);
      if (!variant || quantity < 1) throw new Error('Artículo inválido.');
      return { variantId, quantity, unitPriceCents: variant.priceCents };
    });
    const concept = this.db.concepts.find((c) => c.kind === 'uniform' && c.active);
    if (!concept) throw new Error('Configura un concepto de cobro de tipo uniforme.');
    const id = this.db.id('uo');
    const today = new Date().toISOString().slice(0, 10);
    const charge = await this.billing.createCharge({
      playerId,
      conceptId: concept.id,
      amountCents: lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0),
      description: `Uniforme (pedido ${id})`,
      dueDate: today,
      source: { type: 'uniform-order', id },
    });
    const order: UniformOrder = {
      id,
      playerId,
      createdAt: today,
      lines,
      chargeId: charge.id,
      status: 'pending',
    };
    this.db.uniformOrders = [...this.db.uniformOrders, order];
    return this.db.respond(order);
  }

  orders(playerIds?: string[]): Promise<OrderView[]> {
    const orders = playerIds
      ? this.db.uniformOrders.filter((o) => playerIds.includes(o.playerId))
      : this.db.uniformOrders;
    return this.db.respond(orders.map((o) => this.view(o)));
  }

  // HU-055
  async deliver(orderId: string, deliveredTo: string): Promise<void> {
    const order = this.db.uniformOrders.find((o) => o.id === orderId);
    if (!order) throw new Error('Pedido no encontrado.');
    if (order.status === 'delivered') throw new Error('El pedido ya fue entregado.');
    const delivered: UniformOrder = {
      ...order,
      status: 'delivered',
      deliveredTo,
      deliveredAt: new Date().toISOString(),
    };
    this.db.uniformOrders = this.db.uniformOrders.map((o) => (o.id === orderId ? delivered : o));
    await this.db.respond(null);
  }

  private view(order: UniformOrder): OrderView {
    return {
      ...order,
      playerName: this.db.players.find((p) => p.id === order.playerId)?.fullName ?? '—',
      totalCents: order.lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0),
      items: order.lines.map((l) => {
        const v = this.db.uniformVariants.find((x) => x.id === l.variantId);
        const p = this.db.uniformProducts.find((x) => x.id === v?.productId);
        return `${l.quantity} × ${p?.name ?? '—'} ${v?.size ?? ''}`;
      }),
    };
  }
}

import { Injectable, inject } from '@angular/core';
import { AuthorizationService } from '../../core/auth/authorization.service';
import { MockDb } from '../../core/data/mock-db';
import {
  Cents,
  ChargeStatus,
  Id,
  ISODate,
  UniformOrder,
  UniformOrderStatus,
  UniformProduct,
  UniformVariant,
  fullName,
} from '../../core/models';
import { AuditService } from '../../core/services/audit.service';
import { isISODate, nowDateTime, today } from '../../shared/dates';
import { assertCents, multiplyCents, sumCents } from '../../shared/money';
import { optional, required } from '../../shared/validate';
import { BillingService } from '../billing/billing.service';

export interface OrderLineView {
  product: string;
  size: string;
  quantity: number;
  unitPriceCents: Cents;
}

export interface OrderView extends UniformOrder {
  playerName: string;
  lines: OrderLineView[];
  totalCents: Cents;
  charge: { status: ChargeStatus; balanceCents: Cents } | null;
}

export interface VariantView extends UniformVariant {
  productName: string;
  /** Order lines that use it: a used variant is deactivated, never deleted (HU-052.3). */
  used: number;
}

export const ORDER_STATUS_LABELS: Record<UniformOrderStatus, string> = {
  SOLICITADO: 'Solicitado',
  PAGADO: 'Pagado',
  ENTREGADO: 'Entregado',
  CANCELADO: 'Cancelado',
};

/**
 * Uniforms: catalog (productos_uniforme → variantes_uniforme), orders (pedidos_uniforme + detalle_uniforme with the
 * price at order time) and their link with billing through pedidos_uniforme.cargo_id (HU-054).
 */
@Injectable({ providedIn: 'root' })
export class UniformService {
  private db = inject(MockDb);
  private authz = inject(AuthorizationService);
  private audit = inject(AuditService);
  private billing = inject(BillingService);

  // ── HU-052 catalog ────────────────────────────────────────────────────

  async products(): Promise<UniformProduct[]> {
    this.authz.require('uniformes.consultar');
    return this.db.respond(
      [...this.db.uniformProducts].sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  async variants(onlyActive = false): Promise<VariantView[]> {
    this.authz.require('uniformes.consultar');
    return this.db.respond(
      this.db.uniformVariants
        .filter(
          (v) =>
            !onlyActive ||
            (v.active && this.db.uniformProducts.find((p) => p.id === v.productId)?.active),
        )
        .map((v) => ({
          ...v,
          productName: this.db.get(this.db.uniformProducts, v.productId, 'Producto').name,
          used: this.db.uniformOrderLines.filter((l) => l.variantId === v.id).length,
        }))
        .sort((a, b) => a.productName.localeCompare(b.productName) || a.size.localeCompare(b.size)),
    );
  }

  async saveProduct(draft: {
    id?: Id;
    name: string;
    description: string | null;
  }): Promise<UniformProduct> {
    this.authz.require(draft.id ? 'uniformes.editar' : 'uniformes.crear');
    const name = required(draft.name, 'El nombre', 150);
    if (
      this.db.uniformProducts.some(
        (p) => p.id !== draft.id && p.name.toLowerCase() === name.toLowerCase(),
      )
    )
      throw new Error('Ya existe un producto con ese nombre.');
    const data = { name, description: optional(draft.description, 'La descripción') };
    const product = draft.id
      ? this.db.update(this.db.uniformProducts, draft.id, data)
      : this.db.insert(this.db.uniformProducts, {
          ...data,
          active: true,
          createdAt: nowDateTime(),
        });
    this.audit.log(
      draft.id ? 'EDITAR' : 'CREAR',
      'uniformes',
      'productos_uniforme',
      product.id,
      `Producto ${name}`,
    );
    return this.db.respond(product);
  }

  async setProductActive(id: Id, active: boolean): Promise<void> {
    this.authz.require('uniformes.editar');
    this.db.update(this.db.uniformProducts, id, { active });
    this.audit.log(
      'EDITAR',
      'uniformes',
      'productos_uniforme',
      id,
      active ? 'Activación' : 'Desactivación',
    );
    await this.db.respond(null);
  }

  /** Same product in several sizes; unique (product, size). A new price never changes existing orders. */
  async saveVariant(draft: {
    id?: Id;
    productId: Id;
    size: string;
    priceCents: Cents;
  }): Promise<UniformVariant> {
    this.authz.require(draft.id ? 'uniformes.editar' : 'uniformes.crear');
    this.db.get(this.db.uniformProducts, draft.productId, 'Producto');
    const size = required(draft.size, 'La talla', 30).toUpperCase();
    assertCents(draft.priceCents);
    if (draft.priceCents < 0) throw new Error('El precio no puede ser negativo.');
    if (
      this.db.uniformVariants.some(
        (v) => v.id !== draft.id && v.productId === draft.productId && v.size === size,
      )
    )
      throw new Error('Esa talla ya existe para el producto.');
    const data = { productId: draft.productId, size, priceCents: draft.priceCents };
    let variant: UniformVariant;
    if (draft.id) {
      const before = this.db.get(this.db.uniformVariants, draft.id, 'Talla');
      variant = this.db.update(this.db.uniformVariants, draft.id, data);
      this.audit.log(
        'EDITAR',
        'uniformes',
        'variantes_uniforme',
        variant.id,
        `Talla ${size}`,
        before,
        variant,
      );
    } else {
      variant = this.db.insert(this.db.uniformVariants, {
        ...data,
        active: true,
        createdAt: nowDateTime(),
      });
      this.audit.log(
        'CREAR',
        'uniformes',
        'variantes_uniforme',
        variant.id,
        `Talla ${size}`,
        null,
        variant,
      );
    }
    return this.db.respond(variant);
  }

  async setVariantActive(id: Id, active: boolean): Promise<void> {
    this.authz.require('uniformes.editar');
    this.db.update(this.db.uniformVariants, id, { active });
    this.audit.log(
      'EDITAR',
      'uniformes',
      'variantes_uniforme',
      id,
      active ? 'Activación' : 'Desactivación',
    );
    await this.db.respond(null);
  }

  // ── HU-053 / HU-054 orders ────────────────────────────────────────────

  /**
   * One transaction: order + lines with the current prices + (if total > 0) a charge with the chosen concept and
   * reference 'PED-<id>', linked through cargo_id. The amount always equals the order total.
   */
  async createOrder(
    playerId: Id,
    items: { variantId: Id; quantity: number }[],
    conceptId: Id,
  ): Promise<UniformOrder> {
    this.authz.require('uniformes.crear');
    const player = this.db.get(this.db.players, playerId, 'Jugador');
    if (player.status !== 'ACTIVO')
      throw new Error('Sólo jugadores activos pueden pedir uniforme.');
    if (!items.length) throw new Error('Agrega al menos un artículo.');
    const lines = items.map(({ variantId, quantity }) => {
      const variant = this.db.uniformVariants.find((v) => v.id === variantId && v.active);
      if (!variant) throw new Error('Artículo inválido o inactivo.');
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999)
        throw new Error('Cantidad inválida.');
      return { variantId, quantity, unitPriceCents: variant.priceCents };
    });
    const total = sumCents(lines.map((l) => multiplyCents(l.unitPriceCents, l.quantity)));
    const order = this.db.transaction(() => {
      const now = nowDateTime();
      const created = this.db.insert(this.db.uniformOrders, {
        playerId,
        requestedOn: today(),
        status: 'SOLICITADO',
        chargeId: null,
        deliveredOn: null,
        receivedBy: null,
        createdAt: now,
        updatedAt: now,
      });
      for (const l of lines)
        this.db.insert(this.db.uniformOrderLines, { ...l, orderId: created.id, createdAt: now });
      let chargeId: Id | null = null;
      if (total > 0) {
        chargeId = this.billing.insertCharge({
          playerId,
          conceptId,
          seasonId: this.db.seasons.find((s) => s.isCurrent)?.id ?? null,
          period: null,
          chargedOn: today(),
          dueDate: today(),
          originalAmountCents: total,
          reference: `PED-${created.id}`,
        }).id;
      }
      const saved = this.db.update(this.db.uniformOrders, created.id, { chargeId });
      this.audit.log(
        'CREAR',
        'uniformes',
        'pedidos_uniforme',
        saved.id,
        `Pedido de ${fullName(player)}`,
        null,
        { ...saved, lines },
      );
      return saved;
    });
    return this.db.respond(order);
  }

  async orders(
    filter: { playerIds?: Id[]; status?: UniformOrderStatus | '' } = {},
  ): Promise<OrderView[]> {
    this.authz.require('uniformes.consultar');
    return this.db.respond(this.views(filter));
  }

  /** Synchronous variant for the portal. Syncs PAGADO with the charge balance first (HU-054.2). */
  views(filter: { playerIds?: Id[]; status?: UniformOrderStatus | '' } = {}): OrderView[] {
    this.syncPaid();
    const balances = this.billing.balancesById();
    return this.db.uniformOrders
      .filter(
        (o) =>
          (!filter.playerIds || filter.playerIds.includes(o.playerId)) &&
          (!filter.status || o.status === filter.status),
      )
      .sort((a, b) => b.requestedOn.localeCompare(a.requestedOn) || b.id - a.id)
      .map((o) => {
        const lines = this.db.uniformOrderLines
          .filter((l) => l.orderId === o.id)
          .map((l) => {
            const v = this.db.get(this.db.uniformVariants, l.variantId, 'Talla');
            return {
              product: this.db.get(this.db.uniformProducts, v.productId, 'Producto').name,
              size: v.size,
              quantity: l.quantity,
              unitPriceCents: l.unitPriceCents,
            };
          });
        return {
          ...o,
          playerName: fullName(this.db.get(this.db.players, o.playerId, 'Jugador')),
          lines,
          totalCents: sumCents(lines.map((l) => multiplyCents(l.unitPriceCents, l.quantity))),
          charge: o.chargeId === null ? null : (balances.get(o.chargeId) ?? null),
        };
      });
  }

  /** HU-055: only non-cancelled, not yet delivered orders; records date and who received it. */
  async deliver(orderId: Id, receivedBy: string, deliveredOn: ISODate = today()): Promise<void> {
    this.authz.require('uniformes.editar');
    const order = this.db.get(this.db.uniformOrders, orderId, 'Pedido');
    if (order.status === 'CANCELADO') throw new Error('El pedido está cancelado.');
    if (order.status === 'ENTREGADO') throw new Error('El pedido ya fue entregado.');
    if (!isISODate(deliveredOn) || deliveredOn < order.requestedOn)
      throw new Error('Fecha de entrega inválida.');
    const who = required(receivedBy, 'Quién recibe', 150);
    const updated = this.db.update(this.db.uniformOrders, orderId, {
      status: 'ENTREGADO',
      deliveredOn,
      receivedBy: who,
      updatedAt: nowDateTime(),
    });
    this.audit.log(
      'EDITAR',
      'uniformes',
      'pedidos_uniforme',
      orderId,
      `Entregado a ${who}`,
      order,
      updated,
    );
    await this.db.respond(null);
  }

  /** HU-054.3: cancelling keeps the order and cancels its charge; refused if payments were applied (cancel them first). */
  async cancelOrder(orderId: Id, reason: string): Promise<void> {
    this.authz.require('uniformes.editar');
    const order = this.db.get(this.db.uniformOrders, orderId, 'Pedido');
    if (order.status === 'ENTREGADO') throw new Error('Un pedido entregado no se cancela.');
    if (order.status === 'CANCELADO') throw new Error('El pedido ya está cancelado.');
    const motive = required(reason, 'El motivo');
    this.db.transaction(() => {
      if (order.chargeId !== null)
        this.billing.voidCharge(order.chargeId, `Pedido de uniforme cancelado: ${motive}`);
      const updated = this.db.update(this.db.uniformOrders, orderId, {
        status: 'CANCELADO',
        updatedAt: nowDateTime(),
      });
      this.audit.log(
        'CANCELAR',
        'uniformes',
        'pedidos_uniforme',
        orderId,
        `Cancelado: ${motive}`,
        order,
        updated,
      );
    });
    await this.db.respond(null);
  }

  /** SOLICITADO ↔ PAGADO follows the linked charge (paid in full or not); the API does it in the payment transaction. */
  private syncPaid(): void {
    const balances = this.billing.balancesById();
    for (const o of this.db.uniformOrders) {
      if (o.chargeId === null || (o.status !== 'SOLICITADO' && o.status !== 'PAGADO')) continue;
      const paid = balances.get(o.chargeId)?.status === 'PAGADO';
      const status: UniformOrderStatus = paid ? 'PAGADO' : 'SOLICITADO';
      if (status !== o.status)
        this.db.update(this.db.uniformOrders, o.id, { status, updatedAt: nowDateTime() });
    }
  }
}

import { Cents, DateTime, Id, ISODate } from './common';

/** Catalog (product → variant) is separate from orders; order lines copy the price (historical value). */

/** productos_uniforme */
export interface UniformProduct {
  id: Id;
  name: string;
  description: string | null;
  active: boolean;
  createdAt: DateTime;
}

/** variantes_uniforme. Unique per (product, size). */
export interface UniformVariant {
  id: Id;
  productId: Id;
  size: string;
  priceCents: Cents;
  active: boolean;
  createdAt: DateTime;
}

export type UniformOrderStatus = 'SOLICITADO' | 'PAGADO' | 'ENTREGADO' | 'CANCELADO';

/**
 * pedidos_uniforme. chargeId (unique, same player) links the order with billing (HU-054); null when the order
 * totals 0. PAGADO is derived from the charge balance; ENTREGADO ⇔ deliveredOn set.
 */
export interface UniformOrder {
  id: Id;
  playerId: Id;
  requestedOn: ISODate;
  status: UniformOrderStatus;
  chargeId: Id | null;
  deliveredOn: ISODate | null;
  receivedBy: string | null;
  createdAt: DateTime;
  updatedAt: DateTime;
}

/** detalle_uniforme */
export interface UniformOrderLine {
  id: Id;
  orderId: Id;
  variantId: Id;
  quantity: number;
  unitPriceCents: Cents;
  createdAt: DateTime;
}

/** Catalog (product → variant) is separate from orders; order lines copy the price (historical value). */

export interface UniformProduct {
  id: string;
  name: string;
  active: boolean;
}

export interface UniformVariant {
  id: string;
  productId: string;
  size: string;
  priceCents: number;
  active: boolean;
}

export interface UniformOrderLine {
  variantId: string;
  quantity: number;
  unitPriceCents: number;
}

export interface UniformOrder {
  id: string;
  playerId: string;
  createdAt: string;
  lines: UniformOrderLine[];
  /** Charge created in billing for this order (HU-054). */
  chargeId: string;
  status: 'pending' | 'delivered';
  deliveredAt?: string;
  deliveredTo?: string;
}

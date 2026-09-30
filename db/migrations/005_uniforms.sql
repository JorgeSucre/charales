-- 005 · Uniforms: product → variant → order → line (HU-052, HU-053, HU-055)
-- The charge for an order lives in billing (006, charges.uniform_order_id).

CREATE TABLE uniform_products (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name   text NOT NULL UNIQUE CHECK (btrim(name) <> ''),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE uniform_variants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES uniform_products,
  size        text NOT NULL CHECK (btrim(size) <> ''),
  price_cents integer NOT NULL CHECK (price_cents >= 0), -- CURRENT price; orders copy it
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (product_id, size)
);

CREATE TABLE uniform_orders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid NOT NULL REFERENCES players,
  requested_by uuid NOT NULL REFERENCES users,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, player_id) -- lets the charge prove it belongs to the same player
);

CREATE INDEX ON uniform_orders (player_id);

-- unit_price_cents is the price at order time (historical); it never follows uniform_variants.price_cents.
-- Delivery is per line so partial deliveries are possible; "order delivered" = all lines delivered.
CREATE TABLE uniform_order_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES uniform_orders,
  variant_id       uuid NOT NULL REFERENCES uniform_variants,
  quantity         integer NOT NULL CHECK (quantity > 0),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  delivered_at     timestamptz,
  delivered_by     uuid REFERENCES users,
  delivered_to     text,
  UNIQUE (order_id, variant_id),
  CHECK (
    (delivered_at IS NULL AND delivered_by IS NULL AND delivered_to IS NULL)
    OR (delivered_at IS NOT NULL AND delivered_by IS NOT NULL AND btrim(delivered_to) <> '')
  )
);

CREATE INDEX ON uniform_order_lines (order_id);
CREATE INDEX ON uniform_order_lines (variant_id);

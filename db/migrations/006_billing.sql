-- 006 · Billing: concepts (HU-043), charges (HU-044, HU-054), payments + applications, receipts (HU-048),
-- balances (HU-050). Charge ≠ Payment; payment_applications links them. Balances are derived (view), never stored.

CREATE TABLE charge_concepts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL UNIQUE CHECK (btrim(name) <> ''),
  kind                 text NOT NULL CHECK (kind IN ('monthly', 'enrollment', 'uniform', 'other')),
  default_amount_cents integer NOT NULL CHECK (default_amount_cents >= 0),
  active               boolean NOT NULL DEFAULT true
);

CREATE TABLE charges (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id        uuid NOT NULL REFERENCES players,
  concept_id       uuid NOT NULL REFERENCES charge_concepts,
  season_id        uuid NOT NULL REFERENCES seasons,
  amount_cents     integer NOT NULL CHECK (amount_cents > 0),
  description      text NOT NULL CHECK (btrim(description) <> ''),
  issued_on        date NOT NULL DEFAULT business_date(now()),
  due_date         date NOT NULL,
  period           text CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'), -- 'YYYY-MM' for monthly fees
  uniform_order_id uuid UNIQUE,                                         -- HU-054: one charge per order
  FOREIGN KEY (uniform_order_id, player_id) REFERENCES uniform_orders (id, player_id),
  UNIQUE (id, player_id)
);

-- HU-044: generating the same monthly fee twice is impossible.
CREATE UNIQUE INDEX charges_one_per_period ON charges (player_id, concept_id, period) WHERE period IS NOT NULL;
CREATE INDEX ON charges (player_id, due_date);
CREATE INDEX ON charges (season_id);

CREATE TABLE payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number      bigint GENERATED ALWAYS AS IDENTITY UNIQUE, -- folio; API shows it as R-0001
  player_id           uuid NOT NULL REFERENCES players,
  amount_cents        integer NOT NULL CHECK (amount_cents > 0),
  method              text NOT NULL CHECK (method IN ('cash', 'transfer', 'card')),
  paid_at             timestamptz NOT NULL DEFAULT now(),
  received_by         uuid NOT NULL REFERENCES users,
  cancelled_at        timestamptz,
  cancelled_by        uuid REFERENCES users,
  cancellation_reason text,
  CHECK (
    (cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL)
    OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND btrim(cancellation_reason) <> '')
  ),
  UNIQUE (id, player_id)
);

CREATE INDEX ON payments (player_id);
CREATE INDEX ON payments (paid_at);

-- player_id is repeated on purpose: the two composite FKs make "pay another player's charge" impossible.
CREATE TABLE payment_applications (
  payment_id   uuid NOT NULL,
  charge_id    uuid NOT NULL,
  player_id    uuid NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  PRIMARY KEY (payment_id, charge_id),
  FOREIGN KEY (payment_id, player_id) REFERENCES payments (id, player_id),
  FOREIGN KEY (charge_id, player_id) REFERENCES charges (id, player_id)
);

CREATE INDEX ON payment_applications (charge_id);

-- ── Traceability: payments are never deleted, only cancelled once; applications are insert-only. ──

CREATE FUNCTION payments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments are never deleted; cancel them instead' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'payment % is cancelled and can no longer change', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.id, NEW.receipt_number, NEW.player_id, NEW.amount_cents, NEW.method, NEW.paid_at, NEW.received_by)
     IS DISTINCT FROM
     (OLD.id, OLD.receipt_number, OLD.player_id, OLD.amount_cents, OLD.method, OLD.paid_at, OLD.received_by) THEN
    RAISE EXCEPTION 'only the cancellation fields of a payment can change' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER payments_guard BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_guard();

CREATE FUNCTION payment_applications_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payment applications are insert-only' USING ERRCODE = 'restrict_violation';
END $$;

CREATE TRIGGER payment_applications_guard BEFORE UPDATE OR DELETE ON payment_applications
  FOR EACH ROW EXECUTE FUNCTION payment_applications_guard();

-- ── Totals, checked at COMMIT (deferred) so a payment and its applications can be inserted in any order. ──
-- 1) a non-cancelled payment is fully applied: Σ applications = amount (no credit balances yet);
-- 2) a charge never receives more than its amount from non-cancelled payments.

CREATE FUNCTION check_billing_totals() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p_id   uuid;
  c_ids  uuid[];
  bad    record;
BEGIN
  IF TG_TABLE_NAME = 'payment_applications' THEN
    p_id := NEW.payment_id;
    c_ids := ARRAY[NEW.charge_id];
  ELSIF TG_TABLE_NAME = 'payments' THEN
    p_id := NEW.id;
    c_ids := ARRAY(SELECT charge_id FROM payment_applications WHERE payment_id = NEW.id);
  ELSE -- charges
    c_ids := ARRAY[NEW.id];
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT p.id, p.amount_cents, COALESCE(SUM(pa.amount_cents), 0) AS applied INTO bad
    FROM payments p LEFT JOIN payment_applications pa ON pa.payment_id = p.id
    WHERE p.id = p_id AND p.cancelled_at IS NULL
    GROUP BY p.id
    HAVING COALESCE(SUM(pa.amount_cents), 0) <> p.amount_cents;
    IF FOUND THEN
      RAISE EXCEPTION 'payment % is % cents but % cents are applied', bad.id, bad.amount_cents, bad.applied
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT c.id, c.amount_cents, SUM(pa.amount_cents) AS applied INTO bad
  FROM charges c
  JOIN payment_applications pa ON pa.charge_id = c.id
  JOIN payments p ON p.id = pa.payment_id AND p.cancelled_at IS NULL
  WHERE c.id = ANY (c_ids)
  GROUP BY c.id
  HAVING SUM(pa.amount_cents) > c.amount_cents
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'charge % is % cents but would receive % cents', bad.id, bad.amount_cents, bad.applied
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER payment_applications_totals AFTER INSERT ON payment_applications
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_billing_totals();
CREATE CONSTRAINT TRIGGER payments_totals AFTER INSERT OR UPDATE ON payments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_billing_totals();
CREATE CONSTRAINT TRIGGER charges_totals AFTER UPDATE OF amount_cents ON charges
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_billing_totals();

-- ── Derived balance: the single SQL definition of "saldo" (mirrors src/app/features/billing/billing.rules.ts). ──

CREATE VIEW charge_balances AS
SELECT
  c.*,
  COALESCE(SUM(pa.amount_cents) FILTER (WHERE p.cancelled_at IS NULL), 0)::integer AS paid_cents,
  (c.amount_cents - COALESCE(SUM(pa.amount_cents) FILTER (WHERE p.cancelled_at IS NULL), 0))::integer AS balance_cents,
  CASE
    WHEN c.amount_cents = COALESCE(SUM(pa.amount_cents) FILTER (WHERE p.cancelled_at IS NULL), 0) THEN 'paid'
    WHEN c.due_date < business_date(now()) THEN 'overdue'
    WHEN COALESCE(SUM(pa.amount_cents) FILTER (WHERE p.cancelled_at IS NULL), 0) > 0 THEN 'partial'
    ELSE 'pending'
  END AS status
FROM charges c
LEFT JOIN payment_applications pa ON pa.charge_id = c.id
LEFT JOIN payments p ON p.id = pa.payment_id
GROUP BY c.id;

COMMENT ON VIEW charge_balances IS
  'Charge + paid/balance from non-cancelled payments + derived status (paid|overdue|partial|pending).';

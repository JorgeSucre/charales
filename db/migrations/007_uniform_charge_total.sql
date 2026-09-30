-- 007 · Invariant: a uniform order's charge = Σ(quantity × unit_price_cents) of its lines (HU-054).
-- Checked at COMMIT (deferred), so order, lines and charge can be written in any order within one transaction.
-- An order without a charge is not checked here: a zero-total order cannot have a charge (amount_cents > 0),
-- so "every order has a charge" stays a backend rule (see docs/database/DATA_CONTRACT.md).

CREATE FUNCTION check_uniform_order_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  o_ids    uuid[];
  o_id     uuid;
  charged  integer;
  expected bigint;
BEGIN
  IF TG_TABLE_NAME = 'charges' THEN
    o_ids := ARRAY[NEW.uniform_order_id];
  ELSIF TG_OP = 'INSERT' THEN
    o_ids := ARRAY[NEW.order_id];
  ELSIF TG_OP = 'DELETE' THEN
    o_ids := ARRAY[OLD.order_id];
  ELSE
    o_ids := ARRAY[NEW.order_id, OLD.order_id]; -- a line moved between orders affects both
  END IF;

  FOREACH o_id IN ARRAY o_ids LOOP
    CONTINUE WHEN o_id IS NULL;
    SELECT amount_cents INTO charged FROM charges WHERE uniform_order_id = o_id;
    CONTINUE WHEN NOT FOUND;
    SELECT COALESCE(SUM(quantity::bigint * unit_price_cents), 0) INTO expected
    FROM uniform_order_lines WHERE order_id = o_id;
    IF expected <> charged THEN
      RAISE EXCEPTION 'uniform order % charges % cents but its lines total % cents', o_id, charged, expected
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER uniform_order_lines_total
  AFTER INSERT OR UPDATE OF order_id, quantity, unit_price_cents OR DELETE ON uniform_order_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_uniform_order_total();

CREATE CONSTRAINT TRIGGER charges_uniform_total
  AFTER INSERT OR UPDATE OF amount_cents, uniform_order_id ON charges
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_uniform_order_total();

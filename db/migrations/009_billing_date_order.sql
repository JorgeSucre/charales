-- 009 · A payment cannot be cancelled before it was made. Row-local, so a plain CHECK (validated against existing rows).
-- Deliberately NO "due_date >= issued_on" on charges: charges may be generated retroactively (e.g. September's fee
-- generated in October). issued_on = when the charge was generated; due_date = when it should have been paid.

ALTER TABLE payments ADD CONSTRAINT payments_cancelled_after_paid CHECK (cancelled_at IS NULL OR cancelled_at >= paid_at);

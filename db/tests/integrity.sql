-- Integrity tests. Run against a freshly seeded database (db/scripts/test.sh).
-- Everything runs in one transaction that is rolled back, so the database is left untouched.
-- Constraints are made IMMEDIATE so deferred checks fire per statement.

\ir ../seed/sid.sql
\o /dev/null

BEGIN;
SET CONSTRAINTS ALL IMMEDIATE;

CREATE FUNCTION pg_temp.expect_error(label text, stmt text, expected_state text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state THEN
      RAISE EXCEPTION 'FAIL %: expected SQLSTATE %, got % (%)', label, expected_state, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'ok   %', label;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL %: statement succeeded but should have failed', label;
END $$;

CREATE FUNCTION pg_temp.check(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF;
  RAISE NOTICE 'ok   %', label;
END $$;

SET client_min_messages = notice;

-- SQLSTATEs: 23503 foreign key, 23505 unique, 23514 check, 23001 restrict (our immutability triggers).

-- ── Enrollment / PlayerCategory ──
SELECT pg_temp.expect_error('enrollment requires an existing player',
  format('INSERT INTO enrollments (player_id, season_id) VALUES (%L, %L)', gen_random_uuid(), pg_temp.sid('season', 2)), '23503');
SELECT pg_temp.expect_error('enrollment requires an existing season',
  format('INSERT INTO enrollments (player_id, season_id) VALUES (%L, %L)', pg_temp.sid('player', 1), gen_random_uuid()), '23503');
SELECT pg_temp.expect_error('enrollment has no category column (kept separate from player_categories)',
  'SELECT category_id FROM enrollments', '42703');
SELECT pg_temp.expect_error('one active enrollment per player and season',
  format('INSERT INTO enrollments (player_id, season_id) VALUES (%L, %L)', pg_temp.sid('player', 1), pg_temp.sid('season', 2)), '23505');
INSERT INTO enrollments (player_id, season_id) VALUES (pg_temp.sid('player', 4), pg_temp.sid('season', 2));
SELECT pg_temp.check('a cancelled enrollment does not block re-enrolling', true);

SELECT pg_temp.expect_error('player_category requires an existing player',
  format('INSERT INTO player_categories (player_id, category_id, start_date) VALUES (%L, %L, %L)', gen_random_uuid(), pg_temp.sid('category', 1), '2026-09-01'), '23503');
SELECT pg_temp.expect_error('player_category requires an existing category',
  format('INSERT INTO player_categories (player_id, category_id, start_date) VALUES (%L, %L, %L)', pg_temp.sid('player', 4), gen_random_uuid(), '2026-09-01'), '23503');
SELECT pg_temp.expect_error('a player cannot have two current categories',
  format('INSERT INTO player_categories (player_id, category_id, start_date) VALUES (%L, %L, %L)', pg_temp.sid('player', 1), pg_temp.sid('category', 2), '2026-09-01'), '23505');
UPDATE player_categories SET end_date = '2026-09-30' WHERE player_id = pg_temp.sid('player', 1) AND end_date IS NULL;
INSERT INTO player_categories (player_id, category_id, start_date) VALUES (pg_temp.sid('player', 1), pg_temp.sid('category', 2), '2026-10-01');
SELECT pg_temp.check('changing category = close current row + open new one (history kept)',
  (SELECT count(*) FROM player_categories WHERE player_id = pg_temp.sid('player', 1)) = 2);
SELECT pg_temp.expect_error('player_category end_date cannot precede start_date',
  format('UPDATE player_categories SET end_date = %L WHERE player_id = %L AND end_date IS NULL', '2020-01-01', pg_temp.sid('player', 2)), '23514');

-- ── Seasons / competitions ──
SELECT pg_temp.expect_error('only one active season',
  $$INSERT INTO seasons (name, start_date, end_date, active) VALUES ('Temporada X', '2027-08-01', '2028-06-30', true)$$, '23505');
SELECT pg_temp.expect_error('coach assignment: category and competition must share the season',
  format('INSERT INTO coach_assignments (coach_id, competition_id, category_id, season_id) VALUES (%L, %L, %L, %L)',
    pg_temp.sid('coach', 1), pg_temp.sid('competition', 1), pg_temp.sid('category', 3), pg_temp.sid('season', 2)), '23503');

SELECT pg_temp.expect_error('a coach can only be assigned to a registered participation (C2)',
  format('INSERT INTO coach_assignments (coach_id, competition_id, category_id, season_id) VALUES (%L, %L, %L, %L)',
    pg_temp.sid('coach', 1), pg_temp.sid('competition', 2), pg_temp.sid('category', 1), pg_temp.sid('season', 2)), '23503');
SELECT pg_temp.expect_error('a match needs a registered participation (C2)',
  format($$INSERT INTO matches (competition_id, category_id, season_id, venue_id, starts_at, opponent)
           VALUES (%L, %L, %L, %L, now(), 'X')$$,
    pg_temp.sid('competition', 2), pg_temp.sid('category', 1), pg_temp.sid('season', 2), pg_temp.sid('venue', 1)), '23503');
SELECT pg_temp.expect_error('a category participates once per competition',
  format('INSERT INTO competition_categories (competition_id, category_id, season_id) VALUES (%L, %L, %L)',
    pg_temp.sid('competition', 1), pg_temp.sid('category', 1), pg_temp.sid('season', 2)), '23505');
SELECT pg_temp.expect_error('participation: category and competition must share the season',
  format('INSERT INTO competition_categories (competition_id, category_id, season_id) VALUES (%L, %L, %L)',
    pg_temp.sid('competition', 2), pg_temp.sid('category', 3), pg_temp.sid('season', 2)), '23503');
SELECT pg_temp.check('participation does not depend on a coach assignment (C2)',
  EXISTS (SELECT 1 FROM competition_categories cc
          WHERE cc.competition_id = pg_temp.sid('competition', 1) AND cc.category_id = pg_temp.sid('category', 2)
            AND NOT EXISTS (SELECT 1 FROM coach_assignments a
                            WHERE a.competition_id = cc.competition_id AND a.category_id = cc.category_id)));

-- ── Users / tutors / coaches ──
SELECT pg_temp.expect_error('passwords must be stored as a hash, never plain text',
  format('UPDATE users SET password_hash = %L WHERE id = %L', 'hunter2', pg_temp.sid('user', 1)), '23514');
UPDATE users SET password_hash = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA' WHERE id = pg_temp.sid('user', 1);
SELECT pg_temp.check('an argon2id hash is accepted', true);
SELECT pg_temp.expect_error('emails are unique case-insensitively (stored lowercase)',
  $$INSERT INTO users (email, full_name, role) VALUES ('Admin@Example.com', 'X', 'admin')$$, '23514');
SELECT pg_temp.expect_error('a tutor can only be linked to a user with role tutor',
  format('UPDATE tutors SET user_id = %L WHERE id = %L', pg_temp.sid('user', 2), pg_temp.sid('tutor', 3)), '23503');
SELECT pg_temp.expect_error('a linked tutor account cannot change role',
  format('UPDATE users SET role = %L WHERE id = %L', 'admin', pg_temp.sid('user', 4)), '23503');
SELECT pg_temp.expect_error('tutor_players requires an existing player',
  format('INSERT INTO tutor_players (tutor_id, player_id, relationship) VALUES (%L, %L, %L)', pg_temp.sid('tutor', 2), gen_random_uuid(), 'Padre'), '23503');
SELECT pg_temp.expect_error('tutor_players requires an existing tutor',
  format('INSERT INTO tutor_players (tutor_id, player_id, relationship) VALUES (%L, %L, %L)', gen_random_uuid(), pg_temp.sid('player', 3), 'Padre'), '23503');
SELECT pg_temp.expect_error('at most one primary tutor per player',
  format('UPDATE tutor_players SET is_primary = true WHERE tutor_id = %L AND player_id = %L', pg_temp.sid('tutor', 3), pg_temp.sid('player', 1)), '23505');
SELECT pg_temp.check('a player can have several tutors',
  (SELECT count(*) FROM tutor_players WHERE player_id = pg_temp.sid('player', 1)) = 2);

-- ── Billing ──
SELECT pg_temp.expect_error('application for a non-existent payment',
  format('INSERT INTO payment_applications VALUES (%L, %L, %L, 100)', gen_random_uuid(), pg_temp.sid('charge', 6), pg_temp.sid('player', 1)), '23503');
SELECT pg_temp.expect_error('application for a non-existent charge',
  format('INSERT INTO payment_applications VALUES (%L, %L, %L, 100)', pg_temp.sid('payment', 1), gen_random_uuid(), pg_temp.sid('player', 1)), '23503');
SELECT pg_temp.expect_error('a payment cannot be applied to another player''s charge',
  format($$WITH p AS (INSERT INTO payments (player_id, amount_cents, method, received_by) VALUES (%L, 100, 'cash', %L) RETURNING id)
           INSERT INTO payment_applications SELECT p.id, %L, %L, 100 FROM p$$,
    pg_temp.sid('player', 1), pg_temp.sid('user', 2), pg_temp.sid('charge', 4), pg_temp.sid('player', 1)), '23503');
SELECT pg_temp.expect_error('a payment must be fully applied (no loose money)',
  format($$INSERT INTO payments (player_id, amount_cents, method, received_by) VALUES (%L, 100, 'cash', %L)$$,
    pg_temp.sid('player', 1), pg_temp.sid('user', 2)), '23514');
SELECT pg_temp.expect_error('a charge cannot be overpaid',
  format($$WITH p AS (INSERT INTO payments (player_id, amount_cents, method, received_by) VALUES (%L, 60001, 'cash', %L) RETURNING id)
           INSERT INTO payment_applications SELECT p.id, %L, %L, 60001 FROM p$$,
    pg_temp.sid('player', 1), pg_temp.sid('user', 2), pg_temp.sid('charge', 6), pg_temp.sid('player', 1)), '23514');
SELECT pg_temp.expect_error('a charge amount cannot drop below what was paid',
  format('UPDATE charges SET amount_cents = 100 WHERE id = %L', pg_temp.sid('charge', 1)), '23514');
-- Retroactive charge: September's fee generated in October (issued_on after due_date) is valid (HU-044).
-- The identical second insert can only hit charges_one_per_period (23505), never a date rule (23514).
INSERT INTO charges (player_id, concept_id, season_id, amount_cents, description, issued_on, due_date, period)
VALUES (pg_temp.sid('player', 4), pg_temp.sid('concept', 1), pg_temp.sid('season', 2), 60000,
        'Mensualidad 2026-09', '2026-10-01', '2026-09-10', '2026-09');
SELECT pg_temp.check('a charge can be generated after its due date (retroactive)',
  EXISTS (SELECT 1 FROM charges WHERE player_id = pg_temp.sid('player', 4) AND period = '2026-09'
          AND issued_on > due_date));
SELECT pg_temp.expect_error('monthly fee cannot be generated twice for the same period',
  format($$INSERT INTO charges (player_id, concept_id, season_id, amount_cents, description, issued_on, due_date, period)
           VALUES (%L, %L, %L, 60000, 'Mensualidad 2026-09', '2026-10-01', '2026-09-10', '2026-09')$$,
    pg_temp.sid('player', 4), pg_temp.sid('concept', 1), pg_temp.sid('season', 2)), '23505');
SELECT pg_temp.expect_error('money cannot be zero or negative',
  format($$INSERT INTO charges (player_id, concept_id, season_id, amount_cents, description, due_date)
           VALUES (%L, %L, %L, -5, 'x', '2026-09-10')$$, pg_temp.sid('player', 1), pg_temp.sid('concept', 2), pg_temp.sid('season', 2)), '23514');
SELECT pg_temp.expect_error('a payment cannot be cancelled before it was made',
  format($$UPDATE payments SET cancelled_at = paid_at - interval '1 minute', cancelled_by = %L, cancellation_reason = 'x' WHERE id = %L$$,
    pg_temp.sid('user', 1), pg_temp.sid('payment', 1)), '23514');

-- A partial payment spread over two charges, then cancelled.
WITH p AS (
  INSERT INTO payments (player_id, amount_cents, method, received_by)
  VALUES (pg_temp.sid('player', 3), 90000, 'cash', pg_temp.sid('user', 2)) RETURNING id
)
INSERT INTO payment_applications
SELECT p.id, c.charge, pg_temp.sid('player', 3), c.amount
FROM p, (VALUES (pg_temp.sid('charge', 3), 70000), (pg_temp.sid('charge', 4), 20000)) AS c(charge, amount);
SELECT pg_temp.check('one payment can pay several charges',
  (SELECT sum(balance_cents) FROM charge_balances WHERE player_id = pg_temp.sid('player', 3)) = 40000);

UPDATE payments SET cancelled_at = now(), cancelled_by = pg_temp.sid('user', 1), cancellation_reason = 'Prueba'
WHERE player_id = pg_temp.sid('player', 3) AND amount_cents = 90000;
SELECT pg_temp.check('a cancelled payment does not reduce the balance',
  (SELECT sum(balance_cents) FROM charge_balances WHERE player_id = pg_temp.sid('player', 3)) = 130000);
SELECT pg_temp.check('a cancelled payment keeps its applications (traceability)',
  (SELECT count(*) FROM payment_applications pa JOIN payments p ON p.id = pa.payment_id WHERE p.cancelled_at IS NOT NULL) = 3);
SELECT pg_temp.expect_error('payments are never deleted',
  format('DELETE FROM payments WHERE id = %L', pg_temp.sid('payment', 1)), '23001');
SELECT pg_temp.expect_error('a cancelled payment cannot be un-cancelled',
  format('UPDATE payments SET cancelled_at = NULL, cancelled_by = NULL, cancellation_reason = NULL WHERE id = %L', pg_temp.sid('payment', 3)), '23001');
SELECT pg_temp.expect_error('a payment amount cannot be edited',
  format('UPDATE payments SET amount_cents = 1 WHERE id = %L', pg_temp.sid('payment', 1)), '23001');
SELECT pg_temp.expect_error('cancelling requires who and why',
  format('UPDATE payments SET cancelled_at = now() WHERE id = %L', pg_temp.sid('payment', 1)), '23514');
SELECT pg_temp.expect_error('payment applications are insert-only',
  format('DELETE FROM payment_applications WHERE payment_id = %L', pg_temp.sid('payment', 1)), '23001');
SELECT pg_temp.expect_error('receipt numbers are generated by the database',
  format($$INSERT INTO payments (receipt_number, player_id, amount_cents, method, received_by) VALUES (999, %L, 1, 'cash', %L)$$,
    pg_temp.sid('player', 1), pg_temp.sid('user', 2)), '428C9');

-- ── Uniforms ──
SELECT pg_temp.expect_error('an order line needs an existing order',
  format('INSERT INTO uniform_order_lines (order_id, variant_id, quantity, unit_price_cents) VALUES (%L, %L, 1, 100)', gen_random_uuid(), pg_temp.sid('variant', 1)), '23503');
SELECT pg_temp.expect_error('an order line needs an existing variant',
  format('INSERT INTO uniform_order_lines (order_id, variant_id, quantity, unit_price_cents) VALUES (%L, %L, 1, 100)', pg_temp.sid('order', 1), gen_random_uuid()), '23503');
UPDATE uniform_variants SET price_cents = 99900 WHERE id = pg_temp.sid('variant', 1);
SELECT pg_temp.check('an order line keeps its historical price',
  (SELECT unit_price_cents FROM uniform_order_lines WHERE id = pg_temp.sid('order_line', 1)) = 35000);
INSERT INTO uniform_orders (id, player_id, requested_by) VALUES (pg_temp.sid('order', 2), pg_temp.sid('player', 1), pg_temp.sid('user', 2));
SELECT pg_temp.expect_error('a uniform charge must belong to the same player as the order',
  format($$INSERT INTO charges (player_id, concept_id, season_id, amount_cents, description, due_date, uniform_order_id)
           VALUES (%L, %L, %L, 100, 'x', '2026-10-01', %L)$$,
    pg_temp.sid('player', 2), pg_temp.sid('concept', 3), pg_temp.sid('season', 2), pg_temp.sid('order', 2)), '23503');
SELECT pg_temp.expect_error('one charge per uniform order',
  format($$INSERT INTO charges (player_id, concept_id, season_id, amount_cents, description, due_date, uniform_order_id)
           VALUES (%L, %L, %L, 100, 'x', '2026-10-01', %L)$$,
    pg_temp.sid('player', 1), pg_temp.sid('concept', 3), pg_temp.sid('season', 2), pg_temp.sid('order', 1)), '23505');
SELECT pg_temp.expect_error('uniform charge must equal the sum of its order lines',
  format('UPDATE charges SET amount_cents = 84000 WHERE uniform_order_id = %L', pg_temp.sid('order', 1)), '23514');
SELECT pg_temp.expect_error('adding a line without updating the uniform charge is rejected',
  format('INSERT INTO uniform_order_lines (order_id, variant_id, quantity, unit_price_cents) VALUES (%L, %L, 1, 35000)',
    pg_temp.sid('order', 1), pg_temp.sid('variant', 2)), '23514');
WITH l AS (
  INSERT INTO uniform_order_lines (order_id, variant_id, quantity, unit_price_cents)
  VALUES (pg_temp.sid('order', 1), pg_temp.sid('variant', 2), 1, 35000)
)
UPDATE charges SET amount_cents = amount_cents + 35000 WHERE uniform_order_id = pg_temp.sid('order', 1);
SELECT pg_temp.check('line + charge updated together keep the uniform order consistent',
  (SELECT amount_cents FROM charges WHERE uniform_order_id = pg_temp.sid('order', 1)) = 120000);
SELECT pg_temp.expect_error('a delivery records when, who and to whom together',
  format('UPDATE uniform_order_lines SET delivered_at = now() WHERE id = %L', pg_temp.sid('order_line', 2)), '23514');

-- ── Dates ──
SELECT pg_temp.check('business_date uses Mexico City, not UTC (19:30 local is still the same day)',
  business_date('2026-09-30 19:30-06') = '2026-09-30' AND ('2026-09-30 19:30-06'::timestamptz AT TIME ZONE 'UTC')::date = '2026-10-01');

-- ── Tutor portal scoping: from the logged-in USER, never from a client-supplied player id ──
SELECT pg_temp.check('tutor user sees exactly their children',
  ARRAY(SELECT tp.player_id FROM tutors t JOIN tutor_players tp ON tp.tutor_id = t.id
        WHERE t.user_id = pg_temp.sid('user', 4) ORDER BY 1)
  = ARRAY[pg_temp.sid('player', 1), pg_temp.sid('player', 2)]);
SELECT pg_temp.check('a non-tutor user gets no children',
  NOT EXISTS (SELECT 1 FROM tutors t JOIN tutor_players tp ON tp.tutor_id = t.id WHERE t.user_id = pg_temp.sid('user', 2)));

ROLLBACK;
\o
\echo 'integrity tests passed'

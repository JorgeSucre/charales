-- Development seed. FICTIONAL data only. Loaded by db/scripts/reset.sh inside a single transaction.
-- No passwords: users have password_hash NULL (set through the reset flow once the backend exists).
--
-- Readable fixed UUIDs: 00000000-0000-4000-8000-TTTNNNNNNNNN, TTT = table code, N = row number.
--   sid('player', 3) = 00000000-0000-4000-8000-002000000003

\ir sid.sql

INSERT INTO users (id, email, full_name, role, active) VALUES
  (pg_temp.sid('user', 1), 'admin@example.com', 'Ana Admin', 'admin', true),
  (pg_temp.sid('user', 2), 'secretaria@example.com', 'Sofía Secretaria', 'secretary', true),
  (pg_temp.sid('user', 3), 'coach@example.com', 'Carlos Coach', 'coach', true),
  (pg_temp.sid('user', 4), 'tutor@example.com', 'Teresa Tutor', 'tutor', true),
  (pg_temp.sid('user', 5), 'baja@example.com', 'Usuario Inactivo', 'secretary', false),
  (pg_temp.sid('user', 6), 'jorge.ruiz@example.com', 'Jorge Ruiz', 'tutor', true);

INSERT INTO players (id, full_name, birth_date, active) VALUES
  (pg_temp.sid('player', 1), 'Diego Hernández', '2016-03-12', true),
  (pg_temp.sid('player', 2), 'Lucía Hernández', '2014-07-01', true),
  (pg_temp.sid('player', 3), 'Mateo Ruiz', '2016-11-20', true),
  (pg_temp.sid('player', 4), 'Valeria Soto', '2014-02-05', false);

INSERT INTO tutors (id, full_name, phone, email, user_id) VALUES
  (pg_temp.sid('tutor', 1), 'Teresa Tutor', '0000000001', 'tutor@example.com', pg_temp.sid('user', 4)),
  (pg_temp.sid('tutor', 2), 'Jorge Ruiz', '0000000002', 'jorge.ruiz@example.com', pg_temp.sid('user', 6)),
  (pg_temp.sid('tutor', 3), 'Pedro Hernández', '0000000003', NULL, NULL); -- second tutor of Diego, no login

INSERT INTO tutor_players (tutor_id, player_id, relationship, is_primary) VALUES
  (pg_temp.sid('tutor', 1), pg_temp.sid('player', 1), 'Madre', true),
  (pg_temp.sid('tutor', 1), pg_temp.sid('player', 2), 'Madre', true),
  (pg_temp.sid('tutor', 3), pg_temp.sid('player', 1), 'Padre', false),
  (pg_temp.sid('tutor', 2), pg_temp.sid('player', 3), 'Padre', true);

INSERT INTO coaches (id, full_name, phone, email, active, user_id) VALUES
  (pg_temp.sid('coach', 1), 'Carlos Coach', '0000000011', 'coach@example.com', true, pg_temp.sid('user', 3)),
  (pg_temp.sid('coach', 2), 'Marta Díaz', '0000000012', 'marta@example.com', true, NULL);

INSERT INTO seasons (id, name, start_date, end_date, active) VALUES
  (pg_temp.sid('season', 1), 'Temporada 2025-2026', '2025-08-01', '2026-06-30', false),
  (pg_temp.sid('season', 2), 'Temporada 2026-2027', '2026-08-01', '2027-06-30', true);

INSERT INTO categories (id, season_id, name, birth_year_from, birth_year_to) VALUES
  (pg_temp.sid('category', 1), pg_temp.sid('season', 2), 'Sub-10', 2016, 2017),
  (pg_temp.sid('category', 2), pg_temp.sid('season', 2), 'Sub-12', 2014, 2015),
  (pg_temp.sid('category', 3), pg_temp.sid('season', 1), 'Sub-10', 2015, 2016);

INSERT INTO enrollments (id, player_id, season_id, enrolled_on, status) VALUES
  (pg_temp.sid('enrollment', 1), pg_temp.sid('player', 2), pg_temp.sid('season', 1), '2025-08-04', 'active'),
  (pg_temp.sid('enrollment', 2), pg_temp.sid('player', 1), pg_temp.sid('season', 2), '2026-08-05', 'active'),
  (pg_temp.sid('enrollment', 3), pg_temp.sid('player', 2), pg_temp.sid('season', 2), '2026-08-05', 'active'),
  (pg_temp.sid('enrollment', 4), pg_temp.sid('player', 3), pg_temp.sid('season', 2), '2026-08-10', 'active'),
  (pg_temp.sid('enrollment', 5), pg_temp.sid('player', 4), pg_temp.sid('season', 2), '2026-08-12', 'cancelled');

-- Lucía: Sub-10 last season (closed) → Sub-12 now. History is kept.
INSERT INTO player_categories (id, player_id, category_id, start_date, end_date) VALUES
  (pg_temp.sid('player_category', 1), pg_temp.sid('player', 2), pg_temp.sid('category', 3), '2025-08-04', '2026-06-30'),
  (pg_temp.sid('player_category', 2), pg_temp.sid('player', 2), pg_temp.sid('category', 2), '2026-08-05', NULL),
  (pg_temp.sid('player_category', 3), pg_temp.sid('player', 1), pg_temp.sid('category', 1), '2026-08-05', NULL),
  (pg_temp.sid('player_category', 4), pg_temp.sid('player', 3), pg_temp.sid('category', 1), '2026-08-10', NULL);

INSERT INTO venues (id, name, address) VALUES
  (pg_temp.sid('venue', 1), 'Campo Principal', 'Av. Ficticia 123'),
  (pg_temp.sid('venue', 2), 'Unidad Deportiva Norte', 'Calle Inventada 45');

INSERT INTO competitions (id, season_id, name, kind, start_date, end_date) VALUES
  (pg_temp.sid('competition', 1), pg_temp.sid('season', 2), 'Liga Municipal', 'league', '2026-09-01', '2027-05-31'),
  (pg_temp.sid('competition', 2), pg_temp.sid('season', 2), 'Copa Otoño', 'tournament', '2026-10-01', '2026-11-30');

-- Participations (HU-035). Sub-12 also plays the Liga Municipal but has no coach assigned there yet.
INSERT INTO competition_categories (id, competition_id, category_id, season_id, registered_on) VALUES
  (pg_temp.sid('competition_category', 1), pg_temp.sid('competition', 1), pg_temp.sid('category', 1), pg_temp.sid('season', 2), '2026-08-20'),
  (pg_temp.sid('competition_category', 2), pg_temp.sid('competition', 2), pg_temp.sid('category', 2), pg_temp.sid('season', 2), '2026-09-15'),
  (pg_temp.sid('competition_category', 3), pg_temp.sid('competition', 1), pg_temp.sid('category', 2), pg_temp.sid('season', 2), '2026-08-20');

INSERT INTO coach_assignments (id, coach_id, competition_id, category_id, season_id) VALUES
  (pg_temp.sid('assignment', 1), pg_temp.sid('coach', 1), pg_temp.sid('competition', 1), pg_temp.sid('category', 1), pg_temp.sid('season', 2)),
  (pg_temp.sid('assignment', 2), pg_temp.sid('coach', 2), pg_temp.sid('competition', 2), pg_temp.sid('category', 2), pg_temp.sid('season', 2));

INSERT INTO matches (id, competition_id, category_id, season_id, venue_id, starts_at, opponent) VALUES
  (pg_temp.sid('match', 1), pg_temp.sid('competition', 1), pg_temp.sid('category', 1), pg_temp.sid('season', 2), pg_temp.sid('venue', 2), '2026-10-04 10:00-06', 'Tiburones'),
  (pg_temp.sid('match', 2), pg_temp.sid('competition', 2), pg_temp.sid('category', 2), pg_temp.sid('season', 2), pg_temp.sid('venue', 1), '2026-10-05 12:00-06', 'Halcones');

INSERT INTO training_sessions (id, category_id, coach_id, venue_id, starts_at, duration_min) VALUES
  (pg_temp.sid('training', 1), pg_temp.sid('category', 1), pg_temp.sid('coach', 1), pg_temp.sid('venue', 1), '2026-10-01 17:00-06', 90),
  (pg_temp.sid('training', 2), pg_temp.sid('category', 2), pg_temp.sid('coach', 2), pg_temp.sid('venue', 1), '2026-10-02 17:00-06', 90);

INSERT INTO uniform_products (id, name) VALUES
  (pg_temp.sid('product', 1), 'Jersey local'),
  (pg_temp.sid('product', 2), 'Short');

INSERT INTO uniform_variants (id, product_id, size, price_cents) VALUES
  (pg_temp.sid('variant', 1), pg_temp.sid('product', 1), 'CH', 35000),
  (pg_temp.sid('variant', 2), pg_temp.sid('product', 1), 'M', 35000),
  (pg_temp.sid('variant', 3), pg_temp.sid('product', 2), 'CH', 15000);

INSERT INTO uniform_orders (id, player_id, requested_by, created_at) VALUES
  (pg_temp.sid('order', 1), pg_temp.sid('player', 1), pg_temp.sid('user', 2), '2026-09-15 11:00-06');

-- Prices copied from the variants at order time; one line already delivered.
INSERT INTO uniform_order_lines (id, order_id, variant_id, quantity, unit_price_cents, delivered_at, delivered_by, delivered_to) VALUES
  (pg_temp.sid('order_line', 1), pg_temp.sid('order', 1), pg_temp.sid('variant', 1), 2, 35000, '2026-09-20 12:00-06', pg_temp.sid('user', 2), 'Teresa Tutor'),
  (pg_temp.sid('order_line', 2), pg_temp.sid('order', 1), pg_temp.sid('variant', 3), 1, 15000, NULL, NULL, NULL);

-- Price raised after the order: the order lines above keep 35000.
UPDATE uniform_variants SET price_cents = 38000 WHERE id = pg_temp.sid('variant', 1);

INSERT INTO charge_concepts (id, name, kind, default_amount_cents) VALUES
  (pg_temp.sid('concept', 1), 'Mensualidad', 'monthly', 60000),
  (pg_temp.sid('concept', 2), 'Inscripción anual', 'enrollment', 120000),
  (pg_temp.sid('concept', 3), 'Uniforme', 'uniform', 0);

INSERT INTO charges (id, player_id, concept_id, season_id, amount_cents, description, issued_on, due_date, period, uniform_order_id) VALUES
  (pg_temp.sid('charge', 1), pg_temp.sid('player', 1), pg_temp.sid('concept', 1), pg_temp.sid('season', 2), 60000, 'Mensualidad 2026-09', '2026-09-01', '2026-09-10', '2026-09', NULL),
  (pg_temp.sid('charge', 2), pg_temp.sid('player', 2), pg_temp.sid('concept', 1), pg_temp.sid('season', 2), 60000, 'Mensualidad 2026-09', '2026-09-01', '2026-09-10', '2026-09', NULL),
  (pg_temp.sid('charge', 3), pg_temp.sid('player', 3), pg_temp.sid('concept', 2), pg_temp.sid('season', 2), 120000, 'Inscripción 2026-2027', '2026-08-10', '2026-08-15', NULL, NULL),
  (pg_temp.sid('charge', 4), pg_temp.sid('player', 3), pg_temp.sid('concept', 1), pg_temp.sid('season', 2), 60000, 'Mensualidad 2026-09', '2026-09-01', '2026-09-10', '2026-09', NULL),
  (pg_temp.sid('charge', 5), pg_temp.sid('player', 1), pg_temp.sid('concept', 3), pg_temp.sid('season', 2), 85000, 'Uniforme (pedido 1)', '2026-09-15', '2026-10-15', NULL, pg_temp.sid('order', 1)),
  (pg_temp.sid('charge', 6), pg_temp.sid('player', 1), pg_temp.sid('concept', 1), pg_temp.sid('season', 2), 60000, 'Mensualidad 2026-10', '2026-10-01', '2026-10-10', '2026-10', NULL);

-- Receipt numbers are generated by the database in insertion order (1..4).
INSERT INTO payments (id, player_id, amount_cents, method, paid_at, received_by) VALUES
  (pg_temp.sid('payment', 1), pg_temp.sid('player', 1), 60000, 'cash', '2026-09-08 10:15-06', pg_temp.sid('user', 2)),
  (pg_temp.sid('payment', 2), pg_temp.sid('player', 3), 50000, 'transfer', '2026-08-20 13:40-06', pg_temp.sid('user', 2)),
  (pg_temp.sid('payment', 3), pg_temp.sid('player', 2), 60000, 'card', '2026-09-09 09:00-06', pg_temp.sid('user', 2)),
  (pg_temp.sid('payment', 4), pg_temp.sid('player', 1), 35000, 'cash', '2026-09-30 19:30-06', pg_temp.sid('user', 2));

INSERT INTO payment_applications (payment_id, charge_id, player_id, amount_cents) VALUES
  (pg_temp.sid('payment', 1), pg_temp.sid('charge', 1), pg_temp.sid('player', 1), 60000),
  (pg_temp.sid('payment', 2), pg_temp.sid('charge', 3), pg_temp.sid('player', 3), 50000),
  (pg_temp.sid('payment', 3), pg_temp.sid('charge', 2), pg_temp.sid('player', 2), 60000),
  (pg_temp.sid('payment', 4), pg_temp.sid('charge', 5), pg_temp.sid('player', 1), 35000);

-- Payment 3 was a mistake: cancelled, not deleted. Lucía's September fee is open again.
UPDATE payments
SET cancelled_at = '2026-09-09 18:00-06', cancelled_by = pg_temp.sid('user', 1),
    cancellation_reason = 'Cobro duplicado en terminal'
WHERE id = pg_temp.sid('payment', 3);

-- Critical queries: proof that the model answers the system's real questions.
-- Run: psql postgresql:///charales_dev -f db/queries/critical.sql   (read-only; Q11 runs inside a rolled-back transaction)
-- Parameters are psql variables so the backend can copy each query and bind $1, $2…

\set player    '00000000-0000-4000-8000-002000000001'
\set category  '00000000-0000-4000-8000-006000000001'
\set season    '00000000-0000-4000-8000-005000000002'
\set tutor_user '00000000-0000-4000-8000-001000000004'
\set payment   '00000000-0000-4000-8000-020000000001'
\set admin     '00000000-0000-4000-8000-001000000001'
\set from      '2026-08-01'
\set to        '2026-09-30'

\echo 'Q1 · Jugadores de una categoría (actuales)'
SELECT p.id, p.full_name, pc.start_date
FROM player_categories pc JOIN players p ON p.id = pc.player_id
WHERE pc.category_id = :'category' AND pc.end_date IS NULL
ORDER BY p.full_name;

\echo 'Q2 · Categoría actual de un jugador'
SELECT c.name, s.name AS season, pc.start_date
FROM player_categories pc JOIN categories c ON c.id = pc.category_id JOIN seasons s ON s.id = c.season_id
WHERE pc.player_id = :'player' AND pc.end_date IS NULL;

\echo 'Q3 · Historial de categorías de un jugador'
SELECT p.full_name, c.name, s.name AS season, pc.start_date, pc.end_date
FROM player_categories pc
JOIN players p ON p.id = pc.player_id
JOIN categories c ON c.id = pc.category_id
JOIN seasons s ON s.id = c.season_id
WHERE pc.player_id = '00000000-0000-4000-8000-002000000002'
ORDER BY pc.start_date;

\echo 'Q4 · Jugadores inscritos (activos) en una temporada'
SELECT p.full_name, e.enrolled_on
FROM enrollments e JOIN players p ON p.id = e.player_id
WHERE e.season_id = :'season' AND e.status = 'active'
ORDER BY p.full_name;

\echo 'Q5 · Hijos de un tutor, a partir del USUARIO autenticado (nunca de un id enviado por el navegador)'
SELECT p.id, p.full_name, tp.relationship
FROM tutors t JOIN tutor_players tp ON tp.tutor_id = t.id JOIN players p ON p.id = tp.player_id
WHERE t.user_id = :'tutor_user'
ORDER BY p.full_name;

\echo 'Q6 · Cargos pendientes de un jugador'
SELECT description, due_date, amount_cents, paid_cents, balance_cents, status
FROM charge_balances
WHERE player_id = :'player' AND balance_cents > 0
ORDER BY due_date;

\echo 'Q7 · Saldo total de un jugador'
SELECT COALESCE(SUM(balance_cents), 0) AS balance_cents FROM charge_balances WHERE player_id = :'player';

\echo 'Q8 · Cargos vencidos (hoy en hora de México)'
SELECT p.full_name, cb.description, cb.due_date, cb.balance_cents
FROM charge_balances cb JOIN players p ON p.id = cb.player_id
WHERE cb.balance_cents > 0 AND cb.due_date < business_date(now())
ORDER BY cb.due_date;

\echo 'Q9 · Pagos de un jugador (incluye cancelados, para trazabilidad)'
SELECT receipt_number, paid_at, amount_cents, method, cancelled_at, cancellation_reason
FROM payments WHERE player_id = :'player' ORDER BY paid_at;

\echo 'Q10 · Aplicaciones de un pago (reconstruye el recibo)'
SELECT pay.receipt_number, business_date(pay.paid_at) AS paid_on, pay.method, u.full_name AS received_by,
       c.description, pa.amount_cents
FROM payments pay
JOIN users u ON u.id = pay.received_by
JOIN payment_applications pa ON pa.payment_id = pay.id
JOIN charges c ON c.id = pa.charge_id
WHERE pay.id = :'payment';

\echo 'Q11 · Cancelar un pago sin perder historial (en transacción revertida)'
BEGIN;
UPDATE payments
SET cancelled_at = now(), cancelled_by = :'admin', cancellation_reason = 'Ejemplo de cancelación'
WHERE id = :'payment' AND cancelled_at IS NULL;
SELECT receipt_number, cancelled_at IS NOT NULL AS cancelled,
       (SELECT count(*) FROM payment_applications WHERE payment_id = :'payment') AS applications_kept,
       (SELECT balance_cents FROM charge_balances WHERE id = '00000000-0000-4000-8000-019000000001') AS charge_balance_again
FROM payments WHERE id = :'payment';
ROLLBACK;

\echo 'Q12 · Ingresos por periodo (mes local) y concepto; excluye pagos cancelados'
SELECT to_char(business_date(pay.paid_at), 'YYYY-MM') AS month, cc.name AS concept, SUM(pa.amount_cents) AS income_cents
FROM payments pay
JOIN payment_applications pa ON pa.payment_id = pay.id
JOIN charges c ON c.id = pa.charge_id
JOIN charge_concepts cc ON cc.id = c.concept_id
WHERE pay.cancelled_at IS NULL AND business_date(pay.paid_at) BETWEEN :'from' AND :'to'
GROUP BY 1, 2 ORDER BY 1, 2;

\echo 'Q13 · Ingresos por método de pago'
SELECT method, count(*) AS payments, SUM(amount_cents) AS income_cents
FROM payments
WHERE cancelled_at IS NULL AND business_date(paid_at) BETWEEN :'from' AND :'to'
GROUP BY method ORDER BY method;

\echo 'Q14 · Pedidos de uniformes (reporte: producto, talla, cantidades, cargo, pagado, entregas)'
SELECT o.id AS order_id, pl.full_name AS player, up.name AS product, uv.size, l.quantity, l.unit_price_cents,
       l.quantity * l.unit_price_cents AS line_total_cents, l.delivered_at IS NOT NULL AS delivered,
       cb.amount_cents AS charge_cents, cb.paid_cents AS charge_paid_cents
FROM uniform_orders o
JOIN players pl ON pl.id = o.player_id
JOIN uniform_order_lines l ON l.order_id = o.id
JOIN uniform_variants uv ON uv.id = l.variant_id
JOIN uniform_products up ON up.id = uv.product_id
LEFT JOIN charge_balances cb ON cb.uniform_order_id = o.id
ORDER BY o.created_at, up.name;

\echo 'Q15 · Uniformes pendientes de entrega'
SELECT pl.full_name AS player, up.name AS product, uv.size, l.quantity, o.created_at
FROM uniform_order_lines l
JOIN uniform_orders o ON o.id = l.order_id
JOIN players pl ON pl.id = o.player_id
JOIN uniform_variants uv ON uv.id = l.variant_id
JOIN uniform_products up ON up.id = uv.product_id
WHERE l.delivered_at IS NULL
ORDER BY o.created_at;

\echo 'Q16 · Competencias en las que participa una categoría (C2), con entrenador si ya tiene'
SELECT comp.name, comp.kind, comp.start_date, comp.end_date, cc.registered_on, co.full_name AS coach
FROM competition_categories cc
JOIN competitions comp ON comp.id = cc.competition_id
LEFT JOIN coach_assignments a ON a.competition_id = cc.competition_id AND a.category_id = cc.category_id
LEFT JOIN coaches co ON co.id = a.coach_id
WHERE cc.category_id = '00000000-0000-4000-8000-006000000002'
ORDER BY comp.start_date;

\echo 'Q17 · Agenda de una categoría (entrenamientos + partidos, hora local)'
SELECT * FROM (
  SELECT 'training' AS kind, t.starts_at AT TIME ZONE 'America/Mexico_City' AS local_start, c.name AS category,
         co.full_name AS coach, v.name AS venue, t.duration_min || ' min' AS detail
  FROM training_sessions t
  JOIN categories c ON c.id = t.category_id JOIN coaches co ON co.id = t.coach_id JOIN venues v ON v.id = t.venue_id
  WHERE t.category_id = :'category'
  UNION ALL
  SELECT 'match', m.starts_at AT TIME ZONE 'America/Mexico_City', c.name, co.full_name, v.name,
         'vs ' || m.opponent || ' — ' || comp.name
  FROM matches m
  JOIN categories c ON c.id = m.category_id JOIN venues v ON v.id = m.venue_id
  JOIN competitions comp ON comp.id = m.competition_id
  LEFT JOIN coach_assignments a ON a.competition_id = m.competition_id AND a.category_id = m.category_id
  LEFT JOIN coaches co ON co.id = a.coach_id
  WHERE m.category_id = :'category'
) agenda
ORDER BY local_start;

\echo 'Q18 · Jugadores activos con inscripción activa en la temporada activa (base de mensualidades, HU-044)'
SELECT p.full_name
FROM players p
JOIN enrollments e ON e.player_id = p.id AND e.status = 'active'
JOIN seasons s ON s.id = e.season_id AND s.active
WHERE p.active
ORDER BY p.full_name;

\echo 'Q19 · Mensualidades de una temporada'
SELECT cb.period, p.full_name, cb.amount_cents, cb.balance_cents, cb.status
FROM charge_balances cb
JOIN charge_concepts cc ON cc.id = cb.concept_id AND cc.kind = 'monthly'
JOIN players p ON p.id = cb.player_id
WHERE cb.season_id = :'season'
ORDER BY cb.period, p.full_name;

\echo 'Q20 · Reporte global de adeudos (con tutor principal)'
SELECT p.full_name AS player, t.full_name AS primary_tutor, t.phone,
       count(*) AS open_charges, MIN(cb.due_date) AS oldest_due, SUM(cb.amount_cents) AS charged_cents,
       SUM(cb.paid_cents) AS paid_cents, SUM(cb.balance_cents) AS balance_cents
FROM charge_balances cb
JOIN players p ON p.id = cb.player_id
LEFT JOIN tutor_players tp ON tp.player_id = p.id AND tp.is_primary
LEFT JOIN tutors t ON t.id = tp.tutor_id
WHERE cb.balance_cents > 0
GROUP BY p.id, t.id
ORDER BY balance_cents DESC;

\echo 'Q21 · Portal (HU-063): competencias de cada hijo del tutor autenticado, vía categoría actual → participación'
\echo '      (cuando exista el plantel de HU-036, filtrar además por jugador_competencia_categoria)'
SELECT p.full_name AS child, c.name AS category, comp.name AS competition, comp.kind, comp.start_date, comp.end_date
FROM tutors t
JOIN tutor_players tp ON tp.tutor_id = t.id
JOIN players p ON p.id = tp.player_id
JOIN player_categories pc ON pc.player_id = p.id AND pc.end_date IS NULL
JOIN categories c ON c.id = pc.category_id
JOIN competition_categories cc ON cc.category_id = pc.category_id
JOIN competitions comp ON comp.id = cc.competition_id
WHERE t.user_id = :'tutor_user'
ORDER BY p.full_name, comp.start_date;

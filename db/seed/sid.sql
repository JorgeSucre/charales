-- Readable fixed UUIDs for seed and tests: 00000000-0000-4000-8000-TTTNNNNNNNNN (TTT = table code).
-- Session-local helper (pg_temp); never part of the schema.

CREATE FUNCTION pg_temp.sid(tbl text, n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT format('00000000-0000-4000-8000-%s%s', lpad(code::text, 3, '0'), lpad(n::text, 9, '0'))::uuid
  FROM (SELECT CASE tbl
    WHEN 'user' THEN 1 WHEN 'player' THEN 2 WHEN 'tutor' THEN 3 WHEN 'coach' THEN 4 WHEN 'season' THEN 5
    WHEN 'category' THEN 6 WHEN 'enrollment' THEN 7 WHEN 'player_category' THEN 8 WHEN 'venue' THEN 9
    WHEN 'competition' THEN 10 WHEN 'assignment' THEN 11 WHEN 'match' THEN 12 WHEN 'training' THEN 13
    WHEN 'product' THEN 14 WHEN 'variant' THEN 15 WHEN 'order' THEN 16 WHEN 'order_line' THEN 17
    WHEN 'concept' THEN 18 WHEN 'charge' THEN 19 WHEN 'payment' THEN 20
    WHEN 'competition_category' THEN 21 END AS code) t
$$;

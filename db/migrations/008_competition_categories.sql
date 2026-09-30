-- 008 · Explicit participation of a category in a competition (contract C2; spec: competencia_categoria).
-- Writes: HU-035 (Armando). Readers: HU-026 coach assignments, HU-037 matches, HU-063 tutor portal, agenda.
-- Participation ≠ coach responsibility: a category can participate before (or without) an assigned coach.

CREATE TABLE competition_categories (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL,
  category_id    uuid NOT NULL,
  season_id      uuid NOT NULL,
  registered_on  date NOT NULL DEFAULT business_date(now()),
  FOREIGN KEY (competition_id, season_id) REFERENCES competitions (id, season_id),
  FOREIGN KEY (category_id, season_id) REFERENCES categories (id, season_id),
  UNIQUE (competition_id, category_id),
  UNIQUE (competition_id, category_id, season_id)
);

CREATE INDEX ON competition_categories (category_id);

-- Backfill: every pair already used by a coach assignment or a match is a participation.
INSERT INTO competition_categories (competition_id, category_id, season_id)
SELECT competition_id, category_id, season_id FROM coach_assignments
UNION
SELECT competition_id, category_id, season_id FROM matches;

-- A coach can only be assigned to, and a match only scheduled for, a registered participation (HU-026, HU-037).
ALTER TABLE coach_assignments ADD CONSTRAINT coach_assignments_participation_fkey
  FOREIGN KEY (competition_id, category_id, season_id)
  REFERENCES competition_categories (competition_id, category_id, season_id);

ALTER TABLE matches ADD CONSTRAINT matches_participation_fkey
  FOREIGN KEY (competition_id, category_id, season_id)
  REFERENCES competition_categories (competition_id, category_id, season_id);

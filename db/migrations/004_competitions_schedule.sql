-- 004 · Competitions, coach assignments (HU-026), venues and schedule (HU-068)

CREATE TABLE venues (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name    text NOT NULL UNIQUE CHECK (btrim(name) <> ''),
  address text NOT NULL
);

CREATE TABLE competitions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id  uuid NOT NULL REFERENCES seasons,
  name       text NOT NULL CHECK (btrim(name) <> ''),
  kind       text NOT NULL CHECK (kind IN ('tournament', 'league')),
  start_date date,
  end_date   date,
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  UNIQUE (season_id, name),
  UNIQUE (id, season_id)
);

-- Which coach takes which category to which competition. season_id exists only to force
-- category and competition to belong to the same season.
CREATE TABLE coach_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id       uuid NOT NULL REFERENCES coaches,
  competition_id uuid NOT NULL,
  category_id    uuid NOT NULL,
  season_id      uuid NOT NULL,
  FOREIGN KEY (competition_id, season_id) REFERENCES competitions (id, season_id),
  FOREIGN KEY (category_id, season_id) REFERENCES categories (id, season_id),
  UNIQUE (coach_id, competition_id, category_id)
);

CREATE INDEX ON coach_assignments (category_id);
CREATE INDEX ON coach_assignments (competition_id);

CREATE TABLE matches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL,
  category_id    uuid NOT NULL,
  season_id      uuid NOT NULL,
  venue_id       uuid NOT NULL REFERENCES venues,
  starts_at      timestamptz NOT NULL,
  opponent       text NOT NULL CHECK (btrim(opponent) <> ''),
  FOREIGN KEY (competition_id, season_id) REFERENCES competitions (id, season_id),
  FOREIGN KEY (category_id, season_id) REFERENCES categories (id, season_id)
);

CREATE INDEX ON matches (category_id, starts_at);
CREATE INDEX ON matches (starts_at);

CREATE TABLE training_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  uuid NOT NULL REFERENCES categories,
  coach_id     uuid NOT NULL REFERENCES coaches,
  venue_id     uuid NOT NULL REFERENCES venues,
  starts_at    timestamptz NOT NULL,
  duration_min integer NOT NULL CHECK (duration_min BETWEEN 1 AND 600)
);

CREATE INDEX ON training_sessions (category_id, starts_at);
CREATE INDEX ON training_sessions (starts_at);

-- 003 · Seasons (HU-070), categories, enrollment (HU-020) and category membership (jugador_categoria)

CREATE TABLE seasons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE CHECK (btrim(name) <> ''),
  start_date date NOT NULL,
  end_date   date NOT NULL,
  active     boolean NOT NULL DEFAULT false,
  CHECK (end_date > start_date)
);

CREATE UNIQUE INDEX seasons_one_active ON seasons (active) WHERE active;

CREATE TABLE categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id       uuid NOT NULL REFERENCES seasons,
  name            text NOT NULL CHECK (btrim(name) <> ''),
  birth_year_from integer NOT NULL,
  birth_year_to   integer NOT NULL,
  CHECK (birth_year_from <= birth_year_to),
  UNIQUE (season_id, name),
  UNIQUE (id, season_id) -- lets other tables require "same season" via composite FK
);

-- Administrative/annual enrollment. Deliberately NO category_id (see player_categories).
CREATE TABLE enrollments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid NOT NULL REFERENCES players,
  season_id   uuid NOT NULL REFERENCES seasons,
  enrolled_on date NOT NULL DEFAULT business_date(now()),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  notes       text
);

CREATE UNIQUE INDEX enrollments_one_active_per_season ON enrollments (player_id, season_id)
  WHERE status = 'active';
CREATE INDEX ON enrollments (season_id);

-- Category membership history. Open row (end_date NULL) = current category.
-- Changing category: set end_date on the open row, insert a new one (same transaction).
CREATE TABLE player_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid NOT NULL REFERENCES players,
  category_id uuid NOT NULL REFERENCES categories,
  start_date  date NOT NULL,
  end_date    date,
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE UNIQUE INDEX player_categories_one_current ON player_categories (player_id) WHERE end_date IS NULL;
CREATE INDEX ON player_categories (category_id) WHERE end_date IS NULL;

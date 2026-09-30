-- 002 · Players, tutors (HU-011), coaches (HU-022)

CREATE TABLE players (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name  text NOT NULL CHECK (btrim(full_name) <> ''),
  birth_date date NOT NULL CHECK (birth_date > '1900-01-01'),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tutors (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL CHECK (btrim(full_name) <> ''),
  phone     text NOT NULL CHECK (phone ~ '^\+?[0-9]{10,13}$'),
  email     text CHECK (email = lower(btrim(email)) AND email LIKE '%_@_%'),
  -- Optional login. The composite FK guarantees the linked account has role 'tutor'.
  user_id   uuid UNIQUE,
  user_role text NOT NULL DEFAULT 'tutor' CHECK (user_role = 'tutor'),
  FOREIGN KEY (user_id, user_role) REFERENCES users (id, role)
);

-- Many-to-many: a player can have several tutors and a tutor several players.
CREATE TABLE tutor_players (
  tutor_id     uuid NOT NULL REFERENCES tutors,
  player_id    uuid NOT NULL REFERENCES players,
  relationship text NOT NULL CHECK (btrim(relationship) <> ''), -- per pair: mother of one, aunt of another
  is_primary   boolean NOT NULL DEFAULT false,                  -- contact shown in debt reports
  PRIMARY KEY (tutor_id, player_id)
);

CREATE INDEX ON tutor_players (player_id);
CREATE UNIQUE INDEX tutor_players_one_primary ON tutor_players (player_id) WHERE is_primary;

CREATE TABLE coaches (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL CHECK (btrim(full_name) <> ''),
  phone     text NOT NULL CHECK (phone ~ '^\+?[0-9]{10,13}$'),
  email     text NOT NULL CHECK (email = lower(btrim(email)) AND email LIKE '%_@_%'),
  active    boolean NOT NULL DEFAULT true,
  user_id   uuid UNIQUE,
  user_role text NOT NULL DEFAULT 'coach' CHECK (user_role = 'coach'),
  FOREIGN KEY (user_id, user_role) REFERENCES users (id, role)
);

-- 001 · Foundation + users/auth (HU-004, HU-005, HU-072)
-- Conventions: uuid PKs, money in integer cents, `date` = local business date, `timestamptz` = instant.
-- See docs/database/decisions.md.

-- The ONLY place that names the business time zone. Use it for every "today" / "which day was this" question.
CREATE FUNCTION business_date(ts timestamptz) RETURNS date
LANGUAGE sql STABLE
AS $$ SELECT (ts AT TIME ZONE 'America/Mexico_City')::date $$;

COMMENT ON FUNCTION business_date(timestamptz) IS
  'Local (America/Mexico_City) calendar date of an instant. Never derive business dates from UTC.';

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND email LIKE '%_@_%'),
  full_name     text NOT NULL CHECK (btrim(full_name) <> ''),
  -- Same values as the TS `Role`. Permissions per role live in code (core/auth/permissions.ts).
  role          text NOT NULL CHECK (role IN ('admin', 'secretary', 'coach', 'tutor')),
  active        boolean NOT NULL DEFAULT true,
  -- argon2id or bcrypt hash; NULL = invited, no password yet. The CHECK rejects anything that isn't a hash.
  password_hash text CHECK (password_hash ~ '^\$(argon2id|2[aby])\$'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Target of role-checked FKs from tutors/coaches.
  UNIQUE (id, role)
);

COMMENT ON TABLE users IS 'Login identity. Deactivate (active=false) instead of deleting.';

-- HU-005: only the SHA-256 of the emailed token is stored.
CREATE TABLE password_reset_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  CHECK (expires_at > created_at),
  CHECK (used_at IS NULL OR used_at >= created_at)
);

CREATE INDEX ON password_reset_tokens (user_id);

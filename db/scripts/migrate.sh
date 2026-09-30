#!/usr/bin/env sh
# Applies pending migrations (db/migrations/NNN_*.sql) in order, each in its own transaction.
# Usage: DATABASE_URL=postgresql://user@host/db sh db/scripts/migrate.sh   (default: local charales_dev)
set -eu
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
DB="${DATABASE_URL:-postgresql:///charales_dev}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PSQL="psql $DB -X -q -v ON_ERROR_STOP=1"

$PSQL -c "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
for file in "$DIR"/migrations/*.sql; do
  version="$(basename "$file" .sql)"
  if [ -z "$($PSQL -At -c "SELECT 1 FROM schema_migrations WHERE version = '$version'")" ]; then
    echo "→ $version"
    $PSQL -1 -f "$file" -c "INSERT INTO schema_migrations (version) VALUES ('$version')"
  fi
done
echo "migrations up to date"

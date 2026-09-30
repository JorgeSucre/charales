#!/usr/bin/env sh
# Builds a throwaway database from scratch (migrations + seed), runs the integrity tests and the critical queries.
# Usage: sh db/scripts/test.sh   (uses local database charales_test)
set -eu
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
sh "$DIR/scripts/reset.sh" charales_test
# Migrations must be idempotent to re-run: nothing pending → no-op.
DATABASE_URL="postgresql:///charales_test" sh "$DIR/scripts/migrate.sh" | tail -1
for test in "$DIR"/tests/*.sql; do
  psql "postgresql:///charales_test" -X -q -v ON_ERROR_STOP=1 -f "$test"
done
psql "postgresql:///charales_test" -X -q -v ON_ERROR_STOP=1 -f "$DIR/queries/critical.sql" > /dev/null
echo "critical queries OK"

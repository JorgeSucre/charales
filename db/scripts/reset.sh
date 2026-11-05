#!/usr/bin/env sh
# LOCAL DEV ONLY: drops and recreates a database, applies all migrations and loads the dev seed.
# Usage: sh db/scripts/reset.sh [db_name]   (default: charales_dev)
set -eu
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
NAME="${1:-charales_dev}"
# Borra la base que recibe: sólo las dos de este esquema histórico, nunca otra por error (F5-19).
case "$NAME" in
  charales_dev | charales_test) ;;
  *)
    echo "reset.sh sólo recrea charales_dev o charales_test, no «$NAME»." >&2
    exit 1
    ;;
esac
DIR="$(cd "$(dirname "$0")/.." && pwd)"
dropdb --if-exists "$NAME"
createdb "$NAME"
DATABASE_URL="postgresql:///$NAME" sh "$DIR/scripts/migrate.sh"
psql "postgresql:///$NAME" -X -q -v ON_ERROR_STOP=1 -1 -f "$DIR/seed/dev_seed.sql"
echo "$NAME ready (seeded)"

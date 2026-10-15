#!/bin/sh
# Aplica en orden las migraciones de db/mariadb/migrations a una base ya creada con docs/escuela_futbol_mariadb.sql.
# Cada migración es idempotente, así que se puede volver a ejecutar sobre una base al día.
# Uso: sh db/mariadb/scripts/migrate.sh [base]   (por defecto $DB_NAME o escuela_futbol)
set -eu
DB="${1:-${DB_NAME:-escuela_futbol}}"
for f in "$(dirname "$0")/../migrations/"*.sql; do
  mariadb "$DB" < "$f"
  echo "migración aplicada: $(basename "$f")"
done

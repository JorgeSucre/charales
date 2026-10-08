#!/bin/sh
# HU-076 · Restaura un respaldo en una base NUEVA. Se niega a escribir sobre una base existente.
# Uso: sh db/mariadb/scripts/restore.sh <respaldo.sql.gz> <base_destino_nueva>
set -eu
FILE="${1:?Uso: restore.sh <respaldo.sql.gz> <base_destino>}"
DB="${2:?Uso: restore.sh <respaldo.sql.gz> <base_destino>}"
if [ -n "$(mariadb -N -e "SHOW DATABASES LIKE '$DB'")" ]; then
  echo "La base $DB ya existe; restaura siempre en una base nueva." >&2
  exit 1
fi
mariadb -e "CREATE DATABASE \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
gunzip -c "$FILE" | mariadb "$DB"
echo "Restaurado en $DB"

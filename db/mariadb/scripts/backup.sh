#!/bin/sh
# HU-076 · Respaldo consistente de una base MariaDB (InnoDB, sin bloquear escrituras).
# Uso: sh db/mariadb/scripts/backup.sh <base> [directorio]   →  imprime la ruta del .sql.gz creado
# Conexión: variables/archivo de opciones estándar de mariadb (~/.my.cnf, MYSQL_HOST…). Sin contraseñas en el repo.
set -eu
DB="${1:?Uso: backup.sh <base> [directorio]}"
DIR="${2:-backups}"
mkdir -p "$DIR"
FILE="$DIR/${DB}_$(date +%Y-%m-%d_%H%M%S).sql.gz"
mariadb-dump --single-transaction --routines --triggers --events --default-character-set=utf8mb4 "$DB" | gzip > "$FILE"
gzip -t "$FILE"
echo "$FILE"

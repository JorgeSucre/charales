#!/bin/sh
# HU-076 · Respaldo consistente de una base MariaDB (InnoDB, sin bloquear escrituras).
# Uso: sh db/mariadb/scripts/backup.sh <base> [directorio]   →  imprime la ruta del .sql.gz creado
# Conexión: variables/archivo de opciones estándar de mariadb (~/.my.cnf, MYSQL_HOST…). Sin contraseñas en el repo.
# Si el volcado falla o queda incompleto, sale con error y no deja archivo: nadie debe confiar en un respaldo roto.
set -eu
umask 077 # sólo su dueño: contiene datos de personas, también de menores
DB="${1:?Uso: backup.sh <base> [directorio]}"
DIR="${2:-backups}"
mkdir -p "$DIR"
FILE="$DIR/${DB}_$(date +%Y-%m-%d_%H%M%S).sql.gz"
PART="$FILE.parcial"
ZIPPED="$FILE.parcial.gz"
trap 'rm -f "$PART" "$ZIPPED"' EXIT
trap 'exit 1' INT TERM # no todos los sh ejecutan el trap de EXIT con una señal: este sí sale por él
mariadb-dump --single-transaction --routines --triggers --events --default-character-set=utf8mb4 "$DB" > "$PART"
tail -n 1 "$PART" | grep -q 'Dump completed' || {
  echo "backup.sh: el volcado de $DB quedó incompleto" >&2
  exit 1
}
gzip -c "$PART" > "$ZIPPED"
gzip -t "$ZIPPED"
mv "$ZIPPED" "$FILE"
echo "$FILE"

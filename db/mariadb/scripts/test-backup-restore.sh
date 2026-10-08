#!/bin/sh
# HU-076 · Prueba de punta a punta en bases temporales propias (nunca toca otras):
#   esquema + datos de prueba (escuela_futbol_mariadb_checks.sql) → backup.sh → restore.sh → verify-backup.sh → limpieza.
# Uso: sh db/mariadb/scripts/test-backup-restore.sh   (desde la raíz del repo, con un servidor MariaDB local)
set -eu
HERE=$(dirname "$0")
SRC="ef_bktest_$$_src"; DST="ef_bktest_$$_dst"; TMP=$(mktemp -d)
cleanup() { mariadb -e "DROP DATABASE IF EXISTS \`$SRC\`; DROP DATABASE IF EXISTS \`$DST\`;"; rm -rf "$TMP"; }
trap cleanup EXIT
echo "MariaDB $(mariadb -N -e 'SELECT VERSION()') · $(date '+%Y-%m-%d %H:%M')"
sed "s/escuela_futbol/$SRC/g" docs/escuela_futbol_mariadb.sql | mariadb
mariadb "$SRC" < db/mariadb/010_permisos_app.sql
mariadb "$SRC" < docs/escuela_futbol_mariadb_checks.sql > "$TMP/checks.txt"
tail -1 "$TMP/checks.txt" | awk '{print "Checks del esquema: " $1 " casos, " $2 " OK, " $3 " fallas"}'
FILE=$(sh "$HERE/backup.sh" "$SRC" "$TMP")
echo "Respaldo: $(basename "$FILE") ($(wc -c < "$FILE" | tr -d ' ') bytes comprimidos)"
sh "$HERE/restore.sh" "$FILE" "$DST"
sh "$HERE/verify-backup.sh" "$SRC" "$DST"

#!/bin/sh
# HU-076 · Compara dos bases tabla por tabla: número de filas y CHECKSUM TABLE de TODAS las tablas.
# Uso: sh db/mariadb/scripts/verify-backup.sh <base_original> <base_restaurada>   (exit 1 si difieren)
set -eu
SRC="${1:?Uso: verify-backup.sh <original> <restaurada>}"
DST="${2:?Uso: verify-backup.sh <original> <restaurada>}"
tables=$(mariadb -N -e "SELECT table_name FROM information_schema.tables WHERE table_schema='$SRC' AND table_type='BASE TABLE' ORDER BY table_name")
fail=0; n=0
for t in $tables; do
  n=$((n + 1))
  a=$(mariadb -N -e "SELECT COUNT(*) FROM \`$SRC\`.\`$t\`"); b=$(mariadb -N -e "SELECT COUNT(*) FROM \`$DST\`.\`$t\`")
  ca=$(mariadb -N -e "CHECKSUM TABLE \`$SRC\`.\`$t\`" | awk '{print $2}'); cb=$(mariadb -N -e "CHECKSUM TABLE \`$DST\`.\`$t\`" | awk '{print $2}')
  if [ "$a" = "$b" ] && [ "$ca" = "$cb" ]; then s=OK; else s=DIFERENTE; fail=1; fi
  printf '%-34s filas %6s / %6s  checksum %12s / %12s  %s\n' "$t" "$a" "$b" "$ca" "$cb" "$s"
done
echo "Tablas comparadas: $n"
[ "$fail" -eq 0 ] && echo "RESULTADO: OK, el respaldo es idéntico" || { echo "RESULTADO: DIFERENCIAS"; exit 1; }

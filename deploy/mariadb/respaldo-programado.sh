#!/bin/sh
# Respaldo cifrado con retención (P-06). Lo ejecuta un temporizador del servidor; no borra nada fuera de $BACKUP_DIR.
# Uso: BACKUP_GPG_RECIPIENT=<clave pública> sh deploy/mariadb/respaldo-programado.sh <base> <directorio>
# Retención: 7 diarios + 4 semanales (domingo) + 12 mensuales (día 1). Copia el resultado fuera del servidor aparte.
set -eu
umask 077
DB="${1:?Uso: respaldo-programado.sh <base> <directorio>}"
BACKUP_DIR="${2:?Uso: respaldo-programado.sh <base> <directorio>}"
RECIPIENT="${BACKUP_GPG_RECIPIENT:?Falta BACKUP_GPG_RECIPIENT: un respaldo sin cifrar no sale de aquí}"
HERE=$(dirname "$0")
mkdir -p "$BACKUP_DIR/diario" "$BACKUP_DIR/semanal" "$BACKUP_DIR/mensual"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
PLAIN=$(sh "$HERE/../../db/mariadb/scripts/backup.sh" "$DB" "$WORK")
OUT="$BACKUP_DIR/diario/$(basename "$PLAIN").gpg"
gpg --batch --yes --trust-model always --recipient "$RECIPIENT" --output "$OUT" --encrypt "$PLAIN"
[ "$(date +%u)" = 7 ] && cp "$OUT" "$BACKUP_DIR/semanal/"
[ "$(date +%d)" = 01 ] && cp "$OUT" "$BACKUP_DIR/mensual/"
find "$BACKUP_DIR/diario" -type f -name '*.gpg' -mtime +7 -delete
find "$BACKUP_DIR/semanal" -type f -name '*.gpg' -mtime +28 -delete
find "$BACKUP_DIR/mensual" -type f -name '*.gpg' -mtime +365 -delete
echo "$OUT"

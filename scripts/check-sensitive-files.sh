#!/bin/sh
# Falla si Git sigue archivos que nunca deben entrar al repositorio, o texto con forma de secreto (F5-09). Sin dependencias.
# Uso: sh scripts/check-sensitive-files.sh   (en CI y a mano, antes de un commit)
set -u
status=0
fail() {
  echo "ERROR: $1"
  status=1
}
files=$(git ls-files)
bad=$(echo "$files" | grep -E '(^|/)\.env($|\.)|(^|/)backups/|\.(sql\.gz|dump|pem|key|p12|pfx|gpg|ibd)$|(^|/)id_(rsa|ed25519)$' | grep -vE '(^|/)\.env\.example$')
[ -n "$bad" ] && fail "archivos sensibles en Git:
$bad"
# Claves de los proveedores que usa o podría usar el proyecto, y llaves privadas. Los valores de prueba son más cortos.
secrets=$(git grep -nIE 're_[A-Za-z0-9]{24,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36}' -- ':!scripts/check-sensitive-files.sh' || true)
[ -n "$secrets" ] && fail "texto con forma de secreto:
$secrets"
# Un archivo real sin seguir por Git debe estar ignorado, no sólo sin añadir.
for sample in .env .env.production backups/x.sql.gz respaldo.sql.gz; do
  git check-ignore -q "$sample" || fail "$sample no está en .gitignore"
done
[ "$status" -eq 0 ] && echo "OK: sin archivos sensibles ni secretos en Git."
exit "$status"

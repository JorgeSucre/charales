#!/bin/sh
# Pasos 8-9 de DEPLOYMENT.md: copia el frontend (dist/, con su .htaccess) al DocumentRoot de Apache, permite el
# .htaccess con /etc/httpd/conf.d/charales.conf y aplica el contexto SELinux. Como root:
#   sh /home/charales/charales/backend/deploy/servidor/instalar-apache.sh [DocumentRoot]   (por defecto /var/www/html)
# No sobrescribe nada ajeno: se detiene si el DocumentRoot tiene contenido que no es Charales o si charales.conf ya
# existe con otro contenido. Una versión anterior de Charales se respalda antes de copiar encima.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
DIST=$(cd "$HERE/../../../dist" && pwd)
DOCROOT=${1:-/var/www/html}
CONF_D=${CONF_D:-/etc/httpd/conf.d}
CONF=$CONF_D/charales.conf

[ -f "$DIST/index.html" ] && [ -f "$DIST/.htaccess" ] || { echo "No encuentro dist/index.html y dist/.htaccess en $DIST" >&2; exit 1; }
[ -d "$DOCROOT" ] || { echo "No existe el DocumentRoot $DOCROOT" >&2; exit 1; }
[ -d "$CONF_D" ] || { echo "No existe $CONF_D (¿Apache instalado? dnf install -y httpd)" >&2; exit 1; }

# 1. DocumentRoot: vacío, o con una versión anterior de Charales (se respalda).
if [ -n "$(ls -A "$DOCROOT")" ]; then
  if grep -q '<app-root' "$DOCROOT/index.html" 2>/dev/null && [ -f "$DOCROOT/.htaccess" ]; then
    BK=${BACKUP_DIR:-/root}/charales-html-$(date +%Y%m%d-%H%M%S).tar.gz
    (umask 077 && tar -czf "$BK" -C "$DOCROOT" .)
    echo "Versión anterior respaldada en $BK (sus .js/.css quedan y no estorban)"
  else
    echo "El DocumentRoot $DOCROOT tiene contenido que no es Charales:" >&2
    ls -A "$DOCROOT" | head -n 10 >&2
    echo "No se tocó nada. Usa un DocumentRoot vacío o respáldalo y vacíalo tú (DEPLOYMENT.md paso 8)." >&2
    exit 1
  fi
fi
cp -R "$DIST/." "$DOCROOT/"
chmod -R u=rwX,go=rX "$DOCROOT"
echo "Frontend copiado a $DOCROOT"

# 2. SELinux: contexto de contenido web (sólo si SELinux está presente).
if command -v restorecon >/dev/null 2>&1; then
  case "$DOCROOT" in
    /var/www/*) ;;
    *)
      if command -v semanage >/dev/null 2>&1; then
        semanage fcontext -l | grep -qF "$DOCROOT(/.*)?" || semanage fcontext -a -t httpd_sys_content_t "$DOCROOT(/.*)?"
      else
        echo "AVISO: $DOCROOT está fuera de /var/www y falta semanage (dnf install -y policycoreutils-python-utils)."
      fi
      ;;
  esac
  restorecon -R "$DOCROOT"
  echo "Contexto SELinux aplicado a $DOCROOT"
fi

# 3. AllowOverride para el .htaccess (AlmaLinux trae AllowOverride None).
WANT=$(sed "s|/var/www/html|$DOCROOT|" "$HERE/apache-charales.conf")
if [ -e "$CONF" ]; then
  if [ "$(cat "$CONF")" = "$WANT" ]; then
    echo "$CONF ya estaba instalado"
  else
    echo "AVISO: $CONF ya existe con otro contenido; no se modificó. Debe tener «AllowOverride All» en <Directory \"$DOCROOT\">."
  fi
  NEW=
else
  printf '%s\n' "$WANT" > "$CONF"
  chmod 644 "$CONF"
  command -v restorecon >/dev/null 2>&1 && restorecon "$CONF"
  NEW=1
  echo "Creado $CONF"
fi

if apachectl configtest; then
  systemctl reload httpd 2>/dev/null || systemctl restart httpd
  echo "Apache recargado. Comprueba: curl -I http://45.80.152.66/login  (200)"
else
  [ -n "$NEW" ] && rm -f "$CONF" && echo "Retirado $CONF: la configuración de Apache no es válida (revisa el mensaje)." >&2
  exit 1
fi

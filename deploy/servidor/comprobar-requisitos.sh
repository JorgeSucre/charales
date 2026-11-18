#!/bin/sh
# Paso 1 de DEPLOYMENT.md: qué software hay y qué falta. Sólo lee; no instala ni cambia nada. Como root:
#   sh backend/deploy/servidor/comprobar-requisitos.sh
set -u
status=0
ok() { echo "PASS  $1"; }
ko() { echo "FALTA $1"; status=1; }
aviso() { echo "AVISO $1"; }
have() { command -v "$1" >/dev/null 2>&1; }

[ -r /etc/os-release ] && ok "sistema: $(. /etc/os-release && echo "$PRETTY_NAME")"

if have node && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>=26||(a===24&&b>=15)||a===25?0:1)'; then
  ok "Node.js $(node --version) (se necesita 24.15 o mayor)"
else
  ko "Node.js 24.15 o mayor (hay: $(node --version 2>/dev/null || echo ninguno)) → DEPLOYMENT.md paso 2"
fi
have npm && ok "npm $(npm --version)" || ko "npm (viene con Node.js)"
have pm2 && ok "PM2 $(pm2 --version 2>/dev/null | tail -n 1)" || ko "PM2 → npm install -g pm2"
have unzip && ok "unzip" || ko "unzip → dnf install -y unzip"

if have httpd; then
  ok "Apache: $(httpd -v | head -n 1)"
  mods=$(httpd -M 2>/dev/null)
  for m in dir_module headers_module; do
    echo "$mods" | grep -q "$m" && ok "Apache: $m activo" || ko "Apache: $m (necesario para el .htaccess)"
  done
else
  ko "Apache (httpd) → dnf install -y httpd"
fi

if have mariadb; then
  ok "cliente MariaDB: $(mariadb --version)"
else
  aviso "no hay cliente mariadb en esta máquina (basta si MariaDB está en otro servidor; los respaldos lo necesitan)"
fi
if have mariadbd || [ -x /usr/libexec/mariadbd ]; then
  v=$( (mariadbd --version 2>/dev/null || /usr/libexec/mariadbd --version) | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1)
  case "$v" in
    10.[0-5].*) ko "servidor MariaDB $v: se necesita 10.6 o mayor → DEPLOYMENT.md paso 3" ;;
    *) ok "servidor MariaDB $v (se necesita 10.6 o mayor)" ;;
  esac
else
  aviso "no hay servidor MariaDB en esta máquina (si está en otra, anota su host y puerto para el .env)"
fi

if have getenforce; then aviso "SELinux: $(getenforce) (DEPLOYMENT.md paso 9 aplica el contexto a los archivos de Apache)"; fi
if have firewall-cmd && firewall-cmd --state >/dev/null 2>&1; then
  firewall-cmd --list-services | grep -qw http && ok "firewalld: servicio http abierto" || ko "firewalld: http (puerto 80) cerrado → paso 10"
  firewall-cmd --list-ports | grep -qw 3002/tcp && ok "firewalld: 3002/tcp abierto" || ko "firewalld: 3002/tcp cerrado → paso 10"
else
  aviso "firewalld no está activo: comprueba por otro medio que los puertos 80 y 3002 llegan al servidor"
fi
if have ss; then
  ss -ltn | grep -Eq '[:.]3002[[:space:]]' && aviso "el puerto 3002 ya está en uso: $(ss -ltnp | grep -E '[:.]3002[[:space:]]' | head -n 1)"
  ss -ltnp 2>/dev/null | grep -Ei 'mariadb|mysql' | sed 's/^/INFO  MariaDB escucha en: /'
fi
id charales >/dev/null 2>&1 && ok "usuario de aplicación charales existe" || aviso "usuario charales aún no existe (el paso 1 lo crea)"

[ "$status" -eq 0 ] && echo "Resultado: PASS" || echo "Resultado: faltan requisitos (líneas FALTA)"
exit "$status"

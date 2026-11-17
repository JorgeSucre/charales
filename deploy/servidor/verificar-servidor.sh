#!/bin/sh
# Comprueba la API (PM2, puerto, /health, CORS) y Apache (index, ruta interna, .htaccess). Sólo lee; nada cambia.
#   sh deploy/servidor/verificar-servidor.sh [API] [APP]
#   por defecto API=http://45.80.152.66:3002  APP=http://45.80.152.66
set -u
API=${1:-http://45.80.152.66:3002}
APP=${2:-http://45.80.152.66}
status=0
ok() { echo "PASS  $1"; }
ko() { echo "FAIL  $1"; status=1; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

if command -v pm2 >/dev/null; then
  pm2 jlist 2>/dev/null | grep -q '"name":"charales-api".*"status":"online"' &&
    ok "PM2: charales-api online" || ko "PM2: charales-api no está online (pm2 logs charales-api)"
else
  echo "SKIP  PM2 no instalado en esta máquina"
fi

health=$(curl -s "$API/health")
[ "$health" = '{"status":"ok","database":"ok"}' ] && ok "API /health: $health" || ko "API /health: ${health:-sin respuesta}"

cors=$(curl -s -o /dev/null -D - -X OPTIONS "$API/auth/login" -H "Origin: $APP" \
  -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type')
echo "$cors" | grep -qi "^access-control-allow-origin: $APP" && echo "$cors" | grep -qi '^access-control-allow-credentials: true' &&
  ok "CORS: preflight desde $APP aceptado" || ko "CORS: preflight desde $APP rechazado (¿APP_URL igual a $APP?)"

[ "$(code -X POST "$API/auth/login" -H "Origin: $APP" -H 'Content-Type: application/json' -d '{}')" = 400 ] &&
  ok "API: POST /auth/login sin datos → 400 (la validación responde)" || ko "API: POST /auth/login no respondió 400"

[ "$(code -X POST "$API/auth/logout" -H 'Origin: http://otro-sitio.example')" = 403 ] &&
  ok "CSRF: POST de otro origen → 403" || ko "CSRF: un POST de otro origen no recibió 403"

[ "$(code "$APP/")" = 200 ] && ok "Apache: / → 200" || ko "Apache: / no responde 200"
[ "$(code "$APP/login")" = 200 ] && ok "Apache: /login (ruta interna) → 200" ||
  ko "Apache: /login no responde 200 (¿AllowOverride para .htaccess?)"
[ "$(code "$APP/admin/jugadores")" = 200 ] && ok "Apache: /admin/jugadores (recarga) → 200" || ko "Apache: /admin/jugadores no responde 200"
curl -s -D - -o /dev/null "$APP/" | grep -qi '^content-security-policy:.*3002' &&
  ok "Apache: CSP del .htaccess presente" || ko "Apache: falta la CSP del .htaccess (¿mod_headers / AllowOverride?)"
curl -s "$APP/" | grep -q '<app-root>' && ok "Apache: index.html es la app" || ko "Apache: / no sirve index.html de la app"

[ "$status" -eq 0 ] && echo "Resultado: PASS" || echo "Resultado: FAIL"
exit "$status"

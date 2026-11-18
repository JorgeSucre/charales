#!/bin/sh
# Paso 7 de DEPLOYMENT.md: dependencias, comprobación del .env y de la base, y arranque de la API con PM2. Como el
# usuario de aplicación (charales), NUNCA como root:
#   sh ~/charales/backend/deploy/servidor/instalar.sh
# No crea ni migra la base (eso es `npm run db:setup`, paso 6); si la base no está al día, se detiene antes de PM2.
set -eu
cd "$(dirname "$0")/../.."

[ "$(id -u)" != 0 ] || { echo "Ejecútalo como el usuario de aplicación (su - charales), no como root." >&2; exit 1; }
[ -f .env ] || { echo "Falta $(pwd)/.env: cp -n .env.example .env y complétalo (paso 6)." >&2; exit 1; }
chmod 600 .env
command -v pm2 >/dev/null || { echo "Falta PM2: como root, npm install -g pm2 (paso 2)." >&2; exit 1; }

npm install --legacy-peer-deps --no-audit --no-fund
npm run api:build
node --env-file=.env deploy/servidor/verificar-env.ts

pm2 delete charales-api >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs
pm2 save
echo "API iniciada con PM2. Siguiente: arranque automático con systemd (DEPLOYMENT.md paso 7.3)."

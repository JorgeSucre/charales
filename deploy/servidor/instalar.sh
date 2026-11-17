#!/bin/sh
# En el servidor, dentro de backend/: dependencias, dominio empaquetado, verificación del .env y arranque con PM2.
# No toca la base de datos: `npm run db:setup` y `npm run db:admin` se ejecutan aparte (DEPLOYMENT.md § 5).
#   sh deploy/servidor/instalar.sh
set -eu
cd "$(dirname "$0")/../.."

[ -f .env ] || { echo "Falta backend/.env (copia .env.example y complétalo)."; exit 1; }
chmod 600 .env
command -v pm2 >/dev/null || { echo "Falta PM2: sudo npm install -g pm2"; exit 1; }

npm install --legacy-peer-deps --no-audit --no-fund
npm run api:build
node --env-file=.env deploy/servidor/verificar-env.ts

pm2 delete charales-api >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs
pm2 save
echo "Listo. Arranque automático tras reiniciar: ejecuta UNA vez lo que imprime «pm2 startup systemd» y luego «pm2 save» (DEPLOYMENT.md § 6)."

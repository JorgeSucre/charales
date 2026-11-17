#!/bin/sh
# En la máquina de desarrollo: compila el frontend y arma entrega/charales/ (dist/ + backend/ + DEPLOYMENT.md) y
# entrega/charales.tar.gz SIN .env. No copia node_modules, .env, respaldos ni cachés. Incluye MANIFEST.txt (commit y
# cambios sin commit) y MANIFEST.sha256 (en el servidor: cd charales && sha256sum -c MANIFEST.sha256).
#   sh deploy/servidor/empaquetar.sh
set -eu
cd "$(dirname "$0")/../.."
OUT=entrega/charales
PATHS="api src db deploy docs package.json package-lock.json tsconfig.json ecosystem.config.cjs LICENSE README.md"

npm run build:servidor
npm run api:build

# El .env real (si ya lo creaste en la entrega) se conserva entre empaquetados; nunca entra al .tar.gz ni al manifiesto.
KEEP=entrega/.env.conservado
[ -f "$OUT/backend/.env" ] && mv "$OUT/backend/.env" "$KEEP"
rm -rf "$OUT" entrega/charales.tar.gz entrega/charales.tar.gz.sha256
mkdir -p "$OUT/backend"
cp -R dist/servidor "$OUT/dist"
# Archivos del repositorio (también los nuevos sin commit), respetando .gitignore; sin los borrados.
git ls-files --cached --others --exclude-standard -z -- $PATHS |
  xargs -0 sh -c 'for f; do [ -f "$f" ] && echo "$f"; done' _ |
  COPYFILE_DISABLE=1 tar -cf - --no-xattrs --no-mac-metadata -T - | tar -xf - -C "$OUT/backend"
mkdir -p "$OUT/backend/api/.build" && cp api/.build/domain.mjs "$OUT/backend/api/.build/"
cp deploy/servidor/env.servidor.example "$OUT/backend/.env.example"
cp DEPLOYMENT.md "$OUT/"
find "$OUT" -name .DS_Store -delete

{
  echo "Charales · paquete para Apache + PM2 (DEPLOYMENT.md)"
  echo "Generado: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo "Rama: $(git rev-parse --abbrev-ref HEAD)"
  echo "Commit base: $(git rev-parse HEAD)"
  changes=$(git status --porcelain -- $PATHS DEPLOYMENT.md angular.json)
  if [ -n "$changes" ]; then
    echo "Cambios sin commit incluidos (el paquete es el árbol de trabajo, no sólo el commit):"
    echo "$changes" | sed 's/^/  /'
  else
    echo "Sin cambios sin commit: el paquete corresponde exactamente al commit."
  fi
} > "$OUT/MANIFEST.txt"
(cd "$OUT" && find . -type f ! -name MANIFEST.sha256 | LC_ALL=C sort | xargs shasum -a 256 > MANIFEST.sha256)

COPYFILE_DISABLE=1 tar -czf entrega/charales.tar.gz --no-xattrs --no-mac-metadata --exclude='.env' -C entrega charales
(cd entrega && shasum -a 256 charales.tar.gz > charales.tar.gz.sha256)
if [ -f "$KEEP" ]; then mv "$KEEP" "$OUT/backend/.env" && chmod 600 "$OUT/backend/.env"; fi
echo "Entrega: $OUT  ·  $(du -sh entrega/charales.tar.gz | cut -f1) en entrega/charales.tar.gz (sin .env)"

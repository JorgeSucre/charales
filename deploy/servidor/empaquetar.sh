#!/bin/sh
# En la máquina de desarrollo: compila desde cero y arma la entrega para el profesor:
#   entrega/CHARALES-ENTREGA-FINAL/      (LEEME.md, DEPLOYMENT.md, INVENTARIO.txt, MANIFEST.sha256, dist/, backend/)
#   entrega/CHARALES-ENTREGA-FINAL.zip  y  entrega/CHARALES-ENTREGA-FINAL.zip.sha256
# Sólo lo necesario para instalar y operar: sin node_modules, .env, pruebas, evidencias, el esquema PostgreSQL histórico
# ni la variante nginx/HTTPS.
#   sh deploy/servidor/empaquetar.sh
set -eu
cd "$(dirname "$0")/../.."
NAME=CHARALES-ENTREGA-FINAL
OUT=entrega/$NAME
# Archivos del repositorio que usa el servidor (api:build, db:setup, db:admin, scripts de deploy/servidor y respaldos).
PATHS="api src db/mariadb/010_permisos_app.sql db/mariadb/migrations db/mariadb/scripts/backup.sh
  db/mariadb/scripts/restore.sh db/mariadb/scripts/verify-backup.sh deploy/servidor docs/escuela_futbol_mariadb.sql
  docs/API.md package.json package-lock.json tsconfig.json ecosystem.config.cjs LICENSE"
# Dentro de esas rutas, lo que es sólo de desarrollo.
SKIP='^api/.*\.test\.ts$|^api/test-db\.ts$|^api/perf-data\.sql$|^deploy/servidor/(empaquetar\.sh|LEEME\.md)$'

# Nunca borra un .env real que alguien haya puesto en la carpeta de entrega.
if [ -n "$(find "$OUT" -name '.env' 2>/dev/null)" ]; then
  echo "Hay un .env dentro de $OUT: muévelo fuera antes de empaquetar." >&2
  exit 1
fi

rm -rf dist api/.build
npm run build:servidor
npm run api:build
grep -rq "http://45.80.152.66:3002" dist/servidor/*.js || { echo "dist no apunta a http://45.80.152.66:3002" >&2; exit 1; }

rm -rf "$OUT" "$OUT.zip" "$OUT.zip.sha256"
mkdir -p "$OUT/backend"
cp -R dist/servidor "$OUT/dist"
# Archivos versionados (y nuevos sin commit), respetando .gitignore; sin los borrados.
git ls-files --cached --others --exclude-standard -- $PATHS | grep -Ev "$SKIP" |
  while IFS= read -r f; do [ -f "$f" ] && echo "$f"; done |
  COPYFILE_DISABLE=1 tar -cf - --no-xattrs --no-mac-metadata -T - | tar -xf - -C "$OUT/backend"
mkdir -p "$OUT/backend/api/.build" && cp api/.build/domain.mjs "$OUT/backend/api/.build/"
cp deploy/servidor/env.servidor.example "$OUT/backend/.env.example"
cp deploy/servidor/LEEME.md DEPLOYMENT.md "$OUT/"
find "$OUT" -name .DS_Store -delete

{
  echo "Charales · entrega para el servidor del curso (Apache + PM2, HTTP). Guía: DEPLOYMENT.md"
  echo "Generado: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo "Commit: $(git rev-parse HEAD)"
  changes=$(git status --porcelain -- $PATHS DEPLOYMENT.md angular.json)
  if [ -n "$changes" ]; then
    echo "AVISO: incluye cambios sin commit:"
    echo "$changes" | sed 's/^/  /'
  else
    echo "Sin cambios sin commit: el contenido corresponde exactamente al commit."
  fi
  echo
  echo "Resumen:"
  for d in dist backend/api backend/src backend/db backend/deploy backend/docs; do
    printf '  %-16s %4s archivos\n' "$d/" "$(find "$OUT/$d" -type f | wc -l | tr -d ' ')"
  done
  echo
  echo "Archivos (bytes  ruta):"
  (cd "$OUT" && find . -type f ! -name INVENTARIO.txt ! -name MANIFEST.sha256 | LC_ALL=C sort |
    while IFS= read -r f; do printf '%10s  %s\n' "$(wc -c < "$f" | tr -d ' ')" "${f#./}"; done)
} > "$OUT/INVENTARIO.txt"
(cd "$OUT" && find . -type f ! -name MANIFEST.sha256 | LC_ALL=C sort | xargs shasum -a 256 > MANIFEST.sha256)

(cd entrega && rm -f "$NAME.zip" && zip -qrX "$NAME.zip" "$NAME" -x '*/.env' '*.DS_Store' && shasum -a 256 "$NAME.zip" > "$NAME.zip.sha256")
echo "Entrega: $OUT.zip ($(du -h "$OUT.zip" | cut -f1)) · $(cut -d' ' -f1 "$OUT.zip.sha256")"

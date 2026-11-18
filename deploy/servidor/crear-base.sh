#!/bin/sh
# Paso 5 de DEPLOYMENT.md: crea la base charalesdb y la cuenta charalesdb SÓLO si no existen, con los privilegios que
# necesita `npm run db:setup`. Nunca borra, vacía ni cambia la contraseña de una cuenta existente. Como root, en el
# servidor de MariaDB (root entra por el socket sin contraseña; si no, MARIADB="mariadb -u root -p"):
#   sh crear-base.sh                 cuenta para conexiones desde esta misma máquina (localhost y 127.0.0.1)
#   sh crear-base.sh 10.0.0.5        cuenta para conexiones desde el host 10.0.0.5 (la API en otra máquina)
# Pide la contraseña sin mostrarla; no queda en el historial ni en la lista de procesos.
set -eu
DB=${CHARALES_DB:-charalesdb}
USR=${CHARALES_DB_USER:-charalesdb}
MARIADB=${MARIADB:-mariadb}
HOSTS=${1:-localhost 127.0.0.1}

$MARIADB -N -e 'SELECT 1' >/dev/null || { echo "No se pudo entrar a MariaDB como administrador ($MARIADB)." >&2; exit 1; }

printf 'Contraseña para la cuenta %s (la que irá en DB_PASSWORD): ' "$USR"
stty -echo 2>/dev/null || true
IFS= read -r PW
stty echo 2>/dev/null || true
echo
[ -n "$PW" ] || { echo "La contraseña no puede estar vacía." >&2; exit 1; }
# Literal SQL: se escapan la barra invertida y la comilla simple.
PW_SQL=$(printf '%s' "$PW" | sed "s/[\\\\']/\\\\&/g")

for H in $HOSTS; do
  n=$($MARIADB -N -e "SELECT COUNT(*) FROM mysql.user WHERE User='$USR' AND Host='$H'")
  if [ "$n" != 0 ]; then
    echo "La cuenta '$USR'@'$H' ya existía: NO se cambió su contraseña (DB_PASSWORD debe ser la que ya tiene)."
  fi
done

# printf y no echo: el echo de algunos sh (dash) interpreta las barras invertidas de la contraseña.
{
  printf '%s\n' "CREATE DATABASE IF NOT EXISTS \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  for H in $HOSTS; do
    printf '%s\n' "CREATE USER IF NOT EXISTS '$USR'@'$H' IDENTIFIED BY '$PW_SQL';"
    printf '%s\n' "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES, CREATE ROUTINE, ALTER ROUTINE,"
    printf '%s\n' "  EXECUTE, EVENT, TRIGGER, LOCK TABLES, SHOW VIEW ON \`$DB\`.* TO '$USR'@'$H';"
  done
} | $MARIADB

echo "Listo: base $DB y cuenta(s) $(for H in $HOSTS; do printf "'%s'@'%s' " "$USR" "$H"; done)con privilegios sólo sobre $DB."
$MARIADB -N -e "SELECT VERSION()" | sed 's/^/Versión del servidor: /'

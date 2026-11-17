# Instalación de Charales en AlmaLinux 9 desde cero

Manual para quien tenga acceso SSH al servidor y **no** conozca la arquitectura interna del proyecto. Se sigue en
orden, de arriba abajo. Cada comando lleva una explicación.

> **Estado de este manual (17-nov-2026).** Ensayado de principio a fin sobre AlmaLinux 9.9 limpio (contenedor con
> systemd, datos ficticios) con los paquetes generados desde esta rama (`MANIFIESTO.txt`). **Sin probar:** SELinux en
> modo `Enforcing` (§ G.4), certificado TLS real (§ G.3), acceso SSH real y envío de correo real (§ E.5). Detalle en
> [`audits/RECONCILIACION_ARTEFACTOS_2026-11-17.md`](audits/RECONCILIACION_ARTEFACTOS_2026-11-17.md).

## Cómo leer este manual

- Sustituye **siempre** estos marcadores por tus datos. Ninguno es un valor institucional real:

  | Marcador              | Qué es                                                                          |
  | --------------------- | ------------------------------------------------------------------------------- |
  | `TU_DOMINIO`          | Dominio de la aplicación, por ejemplo el que dé la escuela                      |
  | `IP_DEL_SERVIDOR`     | Dirección IP pública del VPS                                                    |
  | `USUARIO_SSH`         | Tu usuario para entrar por SSH                                                  |
  | `TU_CORREO_RESPALDOS` | Identificador de la clave GPG pública de respaldos (un correo)                  |
  | `TU_CORREO_ADMIN`     | Correo de la primera cuenta administradora de la aplicación                     |
  | `VERSION`             | Nombre de la versión que instalas, fecha + commit, p. ej. `2026-11-17-a5ed0e60` |

- Los comandos con `#` delante del prompt se ejecutan como **root**. Después de entrar por SSH, haz `sudo -i`.
- **Contraseñas:** nunca las escribas en un comando ni en un documento. Este manual las genera en archivos de
  `/root/charales-secretos/` (sólo root puede leerlos) y los comandos las leen de ahí con `$(cat …)`.

## Arquitectura en una imagen

```text
Internet ──443/80──► nginx ──► archivos de Angular   (/srv/charales/current/dist/project/browser)
                       └─────► /auth, /api  ──► API Node.js (127.0.0.1:3000, usuario charales)
                                                   └──► MariaDB (127.0.0.1:3306, base charalesdb)
```

- El navegador sólo habla con nginx, en el **mismo dominio**: no hay CORS ni URL de API que configurar en el frontend.
- La API y MariaDB escuchan sólo en `127.0.0.1`: desde Internet no se llega a ellas.
- Cada versión vive en `/srv/charales/releases/VERSION/`. El enlace `/srv/charales/current` apunta a la activa:
  volver atrás es cambiar el enlace.

---

## A. Requisitos previos

| Recurso      | Mínimo                                                              | Recomendado                   | Medido en el ensayo                                       |
| ------------ | ------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------- |
| Sistema      | AlmaLinux 9 (probado 9.9), 64 bits                                  | Igual                         | —                                                         |
| CPU          | 1 vCPU                                                              | 2 vCPU                        | —                                                         |
| RAM          | 2 GB                                                                | 4 GB                          | API 91 MiB, MariaDB 129 MiB, nginx 5 MiB (sin carga real) |
| Disco        | 20 GB                                                               | 40 GB                         | 73 MB por versión, 169 MB MariaDB vacía                   |
| Dominio      | Un nombre (`TU_DOMINIO`) apuntando a `IP_DEL_SERVIDOR` (registro A) | —                             | —                                                         |
| Acceso       | SSH con un usuario con `sudo`                                       | Con clave SSH, sin contraseña | —                                                         |
| Red saliente | Repositorios de AlmaLinux y `registry.npmjs.org` (para `npm ci`)    | —                             | —                                                         |

Cada verificación de contraseña usa unos 32 MiB (scrypt `N=32768, r=8, p=1`); la API admite 2 a la vez por proceso
(`SCRYPT_MAX_CONCURRENT`, por defecto 2): ~64 MiB más en picos. **No se ha medido bajo carga real.**

Archivos que debes tener en tu equipo antes de empezar (se entregan juntos):

| Archivo                 | Qué contiene                                                        |
| ----------------------- | ------------------------------------------------------------------- |
| `backend-charales.zip`  | API, código compartido, migraciones, plantillas y documentación     |
| `frontend-charales.zip` | Angular compilado para producción (`index.html`, JS, CSS, recursos) |
| `MANIFIESTO.txt`        | Rama, commit, fecha, versiones y SHA-256 de los dos ZIP             |
| `SHA256SUMS`            | Los SHA-256 en formato `sha256sum -c`                               |

Los dos ZIP salen del **mismo commit** (está en `MANIFIESTO.txt`). No mezcles ZIP de entregas distintas.

---

## B. Preparación del servidor

**B.1. Entra y hazte root.**

```sh
ssh USUARIO_SSH@IP_DEL_SERVIDOR      # desde tu equipo
sudo -i                              # ya en el servidor: shell de root
```

**B.2. Actualiza el sistema operativo.** Instala parches de seguridad y la herramienta que dice si hace falta
reiniciar (`dnf-plugins-core`; la imagen mínima no la trae).

```sh
# dnf -y update
# dnf -y install dnf-plugins-core
# dnf needs-restarting -r          # «Reboot should not be necessary» → sigue; si pide reinicio:
# systemctl reboot                 # sólo si lo pidió la línea anterior; vuelve a entrar y haz sudo -i
```

**B.3. Instala herramientas básicas.** `unzip` y `tar` para los paquetes, `firewalld` para el cortafuegos, `gnupg2`
para cifrar respaldos y `policycoreutils-python-utils` para `semanage` (SELinux). **No pidas `curl`:** el sistema ya
trae `curl-minimal` y los dos chocan.

```sh
# dnf -y install tar unzip firewalld gnupg2 policycoreutils-python-utils
```

**B.4. Zona horaria de la escuela** (afecta a los registros y a la hora de los respaldos programados).

```sh
# timedatectl set-timezone America/Mexico_City
# timedatectl
```

**B.5. Cortafuegos: sólo SSH, HTTP y HTTPS.** AlmaLinux abre también `cockpit` y `dhcpv6-client` por defecto: se
cierran.

```sh
# systemctl enable --now firewalld
# firewall-cmd --permanent --add-service=ssh --add-service=http --add-service=https
# firewall-cmd --permanent --remove-service=cockpit --remove-service=dhcpv6-client
# firewall-cmd --reload
# firewall-cmd --list-services          # debe mostrar exactamente: http https ssh
```

> Si entras por SSH en un puerto distinto del 22, ábrelo **antes** del `--reload`
> (`firewall-cmd --permanent --add-port=PUERTO/tcp`) o perderás el acceso.

**B.6. Usuario de servicio y directorios.** La API corre como `charales`, un usuario sin contraseña ni shell.

```sh
# useradd --system --home-dir /srv/charales --shell /sbin/nologin charales
# install -d -o root -g root     -m 755 /srv/charales /srv/charales/releases
# install -d -o root -g charales -m 750 /etc/charales
# install -d -o root -g root     -m 700 /root/charales-secretos /var/backups/charales
```

| Ruta                       | Para qué                          | Dueño / modo       |
| -------------------------- | --------------------------------- | ------------------ |
| `/srv/charales/releases/`  | Una carpeta por versión instalada | root, 755          |
| `/srv/charales/current`    | Enlace a la versión activa        | root               |
| `/etc/charales/api.env`    | Variables y contraseña de la API  | root:charales, 640 |
| `/root/charales-secretos/` | Contraseñas generadas (sólo root) | root, 700          |
| `/var/backups/charales/`   | Respaldos cifrados                | root, 700          |

---

## C. Instalación de MariaDB

**C.1. Elige la versión.** El MariaDB por defecto de AlmaLinux 9 es la 10.5, y **Charales necesita 10.6 o
superior**. Activa el módulo 11.8 (versión de soporte largo) **antes** de instalar.

```sh
# dnf -y module enable mariadb:11.8
# dnf -y install mariadb-server
# mariadb --version          # debe decir 11.8.x-MariaDB
```

**C.2. Configuración.** Sólo escucha en la propia máquina, activa el planificador de eventos (marca cada día los cargos
vencidos) y usa la hora del centro de México (sin horario de verano desde 2022).

```sh
# cat > /etc/my.cnf.d/charales.cnf <<'EOF'
[mysqld]
bind-address=127.0.0.1
event_scheduler=ON
default_time_zone=-06:00
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
EOF
# systemctl enable --now mariadb
```

> **No añadas `skip-name-resolve`.** Las cuentas se crean como `@'localhost'` y la API conecta a `127.0.0.1`: con esa
> opción MariaDB las rechaza (`Host '127.0.0.1' is not allowed to connect`).

**C.3. Seguridad inicial.** En MariaDB 11.8 `root` sólo entra desde la consola del servidor como root del sistema
(socket Unix), sin contraseña de red. Se borran el usuario anónimo y la base `test`.

```sh
# mariadb -e "DELETE FROM mysql.global_priv WHERE User=''; DROP DATABASE IF EXISTS test; DELETE FROM mysql.db WHERE Db LIKE 'test%'; FLUSH PRIVILEGES;"
# mariadb -N -e "SELECT VERSION(), @@bind_address, @@event_scheduler, @@time_zone"
```

Resultado esperado: `11.8.x-MariaDB  127.0.0.1  ON  -06:00`.

**C.4. Genera las contraseñas de las tres cuentas.** Se guardan en archivos; nunca aparecen en pantalla ni en el
historial.

```sh
# umask 077
# for u in admin app backup; do head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 28 > /root/charales-secretos/$u.pw; done
# ls -l /root/charales-secretos        # tres archivos, -rw------- root
```

**C.5. Crea la base y las cuentas.** Hacen falta los archivos del backend: primero transfiere y verifica el ZIP
(**§ E.1 y E.2**) y vuelve aquí. Las cuentas salen de la plantilla del proyecto `deploy/mariadb/cuentas.sql`:

| Cuenta            | Uso                            | Permisos                                              |
| ----------------- | ------------------------------ | ----------------------------------------------------- |
| `charales_admin`  | Una persona: instalar y migrar | Datos y esquema de `charalesdb`                       |
| `charales_app`    | La API, siempre                | Sólo `SELECT, INSERT, UPDATE, DELETE` en `charalesdb` |
| `charales_backup` | Los respaldos                  | Lectura de `charalesdb` y de las rutinas              |

```sh
# mariadb -e "CREATE DATABASE charalesdb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
# unzip -p /root/backend-charales.zip deploy/mariadb/cuentas.sql \
    | sed -e "s/escuela_futbol/charalesdb/g" \
          -e "s/CAMBIAR_ADMIN/$(cat /root/charales-secretos/admin.pw)/" \
          -e "s/CAMBIAR_APP/$(cat /root/charales-secretos/app.pw)/" \
          -e "s/CAMBIAR_BACKUP/$(cat /root/charales-secretos/backup.pw)/" \
    | mariadb
# for u in admin app backup; do mariadb -N -e "SHOW GRANTS FOR charales_$u@localhost" | sed 's/IDENTIFIED BY PASSWORD .*//'; done
```

---

## D. Instalación de Node.js

Charales necesita Node **24.15 o superior** (ejecuta TypeScript directamente, sin compilar). El Node por
defecto de AlmaLinux 9 es el 16: activa el módulo 24.

```sh
# dnf -y module enable nodejs:24
# dnf -y install nodejs
# node --version        # v24.15 o superior (ensayo: v24.22.1)
# npm --version
# which node            # debe ser /usr/bin/node (lo usa el servicio systemd)
```

---

## E. Instalación del backend

**E.1. Transfiere los ZIP** desde tu equipo (no desde el servidor):

```sh
scp backend-charales.zip frontend-charales.zip MANIFIESTO.txt SHA256SUMS USUARIO_SSH@IP_DEL_SERVIDOR:/tmp/
```

En el servidor, como root, muévelos a un sitio sólo de root:

```sh
# mv /tmp/backend-charales.zip /tmp/frontend-charales.zip /tmp/MANIFIESTO.txt /tmp/SHA256SUMS /root/
```

**E.2. Verifica la integridad.** `sha256sum -c` compara los ZIP con `SHA256SUMS`; compara también a ojo esos valores
con los de `MANIFIESTO.txt` y con los que te comunicó quien generó la versión por otro canal. Si algo no coincide, no
sigas: pide el paquete otra vez.

```sh
# cd /root && sha256sum -c SHA256SUMS          # backend-charales.zip: OK · frontend-charales.zip: OK
# grep -E '^(Rama|Commit)' /root/MANIFIESTO.txt
```

**E.3. Extrae la versión.** `VERSION` es un nombre único: fecha y los 8 primeros caracteres del commit
(`MANIFIESTO.txt`).

```sh
# VERSION=AAAA-MM-DD-xxxxxxxx
# R=/srv/charales/releases/$VERSION
# mkdir -p $R && cd $R
# unzip -q /root/backend-charales.zip
# mkdir -p dist/project/browser
# unzip -q /root/frontend-charales.zip -d dist/project/browser
# ls                     # api db deploy dist docs e2e package.json …
```

**E.4. Instala dependencias y compila la parte de dominio.** `npm ci` instala exactamente lo de `package-lock.json`;
`api:build` genera `api/.build/domain.mjs`; `npm prune` retira lo que sólo hace falta para compilar.

```sh
# npm ci --no-audit --no-fund
# npm run api:build
# npm prune --omit=dev --no-audit --no-fund
```

Los avisos `npm warn install-scripts … lmdb / msgpackr-extract` son de herramientas de compilación del frontend que la
API no usa: se pueden ignorar.

> Después de `npm prune`, **`npm run db:setup` y `npm run db:admin` ya no funcionan** (intentan recompilar). Este
> manual llama directamente a `node api/setup.ts` y `node api/create-admin.ts`, que sí funcionan.

**E.5. Variables de entorno.** Parte de la plantilla del proyecto y complétala.

```sh
# install -m 640 -o root -g charales $R/deploy/env.production.example /etc/charales/api.env
# sed -i -e "s/^DB_NAME=.*/DB_NAME=charalesdb/" \
         -e "s/^DB_PASSWORD=.*/DB_PASSWORD=$(cat /root/charales-secretos/app.pw)/" \
         -e "s#^APP_URL=.*#APP_URL=https://TU_DOMINIO#" /etc/charales/api.env
# vi /etc/charales/api.env        # o nano: revisa el resto
```

| Variable          | Valor                                                | Nota                                                                                |
| ----------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `NODE_ENV`        | `production`                                         | Obligatorio. Activa la cookie `Secure` y las validaciones                           |
| `HOST` / `PORT`   | `127.0.0.1` / `3000`                                 | No los cambies: nginx espera ese puerto                                             |
| `DB_*`            | `127.0.0.1`, `3306`, `charalesdb`, `charales_app`, … | La API usa **sólo** `charales_app`                                                  |
| `TRUSTED_PROXIES` | `127.0.0.1`                                          | nginx en la misma máquina. Si hay un balanceador delante, añade su IP real          |
| `APP_URL`         | `https://TU_DOMINIO`                                 | Debe empezar por `https://`                                                         |
| `MAIL_PROVIDER`   | `resend` (o `none`)                                  | Con `none` arranca, pero invitaciones y recuperación de contraseña responden 503    |
| `RESEND_API_KEY`  | La clave de Resend                                   | **Pendiente:** requiere cuenta y dominio verificado                                 |
| `MAIL_FROM`       | `Charales <no-responder@TU_DOMINIO>`                 |                                                                                     |
| `SCRYPT_*`        | Los de la plantilla                                  | Parámetros del hash de contraseñas. **No los cambies** sin medir memoria y latencia |

**No pongas comentarios al final de una línea** (systemd los toma como parte del valor). Si aún no tienes la clave de
Resend, usa `MAIL_PROVIDER=none` y deja vacíos `RESEND_API_KEY` y `MAIL_FROM`.

```sh
# ls -l /etc/charales/api.env      # -rw-r----- root charales
```

**E.6. Crea el esquema y aplica las migraciones.** Con la cuenta `charales_admin`. El comando es idempotente: en una
base vacía crea el esquema, aplica las migraciones `001`–`010` de `db/mariadb/migrations/` y el catálogo de permisos
`db/mariadb/010_permisos_app.sql` (dos archivos distintos que comparten el número); en una base con datos sólo añade lo
que falte. No borra datos: la migración `010_eliminar_turnos_hash_antiguo.sql` sólo retira dos tablas temporales sin
datos personales (`turnos_argon2`, `turnos_argon2_guarda`).

```sh
# cd /srv/charales/releases/$VERSION
# DB_HOST=127.0.0.1 DB_USER=charales_admin DB_PASSWORD="$(cat /root/charales-secretos/admin.pw)" DB_NAME=charalesdb node api/setup.ts
```

Salida esperada (primera vez):

```text
MariaDB 11.8.x-MariaDB · base «charalesdb»
· esquema base aplicado
· migraciones: 001_token_finalidad.sql, … , 010_eliminar_turnos_hash_antiguo.sql
· permisos: matriz inicial de roles aplicada (106 filas)
· usuarios: 0 · jugadores: 0
```

> **Nunca** ejecutes `docs/escuela_futbol_mariadb.sql` a mano ni uses `--demo` o `--dev-seed` en el servidor: el
> primero borra tablas y los otros cargan cuentas de prueba.

Comprobación de la estructura:

```sh
# mariadb -N charalesdb -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='charalesdb' AND TABLE_TYPE='BASE TABLE'"   # 44
# mariadb -N charalesdb -e "SELECT EVENT_NAME, STATUS FROM information_schema.EVENTS WHERE EVENT_SCHEMA='charalesdb'"                    # ev_cargos_vencidos ENABLED
```

**E.7. Crea la primera cuenta administradora.** Te pide correo, nombre y contraseña (8+ caracteres, letras y
números); la contraseña no se ve al escribirla. Si el correo ya existe se niega y no cambia nada.

```sh
# cd /srv/charales/releases/$VERSION
# node --env-file=/etc/charales/api.env api/create-admin.ts
Correo del administrador: TU_CORREO_ADMIN
Nombre: Nombre Apellido
Contraseña (8+ caracteres, letras y números):
Repite la contraseña:
Administrador creado (id 1). Inicia sesión en la app con TU_CORREO_ADMIN.
```

(En el ensayo se usó la variante no interactiva del mismo comando; el modo interactivo no se probó en una terminal.)

**E.8. Activa la versión.**

```sh
# ln -sfn /srv/charales/releases/$VERSION /srv/charales/current
```

---

## F. Instalación del frontend

El frontend ya quedó dentro de la versión en § E.3 (`dist/project/browser`). Esta sección lo verifica.

```sh
# ls /srv/charales/current/dist/project/browser                 # index.html, main-*.js, chunk-*.js, styles-*.css, favicon.ico, brand/
# grep -c '<script>' /srv/charales/current/dist/project/browser/index.html   # debe ser 0
# grep -o '<base href="[^"]*"' /srv/charales/current/dist/project/browser/index.html    # <base href="/"
```

- **Permisos:** los archivos son de root y legibles por todos (644); nginx sólo los lee. No los hagas del usuario
  `nginx` ni de `charales`.
- **Rutas de Angular:** direcciones como `/admin/players` no existen como archivo; nginx devuelve `index.html` y
  Angular las resuelve (`try_files $uri /index.html` en la plantilla).
- **API:** el frontend llama a `/auth/…` y `/api/rpc` en su mismo dominio. No hay nada que configurar.

---

## G. Servicios

### G.1. API con systemd

La plantilla del proyecto corre la API como `charales`, con el sistema de archivos en sólo lectura, reinicio
automático ante fallos y un tope de 1 GB de memoria.

```sh
# cp /srv/charales/current/deploy/systemd/charales-api.service /etc/systemd/system/
# systemctl daemon-reload
# systemctl enable --now charales-api
# systemctl status charales-api --no-pager
# journalctl -u charales-api -n 20 --no-pager      # debe decir «Charales API en http://localhost:3000 (BD charalesdb)»
# curl -s http://127.0.0.1:3000/health             # {"status":"ok","database":"ok"}
```

### G.2. nginx

El nginx por defecto de AlmaLinux 9 es el 1.20; la plantilla necesita **1.25.1 o superior** (`http2 on`).

```sh
# dnf -y module enable nginx:1.26
# dnf -y install nginx
# nginx -v                                          # nginx/1.26.x
# mkdir -p /etc/nginx/snippets
# cp /srv/charales/current/deploy/nginx/security-headers.conf /etc/nginx/snippets/charales-security-headers.conf
# sed "s/escuela\.example/TU_DOMINIO/g" /srv/charales/current/deploy/nginx/charales.conf > /etc/nginx/conf.d/charales.conf
```

La plantilla incluye: redirección de HTTP a HTTPS, cabeceras de seguridad (CSP, HSTS, X-Frame-Options…), límites de
peticiones en el inicio de sesión, `/health` sólo desde la propia máquina, caché larga para archivos con huella y el
reenvío de `/auth` y `/api` a la API.

**No arranques nginx todavía**: necesita el certificado (§ G.3).

### G.3. HTTPS con Let's Encrypt

> **Sin probar en el ensayo** (no había dominio real). Se probó la misma configuración con un certificado autofirmado
> en la misma ruta. Requisitos: el registro DNS de `TU_DOMINIO` ya apunta a `IP_DEL_SERVIDOR` y el puerto 80 está
> abierto.

```sh
# dnf -y install epel-release
# dnf -y install certbot
# certbot certonly --standalone -d TU_DOMINIO --agree-tos -m TU_CORREO_ADMIN --no-eff-email \
    --pre-hook "systemctl stop nginx" --post-hook "systemctl start nginx"
# ls /etc/letsencrypt/live/TU_DOMINIO/              # fullchain.pem privkey.pem
# certbot renew --dry-run                           # comprueba la renovación automática
```

`--standalone` usa el puerto 80 un momento; los _hooks_ paran y arrancan nginx en cada renovación (unos segundos sin
servicio cada ~60 días). El temporizador `certbot-renew.timer` lo hace solo: `systemctl list-timers | grep certbot`.

Ahora sí, arranca nginx:

```sh
# nginx -t                                          # «syntax is ok» y «test is successful»
# systemctl enable --now nginx
```

### G.4. SELinux

AlmaLinux trae SELinux en modo `Enforcing`. Sin estos dos ajustes nginx no puede leer `/srv/charales` (403) ni
conectar con la API (502).

> **Sin probar en el ensayo** (el contenedor no tiene SELinux). Si algo falla, revisa § J.

```sh
# getenforce                                                     # Enforcing
# setsebool -P httpd_can_network_connect 1                       # nginx → 127.0.0.1:3000
# semanage fcontext -a -t httpd_sys_content_t "/srv/charales(/.*)?"
# restorecon -Rv /srv/charales
```

Repite `restorecon -Rv /srv/charales` después de instalar cada versión nueva.

### G.5. Respaldo diario cifrado

Los respaldos contienen datos de menores: se cifran con una clave GPG **pública**. La clave **privada** se queda
fuera del servidor, con quien sea responsable, porque es la única que puede abrirlos.

1. **En tu equipo** (no en el servidor) crea la clave y exporta la parte pública. Guarda la privada en un lugar seguro
   y con copia:

   ```sh
   gpg --quick-gen-key "Respaldos Charales <TU_CORREO_RESPALDOS>" default default never
   gpg --armor --export TU_CORREO_RESPALDOS > respaldos-publica.asc
   scp respaldos-publica.asc USUARIO_SSH@IP_DEL_SERVIDOR:/tmp/
   ```

2. **En el servidor**, prepara el directorio del trabajo de respaldo con la cuenta `charales_backup` y la clave pública:

   ```sh
   # install -d -m 700 /etc/charales/respaldo
   # printf '[client]\nuser=charales_backup\npassword=%s\nhost=localhost\n' "$(cat /root/charales-secretos/backup.pw)" > /etc/charales/respaldo/.my.cnf
   # chmod 600 /etc/charales/respaldo/.my.cnf
   # GNUPGHOME=/etc/charales/respaldo/.gnupg gpg --batch --import /tmp/respaldos-publica.asc
   # rm /tmp/respaldos-publica.asc
   ```

3. Crea el servicio y el temporizador (todos los días a las 02:30):

   ```sh
   # cat > /etc/systemd/system/charales-respaldo.service <<'EOF'
   [Unit]
   Description=Respaldo cifrado de Charales (MariaDB)
   After=mariadb.service
   Requires=mariadb.service

   [Service]
   Type=oneshot
   Environment=HOME=/etc/charales/respaldo
   Environment=BACKUP_GPG_RECIPIENT=TU_CORREO_RESPALDOS
   WorkingDirectory=/srv/charales/current
   ExecStart=/bin/sh deploy/mariadb/respaldo-programado.sh charalesdb /var/backups/charales
   EOF
   # cat > /etc/systemd/system/charales-respaldo.timer <<'EOF'
   [Unit]
   Description=Respaldo diario de Charales

   [Timer]
   OnCalendar=*-*-* 02:30:00
   Persistent=true

   [Install]
   WantedBy=timers.target
   EOF
   # systemctl daemon-reload
   # systemctl enable --now charales-respaldo.timer
   # systemctl start charales-respaldo.service          # primer respaldo, ahora
   # systemctl show -p Result --value charales-respaldo  # success
   # ls -l /var/backups/charales/diario/                 # charalesdb_AAAA-MM-DD_HHMMSS.sql.gz.gpg
   ```

Retención automática: 7 diarios, 4 semanales y 12 mensuales. **Copia `/var/backups/charales` fuera del servidor**
(otro equipo o almacenamiento externo): un respaldo que sólo existe en el servidor se pierde con él.

---

## H. Verificación final

En el servidor:

```sh
# systemctl is-active mariadb charales-api nginx firewalld        # active ×4
# systemctl is-enabled mariadb charales-api nginx firewalld charales-respaldo.timer
# ss -ltnp | grep -E ':(80|443|3000|3306) '    # 3000 y 3306 sólo en 127.0.0.1; 80 y 443 en 0.0.0.0
# curl -s http://127.0.0.1:3000/health          # {"status":"ok","database":"ok"}
# firewall-cmd --list-services                  # http https ssh
```

Desde **tu equipo** (fuera del servidor):

```sh
curl -sI http://TU_DOMINIO/ | head -1                 # 301 (redirige a HTTPS)
curl -sI https://TU_DOMINIO/ | grep -iE '^(HTTP|content-security|strict-transport|x-frame)'
curl -s -o /dev/null -w '%{http_code}\n' https://TU_DOMINIO/admin/players    # 200 (Angular)
curl -s -o /dev/null -w '%{http_code}\n' https://TU_DOMINIO/health           # 403 (sólo local)
curl -s -o /dev/null -w '%{http_code}\n' https://TU_DOMINIO/auth/session     # 401 (sin sesión)
curl -s -o /dev/null -w '%{http_code}\n' https://TU_DOMINIO/api/jugadores    # 404 (desactivado en producción)
nc -zv -w 3 IP_DEL_SERVIDOR 3000 ; nc -zv -w 3 IP_DEL_SERVIDOR 3306          # ambos deben fallar
```

En un navegador, en `https://TU_DOMINIO`:

- [ ] La página de inicio de sesión se ve con estilos (tarjeta centrada, botón azul).
- [ ] Entras con `TU_CORREO_ADMIN` y llegas al panel.
- [ ] Herramientas de desarrollo → Aplicación → Cookies: `charales_sid` con `HttpOnly`, `Secure`, `SameSite=Strict`.
- [ ] La consola no muestra errores «Content Security Policy».
- [ ] Recargar una página interna (F5) mantiene la sesión.
- [ ] «Salir» te devuelve a `/login` y una ruta interna vuelve a pedir sesión.
- [ ] En el servidor, `mariadb -N charalesdb -e "SELECT accion, ip FROM auditoria ORDER BY id DESC LIMIT 3"` muestra
      **tu** IP pública, no `127.0.0.1`.

---

## I. Mantenimiento

### I.1. Antes de cualquier actualización

```sh
# systemctl start charales-respaldo.service && ls -lt /var/backups/charales/diario | head -2   # respaldo recién hecho
# readlink /srv/charales/current                                                              # anota la versión actual (para volver)
```

### I.2. Actualizar backend (y frontend)

Cada versión nueva se instala en su propia carpeta; la anterior queda intacta para volver atrás.

```sh
# sha256sum /root/backend-charales.zip /root/frontend-charales.zip      # compara con lo que te entregaron
# VERSION=AAAA-MM-DD-xxxxxxxx
# R=/srv/charales/releases/$VERSION
# mkdir -p $R && cd $R
# unzip -q /root/backend-charales.zip
# mkdir -p dist/project/browser && unzip -q /root/frontend-charales.zip -d dist/project/browser
# npm ci --no-audit --no-fund && npm run api:build && npm prune --omit=dev --no-audit --no-fund
# DB_HOST=127.0.0.1 DB_USER=charales_admin DB_PASSWORD="$(cat /root/charales-secretos/admin.pw)" DB_NAME=charalesdb node api/setup.ts
# restorecon -Rv /srv/charales
# ln -sfn $R /srv/charales/current
# systemctl restart charales-api && nginx -t && systemctl reload nginx
# curl -s http://127.0.0.1:3000/health
```

`node api/setup.ts` aplica sólo las migraciones nuevas y conserva los datos. Lee antes la cabecera de cada migración
nueva (`db/mariadb/migrations/`).

> **Si la base viene de una versión con Argon2** (anterior a scrypt): esas contraseñas ya no se aceptan. Cada persona
> entra con «¿Olvidaste tu contraseña?» (requiere correo) o con un enlace de `access-link.ts` (§ I.8), tras confirmar
> su identidad. En una instalación nueva no aplica.

### I.3. Actualizar sólo el frontend

Copia la versión activa, cambia sólo `dist/` y activa la copia (probado en el ensayo):

```sh
# NUEVA=/srv/charales/releases/$(basename $(readlink /srv/charales/current))-fe$(date +%Y%m%d%H%M)
# cp -a $(readlink /srv/charales/current) $NUEVA
# rm -rf $NUEVA/dist/project/browser && mkdir -p $NUEVA/dist/project/browser
# unzip -q /root/frontend-charales.zip -d $NUEVA/dist/project/browser
# grep -c '<script>' $NUEVA/dist/project/browser/index.html            # debe ser 0
# restorecon -Rv /srv/charales
# ln -sfn $NUEVA /srv/charales/current
# systemctl restart charales-api && systemctl reload nginx
```

### I.4. Volver a la versión anterior

```sh
# ln -sfn /srv/charales/releases/VERSION_ANTERIOR /srv/charales/current
# systemctl restart charales-api && systemctl reload nginx
```

No hay migraciones de bajada: la versión anterior ignora las tablas nuevas. No borres tablas a mano. **Cuidado al
volver a una versión anterior a scrypt (Argon2):** arranca sobre la base migrada (probado), pero no reconoce las
contraseñas guardadas en scrypt; las cuentas creadas o con contraseña cambiada en la versión nueva no podrán entrar.

### I.5. Reinicios

```sh
# systemctl restart charales-api      # la API (corta las peticiones en curso unos segundos)
# systemctl reload nginx              # nginx sin cortar conexiones (tras cambiar su configuración: nginx -t antes)
# systemctl restart mariadb           # la API responde 503 mientras tanto y se recupera sola
```

Tras un reinicio del servidor todo arranca solo (probado).

### I.6. Logs

```sh
# journalctl -u charales-api -f                 # API en vivo (Ctrl+C para salir)
# journalctl -u charales-api --since today
# tail -f /var/log/nginx/access.log /var/log/nginx/error.log
# journalctl -u mariadb --since today
# journalctl -u charales-respaldo --since "2 days ago"
```

La API no registra contraseñas, tokens ni parámetros SQL (comprobado en el ensayo).

### I.7. Restaurar un respaldo

Siempre en una base **nueva**; `restore.sh` se niega a escribir sobre una existente. Necesitas la clave **privada**,
que está fuera del servidor: descifra en tu equipo y sube el `.sql.gz`, o importa la privada temporalmente.

```sh
# En tu equipo:
scp USUARIO_SSH@IP_DEL_SERVIDOR:/var/backups/charales/diario/charalesdb_FECHA.sql.gz.gpg .
gpg --decrypt charalesdb_FECHA.sql.gz.gpg > respaldo.sql.gz
scp respaldo.sql.gz USUARIO_SSH@IP_DEL_SERVIDOR:/tmp/

# En el servidor:
# cd /srv/charales/current
# sh db/mariadb/scripts/restore.sh /tmp/respaldo.sql.gz charalesdb_restaurada
# sh db/mariadb/scripts/verify-backup.sh charalesdb charalesdb_restaurada     # sólo si charalesdb sigue existiendo
# shred -u /tmp/respaldo.sql.gz
```

Para **usar** la base restaurada: `systemctl stop charales-api`, cambia `DB_NAME=charalesdb_restaurada` en
`/etc/charales/api.env`, da permisos a las cuentas sobre ella (repite § C.5 cambiando `charalesdb` por
`charalesdb_restaurada`, sin el `CREATE DATABASE`) y `systemctl start charales-api`. Lo escrito después del
respaldo se pierde: hazlo sólo con decisión expresa de quien sea responsable.

**Ensaya la restauración al menos cada trimestre** en una base de nombre nuevo y bórrala después
(`mariadb -e "DROP DATABASE charalesdb_ensayo"`).

### I.8. Recuperación ante fallos

| Situación                          | Qué hacer                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| La API se cae                      | systemd la relanza a los 5 s (probado con `kill -9`). Si falla 5 veces en 2 min, para: revisa `journalctl -u charales-api`                         |
| MariaDB cae                        | `/health` → 503; al volver MariaDB la API se recupera sola (probado)                                                                               |
| El servidor reinicia               | Todo arranca solo (probado)                                                                                                                        |
| Una versión nueva falla            | § I.4                                                                                                                                              |
| Datos dañados                      | § I.7, con decisión de quien sea responsable                                                                                                       |
| Nadie puede entrar y no hay correo | `node --env-file=/etc/charales/api.env api/access-link.ts CORREO` genera un enlace de 60 min; entrégalo por otro canal tras confirmar la identidad |

---

## J. Solución de problemas

| Síntoma                                                  | Causa probable                                                                  | Diagnóstico / solución                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `dnf install curl`: «conflicts with curl-minimal»        | El sistema ya trae `curl-minimal`                                               | No instales `curl`; `curl-minimal` basta                                                                                    |
| `mariadb --version` dice 10.5                            | Instalado sin activar el módulo                                                 | `dnf -y module reset mariadb && dnf -y module enable mariadb:11.8 && dnf -y distro-sync`                                    |
| `node --version` < 24.15                                 | Igual con Node                                                                  | `dnf -y module reset nodejs && dnf -y module enable nodejs:24 && dnf -y distro-sync`                                        |
| `setup.ts`: `Host '127.0.0.1' is not allowed to connect` | `skip-name-resolve` en la configuración de MariaDB                              | Quítalo de `/etc/my.cnf.d/` y `systemctl restart mariadb`                                                                   |
| `setup.ts`: `Access denied for user`                     | Contraseña o cuenta equivocada                                                  | Revisa `SHOW GRANTS` (§ C.5) y `/root/charales-secretos/`                                                                   |
| API no arranca: `Error de configuración: …`              | Variable obligatoria incorrecta                                                 | `journalctl -u charales-api -n 30`; corrige `/etc/charales/api.env`; `systemctl restart charales-api`                       |
| API no arranca: `La base no está al día, falta: …`       | Falta una migración                                                             | Respaldo y `node api/setup.ts` (§ E.6)                                                                                      |
| `systemctl status`: `start-limit-hit`                    | 5 fallos seguidos                                                               | Corrige la causa y `systemctl reset-failed charales-api && systemctl start charales-api`                                    |
| Navegador: **502 Bad Gateway**                           | API caída, o SELinux bloquea a nginx                                            | `curl -s http://127.0.0.1:3000/health`; `getsebool httpd_can_network_connect` (debe ser `on`); `ausearch -m avc -ts recent` |
| Navegador: **403** en todas las páginas                  | SELinux: etiquetas de `/srv/charales`                                           | `restorecon -Rv /srv/charales`; `ls -Z /srv/charales/current/dist/project/browser`                                          |
| La página se ve **sin estilos**                          | Frontend con script en línea (bloqueado por la CSP)                             | `grep -c '<script>' …/index.html` debe ser 0; el ZIP debe salir de `npm run build` con el `angular.json` del repositorio    |
| Página de bienvenida de nginx en vez de Charales         | Entras por IP o el `server_name` no coincide                                    | Entra por `https://TU_DOMINIO`; revisa `server_name` en `/etc/nginx/conf.d/charales.conf`                                   |
| `nginx -t`: `cannot load certificate`                    | Aún no hay certificado                                                          | § G.3                                                                                                                       |
| Todos reciben **429** al entrar                          | `TRUSTED_PROXIES` no incluye al proxy                                           | Busca `Llegó X-Forwarded-For` en `journalctl -u charales-api`                                                               |
| Una cuenta recibe 429 desde un navegador nuevo           | Límite por cuenta (muchos fallos). Se guarda en la base y sobrevive a reinicios | Esperar (hasta 30 min por intento), entrar desde un navegador donde ya entró, recuperar contraseña o `access-link.ts`       |
| Invitaciones o «¿Olvidaste tu contraseña?» → 503         | `MAIL_PROVIDER=none`                                                            | Configura Resend (§ E.5)                                                                                                    |
| Respaldo falla: `skipped: No name`                       | La clave pública no está en `/etc/charales/respaldo/.gnupg`                     | § G.5 paso 2                                                                                                                |
| Respaldo falla: `no contiene el procedimiento`           | `charales_backup` sin `SELECT` en `mysql.proc`                                  | Repite § C.5                                                                                                                |
| La etiqueta **DEMO** aparece arriba                      | El frontend es una compilación de desarrollo                                    | Usa el `frontend-charales.zip` oficial (compilación de producción)                                                          |
| Una cuenta antigua no puede entrar con su contraseña     | Hash Argon2 heredado (no se verifica)                                           | Recuperación de contraseña o `access-link.ts` (§ I.2)                                                                       |

Comandos de diagnóstico generales:

```sh
# systemctl --failed
# journalctl -p err -b --no-pager | tail -30
# ss -ltnp
# df -h / /var
# free -m
# mariadb -N -e "SELECT @@event_scheduler, @@time_zone; SELECT LAST_EXECUTED FROM information_schema.EVENTS WHERE EVENT_NAME='ev_cargos_vencidos'"
```

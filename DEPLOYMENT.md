# Charales · Guía de instalación en el servidor (AlmaLinux · Apache + PM2 · HTTP)

Esta guía es para quien recibe `CHARALES-ENTREGA-FINAL.zip` e instala Charales desde cero. No hace falta el
repositorio Git ni conocer el código: todo lo necesario está en el ZIP y cada comando se da completo.

**Resultado final:**

| Parte                 | Dónde                                                             |
| --------------------- | ----------------------------------------------------------------- |
| Aplicación (frontend) | `http://45.80.152.66` → Apache sirve archivos estáticos           |
| API (backend)         | `http://45.80.152.66:3002` → Node.js bajo PM2, usuario `charales` |
| Base de datos         | MariaDB, base `charalesdb`, cuenta `charalesdb`                   |

Sin HTTPS, sin proxy y sin correo saliente (las invitaciones y la recuperación de contraseña por correo quedan
desactivadas).

## Cómo leer esta guía

Cada bloque de comandos indica **quién** lo ejecuta:

- **`root`**: administrador del servidor (`sudo -i` o entrar como root). El indicador es `#`.
- **`charales`**: el usuario de aplicación que se crea en el paso 1. Se entra con `su - charales` desde root. El
  indicador es `$`. La API **nunca** se ejecuta como root.

Los pasos van **en orden**. Ningún comando de esta guía borra datos: lo que podría sobrescribir algo comprueba antes
y se detiene (resumen en el § 15).

## Contenido del ZIP

```text
CHARALES-ENTREGA-FINAL/
├── LEEME.md                 → resumen de una página
├── DEPLOYMENT.md            → esta guía
├── INVENTARIO.txt           → commit de origen y lista de todos los archivos con su tamaño
├── MANIFEST.sha256          → suma SHA-256 de cada archivo (sha256sum -c MANIFEST.sha256)
├── dist/                    → frontend compilado: lo que se copia al DocumentRoot de Apache (incluye .htaccess)
└── backend/                 → la API
    ├── .env.example         → plantilla de configuración (sin contraseñas)
    ├── ecosystem.config.cjs → configuración de PM2 (proceso «charales-api»)
    ├── package.json, package-lock.json
    ├── api/  src/           → código de la API y de los servicios de dominio
    ├── db/mariadb/          → migraciones, permisos y scripts de respaldo/restauración
    ├── docs/                → esquema SQL base y referencia de la API (API.md)
    └── deploy/servidor/     → scripts de instalación y verificación (tabla abajo)
```

| Script (en `backend/deploy/servidor/`) | Quién    | Qué hace                                                                    |
| -------------------------------------- | -------- | --------------------------------------------------------------------------- |
| `comprobar-requisitos.sh`              | root     | Lista qué software hay y qué falta. Sólo lee.                               |
| `crear-base.sh`                        | root     | Crea la base y la cuenta **sólo si no existen**. Pide la contraseña.        |
| `verificar-env.ts`                     | charales | Valida el `.env` y la conexión a MariaDB. Sólo lee.                         |
| `instalar.sh`                          | charales | Dependencias, validación y arranque con PM2. No toca la base.               |
| `instalar-apache.sh`                   | root     | Copia el frontend, habilita el `.htaccess`, aplica SELinux, recarga Apache. |
| `verificar-servidor.sh`                | charales | Prueba PM2, API, CORS, CSRF y Apache. Sólo lee.                             |

## Datos que necesitas tener a mano

| Dato                                     | Valor                                                        | Dónde se usa                  |
| ---------------------------------------- | ------------------------------------------------------------ | ----------------------------- |
| IP pública                               | `45.80.152.66`                                               | ya configurada en el frontend |
| Puerto de la API                         | `3002`                                                       | ya en `.env.example`          |
| Base / cuenta de MariaDB                 | `charalesdb` / `charalesdb`                                  | ya en `.env.example`          |
| **Contraseña de la cuenta `charalesdb`** | **se entrega por separado, no está en el ZIP**               | `.env` → `DB_PASSWORD`        |
| **Host de MariaDB**                      | **lo completas tú** (mismo servidor: `127.0.0.1`)            | `.env` → `DB_HOST`            |
| **Puerto de MariaDB**                    | **lo completas tú** (habitual: `3306`; el paso 4 lo muestra) | `.env` → `DB_PORT`            |
| DocumentRoot de Apache                   | `/var/www/html` salvo que uses otro                          | paso 8                        |

> El frontend está compilado para llamar a `http://45.80.152.66:3002` y Apache debe servirlo en el puerto 80 de esa
> misma IP. Si la IP o los puertos fueran otros, el frontend tiene que recompilarse: avísanos.

---

## 1. Requisitos de software

| Software  | Versión                                  | Notas                                                                  |
| --------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| AlmaLinux | 9 o 10 (x86_64)                          | Cualquier RHEL 9/10 compatible sirve igual.                            |
| Node.js   | **24.15 o mayor** (24 LTS)               | Node 22 o anterior **no sirve**: la API usa TypeScript nativo de Node. |
| npm       | el que trae Node (11)                    |                                                                        |
| PM2       | 5 o mayor (probado con 7.1)              | Se instala con npm.                                                    |
| Apache    | 2.4 (`httpd`)                            | Con `mod_dir` y `mod_headers` (vienen activos en AlmaLinux).           |
| MariaDB   | **10.6 o mayor** (10.11 LTS recomendado) | Puede estar en este servidor o en otro.                                |
| unzip     | cualquiera                               |                                                                        |

**root** — instala `unzip`, crea el usuario de aplicación y coloca el ZIP (cópialo antes al servidor, p. ej. con
`scp CHARALES-ENTREGA-FINAL.zip root@45.80.152.66:/root/`):

```sh
dnf install -y unzip
id charales || useradd --create-home --shell /bin/bash charales
sha256sum /root/CHARALES-ENTREGA-FINAL.zip       # compáralo con el SHA-256 que acompaña al ZIP
install -o charales -g charales -m 600 /root/CHARALES-ENTREGA-FINAL.zip /home/charales/
```

**charales** — descomprime en `~/charales` (si ya existe, es una actualización: § 13):

```sh
su - charales
[ ! -e ~/charales ] && unzip -q ~/CHARALES-ENTREGA-FINAL.zip -d ~ && mv ~/CHARALES-ENTREGA-FINAL ~/charales || echo "~/charales ya existe: usa el § 13"
cd ~/charales && sha256sum -c --quiet MANIFEST.sha256 && echo "archivos íntegros"
exit
```

A partir de aquí la aplicación está en `/home/charales/charales` (backend en `/home/charales/charales/backend`).

**root** — comprueba qué falta (sólo lee):

```sh
sh /home/charales/charales/backend/deploy/servidor/comprobar-requisitos.sh
```

Instala sólo lo que aparezca como `FALTA` en los pasos 2 a 4.

## 2. Instalación de Node.js, PM2 y Apache

**root** — Node.js 24 desde el repositorio de NodeSource (si `dnf list --available 'nodejs*'` ya ofrece 24.15 o
mayor, puedes usar ese en su lugar):

```sh
curl -fsSL https://rpm.nodesource.com/setup_24.x -o /root/nodesource_setup.sh
less /root/nodesource_setup.sh                 # revisa lo que hace antes de ejecutarlo
bash /root/nodesource_setup.sh
dnf install -y nodejs
node --version                                 # v24.15.0 o mayor
```

**root** — PM2 (global, para que el usuario `charales` y systemd lo encuentren en `/usr/bin/pm2`) y Apache:

```sh
npm install -g pm2
pm2 --version
dnf install -y httpd
systemctl enable --now httpd
httpd -M | grep -E 'dir_module|headers_module'   # deben aparecer los dos
```

## 3. Preparación de MariaDB

**Si MariaDB ya está instalado** (en este servidor o en otro), comprueba la versión y pasa al paso 4:

```sh
mariadb -N -e 'SELECT VERSION()'               # root; debe ser 10.6 o mayor
```

**Si hay que instalarlo en este servidor** — **root**:

```sh
dnf info mariadb-server | grep -E '^(Version|Versión)'   # ¿10.6 o mayor?
```

- AlmaLinux 10 trae MariaDB 10.11: `dnf install -y mariadb-server`.
- AlmaLinux 9 trae 10.5 en el repositorio principal, que **no sirve**. Usa el repositorio oficial de MariaDB
  (mariadb.org/download → «MariaDB Repositories», AlmaLinux, versión 10.11 o 11.4 LTS) y después
  `dnf install -y MariaDB-server MariaDB-client`.

```sh
systemctl enable --now mariadb
mariadb -N -e 'SELECT VERSION()'
```

**Recomendado — planificador de eventos** (calcula cada noche los cargos vencidos; sin él la aplicación los recalcula
igual en cada operación de cobranza). **root**, en el servidor de MariaDB; el archivo sólo se crea si no existe:

```sh
mariadb -e 'SET GLOBAL event_scheduler = ON'
test -e /etc/my.cnf.d/charales.cnf || printf '[mariadb]\nevent_scheduler=ON\n' > /etc/my.cnf.d/charales.cnf
```

MariaDB **no** debe abrirse al exterior (§ 10): la API se conecta a ella desde el propio servidor.

## 4. Datos de conexión de MariaDB

**root** — anota host y puerto (los pondrás en `DB_HOST` y `DB_PORT`):

```sh
ss -ltnp | grep -Ei 'mariadb|mysql'            # p. ej. «0.0.0.0:3306 … mariadbd» → DB_HOST=127.0.0.1, DB_PORT=3306
```

Si MariaDB está en otra máquina, `DB_HOST` es su IP y `DB_PORT` su puerto, y la cuenta debe permitir conexiones
desde la IP de este servidor (paso 5).

## 5. Creación de la base y del usuario

**Si la base `charalesdb` y la cuenta `charalesdb` ya existen**, salta este paso (la contraseña de `DB_PASSWORD` es la
que ya tiene la cuenta). Para saberlo, **root**:

```sh
mariadb -e "SHOW DATABASES LIKE 'charalesdb'; SELECT User, Host FROM mysql.user WHERE User = 'charalesdb'"
```

**Si no existen** — **root**, en el servidor de MariaDB. El script pide la contraseña (escribe la que se entregó con el
ZIP), crea la base y la cuenta **sólo si no existen** y concede privilegios **sólo sobre `charalesdb`**:

```sh
sh /home/charales/charales/backend/deploy/servidor/crear-base.sh              # API en este mismo servidor
# sh …/crear-base.sh IP_DEL_SERVIDOR_DE_LA_API                                # si MariaDB está en otra máquina
```

Privilegios que concede (los que necesita `npm run db:setup` para crear tablas, procedimientos, eventos y triggers):
`SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES, CREATE ROUTINE, ALTER ROUTINE, EXECUTE,
EVENT, TRIGGER, LOCK TABLES, SHOW VIEW` sobre `charalesdb.*`. Si root no entra a MariaDB sin contraseña:
`MARIADB="mariadb -u root -p" sh …/crear-base.sh`.

<details>
<summary>Equivalente en SQL, si prefieres hacerlo a mano</summary>

```sql
CREATE DATABASE IF NOT EXISTS charalesdb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'charalesdb'@'localhost' IDENTIFIED BY 'CONTRASEÑA';
CREATE USER IF NOT EXISTS 'charalesdb'@'127.0.0.1' IDENTIFIED BY 'CONTRASEÑA';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES, CREATE ROUTINE, ALTER ROUTINE,
      EXECUTE, EVENT, TRIGGER, LOCK TABLES, SHOW VIEW ON charalesdb.* TO 'charalesdb'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES, CREATE ROUTINE, ALTER ROUTINE,
      EXECUTE, EVENT, TRIGGER, LOCK TABLES, SHOW VIEW ON charalesdb.* TO 'charalesdb'@'127.0.0.1';
```

</details>

## 6. Configuración, dependencias y migraciones

### 6.1 Archivo `.env`

**charales**:

```sh
su - charales
cd ~/charales/backend
cp -n .env.example .env                        # -n: nunca sobrescribe un .env existente
chmod 600 .env                                 # sólo charales puede leerlo (contiene la contraseña)
vi .env                                        # o nano .env
```

Completa **sólo** estas tres líneas; el resto ya viene configurado y no debe cambiarse:

```ini
DB_HOST=127.0.0.1
DB_PORT=3306
DB_PASSWORD=la-contraseña-entregada-aparte
```

`DB_HOST` y `DB_PORT` son los del paso 4. Escribe cada valor tal cual, sin espacios ni comentarios en la misma línea.
Si la contraseña contiene `#` o espacios, enciérrala entre comillas simples (`DB_PASSWORD='…'`): sin comillas, todo lo
que sigue a `#` se toma como comentario.

Lo que ya trae, como referencia: `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3002`, `APP_URL=http://45.80.152.66`
(el único origen que la API acepta), `COOKIE_SECURE=false` (sin HTTPS), `TRUSTED_PROXIES=none`,
`MAIL_PROVIDER=none`, `DB_NAME=charalesdb`, `DB_USER=charalesdb`, `DB_POOL_SIZE=10`. Si MariaDB sólo escucha en un
socket, puedes usar `DB_SOCKET=/var/lib/mysql/mysql.sock` en lugar de `DB_HOST`/`DB_PORT` (deja esos dos con los
valores del paso 4 igualmente).

### 6.2 Dependencias

**charales** (tarda unos minutos; descarga ~270 paquetes de npm):

```sh
cd ~/charales/backend
npm install --legacy-peer-deps --no-audit --no-fund
npm run api:build
node --env-file=.env deploy/servidor/verificar-env.ts
```

Es normal que `npm install` avise de «install scripts not yet covered by allowScripts» (paquetes del compilador del
frontend, que aquí no se usan). `verificar-env.ts` debe mostrar `PASS` en la configuración y la conexión; la primera
vez termina en `FAIL … la base no está al día` porque aún no hay tablas: es lo esperado.

### 6.3 Migraciones (crear las tablas)

**charales**:

```sh
cd ~/charales/backend
npm run db:setup                               # esquema + migraciones + permisos de la app. Idempotente.
npm run db:admin                               # sólo la primera vez: crea el primer administrador (pide correo y contraseña)
node --env-file=.env deploy/servidor/verificar-env.ts      # ahora debe terminar en «Resultado: PASS»
```

`db:setup` aplica el esquema base **sólo si la base está vacía**, después las migraciones pendientes, y se niega sin
tocar nada si la base tiene tablas que no son de Charales. Repetirlo es seguro. Guarda el correo y la contraseña del
administrador: son el acceso a la aplicación.

> **No ejecutes** `npm run db:setup -- --demo` ni `-- --dev-seed` (cargan datos ficticios), ni `npm run db:reset` o
> `npm run db:test` (de una versión antigua; borran bases), ni `docs/escuela_futbol_mariadb.sql` a mano (borra sus
> tablas). Los scripts necesarios para estos últimos no vienen en el ZIP.

## 7. API con PM2

### 7.1 Arranque

**charales**:

```sh
sh ~/charales/backend/deploy/servidor/instalar.sh
```

Repite `npm install` y la verificación (rápido la segunda vez), arranca la API como proceso `charales-api` (una
instancia, modo fork, reinicio automático si se cae) y guarda la lista de procesos (`pm2 save`).

### 7.2 Comprobación

**charales**:

```sh
pm2 status                                     # charales-api  online
pm2 logs charales-api --lines 20 --nostream    # «Charales API en http://localhost:3002 (BD charalesdb)»
curl -s http://127.0.0.1:3002/health           # {"status":"ok","database":"ok"}
```

El aviso «Sin HTTPS (COOKIE_SECURE=false y APP_URL http://)…» en el log de errores es esperado: recuerda que el
tráfico no va cifrado.

### 7.3 Inicio automático con systemd

**root** (crea y habilita el servicio `pm2-charales`, que arranca PM2 y la API al encender el servidor):

```sh
env PATH=$PATH:/usr/bin pm2 startup systemd -u charales --hp /home/charales
systemctl is-enabled pm2-charales              # enabled
```

**charales** (guarda la lista que el servicio restaurará):

```sh
su - charales -c 'pm2 save'
```

Prueba de reinicio, si se permite: `reboot` (root) y, al volver, `su - charales -c 'pm2 status'` → `online`.

Operación diaria (**charales**): `pm2 restart charales-api` tras cambiar `.env`; `pm2 logs charales-api` para ver
el registro. Los logs están en `/home/charales/.pm2/logs/` (`charales-api-out.log`, `charales-api-error.log`), con
fecha y hora, sin contraseñas ni datos de las consultas. Para rotarlos (opcional): `pm2 install pm2-logrotate`.

Si la configuración es insegura o falta una migración, la API sale con un mensaje claro en el log de errores; PM2 la
reintenta 10 veces y la deja detenida.

## 8. Configuración de Apache

**root**:

```sh
ls -A /var/www/html                            # debe estar vacío (o contener una versión anterior de Charales)
sh /home/charales/charales/backend/deploy/servidor/instalar-apache.sh            # DocumentRoot /var/www/html
# sh …/instalar-apache.sh /ruta/del/documentroot                                 # si usas otro
```

El script:

> **Importante:** el contenido de `dist/` va **directamente** en la raíz del DocumentRoot (`/var/www/html/index.html`).
> En un subdirectorio (`/var/www/html/charales/`) o subiendo la carpeta `dist/` entera, la página queda **en blanco**:
> la app busca sus archivos en la raíz del sitio. El script ya lo hace bien; tenlo en cuenta si copias a mano.

1. Se **detiene sin tocar nada** si el DocumentRoot tiene contenido que no es Charales. Si contiene una versión
   anterior de Charales, la respalda en `/root/charales-html-FECHA.tar.gz` antes de copiar encima.
2. Copia `dist/` (incluido `.htaccess`) al DocumentRoot con permisos de lectura para Apache.
3. Aplica el contexto SELinux (paso 9).
4. Crea `/etc/httpd/conf.d/charales.conf` con `AllowOverride All` para ese directorio (AlmaLinux trae
   `AllowOverride None` y Apache ignoraría el `.htaccess`: las rutas internas darían 404 al recargar). Si el archivo
   ya existe con otro contenido, **no lo modifica** y avisa.
5. Ejecuta `apachectl configtest` y sólo si es correcto recarga Apache. Si no, retira el archivo que acaba de crear.

Qué hace el `.htaccess`: sirve `index.html` en cualquier ruta de la aplicación (`/login`, `/admin/jugadores`…),
desactiva el listado de directorios y añade cabeceras de seguridad (CSP que sólo permite conectar con
`http://45.80.152.66:3002`, `X-Frame-Options`, `nosniff`, etc.).

<details>
<summary>Lo mismo a mano</summary>

```sh
cp -R /home/charales/charales/dist/. /var/www/html/
restorecon -R /var/www/html
test -e /etc/httpd/conf.d/charales.conf || cp /home/charales/charales/backend/deploy/servidor/apache-charales.conf /etc/httpd/conf.d/charales.conf
apachectl configtest && systemctl reload httpd
```

</details>

## 9. Permisos y SELinux

Permisos resultantes (**root**, para comprobar):

```sh
ls -ld /home/charales                          # drwx------ charales: nadie más entra
ls -l  /home/charales/charales/backend/.env    # -rw------- charales: sólo la API lee la contraseña
ls -lZ /var/www/html | head                    # root, lectura para todos, contexto httpd_sys_content_t
ls -lZ /etc/httpd/conf.d/charales.conf         # -rw-r--r-- root, httpd_config_t
```

| Ruta                                   | Dueño / modo           | Por qué                                                  |
| -------------------------------------- | ---------------------- | -------------------------------------------------------- |
| `/home/charales/charales/`             | `charales`, 700 (home) | Código de la API; Apache no lo necesita (usa una copia). |
| `/home/charales/charales/backend/.env` | `charales`, **600**    | Contiene `DB_PASSWORD`.                                  |
| DocumentRoot (`/var/www/html`)         | `root`, 755 / 644      | Apache sólo lee.                                         |
| `/etc/httpd/conf.d/charales.conf`      | `root`, 644            | Configuración de Apache.                                 |

**SELinux** (AlmaLinux lo trae en modo `Enforcing`; compruébalo con `getenforce`). No hay que desactivarlo:

- Archivos de Apache: `instalar-apache.sh` ejecuta `restorecon -R` sobre el DocumentRoot. Si el DocumentRoot está
  fuera de `/var/www`, además registra la regla con
  `semanage fcontext -a -t httpd_sys_content_t "/ruta(/.*)?"` (necesita `dnf install -y policycoreutils-python-utils`).
- Apache no se conecta a la API (el navegador llama directamente al puerto 3002), así que **no** hace falta
  `httpd_can_network_connect`.
- La API corre como servicio de systemd del usuario `charales`, sin dominio SELinux restringido: puede escuchar en el
  3002 y conectar con MariaDB sin reglas adicionales.
- Si Apache responde 403 a archivos que existen: `ausearch -m avc -ts recent` muestra el bloqueo, y
  `restorecon -R /var/www/html` lo corrige.

## 10. Apertura de puertos

**root**:

```sh
firewall-cmd --permanent --add-service=http    # 80: la aplicación (Apache)
firewall-cmd --permanent --add-port=3002/tcp   # 3002: la API (el navegador la llama directamente)
firewall-cmd --reload
firewall-cmd --list-all                        # services: … http …   ports: 3002/tcp
```

**No abras** el puerto de MariaDB (3306) ni el 443. Si el servidor está detrás de un cortafuegos del proveedor (panel
de la nube), abre también allí 80 y 3002 TCP.

## 11. Verificación de funcionamiento

**charales** (sólo lee; prueba desde el propio servidor contra la IP pública):

```sh
sh ~/charales/backend/deploy/servidor/verificar-servidor.sh
```

Debe mostrar `PASS` en todo y terminar en `Resultado: PASS`: PM2 online, `/health`, CORS desde la aplicación, la
validación de la API, el rechazo de un POST de otro origen (protección CSRF) y que Apache sirve `/`, las rutas
internas y la cabecera CSP.

**En un navegador**, desde fuera del servidor:

1. Abre `http://45.80.152.66/login` escribiendo `http://` (los navegadores prueban primero `https://`; si el 443 no
   responde vuelven solos a HTTP).
2. Entra con el administrador creado en el paso 6.3.
3. Abre una página interna (p. ej. Jugadores) y recarga con F5: debe seguir en ella, no dar 404.
4. En las herramientas del navegador (F12 → Consola) no debe haber errores de CORS ni de CSP.
5. «Salir» debe volver a la pantalla de inicio de sesión.

## 12. Problemas frecuentes

| Síntoma                                                         | Causa y solución                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verificar-env.ts`: «No se pudo conectar a MariaDB»             | `DB_HOST`/`DB_PORT`/`DB_PASSWORD` incorrectos, MariaDB detenido, o la cuenta no admite ese host (paso 5).                                                                                                                                                                                                       |
| «Access denied for user 'charalesdb'@'…'»                       | Contraseña distinta, o falta la cuenta para ese host: créala con `crear-base.sh` o el SQL del paso 5.                                                                                                                                                                                                           |
| `db:setup`: «MariaDB … es demasiado antiguo»                    | Servidor < 10.6: paso 3.                                                                                                                                                                                                                                                                                        |
| `db:setup`: «ya tiene N tabla(s) que no son del esquema»        | `charalesdb` contiene otra aplicación. No se modificó nada: usa una base vacía.                                                                                                                                                                                                                                 |
| `db:setup` falla al crear procedimientos con log binario        | Como root de MariaDB: `SET GLOBAL log_bin_trust_function_creators = 1;` y repite `db:setup`.                                                                                                                                                                                                                    |
| `pm2 status` → `errored` / `stopped`                            | `pm2 logs charales-api --err --lines 50`; corrige `.env` y `pm2 restart charales-api`.                                                                                                                                                                                                                          |
| La app carga pero «no se pudo conectar» al iniciar sesión       | Puerto 3002 cerrado (paso 10) o API detenida (`pm2 status`).                                                                                                                                                                                                                                                    |
| Error de CORS en la consola del navegador                       | Abriste la app con otra dirección: debe ser exactamente `http://45.80.152.66` (como `APP_URL`).                                                                                                                                                                                                                 |
| Página en blanco, o «Cargando Charales…» no desaparece          | Los archivos no están en la raíz: el **contenido** de `dist/` debe quedar directamente en el DocumentRoot (`/var/www/html/index.html`), no en `/var/www/html/charales/` ni `/var/www/html/dist/`, y la app se abre en `http://45.80.152.66/`, no como archivo. Vuelve a ejecutar `instalar-apache.sh` (paso 8). |
| 404 al recargar una ruta interna                                | Apache ignora el `.htaccess`: falta `/etc/httpd/conf.d/charales.conf` (paso 8).                                                                                                                                                                                                                                 |
| 403 en todos los archivos de Apache                             | Contexto SELinux: `restorecon -R /var/www/html` (paso 9).                                                                                                                                                                                                                                                       |
| Invitaciones / «olvidé mi contraseña» responden «no disponible» | Esperado: no hay correo (`MAIL_PROVIDER=none`). El administrador da de alta a los usuarios.                                                                                                                                                                                                                     |

## 13. Actualización futura

Con un ZIP nuevo, sin perder la configuración ni los datos:

**root** — copia el ZIP nuevo como en el paso 1 (`install -o charales -g charales -m 600 … /home/charales/`).

**charales** — prepara la versión nueva al lado de la actual, con el mismo `.env`:

```sh
cd ~
rm -rf ~/charales-nuevo ~/CHARALES-ENTREGA-FINAL                 # restos de un intento anterior, si los hay
unzip -q ~/CHARALES-ENTREGA-FINAL.zip -d ~ && mv ~/CHARALES-ENTREGA-FINAL ~/charales-nuevo
(cd ~/charales-nuevo && sha256sum -c --quiet MANIFEST.sha256 && echo "archivos íntegros")
cp -p ~/charales/backend/.env ~/charales-nuevo/backend/.env
cd ~/charales-nuevo/backend && npm install --legacy-peer-deps --no-audit --no-fund && npm run api:build
node --env-file=.env deploy/servidor/verificar-env.ts            # si dice «la base no está al día», hay migraciones
```

Si hay migraciones: **primero un respaldo** (§ 14) y después, **charales**, `npm run db:setup` dentro de
`~/charales-nuevo/backend`.

**charales** — cambia de versión (la anterior queda como `~/charales-anterior-FECHA`):

```sh
mv ~/charales ~/charales-anterior-$(date +%Y%m%d-%H%M) && mv ~/charales-nuevo ~/charales
cd ~/charales/backend && pm2 delete charales-api && pm2 start ecosystem.config.cjs && pm2 save
```

**root** — frontend nuevo (respalda el anterior automáticamente):

```sh
sh /home/charales/charales/backend/deploy/servidor/instalar-apache.sh
```

Y verifica con el § 11. **Volver atrás:** `mv ~/charales ~/charales-fallida && mv ~/charales-anterior-FECHA ~/charales`,
`pm2 delete charales-api && pm2 start ~/charales/backend/ecosystem.config.cjs && pm2 save`, y como root
`tar -xzf /root/charales-html-FECHA.tar.gz -C /var/www/html`. Si se aplicaron migraciones, restaura también la base
(§ 14).

## 14. Respaldos y recuperación

### Qué respaldar

| Qué                           | Dónde                                  | Cómo                                     |
| ----------------------------- | -------------------------------------- | ---------------------------------------- |
| Base de datos (lo importante) | MariaDB `charalesdb`                   | script de abajo                          |
| Configuración de la API       | `/home/charales/charales/backend/.env` | copia con modo 600 (tiene la contraseña) |
| Configuración de Apache       | `/etc/httpd/conf.d/charales.conf`      | copia                                    |
| Frontend y código             | el ZIP de la entrega                   | conserva el ZIP                          |

### Respaldo de la base

**root**, en el servidor de MariaDB (volcado consistente sin bloquear la aplicación; falla y no deja archivo si el
volcado queda incompleto; el archivo sólo lo lee root porque contiene datos personales, también de menores):

```sh
sh /home/charales/charales/backend/db/mariadb/scripts/backup.sh charalesdb /root/respaldos-charales
# → /root/respaldos-charales/charalesdb_AAAA-MM-DD_HHMMSS.sql.gz
```

Respaldo diario automático (opcional; **root**; crea el archivo sólo si no existe). Los respaldos no se borran solos:
revisa el espacio de vez en cuando y copia alguno fuera del servidor.

```sh
test -e /etc/cron.d/charales-respaldo || echo '30 2 * * * root sh /home/charales/charales/backend/db/mariadb/scripts/backup.sh charalesdb /root/respaldos-charales >/dev/null' > /etc/cron.d/charales-respaldo
```

### Recuperación

La restauración **nunca escribe sobre una base existente**: crea una base nueva, se comprueba y después se apunta la
API a ella. **root**:

```sh
sh /home/charales/charales/backend/db/mariadb/scripts/restore.sh /root/respaldos-charales/charalesdb_FECHA.sql.gz charalesdb_restaurada
mariadb -e "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES, CREATE ROUTINE, ALTER ROUTINE, EXECUTE, EVENT, TRIGGER, LOCK TABLES, SHOW VIEW ON charalesdb_restaurada.* TO 'charalesdb'@'localhost', 'charalesdb'@'127.0.0.1'"
```

**charales** — en `~/charales/backend/.env` cambia `DB_NAME=charalesdb_restaurada` y:

```sh
cd ~/charales/backend && node --env-file=.env deploy/servidor/verificar-env.ts && pm2 restart charales-api
```

La base dañada queda intacta para revisarla; bórrala tú sólo cuando ya no la necesites. Para comprobar que un
respaldo es fiel antes de necesitarlo: restáuralo en una base de prueba y compara con
`sh /home/charales/charales/backend/db/mariadb/scripts/verify-backup.sh charalesdb charalesdb_restaurada` (cuenta
filas y sumas de cada tabla).

## 15. Qué toca cada comando y seguridad

| Comando                                                                | Efecto                                                                                                                                                                            |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `comprobar-requisitos.sh`, `verificar-env.ts`, `verificar-servidor.sh` | Sólo leen. El último envía un login vacío (400, no llega a la base) y un logout de otro origen (403).                                                                             |
| `crear-base.sh`                                                        | Crea base y cuenta sólo si no existen; nunca cambia contraseñas ni borra.                                                                                                         |
| `npm install`, `npm run api:build`                                     | Sólo `backend/node_modules` y `backend/api/.build`.                                                                                                                               |
| `npm run db:setup`                                                     | Esquema base sólo en base vacía; migraciones idempotentes (las únicas que eliminan algo retiran dos tablas internas obsoletas, sin datos de negocio). Se niega con tablas ajenas. |
| `npm run db:admin`                                                     | Añade un administrador; se niega si el correo ya existe.                                                                                                                          |
| `instalar.sh`, `pm2 …`                                                 | Sólo la lista de procesos de PM2 del usuario `charales`.                                                                                                                          |
| `instalar-apache.sh`                                                   | DocumentRoot (sólo si vacío o ya era Charales, con respaldo) y `conf.d/charales.conf` (sólo si no existe).                                                                        |
| `backup.sh` / `restore.sh`                                             | Crea un archivo nuevo / una base nueva; nunca sobrescribe.                                                                                                                        |

Seguridad de esta instalación:

- **Sin HTTPS**: la contraseña de inicio de sesión y la cookie de sesión viajan sin cifrar. Es aceptable sólo para el
  servidor del curso.
- Siguen activos: cookie `HttpOnly; SameSite=Strict`, contraseñas con scrypt, límite de intentos de inicio de sesión,
  permisos por rol en cada operación.
- **CSRF**: la API rechaza (403) toda petición que modifique datos si su `Origin` no es exactamente
  `http://45.80.152.66`, y CORS sólo autoriza a ese origen.
- **SQL**: todos los valores van como parámetros; los nombres de tablas salen del código, nunca de la petición.
- La API queda expuesta directamente en el puerto 3002 (sin proxy delante); `/health` es público (sólo dice si la
  base responde). Apache muestra su versión salvo que añadas `ServerTokens Prod` en `/etc/httpd/conf/httpd.conf`.
- `backend/.env` (modo 600) y los respaldos (sólo root) contienen datos sensibles: no los copies a lugares públicos.

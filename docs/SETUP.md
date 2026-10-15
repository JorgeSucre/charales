# Instalación local — Charales en tu computadora

Guía para que cada integrante ejecute Charales con **su propio MariaDB local**, sin servidor remoto:

```text
Navegador → Angular (ng serve, :4200) ─proxy /api, /auth, /health─▶ API Node (:3000) ─▶ MariaDB local (:3306)
```

Los datos que crees en la app se guardan en tu MariaDB: siguen ahí al recargar la página y al reiniciar la API o el
frontend. Nada de esto es producción (ver [`API.md` § Producción y despliegue](API.md#producción-y-despliegue)).

> **Qué está probado (2026-10-15):** macOS con MariaDB 13.0.2 (Homebrew) y Node 26.11, conexión por socket y por TCP
> con una cuenta de privilegios mínimos (los de la sección 3). **No probado:** Windows y Linux; los pasos para ellos
> siguen la documentación oficial de MariaDB y los comandos del proyecto son multiplataforma salvo los marcados `sh`.

## 1. Requisitos

| Herramienta   | Versión                                 | Notas                                                                                           |
| ------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Node.js       | `^24.15.0` o `>=26` (probado con 26.11) | La API usa `crypto.argon2` y ejecuta TypeScript sin compilar (`package.json` → `engines`)       |
| npm           | 11 (incluido con Node 24/26)            | `npm ci` instala exactamente lo de `package-lock.json`                                          |
| MariaDB       | 10.6 o superior (probado con 13.0.2)    | **MySQL no sirve**: el esquema usa columnas generadas `PERSISTENT` y otras funciones de MariaDB |
| Git           | reciente                                |                                                                                                 |
| Google Chrome | opcional                                | Sólo para `npm run e2e`                                                                         |
| `sh`          | macOS/Linux; en Windows, Git Bash       | Sólo para los scripts de respaldo (`db/mariadb/scripts/*.sh`)                                   |

## 2. Instalar MariaDB

**macOS (probado):**

```bash
brew install mariadb
brew services start mariadb        # queda iniciado al encender la computadora
mariadb -e "SELECT VERSION()"      # tu usuario del sistema entra como administrador (unix_socket)
```

**Ubuntu / Debian (no probado):**

```bash
sudo apt update && sudo apt install mariadb-server
sudo systemctl enable --now mariadb
sudo mariadb -e "SELECT VERSION()"   # el administrador es root por unix_socket: usa sudo
```

**Windows (no probado):** descarga el instalador MSI desde <https://mariadb.org/download/> (o
`winget install MariaDB.Server`), elige una contraseña para `root` durante la instalación y deja marcado «Install as
service». Abre «MariaDB Command Prompt» y entra con `mariadb -u root -p`.

## 3. Crear la base y tu cuenta de MariaDB (una sola vez)

Como administrador de MariaDB (`mariadb`, `sudo mariadb` o `mariadb -u root -p`), con **tu propia** contraseña:

```sql
CREATE DATABASE escuela_futbol CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'charales'@'localhost' IDENTIFIED BY 'elige-una-contraseña';
-- Lo que necesitan la API y `npm run db:setup` (tablas, migraciones, procedimiento y evento), sólo en esta base:
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, CREATE ROUTINE, ALTER ROUTINE, EXECUTE,
      EVENT, TRIGGER, LOCK TABLES, SHOW VIEW, CREATE TEMPORARY TABLES
   ON escuela_futbol.* TO 'charales'@'localhost';
-- Sólo si vas a correr las pruebas (crean y borran bases temporales ef_*):
GRANT ALL PRIVILEGES ON `ef\_%`.* TO 'charales'@'localhost';
```

Esa lista de privilegios es la que se probó con `db:setup`, `db:admin` y la API. La cuenta no puede tocar otras bases.

## 4. Obtener el proyecto e instalar dependencias

```bash
git clone https://github.com/JorgeSucre/charales.git
cd charales                           # queda en main, la rama de trabajo del equipo
npm ci                                # dependencias exactas del lockfile
```

## 5. Configurar `.env`

```bash
cp .env.example .env     # Windows (cmd): copy .env.example .env
```

Edita `.env` y pon tu contraseña en `DB_PASSWORD`. `.env` **no se versiona** (está en `.gitignore`); nunca subas
contraseñas. Variables:

| Variable                  | Valor local típico      | Para qué                                                                                       |
| ------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| `PORT`                    | `3000`                  | Puerto de la API (el proxy de `npm start` apunta a 3000)                                       |
| `APP_URL`                 | `http://localhost:4200` | Base de los enlaces de los correos                                                             |
| `DB_NAME`                 | `escuela_futbol`        | Base de datos                                                                                  |
| `DB_HOST` / `DB_PORT`     | `127.0.0.1` / `3306`    | Conexión TCP                                                                                   |
| `DB_USER` / `DB_PASSWORD` | `charales` / la tuya    | Tu cuenta de la sección 3                                                                      |
| `DB_SOCKET`               | — (opcional)            | En macOS/Linux, en lugar de TCP: socket local con autenticación `unix_socket` (sin contraseña) |
| `DB_POOL_SIZE`            | `5`                     | Conexiones de la API                                                                           |
| `COOKIE_SECURE`           | `false`                 | `true` sólo con HTTPS                                                                          |
| `MAIL_CONSOLE`            | `true`                  | Los correos (recuperación, invitaciones) se imprimen en la consola de la API, con su enlace    |

## 6. Preparar la base de datos

```bash
npm run db:setup          # esquema + migraciones + permisos (crea la base si tu cuenta puede)
npm run db:admin          # crea TU administrador: pide correo, nombre y contraseña (no se muestra)
```

Opcional, para tener datos de ejemplo (familias, cobros, partidos ficticios) **en una base sin usuarios ni jugadores**:

```bash
npm run db:setup -- --demo   # en lugar de db:admin; cuentas @example.com con la contraseña pública demo1234
```

`db:setup` es seguro de repetir: **nunca borra ni vacía nada** y no cambia contraseñas. Aplica el esquema sólo a una
base sin tablas, conserva la matriz de permisos que el administrador haya editado y se niega a tocar una base con
tablas ajenas. Ejecútalo después de cada `git pull` que traiga migraciones (`db/mariadb/migrations`).
`db:admin` nunca sobrescribe una cuenta existente: para otra contraseña usa «¿Olvidaste tu contraseña?» en la app.

> No ejecutes `docs/escuela_futbol_mariadb.sql` a mano sobre una base existente: **borra sus 39 tablas**.
> `db:setup` usa ese esquema sin sus `DROP` y sólo en una base vacía.

## 7. Iniciar Charales

```bash
npm run api:start         # terminal 1: API en http://localhost:3000 (empaqueta el dominio antes de iniciar)
npm start                 # terminal 2: app en http://localhost:4200, con proxy a la API (proxy.conf.json)
```

Abre <http://localhost:4200> e inicia sesión con tu administrador. Comprobaciones:

```bash
curl http://localhost:3000/health          # {"status":"ok","database":"ok"} — API y MariaDB conectadas
curl http://localhost:4200/health          # lo mismo a través del proxy del frontend
```

Para comprobar la persistencia: crea un jugador, recarga la página, edítalo, detén la API (Ctrl+C) e iníciala de
nuevo: los datos siguen ahí (es lo que prueba `e2e/app.e2e.ts`, «persistence»).

## 8. Pruebas

```bash
npm run test:all          # frontend (Vitest) + typecheck + API sobre MariaDB (bases temporales ef_*, se borran)
npm run e2e               # navegador (Google Chrome headless) sobre una base temporal
npx prettier --check .    # formato
npm run db:mariadb:test-backup   # sh: checks del esquema y respaldo/restauración (usa el cliente `mariadb` del sistema)
```

Las pruebas de la API y el E2E nunca usan `escuela_futbol`: crean bases `ef_*` y sólo pueden borrar bases con ese
prefijo. Necesitan el permiso sobre `ef\_%` de la sección 3. Detalle: [`TESTING.md`](TESTING.md).

**Chrome para `npm run e2e`.** Por omisión se busca en la ruta de macOS
(`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`); si no está ahí, la prueba falla con «Google Chrome
no encontrado (CHROME_PATH)». Indica el ejecutable con `CHROME_PATH`, en `.env` o en la terminal:

```bash
CHROME_PATH=/usr/bin/google-chrome npm run e2e                                  # Linux (o /usr/bin/chromium)
CHROME_PATH="/Applications/Chromium.app/Contents/MacOS/Chromium" npm run e2e    # macOS con otro navegador
```

```powershell
$env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"; npm run e2e   # Windows (PowerShell)
```

En `.env` se escribe sin comillas: `CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe`. Sólo las
rutas de macOS se han probado.

## 9. Respaldo y restauración de tu base local

```bash
sh db/mariadb/scripts/backup.sh escuela_futbol respaldos/          # crea respaldos/escuela_futbol_<fecha>.sql.gz
sh db/mariadb/scripts/restore.sh respaldos/<archivo>.sql.gz escuela_futbol_restaurada   # sólo en una base NUEVA
sh db/mariadb/scripts/verify-backup.sh escuela_futbol escuela_futbol_restaurada        # compara filas y sumas
```

Usan `mariadb-dump`/`mariadb` con tu configuración de cliente (en Windows, desde Git Bash). `restore.sh` se niega a
restaurar sobre una base existente. Más detalle: [`database/MARIADB.md` § 6](database/MARIADB.md).

## 10. Planificador de eventos

El trabajo diario que marca cargos VENCIDO (migración 002) sólo corre con `event_scheduler=ON`. En local **no hace
falta**: la app recalcula VENCIDO en cada operación de cobranza. Para activarlo en tu propio MariaDB, agrega
`event_scheduler=ON` en la sección `[mysqld]` de su configuración y reinícialo (`db:setup` avisa si está apagado).

## 10.1 Zona horaria

Charales trabaja con la hora de la escuela, `America/Mexico_City` (`DATETIME` sin zona, `MARIADB.md` § 1). La API la
fija sola al iniciar (`api/auth.ts`): invitaciones, vencimientos, cargos y asistencia usan esa hora aunque tu
computadora o el servidor estén en otra zona (`api/timezone.test.ts`). MariaDB, en cambio, usa la suya para los
valores por omisión `CURRENT_TIMESTAMP` y para el trabajo diario de VENCIDO (`CURDATE()`). Compruébala con
`mariadb -e "SELECT @@system_time_zone, @@time_zone"`. Si no es la del centro de México, agrega
`default_time_zone='-06:00'` en `[mysqld]` y reinicia MariaDB (México no aplica horario de verano desde 2022).

## 11. Problemas comunes

| Mensaje                                                   | Causa y solución                                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `No se pudo conectar a MariaDB (... ECONNREFUSED ...)`    | MariaDB no está iniciado, o `DB_HOST`/`DB_PORT` no coinciden                                   |
| `No se pudo conectar a MariaDB (... Access denied ...)`   | `DB_USER`/`DB_PASSWORD` incorrectos, o falta la cuenta de la sección 3                         |
| `No se pudo crear la base «…»`                            | Tu cuenta no puede crear bases: créala como administrador (sección 3) y repite `db:setup`      |
| `La base «…» ya tiene … tabla(s) que no son del esquema…` | `DB_NAME` apunta a otra base: usa otro nombre                                                  |
| `La base ya tiene datos: la demostración sólo se carga…`  | `--demo` sólo en una base sin usuarios ni jugadores                                            |
| El login dice «No se pudo conectar con la API»            | La API no está corriendo (`npm run api:start`) o no está en el puerto 3000                     |
| Crear personal o vincular un tutor responde 503           | Falta `MAIL_CONSOLE=true` en `.env` (no hay proveedor de correo; ver «Producción» en `API.md`) |
| `npm warn EBADENGINE`                                     | Tu Node no cumple `^24.15.0 \|\| >=26`: actualízalo                                            |

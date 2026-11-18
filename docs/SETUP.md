# Instalación local — Charales en tu computadora

Guía para que cada integrante ejecute Charales con **su propio MariaDB local**, sin servidor remoto:

```text
Navegador → Angular (ng serve, :4200) ─proxy /api, /auth, /health─▶ API Node (:3000) ─▶ MariaDB local (:3306)
```

Los datos que crees en la app se guardan en tu MariaDB: siguen ahí al recargar la página y al reiniciar la API o el
frontend. Nada de esto es producción (ver [`API.md` § Producción y despliegue](API.md#producción-y-despliegue)).

> **Qué está probado (2026-11-18):** macOS (Apple Silicon), Node 26.13.1 con npm 11.20.0, desde un clon limpio con
> `npm ci` y caché de npm vacía, contra instancias de MariaDB **13.0.2** y **10.6.28** nuevas, por TCP, con la cuenta de
> privilegios mínimos de la sección 3: `db:setup` (dos veces), `db:mariadb:test-backup`, `api:test`, `ng test` y `e2e`
> (este último sólo con 13.0.2). **No probado:** Windows y Linux; los pasos para ellos siguen la documentación oficial
> de MariaDB y los comandos del proyecto son multiplataforma salvo los marcados `sh`.

## 1. Requisitos

**Matriz oficial de versiones.** Cada versión tiene una sola fuente en el repositorio; las tablas de otros documentos
remiten a ésta.

| Herramienta   | Versión oficial (desarrollo y CI)      | Admitida                                | Fuente / notas                                                                                       |
| ------------- | -------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Node.js       | **26.13.1** (LTS)                      | `^24.15.0 \|\| >=26.0.0`                | Exacta: [`.nvmrc`](../.nvmrc) (la usa la CI). Rango: `package.json` → `engines` (Angular 22, scrypt) |
| npm           | **11.20.0** (la que trae Node 26.13.1) | 11                                      | `package.json` → `packageManager`; la CI falla si no coincide. `npm ci` instala sólo lo del lockfile |
| MariaDB       | 13.0.2 (Homebrew); la CI usa 11.8      | 10.6 o superior (probado con 10.6.28)   | **MySQL no sirve**: columnas generadas `PERSISTENT` y otras funciones de MariaDB                     |
| Cliente       | el que trae MariaDB                    | `mariadb` y `mariadb-dump` en el `PATH` | Sólo para los scripts `sh` de `db/mariadb/scripts` (respaldo y su prueba)                            |
| Git           | reciente                               |                                         |                                                                                                      |
| Google Chrome | estable                                | opcional                                | Sólo para `npm run e2e` (ver § 8, `CHROME_PATH`)                                                     |
| `sh`          | macOS/Linux; en Windows, Git Bash      |                                         | Sólo para los scripts de respaldo (`db/mariadb/scripts/*.sh`)                                        |
| Postman CLI   | opcional                               |                                         | `postman collection lint postman/` y correr la colección contra la API local ([`API.md`](API.md))    |

Angular, TypeScript, RxJS, Vitest, esbuild y el driver `mariadb` no se instalan aparte: sus versiones exactas están en
`package-lock.json` y llegan con `npm ci` (Angular 22.2, TypeScript 6.0, RxJS 7.8, Vitest 5.0, esbuild 0.28,
`mariadb` 3.5). No hace falta nada instalado globalmente con npm: `ng`, `tsc` y `prettier` se llaman con `npx` o
desde los scripts de `package.json`.

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
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES, CREATE ROUTINE, ALTER ROUTINE, EXECUTE,
      EVENT, TRIGGER, LOCK TABLES, SHOW VIEW, CREATE TEMPORARY TABLES
   ON escuela_futbol.* TO 'charales'@'localhost';
-- Sólo si vas a correr las pruebas (crean bases temporales ef_* nuevas y las conservan):
GRANT ALL PRIVILEGES ON `ef\_%`.* TO 'charales'@'localhost';
```

Esa lista de privilegios es la que se probó con `db:setup`, `db:admin` y la API (y la que usa la CI para correr
`db:setup` desde cero). La cuenta no puede tocar otras bases. `DROP` hace falta porque las migraciones 008 y 010
eliminan tablas obsoletas (`DROP TABLE IF EXISTS`); sin él, `db:setup` se detiene con «DROP command denied». Si tu
cuenta se creó antes con la lista anterior: `GRANT DROP ON escuela_futbol.* TO 'charales'@'localhost';`.

## 4. Obtener el proyecto e instalar dependencias

Instala la versión de Node de [`.nvmrc`](../.nvmrc) con un gestor de versiones que la lea (nvm o fnm); `brew install
node` instala la más reciente, que puede no ser la oficial:

```bash
git clone https://github.com/JorgeSucre/charales.git
cd charales                           # queda en main, la rama de trabajo del equipo
nvm install && nvm use                # lee .nvmrc (con fnm: fnm use --install-if-missing)
node --version && npm --version       # v26.13.1 y 11.20.0 (§ 1)
npm ci                                # dependencias exactas del lockfile; falla si el lockfile no cuadra
```

No uses `npm install` para «arreglar» un `npm ci` que falla: cambiaría `package-lock.json` y ocultaría el problema.

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
npm run test:all          # frontend (Vitest) + typecheck + API sobre MariaDB (bases temporales ef_* nuevas, se conservan)
npm run e2e               # navegador (Google Chrome headless) sobre una base temporal
npx prettier --check .    # formato
npm run db:mariadb:test-backup   # sh: checks del esquema y respaldo/restauración (usa el cliente `mariadb` del sistema)
```

Las pruebas de la API y el E2E nunca usan `escuela_futbol`: crean bases `ef_*` con nombre único y nunca borran
ninguna: se conservan al terminar; bórralas a mano cuando ya no hagan falta (cada suite imprime «Base de prueba conservada: …»). Necesitan el permiso sobre `ef\_%` de la sección 3. Detalle: [`TESTING.md`](TESTING.md).

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
| `npm warn EBADENGINE`                                     | Tu Node no cumple `^24.15.0 \|\| >=26`: `nvm install && nvm use` (§ 4)                         |
| `DROP command denied to user …` en `db:setup`             | A tu cuenta le falta `DROP` (sección 3): concédelo y repite `db:setup` (es seguro repetirlo)   |

## 12. Recuperar el proyecto en una computadora nueva

Todo lo necesario para reconstruir, probar y desplegar Charales está en GitHub. **No** está en GitHub, a propósito:
`.env` (contraseñas), los datos de tu MariaDB local y los respaldos `.sql.gz` (datos de personas, también de menores).
Las contraseñas del servidor del curso viven en ese servidor (ver [`DEPLOYMENT.md`](../DEPLOYMENT.md)).

**En la computadora anterior, antes de borrarla:**

1. `git status` y `git log --branches --not --remotes` en cada clon y worktree: nada sin commit ni sin publicar.
2. Si quieres conservar los datos de tu base local: `sh db/mariadb/scripts/backup.sh escuela_futbol ~/respaldo` y
   guarda el `.sql.gz` **fuera de Git** (disco cifrado o gestor de contraseñas para `.env`).

**En la computadora nueva** (los mismos pasos de las secciones 2 a 8):

```bash
brew install git mariadb nvm          # nvm: sigue las instrucciones que imprime brew para tu shell
brew services start mariadb
git clone https://github.com/JorgeSucre/charales.git && cd charales
nvm install && nvm use                # Node de .nvmrc; trae el npm de packageManager
npm ci
cp .env.example .env                  # DB_PASSWORD de tu cuenta (sección 3)
# como administrador de MariaDB: los CREATE/GRANT de la sección 3
npm run db:setup                      # base nueva; para recuperar tus datos, ver abajo
npm run db:admin                      # o: npm run db:setup -- --demo
npm run api:start                     # terminal 1
npm start                             # terminal 2 → http://localhost:4200
npm run test:all && npm run e2e && npx prettier --check . && npm run db:mariadb:test-backup
npm run build                         # producción en dist/; para el servidor del curso: DEPLOYMENT.md
```

**Recuperar tus datos locales** en lugar de empezar vacío: como administrador de MariaDB (en macOS, tu usuario del
sistema), **antes** del `CREATE DATABASE` de la sección 3, `sh db/mariadb/scripts/restore.sh <archivo.sql.gz>
escuela_futbol` (sólo restaura en una base que no existe); después crea la cuenta y sus `GRANT` de la sección 3 y corre
`npm run db:setup`, que aplica las migraciones que le falten al respaldo sin borrar nada.

# Despliegue de Charales en el servidor del curso (AlmaLinux · Apache + PM2 · HTTP)

Frontend compilado servido por **Apache** en `http://45.80.152.66`; API en **Node + PM2** en `http://45.80.152.66:3002`;
MariaDB `charalesdb`. Sin HTTPS, sin proxy, sin correo. El frontend **no necesita Node** en el servidor; la API sí.

> El procedimiento con nginx + HTTPS sigue en
> [`docs/deployment/PROCEDIMIENTO_PRODUCCION.md`](docs/deployment/PROCEDIMIENTO_PRODUCCION.md). Esta es la variante
> del servidor del curso; la API la acepta sólo con `COOKIE_SECURE=false` **y** `APP_URL` `http://`.

Los comandos se ejecutan **en orden**. Ninguno borra datos: lo que podría sobrescribir algo lleva antes una
comprobación (§ 10 resume qué toca cada uno).

## 1. Qué se entrega

```text
charales/
├── dist/                    → contenido del DocumentRoot de Apache (incluye .htaccess)
├── backend/                 → la API: api/, src/ (servicios de dominio), db/, docs/*.sql, deploy/, package*.json
│   ├── ecosystem.config.cjs → PM2 (proceso charales-api)
│   ├── .env.example         → plantilla sin secretos
│   └── .env                 → configuración real: se copia APARTE (no va en el .tar.gz ni en Git)
├── MANIFEST.txt             → rama, commit y cambios sin commit con que se generó
├── MANIFEST.sha256          → suma de cada archivo (sha256sum -c MANIFEST.sha256)
└── DEPLOYMENT.md
```

Se genera en la máquina de desarrollo con `sh deploy/servidor/empaquetar.sh` → `entrega/charales.tar.gz` y
`entrega/charales.tar.gz.sha256`.

| Dato                         | Valor                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| Punto de entrada de la API   | `api/server.ts` (no existe `serve.ts`); Node ≥ 24.15 ejecuta TypeScript                      |
| Carga del `.env`             | `node --env-file=<ruta absoluta>/backend/.env api/server.ts` (lo arma PM2)                   |
| Proceso PM2                  | `charales-api`, 1 instancia, modo fork, reinicio automático                                  |
| Escucha                      | `HOST=0.0.0.0`, `PORT=3002`                                                                  |
| Origen aceptado (CORS/CSRF)  | sólo el de `APP_URL` = `http://45.80.152.66` (exacto)                                        |
| Proxies de confianza         | `TRUSTED_PROXIES=none`                                                                       |
| Correo                       | `MAIL_PROVIDER=none` (la API no tiene `MAIL_URL`): invitaciones y recuperación responden 503 |
| URL de la API en el frontend | `http://45.80.152.66:3002` (fijada al compilar: `npm run build:servidor`)                    |

## 2. Datos que faltan del profesor

| Dato                                               | Dónde va                                              | Estado            |
| -------------------------------------------------- | ----------------------------------------------------- | ----------------- |
| Acceso SSH (usuario) y si ese usuario tiene sudo   | —                                                     | **Pendiente**     |
| Host de MariaDB                                    | `backend/.env` → `DB_HOST`                            | **Pendiente**     |
| Puerto de MariaDB                                  | `backend/.env` → `DB_PORT`                            | **Pendiente**     |
| Si `charalesdb` ya existe y sus privilegios (§ 5)  | MariaDB                                               | **Pendiente**     |
| DocumentRoot de Apache y si está vacío             | Apache                                                | **Pendiente**     |
| Puerto de Apache (se supone 80)                    | `APP_URL` (si no es 80: `http://45.80.152.66:PUERTO`) | **Por confirmar** |
| Si Node, PM2, Apache y MariaDB ya están instalados | servidor                                              | **Pendiente**     |

En el servidor, `ss -ltnp | grep -Ei 'mariadb|mysql'` muestra el host y el puerto reales de un MariaDB local.

## 3. Software base (AlmaLinux 9 o 10; con sudo)

Primero mira qué hay; instala sólo lo que falte.

```sh
cat /etc/almalinux-release
node --version; npm --version; pm2 --version; httpd -v; mariadb --version
```

**Node.js ^24.15 o ≥ 26** (Node 22 no sirve: no ejecuta este TypeScript):

```sh
curl -fsSL https://rpm.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh
less /tmp/nodesource_setup.sh                # revisa lo que hace antes de ejecutarlo
sudo bash /tmp/nodesource_setup.sh
sudo dnf install -y nodejs
node --version                               # v24.15.0 o mayor
```

**PM2:** `sudo npm install -g pm2`

**Apache:**

```sh
sudo dnf install -y httpd
sudo systemctl enable --now httpd
httpd -M | grep -E 'dir_module|headers_module'   # ambos deben aparecer (vienen activos en AlmaLinux)
```

**Cortafuegos** (80 para Apache, 3002 para la API; MariaDB **no** se abre):

```sh
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-port=3002/tcp
sudo firewall-cmd --reload
```

**MariaDB:** si el profesor ya la proporciona, no instales nada. Si hay que instalarla en esta máquina: Charales
necesita **10.6 o superior** (`db:setup` lo comprueba). AlmaLinux 9 trae 10.5 en su repositorio principal; en ese
caso usa el repositorio oficial de MariaDB (mariadb.org/download → «MariaDB Repositories») con 10.11 LTS o mayor.

```sh
sudo dnf install -y mariadb-server           # sólo si dnf ofrece ≥ 10.6 (dnf info mariadb-server)
sudo systemctl enable --now mariadb
```

## 4. Copiar la entrega

Desde la máquina de desarrollo:

```sh
scp entrega/charales.tar.gz entrega/charales.tar.gz.sha256 USUARIO@45.80.152.66:~
scp entrega/charales/backend/.env USUARIO@45.80.152.66:~/charales.env
```

En el servidor (instalación nueva; para actualizar, § 9):

```sh
cd ~
sha256sum -c charales.tar.gz.sha256          # charales.tar.gz: OK
test ! -e ~/charales || { echo "~/charales ya existe: usa § 9"; false; }
tar -xzf charales.tar.gz -C ~                # → ~/charales/{dist,backend,DEPLOYMENT.md,MANIFEST.*}
(cd ~/charales && sha256sum -c --quiet MANIFEST.sha256 && echo "archivos íntegros")
mv -n ~/charales.env ~/charales/backend/.env # -n: nunca sobrescribe un .env existente
chmod 600 ~/charales/backend/.env            # sólo el usuario que ejecuta PM2 lo lee
ls -l ~/charales/backend/.env                # -rw------- USUARIO
```

## 5. Base de datos

Completa en `~/charales/backend/.env` los datos pendientes (§ 2): `DB_HOST` y `DB_PORT`. `DB_NAME`, `DB_USER` y
`DB_PASSWORD` ya vienen.

**Sólo si la base o la cuenta no existen** (lo hace un administrador de MariaDB; sustituye `CONTRASEÑA` y, si la API
se conecta desde otra máquina, `localhost` por su IP):

```sql
CREATE DATABASE IF NOT EXISTS charalesdb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'charalesdb'@'localhost' IDENTIFIED BY 'CONTRASEÑA';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES, CREATE ROUTINE, ALTER ROUTINE,
      EXECUTE, EVENT, TRIGGER, LOCK TABLES, SHOW VIEW ON charalesdb.* TO 'charalesdb'@'localhost';
```

Son los privilegios que necesita `db:setup` (como `charales_admin` en `deploy/mariadb/cuentas.sql`). Recomendado, también
como administrador: `SET GLOBAL event_scheduler = ON;` (y `event_scheduler=ON` en `/etc/my.cnf.d/`) para el cálculo
diario de cargos vencidos; sin él la app los recalcula igual en cada operación de cobranza.

Comprueba la conexión (sólo lee):

```sh
cd ~/charales/backend
npm install --legacy-peer-deps --no-audit --no-fund
npm run api:build
node --env-file=.env deploy/servidor/verificar-env.ts
```

Con npm 11, `npm install` puede avisar de «install scripts not yet covered by allowScripts» (esbuild, lmdb,
@parcel/watcher…): son del build de Angular y no hacen falta aquí; `npm run api:build` funciona igual.

Si termina en «la base no está al día», prepara la base **(sólo con autorización del profesor)**:

```sh
npm run db:setup          # esquema + migraciones + permisos. Idempotente; ver § 10
npm run db:admin          # sólo la primera vez: crea el primer administrador (pregunta correo y contraseña)
node --env-file=.env deploy/servidor/verificar-env.ts      # debe terminar en «Resultado: PASS»
```

> Nunca `npm run db:setup -- --demo` ni `--dev-seed` (datos ficticios), nunca `npm run db:reset` / `db:test`
> (PostgreSQL histórico, borran bases) y nunca `docs/escuela_futbol_mariadb.sql` a mano (borra sus tablas).

## 6. API con PM2

```sh
cd ~/charales/backend
pm2 start ecosystem.config.cjs               # o: sh deploy/servidor/instalar.sh (§ 5 + esto, sin tocar la base)
pm2 logs charales-api --lines 20 --nostream  # «Charales API en http://localhost:3002 (BD charalesdb)»
pm2 save                                     # guarda la lista de procesos
pm2 startup systemd                          # imprime un comando «sudo env PATH=… pm2 startup …»: ejecútalo tal cual
pm2 save
systemctl is-enabled pm2-$USER               # enabled → PM2 y charales-api vuelven solos tras reiniciar
```

`ecosystem.config.cjs` arma rutas absolutas desde su propia ubicación: `pm2 start ~/charales/backend/ecosystem.config.cjs`
funciona desde cualquier directorio, y `pm2 save` guarda esas rutas.

Operación: `pm2 status`, `pm2 restart charales-api` (tras cambiar `.env`), `pm2 logs charales-api`. Si la
configuración es peligrosa o falta una migración, la API sale con código 1; PM2 reintenta 10 veces y la deja detenida:
revisa `pm2 logs`.

Logs: `~/.pm2/logs/charales-api-out*.log` y `charales-api-error*.log` (los avisos de arranque van al de error), con
fecha y hora. No contienen contraseñas, tokens ni parámetros SQL. Para que no crezcan sin límite (opcional):
`pm2 install pm2-logrotate`.

## 7. Frontend en Apache

El DocumentRoot predeterminado es `/var/www/html`; usa el que indique el profesor. Si ya tiene archivos, respáldalos:

```sh
ls -A /var/www/html
sudo tar -czf ~/html-respaldo-$(date +%F-%H%M).tar.gz -C /var/www/html .   # sólo si no estaba vacío
sudo cp -R ~/charales/dist/. /var/www/html/                              # incluye .htaccess
sudo restorecon -R /var/www/html                                          # contexto SELinux correcto
```

AlmaLinux trae `AllowOverride None`: Apache ignoraría el `.htaccess` y las rutas internas darían 404 al recargar.
Se habilita con un archivo propio, sin editar `httpd.conf` (si el DocumentRoot no es `/var/www/html`, edita la ruta
en el archivo antes de copiarlo):

```sh
test ! -e /etc/httpd/conf.d/charales.conf || echo "Ya existe /etc/httpd/conf.d/charales.conf: revísalo a mano"
sudo cp -n ~/charales/backend/deploy/servidor/apache-charales.conf /etc/httpd/conf.d/charales.conf   # -n: no sobrescribe
sudo apachectl configtest                   # Syntax OK
sudo systemctl reload httpd
```

El frontend llama a `http://45.80.152.66:3002`, fijado al compilar. Si cambia la IP o el puerto de la API: en la
máquina de desarrollo cambia `CHARALES_API_URL` en `angular.json` (configuración `servidor`) y `connect-src` en
`deploy/servidor/.htaccess`, y vuelve a ejecutar `sh deploy/servidor/empaquetar.sh`.

## 8. Verificar

```sh
cd ~/charales/backend
sh deploy/servidor/verificar-servidor.sh    # PM2, /health, CORS, CSRF, Apache (/, rutas internas, CSP): PASS o FAIL
```

En un navegador: `http://45.80.152.66/login` → entra con el administrador de `db:admin`; recarga en una página
interna y sigue en ella. La consola del navegador no debe mostrar errores de CORS ni de CSP. Prueba de reinicio
(si se permite): `sudo reboot`, y después `pm2 status` y el script de nuevo.

## 9. Actualizar a un paquete nuevo

```sh
cd ~ && sha256sum -c charales.tar.gz.sha256
mkdir ~/charales-nuevo && tar -xzf charales.tar.gz -C ~/charales-nuevo --strip-components=1
cp -p ~/charales/backend/.env ~/charales-nuevo/backend/.env
cd ~/charales-nuevo/backend && npm install --legacy-peer-deps --no-audit --no-fund && npm run api:build
node --env-file=.env deploy/servidor/verificar-env.ts       # si pide migraciones: respaldo (§ 10) y npm run db:setup
mv ~/charales ~/charales-anterior-$(date +%F-%H%M) && mv ~/charales-nuevo ~/charales
cd ~/charales/backend && pm2 delete charales-api && pm2 start ecosystem.config.cjs && pm2 save
sudo cp -R ~/charales/dist/. /var/www/html/
```

## 10. Qué toca cada comando (nada borra datos)

| Comando                                     | Efecto                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verificar-env.ts`, `verificar-servidor.sh` | Sólo leen. El script del servidor envía un login vacío (400 antes de tocar la base) y un logout de origen ajeno (403).                                                                                                                                                                                                                 |
| `npm install`, `npm run api:build`          | Sólo `backend/node_modules` y `backend/api/.build`.                                                                                                                                                                                                                                                                                    |
| `npm run db:setup`                          | Crea la base si no existe; el esquema base **sólo en una base vacía**; se niega (sin tocar nada) si la base tiene tablas ajenas. Migraciones idempotentes: las únicas que eliminan algo retiran tablas obsoletas sin datos de negocio (`origen_conocido`, 008; semáforos `turnos_argon2*`, 010). Nunca reasigna permisos ya cambiados. |
| `npm run db:admin`                          | Inserta un administrador; se niega si el correo ya existe (nunca cambia contraseñas).                                                                                                                                                                                                                                                  |
| `pm2 start` / `delete` / `save`             | Sólo la lista de procesos de PM2.                                                                                                                                                                                                                                                                                                      |
| `cp -R dist/. /var/www/html/`               | Sobrescribe archivos con el mismo nombre: por eso el respaldo de § 7.                                                                                                                                                                                                                                                                  |

Antes de `db:setup` sobre una base **con datos**, respáldala (como administrador de MariaDB):
`mariadb-dump --single-transaction --routines --events --triggers charalesdb | gzip > ~/charalesdb-$(date +%F).sql.gz`.

## 11. Seguridad de esta variante

- Sin HTTPS, la contraseña y la cookie de sesión viajan sin cifrar. La API lo avisa al arrancar. Aceptable sólo para el
  servidor del curso; para uso real, `PROCEDIMIENTO_PRODUCCION.md`.
- Siguen activos: cookie `HttpOnly; SameSite=Strict`, límite de intentos, scrypt, autorización por permiso en cada
  operación, rutas de práctica desactivadas.
- **CSRF:** otras apps en la misma IP (otros puertos) son «mismo sitio» para el navegador, así que `SameSite=Strict` no
  las frena. Por eso, con `APP_URL` definido, la API rechaza con 403 **toda** petición que no sea GET/HEAD cuyo
  `Origin` no sea exactamente el de `APP_URL` (también `Origin: null`). Los navegadores siempre envían `Origin` en un
  POST; los clientes sin navegador (curl, Postman) no lo envían y siguen funcionando. Además, los cuerpos sólo se
  aceptan como JSON y CORS sólo autoriza a `APP_URL`. Residual: un GET de otro sitio a `/auth/session` puede renovar
  la inactividad de una sesión abierta (no lee ni cambia datos).
- `backend/.env` contiene la contraseña de MariaDB: modo 600, del usuario de PM2, fuera de Git y del `.tar.gz`.
- **SQL:** todos los valores van como parámetros (`?`); los nombres de tabla y columna interpolados salen del código
  (`api/tables.ts`) y de `information_schema`, nunca de la petición. Cuerpos limitados a 10 kB (200 kB en `/api/rpc`).
- **Residuales aceptados en esta variante:** la API queda expuesta directamente en `:3002`, sin proxy que limite
  peticiones (el límite de intentos de login y de recuperación es de la propia API, en MariaDB); `/health` responde
  públicamente si la base está accesible (no da otros datos); Apache anuncia su versión salvo que el administrador
  ponga `ServerTokens Prod` en `httpd.conf`. MariaDB nunca debe abrirse al exterior (§ 3).

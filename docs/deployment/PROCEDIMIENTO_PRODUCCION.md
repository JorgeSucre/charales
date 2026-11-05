# Procedimiento de producción — Charales

**Estado:** este procedimiento **nunca se ha ejecutado**. Charales no está desplegado y no existe un servidor de referencia. Las plantillas de [`deploy/`](../../deploy) son propuestas. Lo marcado «Probado localmente» se ejecutó en una máquina de desarrollo con bases temporales; nada se ha verificado en un entorno de producción.

Antes de usarlo, lee el dictamen vigente en [`AUDITORIA_FINAL_CIERRE_2026.md`](../audits/AUDITORIA_FINAL_CIERRE_2026.md).

| Control                                         | Estado                                            |
| ----------------------------------------------- | ------------------------------------------------- |
| Validación de la configuración al arrancar      | Probado localmente                                |
| Cabeceras y CSP en la app                       | Probado localmente, en Chrome (E2E)               |
| Reglas del proxy (nginx, TLS, `limit_req`)      | Preparado; sin `nginx -t` ni servidor             |
| Servicio systemd                                | Preparado; sin probar                             |
| Cuentas separadas de MariaDB                    | Preparado; sin probar                             |
| Migraciones sobre una copia con datos ficticios | Probado localmente                                |
| Migraciones sobre datos reales                  | Pendiente                                         |
| Respaldo cifrado y restauración                 | Probado localmente                                |
| Programación, rotación y copia externa          | Preparado; sin probar                             |
| Correo real (Resend)                            | Implementado contra un simulador; sin probar real |
| Protección de `main` y CI en GitHub             | Preparado; requiere autorización y ejecución      |

## 1. Requisitos

**Decisiones y recursos que el repositorio no puede resolver:**

| Requisito                                                   | Responsable | Estado    |
| ----------------------------------------------------------- | ----------- | --------- |
| Servidor, dominio y certificado TLS                         | No consta   | Pendiente |
| Cuenta de Resend, dominio verificado (SPF, DKIM), clave     | No consta   | Pendiente |
| Lugar externo y cifrado para los respaldos                  | No consta   | Pendiente |
| Revisión de privacidad y retención de datos de menores      | No consta   | Pendiente |
| Longitud mínima de contraseña (hoy 8, decisión de producto) | No consta   | Pendiente |

**Software:** Node 24.15+ o 26, MariaDB 10.6+ (probado en 13.0.2; CI configurada con 11.8, sin ejecutar), nginx u otro proxy con TLS.

**Dimensionamiento:** unos 19 MiB por operación de Argon2id, multiplicados por `ARGON2_MAX_CONCURRENT` y por el número de procesos, más 100–150 MiB de Node por proceso, más MariaDB. **No se ha medido bajo carga real.**

## 2. Separación de entornos

| Entorno    | `NODE_ENV`   | Correo                  | Base                               | Datos                                                          |
| ---------- | ------------ | ----------------------- | ---------------------------------- | -------------------------------------------------------------- |
| Desarrollo | sin definir  | `MAIL_CONSOLE=true`     | `escuela_futbol` local             | Ficticios (`--demo`)                                           |
| Pruebas    | sin definir  | Simulado en las pruebas | `ef_*`, nombre único por ejecución | Ficticios                                                      |
| Producción | `production` | `MAIL_PROVIDER=resend`  | La de producción                   | Reales. **Nunca** `--demo`, `--dev-seed` ni `020_dev_seed.sql` |

## 3. Preparar el servidor (una vez)

1. Crea un usuario de sistema sin acceso interactivo: `useradd --system --home /srv/charales charales`.
2. Aplica `deploy/mariadb/cuentas.sql`, después de cambiar las contraseñas, como administrador del servidor. La cuenta `charales_app` no tiene privilegios de esquema. **Pendiente de verificar:** ejecuta las pruebas de humo (§ 6) con esa cuenta antes de darla por buena.
3. Configura MariaDB:
   - `event_scheduler=ON`, para el trabajo diario de VENCIDO. Compruébalo con `SELECT @@event_scheduler;`.
   - `bind-address=127.0.0.1`, si la API está en la misma máquina.
   - Zona horaria de la escuela (`America/Mexico_City`), también en el proceso de la API.
4. Copia `deploy/env.production.example` a `/etc/charales/api.env`, modo 640, dueño `root:charales`, y complétalo. **Nunca** en Git. Usa una IP o rango real del proxy en `TRUSTED_PROXIES`: no inventes valores. Si hay un balanceador delante de nginx, añádelo, porque la API busca de derecha a izquierda el primer salto que no sea de confianza.
5. Instala `deploy/systemd/charales-api.service`.
6. Instala `deploy/nginx/charales.conf` y copia `deploy/nginx/security-headers.conf` a `/etc/nginx/snippets/charales-security-headers.conf`. Ajusta el dominio y los certificados, y ejecuta `nginx -t`.
7. Cierra el puerto de la API y de MariaDB en el cortafuegos: sólo 80 y 443 hacia Internet.

## 4. Antes de cada despliegue

1. La CI de la PR está en verde y `main` tiene la versión que se va a desplegar.
2. **Respaldo** inmediato, con prueba de que se puede abrir (§ 8).
3. Anota el SHA actual: es el destino de una marcha atrás.
4. Lee las migraciones nuevas. ¿Son aditivas? Todas las de 001 a 007 lo son.

## 5. Desplegar

En una máquina de compilación o en el servidor, sin datos reales:

```sh
git clone --branch main <repositorio> /srv/charales/releases/<sha>
cd /srv/charales/releases/<sha>
npm ci --no-audit --no-fund
npm run build                 # dist/project/browser
npm run api:build             # api/.build/domain.mjs: necesita esbuild, dependencia de desarrollo
npm prune --omit=dev          # lo que no hace falta en ejecución
```

**Migraciones,** con la cuenta `charales_admin` y después del respaldo. Son idempotentes y `migrate.sh` ejecuta toda la secuencia:

```sh
DB_NAME=escuela_futbol sh db/mariadb/scripts/migrate.sh
```

> **No** ejecutes `docs/escuela_futbol_mariadb.sql` sobre una base con datos: borra sus tablas. Sólo sirve para una base nueva.

**Primer administrador,** sólo la primera vez: `npm run db:admin`.

**Activar:**

```sh
ln -sfn /srv/charales/releases/<sha> /srv/charales/current
systemctl restart charales-api
systemctl reload nginx
```

La API se niega a arrancar, y lo dice en el log, si la configuración es peligrosa o falta una migración.

## 6. Validar

Con `curl -i https://escuela.example` y un navegador:

- [ ] `journalctl -u charales-api` muestra `Charales API en…`, sin avisos inesperados.
- [ ] `curl -s http://127.0.0.1:3000/health` → `{"status":"ok","database":"ok"}`, y desde fuera `/health` responde 403.
- [ ] HTTP redirige a HTTPS.
- [ ] La página lleva `Content-Security-Policy`, `Strict-Transport-Security` y `X-Frame-Options`, y la consola del navegador no muestra bloqueos.
- [ ] Al iniciar sesión, la cookie lleva `Secure; HttpOnly; SameSite=Strict`.
- [ ] `GET /api/jugadores` → 404.
- [ ] **IP real:** un inicio de sesión registra en `auditoria.ip` la dirección del cliente, no la del proxy.
- [ ] **Límite por cliente:** con una cuenta de prueba, 6 contraseñas incorrectas seguidas → la sexta recibe 429, y desde otra conexión la cuenta entra.
- [ ] **Correo real:** una recuperación y una invitación llegan a un buzón de prueba autorizado y el enlace funciona. Comprueba `SELECT estado, proveedor_id FROM correo_saliente ORDER BY id DESC LIMIT 5;`.
- [ ] Una lectura y una escritura de negocio con una cuenta de prueba.

## 7. Monitoreo

La API registra en la salida estándar; el servidor los recoge con `journald`. No se registran contraseñas, tokens ni parámetros de SQL.

| Vigilar                                               | Por qué                                       |
| ----------------------------------------------------- | --------------------------------------------- |
| `/health` desde la propia máquina, cada minuto        | Caída de la API o de la base                  |
| Log: `Límite por cuenta alcanzado`                    | Posible ataque distribuido                    |
| Log: `Llegó X-Forwarded-For…`                         | Proxy mal configurado                         |
| Log: `Correo …: no enviado (…)`                       | Proveedor caído o clave incorrecta            |
| `correo_saliente` con `estado = 'FALLIDO'`            | Mensajes que no se entregarán: revisar a mano |
| `SELECT LAST_EXECUTED FROM information_schema.EVENTS` | El trabajo diario sigue corriendo             |
| Antigüedad del último respaldo y espacio en disco     | Respaldos en silencio rotos                   |

`FALLIDO` con `HTTP_401` o `HTTP_403` suele ser la clave o el dominio. Quien no recibió una invitación puede pedir un enlace nuevo con «¿Olvidaste tu contraseña?».

## 8. Respaldos y retención

Programa `deploy/mariadb/respaldo-programado.sh` a diario, con la cuenta `charales_backup` y la clave **pública** de GPG en el servidor. La clave privada **no** se guarda ahí. Retención: 7 diarios, 4 semanales y 12 mensuales. Copia el directorio fuera del servidor.

```sh
BACKUP_GPG_RECIPIENT=respaldos@escuela.example \
  sh deploy/mariadb/respaldo-programado.sh escuela_futbol /var/backups/charales
```

**Ensayo de restauración, al menos cada trimestre y antes de la primera salida,** siempre en una base nueva:

```sh
gpg --decrypt respaldo.sql.gz.gpg > respaldo.sql.gz
sh db/mariadb/scripts/restore.sh respaldo.sql.gz escuela_futbol_ensayo   # se niega si la base ya existe
sh db/mariadb/scripts/verify-backup.sh escuela_futbol escuela_futbol_ensayo
```

Un respaldo contiene datos de personas, también de menores. Nunca en el repositorio: `backups/` y `*.sql.gz` están en `.gitignore`, y `scripts/check-sensitive-files.sh` lo comprueba en CI.

## 9. Marcha atrás

**Sólo código, si las migraciones nuevas son aditivas (hoy, todas):**

```sh
ln -sfn /srv/charales/releases/<sha-anterior> /srv/charales/current
systemctl restart charales-api
```

La versión anterior ignora las tablas y ámbitos nuevos. **Una API anterior a la 007** no entrega los correos pendientes de `correo_saliente`, y sus límites de recuperación vuelven a estar en memoria.

**Con pérdida de datos,** sólo si los datos están dañados y con decisión expresa de quien sea responsable: detén la API, restaura el último respaldo en una base nueva, verifícala, apunta `DB_NAME` a ella y arranca. Lo escrito después de ese respaldo se pierde.

**No hay migraciones de bajada.** Cada archivo indica en su cabecera cómo revertirse, pero **no elimines `turnos_argon2` ni `turnos_argon2_guarda`** (006) hasta confirmar el estado de todos los entornos.

## 10. Recuperación ante fallos

| Síntoma                                     | Causa probable                             | Qué hacer                                                        |
| ------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| La API no arranca: `Error de configuración` | Variable obligatoria incorrecta            | Corrige `/etc/charales/api.env`; el log dice cuál                |
| La API no arranca: `La base no está al día` | Falta una migración                        | Respaldo y `migrate.sh`                                          |
| Todos reciben 429 al entrar                 | `TRUSTED_PROXIES` no incluye al proxy      | Revisa la IP real del proxy y el log `Llegó X-Forwarded-For`     |
| Una cuenta recibe 429 desde una red nueva   | Ataque o muchos fallos (límite por cuenta) | Esperar 15 min o recuperar la contraseña por correo              |
| Login 503                                   | MariaDB o el pool del limitador            | `/health`, estado de MariaDB; el login falla cerrado a propósito |
| 503 «El servicio está ocupado»              | Semáforo de Argon2id saturado              | Tráfico anómalo; ajusta `limit_req` o el dimensionamiento        |
| Invitaciones o recuperación 503             | `MAIL_PROVIDER=none`                       | Configura el proveedor                                           |
| Correos en `PENDIENTE` sin salir            | Proveedor caído                            | Se reintentan solos, hasta 8 veces o hasta su vencimiento        |

## 11. Protección de GitHub

Requiere autorización de quien administre el repositorio. No se ha aplicado.

```sh
gh api -X PUT repos/JorgeSucre/charales/branches/main/protection \
  --input deploy/github/branch-protection-main.json
```

Hazlo después de la primera ejecución verde de la CI: los nombres de `contexts` deben coincidir con los de los jobs.

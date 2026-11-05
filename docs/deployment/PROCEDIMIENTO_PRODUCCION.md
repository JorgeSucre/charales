# Procedimiento de producción — Charales

**Estado:** este procedimiento **nunca se ha ejecutado**. Charales no está desplegado y no existe un servidor de referencia. Las plantillas de [`deploy/`](../../deploy) son propuestas. Lo marcado «Probado localmente» se ejecutó en una máquina de desarrollo con bases temporales; nada se ha verificado en un entorno de producción.

Antes de usarlo, lee el dictamen vigente en [`CIERRE_FINAL_REMEDIACION_2026.md`](../audits/CIERRE_FINAL_REMEDIACION_2026.md).

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

**Software:** Node 24.15+ o 26, MariaDB 10.6+ (probado en 13.0.2; CI configurada con 11.8, sin ejecutar), nginx 1.25.1+ u otro proxy con TLS.

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
4. Copia `deploy/env.production.example` a `/etc/charales/api.env`, modo 640, dueño `root:charales`, y complétalo. **Nunca** en Git. Usa una IP o rango real del proxy en `TRUSTED_PROXIES`: no inventes valores. Si hay un balanceador delante de nginx, añádelo: la API busca de derecha a izquierda el primer salto que no sea de confianza, y la plantilla de nginx añade el cliente a `X-Forwarded-For` sin perder los anteriores. En ese caso activa también `real_ip` en nginx (ver la plantilla), o sus límites agruparán a todos. Un rango amplio en `TRUSTED_PROXIES` permite a quien esté dentro elegir su IP: usa sólo las direcciones del proxy.
5. Instala `deploy/systemd/charales-api.service`.
6. Instala `deploy/nginx/charales.conf` y copia `deploy/nginx/security-headers.conf` a `/etc/nginx/snippets/charales-security-headers.conf`. Ajusta el dominio y los certificados, y ejecuta `nginx -t`.
7. Cierra el puerto de la API y de MariaDB en el cortafuegos: sólo 80 y 443 hacia Internet.

## 4. Antes de cada despliegue

1. La CI de la PR está en verde y `main` tiene la versión que se va a desplegar.
2. **Respaldo** inmediato, con prueba de que se puede abrir (§ 8).
3. Anota el SHA actual: es el destino de una marcha atrás.
4. Lee las migraciones nuevas. ¿Son aditivas? De 001 a 007 lo son; 008 retira `origen_conocido`, que sólo creó 007 y nadie usa.

## 5. Desplegar

En una máquina de compilación o en el servidor, sin datos reales:

```sh
git clone --branch main <repositorio> /srv/charales/releases/<sha>
cd /srv/charales/releases/<sha>
npm ci --no-audit --no-fund
npm run build                 # dist/project/browser
npm run api:build             # api/.build/domain.mjs: necesita esbuild, dependencia de desarrollo
```

**Prepara la base antes de retirar las dependencias de desarrollo,** con la cuenta `charales_admin` y después del respaldo:

```sh
# Instalación nueva: crea el esquema, las migraciones y los permisos. Base con datos: sólo aplica lo que falte.
DB_USER=charales_admin DB_PASSWORD=<…> DB_NAME=escuela_futbol npm run db:setup
# Sólo la primera vez:
DB_USER=charales_admin DB_PASSWORD=<…> DB_NAME=escuela_futbol npm run db:admin
npm prune --omit=dev          # lo que no hace falta en ejecución
```

> **No** ejecutes `docs/escuela_futbol_mariadb.sql` sobre una base con datos: borra sus tablas.

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

### Retención de datos de correo

La API aplica la retención de `correo_saliente` al arrancar y cada hora (`docs/API.md`). Para una base sin API, o tras cambiar `CORREO_RETENCION_DIAS`:

```sh
node --env-file=/etc/charales/api.env api/mail-purge.ts   # por lotes; repetir o interrumpir es seguro
```

Comprobar: `SELECT estado, COUNT(*), SUM(destinatario IS NOT NULL) FROM correo_saliente GROUP BY estado;`. Fija la retención de los respaldos y de `sesiones` y `auditoria` en la misma política: **esta purga no les alcanza.**

### Navegadores de confianza

Revocar los de una cuenta, por ejemplo si se pierde un teléfono: `DELETE FROM dispositivo_confiable WHERE usuario_id = ?;`. Un cambio o una recuperación de contraseña, desactivar la cuenta o cambiar su correo ya lo hacen.

### Acceso sin correo

Si alguien no puede entrar y no hay correo disponible, quien administra el servidor puede generar un enlace de 60 minutos, tras confirmar la identidad de quien lo pide y para entregarlo por otro canal. Queda en `auditoria`:

```sh
node --env-file=/etc/charales/api.env api/access-link.ts <correo>
```

## 9. Marcha atrás

**Sólo código, si las migraciones nuevas son aditivas (hoy, todas):**

```sh
ln -sfn /srv/charales/releases/<sha-anterior> /srv/charales/current
systemctl restart charales-api
```

La versión anterior ignora las tablas y ámbitos nuevos. **Una API anterior a la 007** no entrega los correos pendientes de `correo_saliente`, y sus límites de recuperación vuelven a estar en memoria. Una API de la 007 no puede volver sobre una base con 008, porque usa `origen_conocido`; pero 007 nunca salió de la rama de remediación.

**Con pérdida de datos,** sólo si los datos están dañados y con decisión expresa de quien sea responsable: detén la API, restaura el último respaldo en una base nueva, verifícala, apunta `DB_NAME` a ella y arranca. Lo escrito después de ese respaldo se pierde.

**No hay migraciones de bajada.** Cada archivo indica en su cabecera cómo revertirse, pero **no elimines `turnos_argon2` ni `turnos_argon2_guarda`** (006) hasta confirmar el estado de todos los entornos.

## 10. Recuperación ante fallos

| Síntoma                                        | Causa probable                             | Qué hacer                                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| La API no arranca: `Error de configuración`    | Variable obligatoria incorrecta            | Corrige `/etc/charales/api.env`; el log dice cuál                                                                                                                |
| La API no arranca: `La base no está al día`    | Falta una migración                        | Respaldo y `migrate.sh`                                                                                                                                          |
| Todos reciben 429 al entrar                    | `TRUSTED_PROXIES` no incluye al proxy      | Revisa la IP real del proxy y el log `Llegó X-Forwarded-For`                                                                                                     |
| Una cuenta recibe 429 desde un navegador nuevo | Ataque o muchos fallos (límite por cuenta) | Desde un navegador donde ya entró funciona. Si no: recuperar la contraseña por correo, o `access-link.ts` (§ 8). Tras un despliegue, todos son «navegador nuevo» |
| Login 503                                      | MariaDB o el pool del limitador            | `/health`, estado de MariaDB; el login falla cerrado a propósito                                                                                                 |
| 503 «El servicio está ocupado»                 | Semáforo de Argon2id saturado              | Tráfico anómalo; ajusta `limit_req` o el dimensionamiento                                                                                                        |
| Invitaciones o recuperación 503                | `MAIL_PROVIDER=none`                       | Configura el proveedor                                                                                                                                           |
| Correos en `PENDIENTE` sin salir               | Proveedor caído                            | Se reintentan solos, hasta 8 veces o hasta su vencimiento                                                                                                        |

## 11. Protección de GitHub

Requiere autorización de quien administre el repositorio. No se ha aplicado.

```sh
gh api -X PUT repos/JorgeSucre/charales/branches/main/protection \
  --input deploy/github/branch-protection-main.json
```

Hazlo después de la primera ejecución verde de la CI: los nombres de `contexts` deben coincidir con los de los jobs.

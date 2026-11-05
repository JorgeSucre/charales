# Auditoría de seguridad independiente 1 — Charales

## 1. Datos

- SHA revisado: `f8e26ec14b7ca56ed70edba99bb2d9ae32327bff` (HEAD detached, copia `charales-wt/auditoria-independiente`).
- Base: `9e08b111cc4180ebab89d56f5e99510c42f6e2cf`. Entrega: 12 commits, 86 archivos.
- Fecha: 2026-11-05. Entorno: macOS, Node 26.13.0, MariaDB 13.0.2.
- El repositorio no se modificó: `git status --short` da 0 líneas al terminar y HEAD sigue igual.

Marcas de evidencia usadas en todo el informe:

- **[E]** demostrado por ejecución.
- **[L]** deducido por lectura de código, sin ejecutar.
- **[NC]** no comprobado.

## 2. Dictamen independiente

**Integración en la rama `main` local: APTA CON CONDICIONES.** No encontré ningún defecto crítico y la entrega deja el sistema mejor que la base: R-1, S-03 y N-06 funcionan de verdad. Pongo dos condiciones antes de integrar:

1. Corregir como mínimo el reintento hacia la dirección antigua de IND-01. Es la única parte de severidad alta que introduce la propia entrega, y su arreglo es pequeño.
2. Actualizar los informes de cierre (IND-14). Hoy declaran un código que ya no es el entregado, y el commit `f8e26ec`, el más sensible, no tiene auditoría registrada.

El resto puede registrarse como trabajo pendiente.

**Producción: NO APTA.** Coincido con el equipo en sus motivos: no hay servidor, ni TLS probado, ni correo real, ni CI ejecutada. Añado los que no declara:

- IND-01, IND-02, IND-03, IND-04 e IND-06.
- La cuenta `charales_backup` genera respaldos incompletos (IND-07).
- No hay política de datos de menores (F5-25).

Recuento de hallazgos nuevos:

| Severidad | N |
| --- | --- |
| CRÍTICO | 0 |
| ALTO | 1 |
| MEDIO | 5 |
| BAJO | 8 |
| INFORMATIVO | 1 |

## 3. Alcance y archivos revisados

Leídos por completo:

- `api/login-limit.ts`, `api/device-trust.ts`, `api/password.ts`, `api/auth.ts`, `api/mail.ts`, `api/mail-purge.ts`
- `api/server.ts`, `api/rpc.ts`, `api/client-ip.ts`, `api/config.ts`, `api/argon2-guard.ts`, `api/schema.ts`, `api/setup.ts`
- Migraciones 007 y 008
- `deploy/*`, `.github/workflows/ci.yml`, `scripts/check-sensitive-files.sh`
- `db/mariadb/scripts/{backup,migrate}.sh`
- `docs/deployment/PROCEDIMIENTO_PRODUCCION.md`
- El plan, el informe y la auditoría final de 2026
- El diff completo de `src/` y de las pruebas existentes

Leídos en parte:

- `docs/API.md`
- `user.service.ts`, `training.service.ts`, `attendance.service.ts`
- `rpc-methods.ts`
- La lista de pruebas de `dispositivo`, `retencion-correo`, `r1-distribuido`, `correo-saliente`, `recuperacion-limites`, `endurecimiento`, `authorization-order` y `client-ip`

No revisé los 49 HU funcionales ni el resto de los servicios de dominio.

## 4. Metodología y resultados reales

Conexión: `DB_SOCKET=/tmp/mysql.sock DB_USER=$(whoami)`, sin `.env`.

| Comando | Resultado |
| --- | --- |
| `npm run api:typecheck` | OK (exit 0) |
| `npm run build` | OK (exit 0) |
| `npm run api:test` | 368/368, 0 fallos, 56 s |
| `npx ng test --watch=false` | 251/251 |
| `npm run e2e` | 23/23 |
| `npm run db:mariadb:test-backup` | exit 0 |
| `npx prettier --check .` | OK |
| `sh scripts/check-sensitive-files.sh` | OK |
| `git diff --check 9e08b11 f8e26ec` | OK |
| `npm ci --dry-run --offline` | sin error |
| YAML de `ci.yml` | se analiza bien; jobs: Calidad, API y Angular, E2E |

No ejecutado:

- `npm audit`: envía datos a un servicio externo, prohibido en este encargo. **F5-20 y S-04 quedan [NC]**; solo comprobé las versiones instaladas (Angular 22.2.4, CLI 22.2.6).
- `nginx -t` y systemd: no están disponibles en esta máquina.
- `actionlint`: no está instalado.
- La CI en GitHub y MariaDB 11.8.

Sondeos propios, en `cierre/indep/` y fuera del repositorio:

- `p1`: límites y cookies.
- `p2`: carreras, red compartida, correo, tokens, oráculo.
- `p3`: recarga con reloj simulado y `TZ=Asia/Tokyo` en el arranque.
- `p4`: dos procesos reales de la API.
- `p5`: migraciones.
- `p6` y `p7`: cuentas de `cuentas.sql` en una instancia MariaDB privada (datadir y puerto propios, ya detenida), API en modo producción y simulador local de Resend.
- `p8`: tiempos.
- `p9`: `checkEnvironment`.
- `p10`: S-03 por rol y marcha atrás de la API de `9e08b11` sobre una base con 008.
- `mut`: 25 mutaciones sobre una copia desechable de `api/`.

## 5. Estados declarados por el equipo

### Ciertos, comprobados

| ID | Comprobación |
| --- | --- |
| F5-03 (R-1) | [E] 80 intentos concurrentes, 2 procesos, 80 IP: 10×401 y 70×429. Global y atómico. **El estado es cierto, pero las cifras de los informes (20 por ventana, 1 920 al día) están obsoletas**; ver IND-14. |
| F5-04 | [E] Con `NODE_ENV=production` exacto, la falta de `TRUSTED_PROXIES` da error de arranque. Valor configurado: una IP no elige su dirección con XFF (mutación detectada). |
| F5-06, F5-17 | [E] Pruebas en verde. [L] `SchemaError` da 500 genérico. |
| F5-07 | [E] 7 solicitudes desde 1 IP: 5×204 y 2×429. Sin `Map` por solicitud [L]. |
| F5-08 | [E] Con proveedor caído: 200, `mailPending: true`, operación confirmada, reintento. **Defecto en el reintento: IND-01.** |
| F5-09 | [E] La comprobación pasa. Git ignora lo indicado. Respaldo: ver IND-06 e IND-07. |
| F5-10 | [E] Prueba en verde; mutación detectada. Límite: es por sesión, no por cuenta (IND-15). |
| F5-14 (S-03) | [E] Entrenador y tutor: 403 con cuerpo idéntico para sesión foránea y sesión inexistente, en `get`, `saveNotes`, `setStatus` y `record`. Secretaría sí distingue, pero puede leer todas las sesiones: es legítimo. **Correcto.** |
| F5-16 | [E] Pruebas en verde. [L] Lista corta, igual en API y app. |
| F5-18 | [E] Producción: `/api/jugadores` → 404. `demo1234`: 0 archivos en `dist`. `@example.com` en 1 chunk, que es lo que declara N-07. |
| F5-19 | [E] `reset.sh ef_indep_no_existe` se niega con exit 1. |
| F5-22, N-03 | [E] Pruebas en verde; mutación del /64 detectada. |
| N-01 | [L] Sin borrado previo y con sufijo aleatorio. Las bases `ef_*` solo se borran en `after`. |
| N-04 | [E] 23/23 E2E con la CSP del archivo real de nginx. |
| N-05, N-07 | Coherentes con lo declarado [L]. |
| S-01 | [E] Límites en MariaDB, atómicos entre procesos. La memoria de rechazos solo puede rechazar, nunca admitir [L]. |
| S-02 | [L] Todo Argon2id de peticiones pasa por el semáforo. Es por proceso y así se documenta. |

### No ciertos o inexactos

| Declaración | Realidad |
| --- | --- |
| Plan: «Código verificado `42ba617`; lo posterior sólo añade estos informes» | **Falso.** `f8e26ec` reescribe el presupuesto por cuenta, añade `device-trust.ts`, la retención y la migración 008. |
| N-06 «Pendiente» y «Sigue abierto N-06» | **Desactualizado.** Está implementado y funciona [E]. Debe pasar a Verificado, con la limitación de que no alcanza a `auditoria`, `sesiones` ni respaldos. |
| F5-12 «Verificado» | **Parcial.** Solo vale con el valor exacto `production`, y la propia plantilla entregada no lo produce bajo systemd (IND-04). |
| N-02 «Verificado: 5» | **Incompleto.** Son 5 por ventana de 15 min, unos 480 correos al día por cuenta (IND-12). |
| F5-13 «Bloqueado, sin ejecutar» | **Avancé la comprobación en una instancia privada.** `charales_admin` aplica todo y `charales_app` pasa una prueba de humo real: login, RPC, alta, correo, recuperación y cambio de contraseña. `charales_backup` **sí falla en silencio** en parte (IND-07). No es una prueba completa de la API. |
| F5-15 «2,33 / 2,32 ms» | **No reproducido con igualdad.** Medí 1,37–1,43 ms frente a 1,10–1,17 ms, n=40, dos rondas [E]. No concluyo que sea explotable: el trabajo en segundo plano del intento anterior puede explicar esos 0,25 ms y a través de Internet no se distinguirían. Lo dejo como riesgo residual. |

### Sin comprobación propia

- F5-01, F5-02, F5-05, F5-11 (bloqueados): el motivo es cierto [L]. El transporte de correo funciona contra un simulador local [E].
- F5-20: [NC].
- F5-21: `PaymentsGatewayService` no aparece en `rpc-methods.ts` (`grep`) [E].
- F5-23, F5-24, F5-25, N-08: sin objeción. F5-24 y N-08 no los verifiqué.

## 6. Hallazgos nuevos

### IND-01 · ALTO · El cambio de correo no revoca los accesos y el trabajador envía uno nuevo a la dirección antigua

Archivos:

- `api/mail.ts:254` (usa `row.destinatario`) y `api/mail.ts:269-318` (`reissue`).
- `src/app/features/users/user.service.ts:70-104` (`save` no toca tokens ni cola).

Reproducción [E, `p2.mjs`]:

1. Un administrador da de alta una cuenta con una dirección equivocada, con el proveedor caído: 200, `mailPending`.
2. Corrige la dirección: 200.
3. El trabajador procesa la cola y envía **un token nuevo y válido a `error.tipografico@example.org`**.
4. Con ese enlace se fija la contraseña: 204, y además emite una cookie de navegador de confianza.
5. Se entra a la cuenta con el correo nuevo: 200.

Variante sin proveedor caído: la invitación ya entregada a la dirección equivocada sigue valiendo tras corregirla: 204.

Impacto: toma de una cuenta con el rol que le dieran, incluido Administrador, por quien controle la dirección que el administrador creía retirada. Lo mismo vale al cambiar el correo porque el buzón anterior se vio comprometido: los enlaces de recuperación vivos (60 min) y sus reintentos siguen llegando allí. Para entrar después hace falta conocer el correo nuevo. El titular legítimo, además, pierde el control de su contraseña.

Origen: el reintento hacia la dirección antigua lo introduce la entrega. El token que no se revoca es anterior (`user.service.ts` no cambió).

Recomendación:

- En `reissue`, leer `usuarios.email` y cerrar la fila si difiere de `destinatario`.
- En `UserService.save`, si cambia el correo: revocar los tokens vivos en la misma transacción, cerrar las filas pendientes, emitir la invitación a la dirección nueva y cerrar sesiones.
- Añadir la prueba correspondiente: hoy no existe.

### IND-02 · MEDIO · Un inicio de sesión en curso sobrevive a la recuperación de contraseña

Archivos: `api/auth.ts:119` (lee la fila), `:126` (verifica), `:151` (emite el navegador) y `:156` (inserta la sesión). No se vuelve a comprobar nada frente a `api/password.ts:250-275`.

Reproducción [E, `p2.mjs`, 8 rondas]: un atacante con la contraseña robada mantiene logins solapados (uno cada 15 ms, sin proxy) mientras el dueño confirma la recuperación. **En 8/8 rondas quedó una sesión del atacante válida** por `GET /auth/session` (1 o 2 sesiones) **y un navegador de confianza nuevo** emitido con la contraseña antigua.

Impacto: la recuperación o el cambio de contraseña, que según D8 cierra todas las sesiones, no expulsa a un intruso activo. Conserva acceso a datos de menores hasta 8 h (30 min sin uso). La ventana va de la lectura de la fila al `INSERT`, y puede crecer hasta 2 s si el semáforo Argon2id está en cola, porque la fila se lee antes.

Matiz: con el `limit_req` de la plantilla (30/min por IP) un solo origen acierta con mucha menos frecuencia; varias IP lo compensan. No medí esto detrás de nginx. [L] El cambio de contraseña sigue el mismo flujo.

Origen: la parte de la sesión ya existía en `9e08b11` (misma secuencia). La emisión del navegador tras la revocación la añade la entrega.

Recomendación: crear la sesión y el navegador en una transacción que bloquee `usuarios` y compruebe que `password_hash` y `activo` no han cambiado desde la verificación; si cambiaron, responder 401.

### IND-03 · MEDIO · Un solo origen bloquea indefinidamente a cualquier cuenta fuera de sus navegadores conocidos, y también su vía de escape

Archivos: `api/login-limit.ts:92-98`, `:213-226`.

Reproducción [E, `p1.mjs`]:

- 2 IP × 5 fallos (o una sola IP en 30 min): el dueño con contraseña correcta, en navegador nuevo y otra IP, recibe 429.
- Cada vez que se recarga un intento, **una sola solicitud del atacante lo retoma**: tres ciclos seguidos, atacante 401 y dueño 429. Cuesta 2 solicitudes por hora.
- 5 solicitudes de recuperación desde 1 IP: el dueño recibe **429 también en la recuperación**. Se repite cada 15 min.

Impacto:

- El equipo documenta el «precio» por separado, pero subestima la suma. «Esperar a un hueco» o «competir por él» no funciona frente a un atacante que sondea, y la vía de recuperación también se agota con coste mínimo.
- El propio atacante hace llegar enlaces a la víctima. El último enlace sirve, pero la víctima no controla cuándo llega y el siguiente lo revoca.
- **Sin correo real en producción, la vía no existe**, como declara `docs/API.md`.
- Tras el despliegue `dispositivo_confiable` está vacía: **todos los usuarios son «navegador nuevo»** hasta su primer login. También les pasa a quienes borran cookies, llevan más de 90 días sin entrar o cambian de equipo; por ejemplo, padres que entran poco.
- Con una IP (50 intentos por 15 min) se sostiene el bloqueo de login de decenas de cuentas (unas 100 por cálculo [L]).

La afirmación de que «nunca bloquea para siempre» solo es cierta si el atacante se detiene.

No debilita la contraseña: con el límite agotado no se verifica nada (429 sin Argon2id, según la prueba del equipo, que ejecuté en verde).

Recomendación: decidirlo como riesgo aceptado por el responsable, con estos datos. Técnicamente:

- Un enlace de desbloqueo por correo que no cuente en `RECUP_CUENTA`.
- Limitar el consumo de `CUENTA` por red: por ejemplo, una red que ya agotó su `CUENTA_IP` no vuelve a gastar presupuesto hasta pasado un tiempo.
- Alertas.
- Un procedimiento manual de desbloqueo por el administrador.

### IND-04 · MEDIO · La plantilla de producción bajo systemd deja la API en modo desarrollo, sin ningún control de arranque

Archivos: `deploy/env.production.example:3` (`NODE_ENV=production                    # obligatorio`), `deploy/systemd/charales-api.service` (`EnvironmentFile`), `api/config.ts:14` (`isProduction` por igualdad exacta).

Demostrado [E, `p7.mjs`, `p9.mjs`] arrancando la API con ese valor literal:

- Arranca con 0 errores.
- La cookie de sesión no lleva `Secure`.
- `/api/jugadores` responde 200.
- No se exige `TRUSTED_PROXIES`, `APP_URL` ni `MAIL_PROVIDER`.
- Igual con `Production`, `prod` o `production ` con espacio.

Deducido [L]: el analizador de `EnvironmentFile` de systemd solo reconoce comentarios a principio de línea, de modo que el valor incluye el comentario. **No pude ejecutarlo: no hay systemd aquí.** `node --env-file` sí lo quita [E], y por eso la batería local no lo ve. Conviene confirmarlo en Linux.

Atenuantes: la API escribe un aviso de «Modo desarrollo», y la lista de § 6 del procedimiento lo detectaría (`Secure`, 404). También [L] el aviso solo se ve si alguien lee el log, y la lista nunca se ha ejecutado.

Recomendación: quitar el comentario de esa línea. Además, un `NODE_ENV` con un valor definido distinto de `development` o `test` debería impedir el arranque; o invertir el criterio, con un modo seguro por defecto.

### IND-05 · MEDIO · Enumeración de cuentas invitadas pendientes por tiempo de respuesta

Archivo: `api/auth.ts:65` (`if (!m) return false`, antes de Argon2id). Las cuentas creadas por el dominio llevan un hash `sha256$…` hasta que usan su enlace.

Medido [E, `p8.mjs`, n=60, 2 rondas]:

| Login incorrecto | Mediana |
| --- | --- |
| Cuenta existente | 22,4 / 22,6 ms |
| Inexistente | 22,2 / 22,3 ms |
| **Invitada pendiente** | **3,2 / 2,2 ms** |

Impacto: un tercero confirma, a razón de 50 por 15 min por IP, qué direcciones corresponden a cuentas recién dadas de alta: personal, entrenadores y tutores de menores. Contradice «no enumeration». La diferencia de 20 ms es medible en red. Las pruebas del equipo solo comparan cuentas existentes con inexistentes, así que no lo detectan.

La comparación entre cuentas con Argon2id y cuentas inexistentes sí es correcta.

Origen: anterior a la entrega (misma línea en `9e08b11`), y no estaba reportado.

Recomendación: si el hash no tiene formato Argon2id, verificar contra `DUMMY_HASH` y devolver falso.

### IND-06 · MEDIO · Un respaldo fallido sale con éxito y la retención termina borrando los buenos

Archivos: `db/mariadb/scripts/backup.sh:11-12` (tubería sin comprobar el código de `mariadb-dump`), `deploy/mariadb/respaldo-programado.sh`.

Reproducción [E]: con credenciales rechazadas, `mariadb-dump` da 1045, **`backup.sh` termina con exit 0 e imprime la ruta**, y el `.sql.gz` pesa 20 bytes (0 bytes al descomprimir), con `gzip -t` correcto. [L] `respaldo-programado.sh` lo cifraría, lo rotaría e imprimiría éxito.

Impacto: tras 8 días de fallo no queda ningún diario válido (`-mtime +7 -delete`), y luego tampoco semanales ni mensuales. Son los «respaldos en silencio rotos» que el procedimiento pide vigilar por antigüedad, y la antigüedad parecería correcta.

Origen: la línea es anterior; la dependencia del programador la añade la entrega.

Recomendación: volcar a un archivo temporal comprobando el código, exigir el marcador `-- Dump completed` y un tamaño mínimo, y no ejecutar la rotación si falla.

### IND-07 · BAJO · `charales_backup` genera respaldos sin el procedimiento almacenado

Archivos: `deploy/mariadb/cuentas.sql:16`, `db/mariadb/scripts/verify-backup.sh`.

[E, `p6`] Con exactamente esos privilegios, el volcado sale con exit 0 y sin mensajes, contiene el `EVENT` y 45 tablas, pero **no `marcar_cargos_vencidos`**. Una vez restaurado: el evento existe y el procedimiento no. El trabajo diario de VENCIDO fallaría en la base restaurada. `verify-backup.sh` solo compara tablas y `test-backup-restore.sh` corre con una cuenta con más privilegios, así que nada lo detecta.

Impacto limitado: la app recalcula esos cargos en la cobranza [según el aviso de `api/setup.ts`, sin comprobación propia].

Recomendación: añadir `SELECT ON mysql.proc` o el privilegio equivalente de la versión, y comparar también rutinas y eventos en la verificación.

### IND-08 · BAJO · El navegador de confianza no se revoca al desactivar ni al cambiar el correo

Archivos: `api/device-trust.ts:31-39` y `:97`, `src/app/features/users/user.service.ts:132-150`.

[E, `p1.mjs`]:

- Tras desactivar: la fila sigue. Tras reactivar, la cookie anterior evita el límite con el presupuesto agotado (200).
- Al cambiar el correo: la fila sigue, ligada al hash del correo antiguo.
- **Si otra cuenta toma ese correo, la cookie de la primera persona evita los límites de la segunda:** sin cookie 429; con la cookie de A y la contraseña de B, 200. La fila de A no se rota y gana un `fallos`.

Lo que no ocurre: nunca evita la contraseña, y sigue el tope de 5 errores. Además, en una cuenta desactivada la respuesta sigue siendo 401 sin `Set-Cookie` [E]. Por eso es bajo.

El equipo no lo declara: el procedimiento dice que solo revocan el cambio y la recuperación, y `docs/API.md` no menciona este caso.

Recomendación: enlazar por `usuario_id` (comprobar que el usuario encontrado es el de la fila) y revocar en `setActive(false)` y al cambiar `email`.

### IND-09 · BAJO · Un enlace vivo funciona sobre una cuenta desactivada

Archivo: `api/password.ts:250-275` (sin comprobar `activo`).

[E, `p2.mjs`] Se pide recuperación, se desactiva la cuenta y el enlace confirma: 204, cambia la contraseña y emite navegador de confianza. Tras reactivar, el exusuario entra con su contraseña: 200. Solo es explotable si la cuenta se reactiva, y durante 60 min (24 h si es invitación).

Origen: anterior, salvo la cookie.

Recomendación: comprobar `activo` en la transacción y revocar tokens en `setActive(false)`.

### IND-10 · BAJO · Otra persona en la misma red anula el navegador de confianza

Archivos: `api/login-limit.ts:202-209`, `api/dispositivo.test.ts:129` (afirma lo contrario, pero sin este caso).

[E, `p2.mjs`] Con la red agotada, el navegador válido entra (200). Una sola solicitud desde esa red con una cookie inventada y bien formada, y **el navegador válido recibe 429 durante 10 s**, sin consultar MariaDB. Es renovable sin fin y por proceso. Exige compartir IP (oficina de la escuela, CGNAT), justo el caso que se promete cubrir («en ninguna red»).

Recomendación: la memoria de cookies malas debería acortar el rechazo del mismo secreto (su hash), no el de la red entera.

### IND-11 · BAJO · Oráculo de contraseña correcta en cuentas desactivadas

Archivo: `api/auth.ts:134`.

[E, `p2.mjs`] Con 4 fallos previos desde una IP, un quinto intento con contraseña **correcta** deja el sexto en 401; con **incorrecta**, en 429. El cuerpo es idéntico, pero el contador lo revela. Sirve para confirmar credenciales de exempleados y probarlas en otros servicios.

`api/login-limit.test.ts` fija este comportamiento como deseado.

Recomendación: conservar la reserva en cuentas inactivas: no devolver nada.

### IND-12 · BAJO · El bombardeo de correo solo queda acotado por ventana

Archivos: `api/login-limit.ts:98`, N-02.

[E] 5 correos por ventana. [L] 5 cada 15 min son 480 al día por cuenta, y 20 por ventana desde una IP son 1 920 al día con cuentas existentes. Agota la cuota del proveedor, de la que dependen invitaciones y recuperación.

Recomendación: presupuesto diario por cuenta o con recarga (como `CUENTA`) y otro global.

### IND-13 · BAJO · Fallos del procedimiento y las plantillas, sin ejecutar nunca

Todo [L], salvo donde se indique:

- `docs/deployment/PROCEDIMIENTO_PRODUCCION.md:75,86`: `npm prune --omit=dev` y después `npm run db:admin`, que ejecuta `api:build` con `esbuild` ya retirado. Fallará. `db:setup` igual.
- `:81`: `migrate.sh` en una base nueva falla sin el esquema base, y no aplica `010_permisos_app.sql`. No se explica cómo preparar una instalación limpia. (`db:setup` sí funciona con `charales_admin` [E].)
- `:53` frente a `deploy/nginx/charales.conf:40`: si hay un balanceador, el procedimiento manda añadirlo a `TRUSTED_PROXIES`, pero nginx **sustituye** XFF por `$remote_addr` (el balanceador). Todos los saltos serían de confianza y la API usaría la IP del par: **todos los clientes compartirían un solo límite**, justo F5-04.
- `charales.conf:25`: `http2 on` requiere nginx 1.25.1 o posterior; con versiones anteriores `nginx -t` falla.
- `:153`: `db:mail-purge` no carga `/etc/charales/api.env`.

Recomendación: ensayar el procedimiento una vez en una máquina desechable.

### IND-14 · BAJO · Los informes de cierre no describen el código entregado

Archivos:

- `docs/audits/PLAN_REMEDIACION_INTEGRAL_2026.md:10,69`
- `docs/audits/AUDITORIA_FINAL_CIERRE_2026.md:7,37,63`
- `INFORME_REMEDIACION_INTEGRAL_2026.md` (describe `origen_conocido`, 20/15 min y 1 920 al día)
- `PROJECT_CONTEXT.md` y `docs/TESTING.md` (338 pruebas de API frente a 368 reales; `PROJECT_CONTEXT.md` dice además 18 E2E en una línea y 23 en otra)
- `api/login-limit.ts:1-84`: **tres comentarios de cabecera apilados y contradictorios**. El primero dice que no hay contador por cuenta, y el tercero describe 20 con redes conocidas.

Impacto: `f8e26ec`, el commit más sensible, no tiene auditoría registrada, y el documento que dictamina es de otro SHA. Incumple AGENTS.md regla 10. Quien lea esos informes tomará decisiones con datos falsos. `git diff 42ba617 f8e26ec -- docs/audits` solo toca evidencia.

Recomendación: rehacer el cierre sobre el SHA final y dejar una sola cabecera.

### IND-15 · INFORMATIVO · Observaciones menores agrupadas

- **Puerto de la API** [L]: `api/server.ts:307` escucha en todas las interfaces. Depende del cortafuegos (§ 3.7) para que no se salten nginx. Mejor enlazar a `127.0.0.1`.
- **Rotación en carrera** [E]: 6 logins correctos simultáneos con la misma cookie dejan 6 filas válidas y huérfanas, acotadas por el tope de 10. Sin impacto real.
- **Claves sin sal** [L]: `dispositivo_confiable.cuenta`, `limite_acceso.clave`, el nombre de la cookie (64 bits) y el prefijo que se registra en el log son SHA-256 sin sal del correo: seudónimos que se pueden comprobar con un diccionario, no anónimos. Los documentos dicen «no guarda el correo», que es literalmente cierto pero no equivale a anonimización. Entra en la revisión de F5-25.
- **Cuenta sin rol** [L]: un login correcto con 403 no devuelve el `fallos` del navegador (`api/auth.ts:146-149`); tras 5 deja de confiar. Inocuo.
- **Fila sin token** [E, solo con una fila creada a mano]: si `token_id` es NULL o el token no existe, `reissue` emite un token nuevo en lugar de cerrar (`current?.usado_en`). No encontré un camino real para llegar ahí. Conviene fallar cerrado.
- **Reparto RPC** [L]: F5-10 es por sesión. Una cuenta puede abrir varias sesiones (el login correcto no gasta intentos) y sumar reparto. El equipo menciona «varias cuentas», no este caso.
- **Equipos compartidos** [L]: la cookie sobrevive a `logout`. En un equipo compartido da hasta 5 intentos sin límites a quien lo use después.

## 7. Falsos positivos descartados

Comprobé específicamente estos riesgos y **no** encontré defecto:

| Riesgo | Por qué se descarta |
| --- | --- |
| Lógica `state()` de recarga: hueco, resto, llenado, devolución, reloj hacia atrás | [E, `p3`] Con reloj simulado: +29 min rechaza; +30 admite 1; +95 admite 3; +5 h admite 10; el ancla conserva el resto; la devolución resta 1. Con el reloj atrás no regala presupuesto. |
| Zona horaria | [E] Con `TZ=Asia/Tokyo` al arrancar, `auth.ts` fija `America/Mexico_City` antes de usar el reloj; diferencia entre parseo y `localDateTime` = 0. México no tiene horario de verano vigente [L]. |
| Purga prematura de `CUENTA` | [E] Fila agotada: sigue a +4 h 59; se va a +5 h 01, cuando ya está llena. No regala presupuesto. |
| Carrera en presupuesto, reserva del navegador o cambio de contraseña | [E, 2 procesos] 80 → 10; 40 con cookie robada → 5 del navegador + 10 del presupuesto, exacto; 40 cambios → 5×400 y 35×429. |
| Cookie inventada, mal formada o de otra cuenta | [E] Se trata como ausencia: va por la vía normal y consume sus contadores. La cookie real de la otra cuenta no se altera. |
| Fijación de cookie | [L] Quien planta su propia cookie no consigue nada: está ligada a su cuenta. La rotación solo borra con `usuario_id` del login correcto. |
| Variantes del correo y la cookie | [E] Nombre por `lower/trim`: una variante no encuentra cookie y sigue por la vía normal, cuya identidad es la colación (`ß`/`ss`, correos largos con final distinto). La identidad no se trunca. |
| Enumeración por estado, cuerpo o `Set-Cookie` | [E] Sin diferencias entre existente e inexistente salvo IND-05. Respuesta 401 sin cookies en cuentas inactivas. |
| Cookie robada más de 5 intentos | [E] Tope atómico entre procesos; la contraseña correcta no la resucita (prueba del equipo y mutación). |
| Filas anonimizadas que rompan el envío | [E, `p5`] Forzadas a `PENDIENTE` con `usuario_id` y `destinatario` NULL: se cierran (`CUENTA_INACTIVA`), sin enviar a NULL. |
| Purga que elimine mensajes necesarios | [E] `PENDIENTE` y `ENVIANDO` con concesión viva se conservan; repetir no cambia nada. La prueba de filas en uso pasa. |
| Direcciones en logs | [L + E] Solo `Correo <id>`. El transporte de consola está prohibido en producción, salvo que falle IND-04. `logParam: false`. |
| Migraciones | [E, `p5`] 008 sobre 007 con datos; 008 repetida; `migrate.sh` completo: filas idénticas. Migrada frente a nueva: esquema idéntico (columnas, índices, FK). FK correcta: `CASCADE` en dispositivo, `RESTRICT` en correo; [L] las cuentas nunca se borran, así que no estorba. |
| Marcha atrás | [E, `p10`] API de `9e08b11` sobre base con 008: health, login y RPC, 200. |
| Privilegios de `charales_app` | [E, `p7`] Prueba de humo correcta. La API no llama a procedimientos [L]. |
| `ReadOnlyPaths`/`ProtectSystem` | [L] La API no escribe a disco en ejecución (`grep` sin `writeFile` fuera de pruebas). Sin ejecutar en systemd. |
| Dependencias de ejecución tras `npm prune` | [L] `domain.mjs` solo importa `@angular/*` y `rxjs`, que son `dependencies`. |
| Secuencia de CI | [L] `npm ci` precede a todo. `api:build` precede a `api:typecheck`. Los SHA fijados corresponden a las versiones comentadas según lo que recuerdo; no lo verifiqué en línea. `--no-sandbox` solo con `CI`. Sin ejecutar. |
| Secretos o datos personales en Git | [E] Comprobación OK; en la evidencia solo aparecen direcciones de `example` y `nobody.example`. Aparecen rutas locales con el nombre de usuario en 2 JSON de evidencia, sin más riesgo que ese. |
| `Set-Cookie` sobre `/auth` detrás de nginx | [L] La API se sirve en la misma ruta `/auth` y mismo origen: la cookie llega. |

## 8. Riesgos residuales

- Contraseña débil con 48 intentos al día por cuenta: es lo declarado; el mínimo de 8 sigue siendo decisión de producto.
- Datos de menores sin política: `auditoria` guarda direcciones (`Alta de <correo>`) e IP sin límite; `sesiones` guarda IP y user agent; los respaldos conservan todo durante 12 meses. La purga de correo no los alcanza, como declara el procedimiento.
- MariaDB 11.8 y Linux sin probar: toda la evidencia es de macOS con 13.0.2.
- Avalancha desde muchas redes: login 503, falla cerrado (F5-11), `limit_req` sin probar.
- F5-15: diferencia residual de 0,25 ms sin explicar del todo.

## 9. Pruebas revisadas

**Cambios en expectativas existentes (`git diff 9e08b11 f8e26ec -- api/*.test.ts e2e`).** No encontré ninguno hecho para ocultar un defecto:

- Son nombres de base aleatorios, `listen(0,'127.0.0.1')`, `getSetCookie()[0]` por la segunda cookie y el contador `CUENTA` añadido.
- Los tres cambios de escenario están justificados y declarados: «una cuenta, 10 IP» de 50×401 a 10×401 + 40×429; S-01+S-02 con 10 cuentas; espera del semáforo de 100 a 1000 ms.
- El cambio importante es **H-2**: antes garantizaba que el dueño entraba «desde su dirección» y ahora «desde su navegador», con una nueva aserción del 429 en navegador nuevo. Es honesto y explícito, pero es la garantía que se cedió: ver IND-03.

**Mutaciones [E]: 23 de 25 detectadas.** Las suites nuevas no son falsos positivos: detectan tope de fallos, enlace a la cuenta, revocación, rotación, `HttpOnly`, recarga nula y doble, purga temprana, /64, reinicio del presupuesto, concesión viva, anonimización, inactiva, token usado, XFF y reparto RPC. Sobreviven:

- **Vencimiento del navegador:** quitar `vence_en > ?` no hace fallar la prueba de los 90 días. Esa prueba parece apoyarse en que la purga borra la fila. El código es correcto [L], pero la protección no está probada.
- **Pérdida del resto en la recarga:** anclar en «ahora» no se detecta. Es de poco impacto.

**Lo que las pruebas no detectarían:**

| Hallazgo | Motivo |
| --- | --- |
| IND-01 | Ninguna prueba cambia el correo con la cola o tokens vivos. |
| IND-02 | Ninguna carrera entre login y recuperación. |
| IND-04 | `checkEnvironment` solo se prueba con `production` exacto. |
| IND-05 | Solo comparan existente con inexistente. |
| IND-06, IND-07 | El ciclo corre con cuenta privilegiada y credenciales válidas. |
| IND-08, IND-09 | Sin desactivar ni cambiar correo. |
| IND-10 | La prueba de `:129` no envía cookie mala antes. |
| IND-11 | Una prueba fija el comportamiento como correcto. |

La E2E sirve la app con las cabeceras reales de nginx, pero con un proxy propio: no prueba nginx.

## 10. Recursos creados

Bases temporales en el servidor compartido, conservadas, solo con datos ficticios:

- `ef_indep_p1_ef27dbb5`
- `ef_indep_p2_f8c31154`
- `ef_indep_p3_a6eb3acc`
- `ef_indep_p4_e2359e42`
- `ef_indep_p8_f867624e`
- `ef_indep_p10_8b416d00`
- `ef_indep_mig7_77b0ebb0`
- `ef_indep_migfresh_77b0ebb0`

Instancia MariaDB privada, **no** el servidor compartido, ya detenida, con su datadir en `cierre/indep/mdb`:

- `ef_indep_priv_bae102`
- `ef_indep_priv_bae102_rest`
- Las cuentas `charales_admin`, `charales_app` y `charales_backup` solo existen en esa instancia.

Las suites del proyecto y las mutaciones crearon y borraron las suyas.

Procesos: apagué los que lancé (2 API de `p4`, 2 de `p7`, 1 de marcha atrás, y `mariadbd` privado). Vi otras API en ejecución (PID 10441 y 16157) que no son mías y no toqué. No detuve el MariaDB compartido.

Auxiliares: `cierre/indep/` (sondeos, logs, `mut/`, `old/`).

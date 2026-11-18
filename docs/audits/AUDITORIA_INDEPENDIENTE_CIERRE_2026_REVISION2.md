# Auditoría de seguridad independiente 2 — Charales

## 1. Datos

- SHA revisado: `d61ab7beadf330648c0d5ba5fb3dbd908f777db7` (HEAD detached, copia `charales-wt/auditoria-independiente`).
- Informe de partida: `docs/audits/AUDITORIA_INDEPENDIENTE_CIERRE_2026.md`, sobre `f8e26ec` (IND-01 a IND-15).
- Fecha: 2026-11-05. Entorno: macOS, Node 26.13.0, MariaDB 13.0.2.
- El repositorio no se modificó: al terminar, `git status --short` da 0 líneas y HEAD sigue igual.

Marcas de evidencia:

- **[E]** demostrado por ejecución.
- **[L]** deducido por lectura de código, sin ejecutar.
- **[NC]** no comprobado.

## 2. Dictamen independiente

**Integración en la rama `main` local: NO APTA TODAVÍA.** Es apta en cuanto se corrija IND2-01, con su prueba, y recomiendo corregir IND2-02 en el mismo cambio. Ambos arreglos son pequeños.

- IND2-01 lo introduce la propia corrección. Tras cualquier intento de inicio de sesión, `npm run db:setup` y `migrate.sh` fallan con error 1265. El proyecto manda ejecutar `db:setup` después de cada `git pull`, así que el fallo llegaría a todos los entornos de desarrollo.
- No encontré ningún defecto crítico. La mayoría de las correcciones funciona de verdad, y el sistema queda mejor que en `f8e26ec` en seguridad de las cuentas.

**Producción: NO APTA.** Siguen vigentes los motivos del equipo: no hay servidor, TLS probado, correo real ni CI ejecutada, y falta la política de datos de menores (F5-25). Además:

- IND2-01, IND2-02 e IND2-03.
- IND-03: el dueño en un navegador nuevo se puede seguir dejando fuera con pocas redes. Debe aceptarlo el responsable, con los datos de § 6.
- nginx, systemd y MariaDB 11.8 siguen sin probarse.

Recuento de hallazgos nuevos:

| Severidad | N |
| --- | --- |
| CRÍTICO | 0 |
| ALTO | 1 |
| MEDIO | 2 |
| BAJO | 7 |
| INFORMATIVO | 1 |

## 3. Alcance y archivos revisados

Leídos por completo:

- `api/auth.ts`, `api/client-ip.ts`, `api/login-limit.ts`, `api/access-link.ts`, `api/device-trust.ts`, `api/config.ts`, `api/password.ts`, `api/mail.ts`, `api/server.ts`, `api/mail-purge.ts`
- `api/argon2-guard.ts` hasta la adquisición del turno
- Migración 008 y la cabecera de 007
- `db/mariadb/scripts/{backup,verify-backup,migrate}.sh`
- `deploy/mariadb/*`, `deploy/nginx/charales.conf`, `deploy/systemd/charales-api.service`, `deploy/env.production.example`

Leídos en parte:

- `api/rpc.ts` (líneas 30-420)
- `api/schema.ts` (`missingSchema`), `api/setup.ts`
- `src/app/features/users/user.service.ts`, `src/app/core/auth/auth.service.ts`
- `docs/API.md` y `docs/deployment/PROCEDIMIENTO_PRODUCCION.md` (los cambios y las secciones afectadas)
- `docs/database/MARIADB.md` y los informes de cierre (por búsqueda)

Diffs revisados:

- `git diff f8e26ec d61ab7b` en `api`, `src`, `db`, `deploy`, documentos y todas las pruebas.
- De `d7f8c9d..f8e26ec`, solo lo que afecta a estos archivos.

No revisé los servicios de dominio ajenos a cuentas ni las HU funcionales.

## 4. Metodología y resultados reales

Conexión: `DB_SOCKET=/tmp/mysql.sock DB_USER=$(whoami)`, sin `.env`. La copia no tiene `.env`, solo `.env.example`.

| Comando | Resultado |
| --- | --- |
| `npm run api:typecheck` | exit 0 |
| `npm run build` | exit 0 |
| `npm run api:test` (3 veces) | 386/386 las tres, 0 fallos; unos 63 s; sin intermitencias |
| `npx ng test --watch=false` | 251/251 |
| `npm run e2e` | 23/23 |
| `npm run db:mariadb:test-backup` | exit 0; 45 tablas idénticas |
| `npm audit` | 0 vulnerabilidades |
| `npx prettier --check .` | OK |
| `git diff --check 9e08b11 HEAD` | exit 0, sin salida |

No ejecutado:

- `nginx -t`: nginx no está instalado.
- systemd: no existe en esta máquina.
- MariaDB 11.8 y la CI en GitHub.
- Colección Postman: evité un posible servicio externo.

Sondeos propios en `cierre/indep2/`:

- `p1`, `p2`: IND-01, 05, 08, 09, 10, 11 y carreras del cambio de correo.
- `p3`: CUENTA_RED, recuperación, `access-link`, invitaciones.
- `p4`: IND-02, carga, bloqueos, fugas, esquema.
- `p5`: buckets, XFF, enumeración, reparto a 72 h simuladas, IND-12, IND-15.
- `p6`: tiempos intercalados y carga final.
- `mig.sh`: migraciones reales desde `d7f8c9d` y `f8e26ec`.
- `priv.sh`: instancia MariaDB privada con `cuentas.sql`, API en modo producción, simulador local de Resend.
- `mut.sh`: 30 mutaciones sobre una copia desechable.

Límites de la evidencia:

- `p1` a `p5` corrieron en parte con otras suites activas. Por eso las medidas de tiempo válidas son solo las de `p6`, con la máquina libre y muestras intercaladas.
- Las carreras de IND2-03 las provoqué solapando solicitudes a propósito. Demuestran que el defecto existe, no con qué frecuencia ocurriría de forma natural.
- Mi primer intento de `mig.sh` falló por un error de mi script en zsh. Creó tres bases con el código actual en lugar del antiguo. No uso esos resultados; las bases figuran en § 11.

## 5. Estado de IND-01 a IND-15

| ID | Estado | Comprobación |
| --- | --- | --- |
| IND-01 | **PARCIAL** | [E] En secuencia, corregido: la dirección antigua no recibe nada, su enlace da 400, la invitación llega a la nueva y confirma con 204, y se cierran las otras sesiones. [E] **Bajo concurrencia sigue llegando un enlace válido a la dirección antigua:** IND2-03. |
| IND-02 | **CORREGIDO** | [E] 8 rondas de recuperación con logins solapados: cada ronda da 3-4 respuestas 200, pero 0 sesiones válidas y ningún navegador del atacante (la única fila es la de quien confirma). Cambio de contraseña: 4×200 y 0 válidas. |
| IND-03 | **PARCIAL** | [E] Un solo /24 o /48 ya no vacía la cuenta: máximo 8 intentos y el dueño entra desde otra red. El silencio en la recuperación funciona y la vía del dueño es real. Queda bloqueo con pocas redes: § 6. Riesgo declarado en `docs/API.md`, sin aceptación constatada del responsable. |
| IND-04 | **CORREGIDO** | [E] `production # obligatorio`, `Production`, `prod` y `production ` impiden el arranque. Plantilla sin comentario en línea. [NC] systemd real. |
| IND-05 | **CORREGIDO** | [E, `p6`, n=60, 2 rondas] Medianas de 23,12-23,43 ms en existente, inexistente, inactiva y pendiente, sin separación entre tipos. |
| IND-06 | **CORREGIDO** | [E] Credenciales malas: exit 2 y ningún archivo. Base inexistente: exit 2. Volcado truncado con exit 0: exit 1 y ningún archivo. `respaldo-programado.sh`: exit distinto de 0 y no rota (el antiguo sigue), también si falla gpg. Residuos en IND2-09. |
| IND-07 | **CORREGIDO** | [E, instancia privada] Con `mysql.proc`, el volcado de `charales_backup` incluye el procedimiento; la restauración verifica OK. Sin ese privilegio, `verify-backup.sh` da DIFERENCIAS. Residuo: el flujo programado no lo detecta (IND2-09). |
| IND-08 | **CORREGIDO** | [E] Desactivar o cambiar el correo deja 0 filas. Con la dirección reasignada, la cookie de A da 429 igual que sin cookie. No se añadió el enlace por `usuario_id` recomendado; ver IND2-11. |
| IND-09 | **CORREGIDO** | [E] El enlace da 400 tras desactivar y sigue en 400 tras reactivar. |
| IND-10 | **PARCIAL** | [E] Una cookie falsa ya no anula a la válida (200). **Veinte sí lo hacen:** IND2-06. |
| IND-11 | **CORREGIDO** | [E] Quinto intento correcto o incorrecto: en ambos casos sexto 429, cuerpo idéntico, sin cookies. |
| IND-12 | **PARCIAL** | [E] Por cuenta: 28 correos en 24 h simuladas, tope declarado 29. **No hay tope global:** 200 /64 de un mismo /48 pasan con 200×204 para cuentas distintas, y agotar la cuota del proveedor sigue siendo posible. |
| IND-13 | **PARCIAL** | [L] Corregidos el orden de `npm prune`, la vía de instalación limpia, la purga, `http2` y el XFF del balanceador. [E] `db:setup` con `charales_admin` funciona en una base nueva y falla en la segunda ejecución con filas (IND2-01). Queda IND2-10. El procedimiento sigue sin ensayarse entero. |
| IND-14 | **PARCIAL** | [E] Hay una sola cabecera en `login-limit.ts` y las cifras de pruebas (386) son correctas. Siguen desfasados `AUDITORIA_FINAL_CIERRE_2026.md` (código auditado `42ba617`; el procedimiento lo llama «dictamen vigente»), `INFORME_REMEDIACION_INTEGRAL_2026.md` (`origen_conocido`, 1 920 al día), `PROJECT_CONTEXT.md:143` (E2E 18), `MARIADB.md` (sin `CUENTA_RED`; dice «no hay contador sólo por cuenta») y el comentario de `login-limit.ts:413`. Incumple AGENTS.md regla 10. |
| IND-15 | **PARCIAL** | [E] Corregidos: `HOST=127.0.0.1` enlaza solo ahí; una fila sin token se cierra sin enviar. [L] Corregido: una cuenta sin rol devuelve el intento del navegador. [E] Sin cambios: rotación en carrera (6 filas), la cookie sobrevive a `logout`. [L] Sin cambios: claves sin sal, reparto RPC por sesión. Sin aceptación explícita que me conste. |

## 6. Equilibrio entre seguridad y disponibilidad

**Adivinar contraseñas sigue acotado.** [E] 153 intentos verificados en 72 h simuladas, con cualquier número de redes, frente a los 154 teóricos (58+48+48). Ninguna solicitud por encima del límite llegó a verificar la contraseña.

**Bloquear al dueño en un navegador nuevo sigue siendo barato.** El dueño intenta cada 30 min durante 72 h simuladas [E, `p5`]:

| Redes (/24 o /48) | Entra por día (de 48) | Solicitudes del atacante en 72 h |
| --- | --- | --- |
| 2 | 45, 48, 48 | 290 |
| 3 | 25, 48, 48 | 292 |
| 4 | 2, 35, 48 | 294 |
| 5 | **0, 0, 0** | 296 |
| 6, 7, 8 | **0, 0, 0** | 298-302 |

La documentación dice 6 redes y es correcto a largo plazo: con 5 el presupuesto recupera más de lo que se gasta y el bloqueo acabaría por ceder después de estas 72 h. En la práctica, unas 100 solicitudes al día desde 5 o 6 redes bastan. La propia cabecera de `client-ip.ts` reconoce que los /48 salen gratis, y [L] cada red admite 50 intentos cada 15 min, de modo que un ataque así puede cubrir a muchas cuentas a la vez.

**Lo que sí protege de ese bloqueo:**

- [E] Un navegador de confianza entra (200), salvo IND2-06.
- [E] Recuperación con la cuenta agotada: 30 redes dan 30×204 idénticos y solo 5 correos. El último enlace funciona (204) y hace de confianza ese navegador: bajo ataque entra con 200, y sin cookie recibe 429.

**Valoración:** el equilibrio es razonable si hay correo real. Sin correo solo queda `access-link`, que requiere intervención manual. Tras el despliegue todos cuentan como navegador nuevo. Debe decidirlo el responsable y sería útil añadir alertas. No es un defecto oculto: está documentado.

## 7. Hallazgos nuevos

### IND2-01 · ALTO · Las filas `CUENTA_RED` rompen la reejecución de las migraciones: falla `db:setup` y `migrate.sh`

Archivos: `db/mariadb/migrations/007_correo_y_limites.sql:7-8`, `008_retencion_y_dispositivos.sql:36-37`, `api/setup.ts:3-4`, `db/mariadb/scripts/migrate.sh`.

Causa: `db:setup` y `migrate.sh` ejecutan todas las migraciones cada vez. La 007 redefine `ambito` **sin** `CUENTA_RED`, y solo la 008 lo añade. La corrección amplió la 008 y dejó la 007 igual. Las pruebas no lo ven porque reejecutan sobre tablas sin esas filas.

Reproducción [E, `mig.sh`, base `ef_indep2_rerun_*`]:

1. `db:setup --demo` en una base nueva.
2. Dos intentos de login con la API de este commit: quedan filas `CUENTA_RED`.
3. `node api/setup.ts`: exit distinto de 0, `SqlError 1265: Data truncated for column 'ambito' at row 2`.
4. `migrate.sh`: `ERROR 1265 at line 7`, exit 1.

Con `sql_mode` no estricto [E, `ef_indep2_rerun2_*`] el `MODIFY` de la 007 no falla: **la fila queda con `ambito=''` y conserva sus 8 intentos**. [L] Después, la purga la trataría como ventana fija y la borraría a los 15 min, lo que regala presupuesto al atacante.

Impacto:

- La fila dura hasta 24 h, así que casi cualquier base en uso la tiene. **Fallaría el paso de migración del despliegue de la versión siguiente**, y también el de la tabla de recuperación de § 10.
- Falla cerrado en servidores con modo estricto, que es el valor por defecto: no se pierde nada, pero no se puede desplegar sin borrar filas a mano, y borrarlas devuelve presupuesto.

Lo que sí funciona: la actualización inicial desde `d7f8c9d` y `f8e26ec` con filas de todos los ámbitos, dos veces, conserva todo y queda con esquema idéntico al de una base nueva (diff de 0 líneas) [E]. El defecto solo aparece cuando existen filas `CUENTA_RED`.

Recomendación: que ninguna migración anterior pueda reducir el `ENUM`. Lo más simple es que 007 también incluya `CUENTA_RED`: la propia 008 ya se modificó y son idempotentes. La alternativa es un `MODIFY` condicionado. Añadir una prueba: reejecutar `setupDatabase` con una fila de cada ámbito.

### IND2-02 · MEDIO · La comprobación de arranque no detecta el ámbito que falta: todos los logins responden 503

Archivos: `api/schema.ts:287-305`, `api/server.ts:285-291`.

Reproducción [E, `p4`]: con el `ENUM` anterior a `CUENTA_RED`, que es el estado de una base con la 008 de `f8e26ec` o con la 007:

- `missingSchema` devuelve `[]`.
- Login correcto e incorrecto: **503 «El inicio de sesión no está disponible»**. El log solo dice `Límite de intentos no disponible`.

Impacto: si se despliega sin migrar, nadie entra salvo por un navegador de confianza ya existente [L], y la API arranca como sana. Es justo lo que F5-06 prometía evitar, y el procedimiento promete «La API no arranca: `La base no está al día`». [L] `/health` sigue en 200. Falla cerrado, sin riesgo para las cuentas.

Recomendación: que `missingSchema` compruebe que `COLUMN_TYPE` de `limite_acceso.ambito` incluye todos los ámbitos del código.

### IND2-03 · MEDIO · Corregir un correo mientras hay solicitudes en curso deja vivo un enlace enviado a la dirección antigua, o una sesión abierta

Archivos:

- `api/password.ts:182-185` lee el correo fuera de la transacción; `:191` bloquea y no lo vuelve a leer; `:208` encola a la dirección antigua.
- `api/rpc.ts:250-259`: `unitOfWork` carga `tokens_recuperacion` y `sesiones` de una instantánea, y lo que se confirma después no se ve.
- `src/app/features/users/user.service.ts` (`afterEmailChange`) y `auth.service.ts` (`revokeAccessTokens`): revocan sobre esa instantánea.
- `api/rpc.ts` (`settleAccountChanges`): cierra la cola y los navegadores con SQL real, pero no los tokens ni las sesiones.

Reproducción [E, `p2`, solapamiento provocado]:

- **Recuperación contra cambio de correo:** 5 solicitudes escalonadas 2 ms y el cambio 1 ms después. De 40 rondas, 33 cambios correctos; **en los 33 llegó a la dirección antigua un token todavía válido**. Confirmar con él dio **204**: fija la contraseña de la cuenta ya corregida. Las 7 rondas restantes dieron 500 por error 1020 tras agotar los reintentos: nada se escribe, y el administrador debe repetirlo.
- **Login contra cambio de correo:** 30 de 30 rondas dejan una sesión abierta creada con la dirección antigua, que el cambio debía cerrar.

Impacto: reabre IND-01 en una ventana estrecha: toma de la cuenta por quien controla el buzón antiguo. Requisitos que lo limitan:

- Coincidir en una ventana de milisegundos con el cambio. No medí la probabilidad natural. El presupuesto son 5 solicitudes más 1 por hora.
- Se facilita si el atacante puede provocar el momento, por ejemplo pidiendo por teléfono «corrijan mi correo».
- Después necesita conocer la dirección nueva para entrar.

Para la desactivación no ocurre lo mismo [E]: `confirm` y `currentSession` comprueban `activo`.

Recomendación:

- En `issueRecovery`, leer `email` en el `SELECT … FOR UPDATE`, y no usar la lectura previa.
- En `settleAccountChanges`, ya con la fila de `usuarios` bloqueada, revocar con SQL los tokens y cerrar las sesiones que no estén en lo escrito por la operación, sin tocar la invitación nueva.
- Añadir una prueba de carrera con el mismo patrón que IND-02.

### IND2-04 · BAJO · Una solicitud de recuperación del atacante anula el enlace que generó el operador

Archivos: `api/access-link.ts:29-37`, `api/password.ts:198-202`.

Reproducción [E, `p3`]: el operador genera el enlace, se recupera una unidad de `RECUP_CUENTA`, el atacante pide recuperación (204), y el enlace del operador da **400**.

Impacto: es la vía de escape para quien «no puede entrar durante un ataque y no tiene correo que funcione». Durante un ataque sostenido dura como mucho hasta la siguiente recarga (1 por hora), y el nuevo enlace va al buzón que esa persona no tiene. Se puede regenerar. Con `MAIL_PROVIDER=none` no ocurre, porque la solicitud responde 503 [L].

Bien [E]: `access-link` no expone el token salvo en stdout, se niega para cuentas inexistentes e inactivas con el mismo mensaje, deja auditoría sin token, funciona con `charales_app`, y revoca los enlaces anteriores.

Recomendación: una finalidad propia que las solicitudes no revoquen, revocada al confirmar, o que `access-link` deje constancia del riesgo en su mensaje.

### IND2-05 · BAJO · `CUENTA_RED` permite bloquear a un vecino de la misma red o proveedor

Archivos: `api/client-ip.ts:42-47`, `api/login-limit.ts:208-213`.

Reproducción [E, `p3`]: 60 intentos desde `203.0.113.x` dejan a la cuenta con 8 gastados. El dueño, con contraseña correcta y navegador nuevo:

- Desde `203.0.113.250`: **429**.
- Desde otra red: 200.
- Desde el mismo /24, 3 h después: 200.

Impacto: quien comparta /24 o CGNAT bloquea a una cuenta conocida con 8 solicitudes al día; también puede hacerlo toda la asignación /48 de un proveedor. Es **específico de cada cuenta**, no bloquea a toda una red de golpe. No afecta a navegadores de confianza ni a la recuperación. Es un precio razonable por cerrar IND-03, pero la documentación no lo menciona.

Recomendación: documentarlo. Comprobé los bordes y están bien: § 8.

### IND2-06 · BAJO · 20 cookies inventadas desactivan los navegadores de confianza de toda la red

Archivos: `api/login-limit.ts:148-157`, `:183-191`.

Reproducción [E, `p1`], con la red ya agotada (50 intentos):

- Tras 20 cookies inventadas en menos de 10 s, el navegador válido recibe **429**; la misma cookie desde otra IP da 200.
- A los 10 s vuelve a 200.
- Ataque sostenido durante 25 s, con 21 cookies cada 9 s: **el dueño queda bloqueado en 9 de 13 intentos**.

Impacto: el contador es por IP o /64 y no distingue el secreto, así que se puede convertir en una herramienta contra el resto de la red, que es justo IND-10. Coste: unas 2 solicitudes por segundo y 50 intentos previos cada 15 min. Requiere compartir IP, por ejemplo la oficina de la escuela. Por proceso.

[L] Tampoco evita del todo la carga: con muchos /64 cada uno tiene sus propias 20 consultas. Las consultas son baratas (`UPDATE` por clave primaria). Memoria acotada: 10 000 entradas con expulsión del más antiguo, también en `refused`; [L] la expulsión solo provoca más consultas, nunca admite.

Una cookie válida nunca queda marcada como mala salvo que se haya invalidado de verdad [L].

Recomendación: si la red ya agotó las consultas, atender también las cookies ya vistas como válidas por este proceso, o aplicar un coste por cookie mala en lugar de un corte por red.

### IND2-07 · BAJO · El login bajo bloqueo usa el pool general con la espera por defecto de 50 s y no devuelve la reserva si falla

Archivos: `api/auth.ts:165-178` (`transaction(db, …)`), `:183`; `api/server.ts:255-268` (solo el limitador tiene 2 s).

Reproducción [E, `p4`]:

- Con la fila de `usuarios` retenida 8 s desde otra conexión y 14 logins correctos (pool de 10): **`/health` no responde en 6 s**, el login de otra cuenta tampoco en 3 s, y al liberar da 9×200, 4×429, 1×500.
- Con espera limitada a 1 s y el bloqueo retenido: **500** y los contadores quedan en +1 aunque la contraseña sea correcta, también `fallos` del navegador. No hay reintento ni `settleLogin` en ese camino.

Impacto: limitado. Solo llegan a esta transacción las contraseñas correctas, y nada en la API retiene esa fila mucho tiempo: en carga real sin bloqueo externo, `/health` tuvo un máximo de 17,5 ms y no hubo bloqueos mutuos (§ 8). Lo dispararía una sesión manual o un proceso largo. La fuga queda del lado seguro. Con 5 fallos así, el navegador deja de valer.

Recomendación: `SET STATEMENT innodb_lock_wait_timeout=2 FOR …` o `FOR UPDATE WAIT 2` en esa consulta, responder 503 y hacer `settleLogin('not-verified')` en un `catch`.

### IND2-08 · BAJO · Una invitación pendiente sigue valiendo después de fijar la contraseña por otro enlace

Archivos: `api/password.ts:260-263`, `api/access-link.ts:29-33`.

Reproducción [E, `p3`]: alta con invitación, enlace de operador, confirmar (204), y **la invitación original vuelve a confirmar (204)** y cambia la contraseña.

Impacto: durante las 24 h de la invitación, quien tenga ese correo puede volver a fijar la contraseña, cerrando las sesiones del titular. Choca con `access-link`, pensado para cuando el correo no es de fiar. El origen es anterior a la entrega en cuanto a `confirm`; `access-link` es nuevo.

Recomendación: al confirmar, revocar todos los tokens vivos de la cuenta, en la misma transacción.

### IND2-09 · BAJO · Respaldos: el flujo programado no detecta rutinas ausentes y una señal deja el volcado en claro

Archivos: `db/mariadb/scripts/backup.sh:12-14`, `deploy/mariadb/respaldo-programado.sh`.

[E, instancia privada]:

- Sin `SELECT ON mysql.proc`, `respaldo-programado.sh` termina con **exit 0**, y el procedimiento falta en el respaldo. Solo lo ve `verify-backup.sh`, que el flujo programado no ejecuta.
- Con `dash`, el `sh` de Debian y Ubuntu, un SIGTERM durante el volcado **deja `*.sql.gz.parcial` sin comprimir ni cifrar**, porque el `trap … EXIT` no corre con señales. Con el `sh` de macOS se limpia. Probado con un volcado simulado.

[L]:

- El `.parcial` ocupa el tamaño completo sin comprimir: mal fallo con el disco justo.
- Si `gzip` falla a mitad queda un `.sql.gz` parcial, porque el `trap` solo borra el `.parcial`. En `respaldo-programado.sh` lo limpia `$WORK`.
- Un `skip-comments` en el archivo de opciones hace fallar todos los respaldos, pero del lado seguro.

Impacto: contiene datos de menores, aunque con modo 077 y en un directorio temporal. Otro `sh` puede variar.

Recomendación: `trap … EXIT INT TERM`, y en el flujo programado comprobar que el volcado contenga las rutinas y eventos esperados.

### IND2-10 · BAJO · Con balanceador, el `limit_req` de nginx agrupa a todos los clientes

Archivos: `deploy/nginx/charales.conf:6-7`, `docs/deployment/PROCEDIMIENTO_PRODUCCION.md` (§ 3, paso 4).

[L, nginx no disponible] La topología con balanceador ahora se describe como admitida, y el XFF ya es correcto, pero `$binary_remote_addr` es la dirección del balanceador. **Toda la escuela compartiría 30 solicitudes por minuto en login**, sin `real_ip`.

[E, `clientIp`] Un balanceador TCP que no añada XFF, o que añada `ip:puerto`, deja la IP del proxy: todos comparten un límite. No es falsificable, pero sí bloquea.

Recomendación: documentar `set_real_ip_from` y `real_ip_recursive on`, o usar la clave derivada.

### IND2-11 · INFORMATIVO · Observaciones menores agrupadas

- **Sin transporte de correo** [E]: corregir la dirección de una invitación pendiente da 503. El sistema queda con la dirección errónea hasta tener correo.
- **`access-link`** [E]: sin `APP_URL`, imprime un enlace a `http://localhost:4200`. [L] La auditoría no identifica al operador, solo `ip=consola`.
- **`HOST`** [E]: si falta, escucha en todas las interfaces (`*:puerto`) sin aviso. La plantilla sí lo trae. **`NODE_ENV` sin definir** sigue siendo desarrollo, con solo un aviso.
- **`issueDevice` dentro de la transacción del login** [L, `device-trust.ts:91-94`]: se traga los errores. Tras un 1213, InnoDB ya revirtió la transacción, y el `INSERT` de la sesión correría fuera de ella, sin bloqueo. No lo provoqué.
- **`issueDevice` tras `confirm` y `changePassword`** [L]: corre después del `COMMIT`, sin bloqueo, y una revocación simultánea puede dejar una fila viva. Solo evita límites, nunca la contraseña.
- **Error 1020 tras 3 reintentos** [E]: 1 de 214 desactivaciones dio 500 en carga, sin escribir nada. Bajo solapamiento forzado, 7 de 40 cambios de correo (IND2-03).
- **Reactivar** [L]: desactivar revoca la invitación y reactivar no la reenvía. La persona puede usar la recuperación.
- **Regla 6 de AGENTS.md**: se modificó la 008 ya entregada en `f8e26ec`. Tiene sentido porque no se publicó, pero es parte de la causa de IND2-01.
- **`rango ancho`** [E]: con `TRUSTED_PROXIES=10.0.0.0/8`, un cliente interno sí elige su IP. Es configuración del operador; conviene avisarlo en el procedimiento.

## 8. Falsos positivos descartados

| Riesgo | Por qué se descarta |
| --- | --- |
| Interbloqueos del login con `usuarios` | [E, `p6`] 30 s de carga: 2 770 logins correctos, recuperación, confirmación, cambio, desactivación, correo y purga. Ningún 1213 en el login, ningún 500 en login. `/health`: mediana 0,7 ms, máximo 17,5 ms. [L] El orden `usuarios → dispositivo → sesiones` es compatible con R1/R2: las operaciones de una misma cuenta se serializan en `usuarios`. |
| «No se pudo devolver la reserva» (15 veces en mi primer `p4`) | Era artefacto mío: un `DELETE` global sobre `limite_acceso`. Sin él, 0 errores en `p5` y `p6`. |
| Interbloqueos con filas `CUENTA_RED` nuevas | [E] Carga sin errores. [L] Orden único IP → CUENTA → CUENTA_RED → CUENTA_IP, también en `settleLogin`; la purga usa `SKIP LOCKED`; 1062 y 1213 se reintentan. |
| Purga prematura que regale presupuesto | [E] Fila agotada: sigue a +23,9 h y se va a +24,1 h, ya llena. |
| IPv6 abreviado, mapeado, valores no IP | [E] 21 casos: `2001:0DB8:0:0:1::1`, `::ffff:cb00:7107`, zona, `::`, `1::`, etc., todos en su bucket. Un valor no IP en XFF nunca se usa: queda la IP del proxy. |
| Falsificar la IP con `$proxy_add_x_forwarded_for` | [E, `clientIp`] Con nginx solo, con balanceador y saltando el balanceador: el cliente nunca elige su IP, también si escribe `127.0.0.1`. Directo a la API: se ignora XFF. [NC] nginx real. |
| Enumeración por recuperación | [E, `p6`] Medianas de 1,91-2,07 ms y en silencio 0,59-0,60 ms, sin separación por tipo de cuenta. Mismo estado y cuerpo, sin cookies. La cuenta inexistente agota igual el presupuesto. |
| Enumeración por login y límites | [E] Mismo cuerpo y sin cookies en existente, inexistente e inactiva. La secuencia 401/429 es idéntica. |
| Hook que cierre mensajes legítimos | [E] Una invitación nueva creada en la misma operación sobrevive y se confirma. [L] `settleAccountChanges` corre antes de encolar. Un `recordFailure` tardío reabre una fila, pero el trabajador la cierra al comprobar correo y token. |
| Otros caminos que cambien correo o `activo` | [E, `grep`] `users` solo se actualiza en `UserService` y `auth.service`; por SQL, solo la contraseña. |
| Privilegios de `charales_app` y cookies en producción | [E, instancia privada] Con `charales_app`: login, cambio de correo, desactivación, recuperación, `access-link` y purga funcionan. `Secure` en ambas cookies; `/api/jugadores` 404. |
| `FORCE INDEX` y migración 008 | [E] El índice existe en base nueva y migrada; `EXPLAIN` usa `range`. 008 sobre datos de 007 y repetida: filas iguales, ningún dato perdido por `MODIFY`. |
| Fuga de `settleLogin` en caminos normales | [L, E] 401, 403, 503 y sesión rechazada lo llaman. Solo faltan las excepciones (IND2-07). |

## 9. Riesgos residuales

- Contraseña débil con 48 intentos al día por cuenta, unos 17 500 al año; el mínimo de 8 sigue siendo decisión de producto.
- Datos de menores sin política: `auditoria`, `sesiones` y respaldos fuera de la purga.
- Sin correo real, la recuperación no existe.
- MariaDB 11.8, Linux, nginx y systemd sin ejecutar. `dash` probado solo en la señal.
- `innodb_snapshot_isolation` activo en 13.0.2 y puede cambiar por versión: el comportamiento de 1020 no está probado en otras.
- Agotar la cuota del proveedor con muchas cuentas (IND-12) también cerraría la vía de recuperación, y dejaría solo `access-link` (IND2-04).

## 10. Pruebas revisadas

**Expectativas cambiadas (`git diff f8e26ec d61ab7b -- api e2e src`).** No encontré ninguna hecha para ocultar un defecto:

- IP movidas a otros /24 o /48 en `r1-distribuido`, `dispositivo`, `login-limit` y `login-limit-order`: necesario, porque `CUENTA_RED` limitaría esos casos. Y `CUENTA_RED` tiene sus propias pruebas.
- De 429 a 204 en `api.test` y `recuperacion-limites`: cambio de comportamiento declarado, y pasan a contar correos, que es más exigente.
- IND-11 sustituye a la prueba que fijaba el defecto.
- `retencion-correo` cambia el destinatario para superar la nueva comprobación: justificado.
- `cierre-antes.json` se regeneró (`antes3`) con escenarios nuevos: legítimo, pero ya no es la medida original.

**Mutaciones [E]: 21 de 30 detectadas, 9 sobreviven.** Las pruebas nuevas no son falsos positivos: detectan la comprobación bajo bloqueo, el `FOR UPDATE`, `wideBucket`, `settleAccountChanges`, el trabajador, el silencio, Argon2id en invitaciones, la caché por secreto, la protección de la purga y la auditoría de `access-link`. Sobreviven:

| Mutación | Qué queda sin probar |
| --- | --- |
| M08 | `reissue` sin el caso de token ausente |
| M16 | Orden de bloqueo de `CUENTA_RED` respecto de IP. Mutación imperfecta: añade la fila, no la cambia de sitio; indicio, no prueba |
| M17 | Recarga de `CUENTA_RED` de 3 h a 30 min: **el valor que sostiene IND-03** |
| M19 | `HOST` ignorado |
| M20 | Desactivar sin revocar tokens: lo tapa la comprobación de `activo` |
| M25, M27 | `access-link` sin revocar enlaces anteriores, y sobre cuenta inactiva |
| M28 | `backup.sh` sin marcador `Dump completed` (se prueba el exit, no el truncado) |
| M30 | Identidad por colación en `RECUP_CUENTA`: comparación por texto no detectada |

**Lo que las pruebas no detectarían:**

| Hallazgo | Motivo |
| --- | --- |
| IND2-01 | Las reejecuciones no tienen filas `CUENTA_RED` |
| IND2-02 | `missingSchema` y sus pruebas no miran el `ENUM` |
| IND2-03 | Ninguna carrera con cambio de correo |
| IND2-04 | No se prueba la revocación del enlace del operador |
| IND2-06 | La prueba comprueba que el corte existe, no que perjudique a la cookie válida |
| IND2-08 | Sin caso de dos tokens de distinta finalidad |

## 11. Recursos creados

Bases en el servidor compartido, con prefijo `ef_indep2_`, comprobadas como inexistentes o con sufijo aleatorio, solo datos ficticios, conservadas:

- `ef_indep2_p1_f28c1740`
- `ef_indep2_p2_caae492d`, `ef_indep2_p2_6d9436b7`
- `ef_indep2_p3_fa86c2b8`
- `ef_indep2_p4_24ce25f9`, `ef_indep2_p4b_e5c4afee`, `ef_indep2_p4c_b617ad41`
- `ef_indep2_p5_9516d40b`, `ef_indep2_p5b_23011a1e`
- `ef_indep2_p6_ccf362ce`
- `ef_indep2_rerun_e51d32f4`, `ef_indep2_rerun2_e51d32f4`
- `ef_indep2_up7_e51d32f4`, `ef_indep2_up8_e51d32f4`, `ef_indep2_upfresh_e51d32f4`
- `ef_indep2_mig7_b0742df9`, `ef_indep2_mig8_b0742df9`, `ef_indep2_migfresh_b0742df9` (del intento fallido de § 4; sin usar sus resultados)

En las tres `mig` no llegó a ejecutarse la comprobación previa, por ese mismo error de script. Su sufijo es aleatorio y la lista inicial de `ef_indep2%` estaba vacía, así que no pisaron nada.

Instancia MariaDB privada, **no** el servidor compartido, ya detenida, con su datadir en `cierre/indep2/mdb`: `escuela_futbol`, `restaurada`, `restaurada2` y las cuentas de `cuentas.sql`, solo allí.

Las suites del proyecto y las mutaciones crearon y borraron las suyas.

Procesos: paré lo que lancé (API de producción y simulador de `priv.sh`, `mariadbd` privado). No toqué la otra API ni el servidor compartido. No se envió correo real; `npm audit` fue la única consulta externa.

Auxiliares: `cierre/indep2/` (sondeos, `c-*.log`, `mut/`, `mut.log`, `old/`, `mdb/`).

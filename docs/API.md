# API — contrato de endpoints

Estado: autenticación y contraseñas, **operaciones de dominio de toda la app** (`POST /api/rpc`, decisión
[D13](database/MARIADB.md)) y dos `GET` de la práctica de laboratorio. Código en [`api/`](../api); sobre el modelo
[`MARIADB.md`](database/MARIADB.md) (convenciones de JSON en § 1). El frontend usa esta API para todo: sesión y datos.

## Ejecutar

Requisitos: Node `^24.15.0` o `>=26` (usa `crypto.argon2` y TypeScript sin compilar; probado con 26.11) y MariaDB
10.6+ local. Paso a paso: [`SETUP.md`](SETUP.md).

```bash
cp .env.example .env              # ajusta DB_* (TCP o DB_SOCKET); .env no se versiona
npm run db:setup                  # esquema (sólo en base vacía) + migraciones + permisos; nunca borra
npm run db:admin                  # primer administrador (o `npm run db:setup -- --demo`: datos ficticios, demo1234)
npm run api:start                 # empaqueta el dominio (api:build) y abre http://localhost:3000
npm run api:test                  # pruebas en bases temporales ef_* que se borran al terminar
```

`npm run api:build` empaqueta con esbuild los servicios de Angular que ejecuta la API (`api/domain` →
`api/.build/domain.mjs`, no versionado); `api:start`, `api:test`, `db:setup`, `db:admin` y `db:mariadb:demo` lo
ejecutan solos. El script `sh` anterior `db:mariadb:migrate` sigue disponible para quien use el cliente `mariadb`.
`db:mariadb:dev-seed` está **obsoleto** (usa `npm run db:setup -- --demo`) y **sólo sirve para una base nueva**. Es
`db:setup -- --dev-seed` (`api/setup.ts`, `loadDevSeed` en `api/schema.ts`) y carga `020_dev_seed.sql`, el conjunto
mínimo que usan `api/api.test.ts` y la colección Postman: 6 cuentas `@example.com` con la contraseña **pública**
`demo1234` (una de ellas ADMINISTRADOR), 2 entrenadores y 2 tutores vinculados, la temporada 2026-2027 con 3
categorías y 6 jugadores. Garantías (`api/setup.test.ts`):

- Se **niega** si la base ya tiene algún usuario o jugador. Lo comprueba antes de escribir nada (ni siquiera el
  `db:setup` previo corre) y otra vez, con bloqueo, dentro de su transacción. Así nunca recrea una cuenta desactivada
  o con otro correo, ni revincula un perfil, ni devuelve un permiso retirado.
- Todo o nada: si la semilla no queda completa (p. ej. ya hay otra temporada actual y su `INSERT IGNORE` se omitiría),
  hace `ROLLBACK` y termina con error sin dejar cambios.
- No toca `rol_permiso`: la matriz inicial la aplica `db:setup` sólo en la primera instalación.
- Al terminar incrementa `version_datos`, así que una API en marcha deja de usar su copia en memoria.

No la uses en una base real ni en producción. Aplicar `020_dev_seed.sql` a mano con el cliente `mariadb` no tiene
ninguna de estas protecciones.

| Variable                  | Por defecto             | Notas                                                                                                                          |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                    | `3000`                  |                                                                                                                                |
| `DB_NAME`                 | `escuela_futbol`        |                                                                                                                                |
| `DB_HOST` / `DB_PORT`     | `127.0.0.1:3306`        | Se ignoran si hay `DB_SOCKET`                                                                                                  |
| `DB_SOCKET`               | —                       | Socket local (autenticación `unix_socket`)                                                                                     |
| `DB_USER` / `DB_PASSWORD` | —                       | Nunca en el repo                                                                                                               |
| `DB_POOL_SIZE`            | `5`                     |                                                                                                                                |
| `APP_URL`                 | `http://localhost:4200` | Base de los enlaces de los correos (las rutas que escriben los servicios se vuelven absolutas)                                 |
| `COOKIE_SECURE`           | `false`                 | Siempre `Secure` con `NODE_ENV=production`                                                                                     |
| `MAIL_CONSOLE`            | `false`                 | Sólo desarrollo: imprime en la consola de la API el correo de recuperación (con el enlace). Ignorado con `NODE_ENV=production` |

Cuentas de desarrollo: las de [`DEVELOPMENT.md`](DEVELOPMENT.md) (`@example.com`, contraseña `demo1234`), creadas por
[`db/mariadb/020_dev_seed.sql`](../db/mariadb/020_dev_seed.sql). Son ficticias; **nunca** se cargan en producción.

## Convenciones

- JSON en `camelCase`; `DATETIME` como `"YYYY-MM-DDTHH:MM:SS"` en hora de la escuela (`America/Mexico_City`), sin zona.
- Errores: `{ "error": "<mensaje en español>" }`. Cuerpos sólo `application/json` (máx. 10 KB).
- Todas las respuestas llevan `Cache-Control: no-store`.

## Sesión

- Cookie `charales_sid`: `HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` (+ `Secure` en producción). No hay tokens
  en el cuerpo ni en cabeceras.
- `sesiones` guarda sólo el SHA-256 del token. Expira a las **8 h** o tras **30 min** sin uso (HU-002); una sesión
  vencida, o de una cuenta desactivada, se cierra y se audita como «Sesión expirada».
- **Límite de intentos del login (S-01, `api/login-limit.ts`, migración 005; corregido tras la auditoría de la PR #26).**
  Cada intento se **reserva antes** de verificar la contraseña (Argon2id), en una transacción de MariaDB que bloquea los
  contadores (`SELECT … FOR UPDATE`, siempre la IP primero, `READ COMMITTED`). Así las solicitudes simultáneas no pueden
  superar el límite, y el límite se mantiene tras reiniciar la API y entre varias instancias. Hay dos contadores, cada
  uno con una ventana fija de 15 min que abre su primer intento:

  | Contador                | Límite | Para qué                                                                                    |
  | ----------------------- | ------ | ------------------------------------------------------------------------------------------- |
  | Cuenta + IP del cliente | 5      | Una persona que se equivoca desde un equipo, y el freno a adivinar una cuenta desde una IP  |
  | IP (cualquier cuenta)   | 50     | Una dirección no puede provocar Argon2id sin límite probando correos (holgura para una NAT) |
  - Al alcanzar cualquiera de los dos, la respuesta es `429` sin verificar nada.
  - **Sin contador sólo por cuenta (H-2):** con él, quien conociera un correo podía dejar fuera a su dueño desde unas
    pocas direcciones, mientras siguiera intentándolo, y ni restablecer la contraseña lo resolvía. Ahora los intentos
    de otras direcciones no afectan a la del dueño.
  - **Identidad de la cuenta (H-1):** se calcula como MariaDB compara `usuarios.email` (`utf8mb4_unicode_ci`): el peso
    de colación del correo recortado (`WEIGHT_STRING`), sin los espacios finales que esa colación ignora. Acentos,
    letras de ancho completo, caracteres de ancho cero, mayúsculas y espacios que llevan a la misma cuenta comparten su
    contador. Los correos inexistentes se tratan igual (no hay enumeración).
  - **Contraseña correcta:**
    - el inicio de sesión vacía el contador de la cuenta en esa IP y devuelve a la IP sólo su intento;
    - en una cuenta deshabilitada, devuelve el intento a los dos contadores.
  - **Un rechazo no escribe (M-1):** los contadores se leen con bloqueo y sólo se escriben si el intento cabe. Así un
    `429` no crea filas ni actualiza nada, y los correos al azar desde una IP en su límite no hacen crecer la tabla.
    Además, cada proceso recuerda unos 10 s las claves en su límite, y esa avalancha ni siquiera llega a MariaDB. Esa
    memoria sólo rechaza, nunca admite.
  - **Pool propio:** el limitador usa 2 conexiones propias con 3 s de espera máxima (`api/server.ts`), así que una
    avalancha de intentos no agota las conexiones del resto de la API.
  - **Restablecer la contraseña no toca los contadores:** sin el contador por cuenta, sólo afectan a la IP que falló.
  - **Orden de bloqueo (corregido el 2026-11-04):** toda reserva bloquea primero la fila de la IP y después la de la
    pareja cuenta + IP. Si la fila de la IP no existe, la transacción la inserta (con 0 intentos) **antes** de leer la
    pareja. Antes, una solicitud que no encontraba la IP podía bloquear la pareja y quedar esperando la IP que otra ya
    tenía, mientras esa otra esperaba la pareja: un bloqueo mutuo. Si un contador está en su límite, la transacción se
    revierte (ROLLBACK), así que un rechazo no deja ni la fila de IP que tuvo que insertar.
  - **Reintentos:** ante un bloqueo mutuo (1213), un tiempo de espera de bloqueo (1205), «Record has changed» (1020) o
    la colisión de dos inserciones simultáneas de la misma fila de IP (1062 en esa inserción, y sólo en ella), la
    reserva se repite como máximo 6 veces en 1,5 s, esperando un tiempo aleatorio de hasta 10·2ⁿ ms (máx. 200 ms)
    entre intentos. Cualquier otro 1062 es un error. Si se agotan los intentos o el tiempo, el login responde `503`.
  - **Datos guardados:** sólo SHA-256 de cada clave. Después de cada intento admitido se purgan hasta 100 filas
    vencidas con `FOR UPDATE SKIP LOCKED`: la purga nunca espera una fila bloqueada, así que no puede participar en un
    bloqueo mutuo.
  - **Política de fallo:** si MariaDB o el pool del limitador no responden, el login responde `503` y no verifica
    (falla cerrado). La disponibilidad del login depende de la base, igual que la consulta del usuario.
  - **Riesgos residuales:**
    - **Ataque distribuido:** consigue 5 intentos por cuenta y 50 en total por cada dirección y ventana, así que el
      límite depende del número de direcciones del atacante (en IPv6, cada cliente suele tener un /64; ver P-03).
    - **NAT o proxy compartido:** un atacante que comparte la IP del dueño (la misma red, o un proxy sin
      `TRUSTED_PROXIES`) sí puede agotar el contador de esa IP durante una ventana.
    - **Memoria de rechazos:** un rechazo recordado puede durar hasta 10 s más que la ventana.
    - **Seudónimos, no anónimos:** los hashes se revierten con un diccionario de correos o enumerando las IPv4.

- `auditoria`: `LOGIN`, `LOGOUT` e «Intento de acceso fallido» (módulo `auth`), como el `AuthService` del mock.

## Endpoints

| Método y ruta                       | Sesión | Respuestas                                                                                                                                                                                                      |
| ----------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                       | No     | `200 {status:"ok",database:"ok"}` · `503` si MariaDB no responde                                                                                                                                                |
| `POST /auth/login`                  | No     | `200 AuthUser` + cookie · `400` faltan datos · `401` correo/contraseña incorrectos **o cuenta deshabilitada** (mismo mensaje) · `403` sin rol ni perfil · `429` límite de intentos · `503` límite no disponible |
| `GET /auth/session`                 | Sí     | `200 AuthUser` (renueva el uso) · `401` sin sesión, vencida o cerrada                                                                                                                                           |
| `POST /auth/logout`                 | —      | `204` siempre; borra la cookie y cierra la sesión si había una                                                                                                                                                  |
| `POST /auth/password`               | Sí     | `{currentPassword, newPassword}` → `204` (cierra las otras sesiones) · `400` actual incorrecta, política o igual a la actual · `401` sin sesión · `429`                                                         |
| `POST /auth/password-reset/request` | No     | `{email}` → `204` siempre (exista o no la cuenta) · `400` sin correo · `429` · `503` sin transporte de correo                                                                                                   |
| `POST /auth/password-reset/confirm` | No     | `{token, newPassword}` → `204` (cierra todas las sesiones y borra la cookie) · `400` política, o «El enlace no es válido o ya expiró.»                                                                          |
| `GET /api/jugadores`                | Sí     | `200` arreglo de filas de `jugadores` · `401` sin sesión · `403` sin `jugadores.consultar` del rol de seguridad                                                                                                 |
| `GET /api/categorias`               | Sí     | `200` arreglo de filas de `categorias` · `401` sin sesión · `403` sin ningún permiso de oficina                                                                                                                 |
| `POST /api/rpc`                     | Sí     | `{service, method, args}` → `200 {result}` · `400` regla de negocio o datos inválidos · `401` · `403` · `404` fuera de la lista · `409` integridad · `503`                                                      |

`AuthUser` es la interfaz de `src/app/core/auth/session.store.ts`: `userId`, `sessionId`, `email`, `displayName`,
`roles`, `permissions`, `officePermissions`, `tutorId`, `coachId`, `isStaff`, `expiresAt`, `lastUsedAt`. Nunca incluye
`password_hash`.

```bash
curl -i -c jar -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"demo1234"}' localhost:3000/auth/login
curl -b jar localhost:3000/auth/session
curl -b jar -c jar -X POST localhost:3000/auth/logout
```

## Contraseñas (HU-005)

Código: [`api/password.ts`](../api/password.ts). Responsable de la historia: Borrayo. Decisiones del registro M0
(2026-10-09): D2, D3a, D3b, D3d, D3e, D4a, D4b, D4d, D7, D8.

- **Cambio y recuperación son operaciones distintas.** El cambio exige sesión y la contraseña actual; una actual
  incorrecta responde `400` (no `401`, para que el cliente no lo confunda con una sesión vencida) y cuenta para el
  límite de 5 intentos en 15 min por usuario. Al cambiarla se cierran las **demás** sesiones y se conserva la actual.
- **Política** (igual que el frontend): 8 a 200 caracteres, con letras y números; distinta de la actual.
- **Recuperación:** token aleatorio de 32 bytes; sólo se guarda su SHA-256 en `tokens_recuperacion`; un solo uso;
  vence a los 60 min. Una nueva solicitud revoca los tokens anteriores vigentes de la cuenta marcando `usado_en` (se
  conserva el historial). Confirmar cierra **todas** las sesiones, en una transacción con la auditoría.
- **Sin enumeración:** la solicitud responde `204` igual para cuentas existentes, inexistentes o inactivas; límite de 5
  solicitudes por correo e IP en 15 min (también para correos inexistentes).
- **Correo:** proveedor elegido, **Resend** (D4c, decisión DP-04 del 2026-11-02), todavía sin implementar. Sin transporte, la solicitud responde `503` antes de consultar la
  cuenta, y la recuperación queda **deshabilitada en producción**. En desarrollo, `MAIL_CONSOLE=true` imprime el correo
  (con el enlace y su token) en la consola de la API; nunca con `NODE_ENV=production`.
- **Finalidad del token (D3e, migración 001):** `RECUPERACION` (esta solicitud, 60 min) o `INVITACION` (acceso
  inicial de una cuenta nueva o ligada: HU-004, HU-012, HU-022; 24 h, D3c). Una solicitud de recuperación sólo revoca
  tokens de recuperación; `confirm` acepta ambas finalidades, una sola vez.
- **Registros:** el pool usa `logParam: false`, así que un error de SQL no imprime los parámetros. La API no registra
  contraseñas, cookies ni tokens; la única excepción es la consola de desarrollo anterior.
- **Concurrencia:** las tres operaciones bloquean primero la fila de `usuarios` (orden `usuarios` → `tokens_recuperacion`
  → `sesiones`), así que las operaciones sobre una misma cuenta se ejecutan una tras otra. El cambio vuelve a comprobar,
  bajo el bloqueo, que la sesión sigue abierta (si no, `401`) y que la contraseña no cambió desde que se verificó (si
  cambió, `400` sin contar como intento): un cambio nunca sobrescribe un restablecimiento simultáneo, y de dos cambios
  simultáneos gana uno solo. El intento de cambio se reserva antes de verificar la contraseña, así que peticiones
  paralelas no superan el límite. Dentro de las transacciones sólo hay lecturas con bloqueo: con el aislamiento por
  instantánea de MariaDB (`innodb_snapshot_isolation`, activo por omisión desde 11.6) una lectura simple previa
  provocaría «Record has changed since last read». Si falla el rollback, se conserva el error original.
- **Auditoría:** `EDITAR usuarios` «Cambio de contraseña» y «Restablecimiento de contraseña». La solicitud no se audita
  (igual que el mock).
- Las páginas de contraseña de Angular usan estos endpoints (`ApiAuthService`).

## Operaciones de dominio

`POST /api/rpc` con `{ "service": "PlayerService", "method": "search", "args": [{ "query": "Ana" }] }` ejecuta **en la
API** el método del servicio de dominio de Angular, con el usuario de la cookie, sobre MariaDB (decisión D13,
[`MARIADB.md`](database/MARIADB.md)). Responde `{ "result": … }` con el mismo modelo que devolvía sobre `MockDb`.

- **Lista blanca:** [`src/app/core/api/rpc-methods.ts`](../src/app/core/api/rpc-methods.ts), 22 servicios y 126
  métodos: los que usan las páginas. Cada uno verifica permiso y alcance con `AuthorizationService` en su primera
  línea; los métodos internos (síncronos, `profileAccount`, `AuthService.*`) no se exponen (`404`).
- **Unidad de trabajo** ([`api/rpc.ts`](../api/rpc.ts)): candado `GET_LOCK` por base → transacción → carga de las
  tablas ([`api/tables.ts`](../api/tables.ts)) → servicio → INSERT/UPDATE/DELETE sólo de lo que cambió → COMMIT.
  Las tablas que sólo escribe el puente viven en memoria (inmutables) y se releen cuando cambia `version_datos`
  (migración 003); un cambio manual con SQL debe incrementarlo o reiniciar la API.
  Cualquier error deshace todo. Bloqueos por concurrencia con los endpoints de sesión se reintentan (hasta 3 veces).
- **Errores:** regla de negocio del servicio → `400` con su mensaje; `ForbiddenError` → `403`; argumentos que el
  servicio no puede usar → `400` «Datos de la solicitud inválidos.» (y se registra); restricción de MariaDB
  (duplicado, FK, CHECK) → `409` con un mensaje genérico (HU-073); candado ocupado o correo sin transporte → `503`.
- **Correo:** los mensajes que encola el servicio (invitaciones) se envían **después** del COMMIT; sin transporte, la
  operación se deshace y responde `503` (D4b).
- **Respuestas:** nunca incluyen `passwordHash` ni `tokenHash` (se eliminan de todo el resultado).
- **Argumentos:** vienen del navegador. Los servicios copian sólo los campos de su borrador (nunca `...draft` en una
  fila), así que un cliente no puede fijar `active`, `createdAt` ni otros campos que la operación no recibe; un nombre
  de servicio o método fuera de la lista (incluidos `constructor`, `__proto__`…) responde `404`.
- **Valores de catálogo y booleanos (T1/T2):** un argumento que va a una columna `ENUM` debe ser **un texto** igual a
  uno de sus valores (no un arreglo como `["ACTIVO"]`, ni `null`, ni otra capitalización, ni nombres como
  `toString`); uno que va a una columna `BOOLEAN` debe ser `true` o `false` (no `"false"`, `0` ni `null`). Si no,
  `400` con el mensaje de la operación («Estatus inválido.», «Estado inválido.», «Tipo inválido.», «Forma de pago
  inválida.», «Tipo de ajuste inválido.», «Estado de asistencia inválido.», «Valor de «activo» inválido.»…) y no se
  escribe nada. El permiso se verifica antes que el valor (`403` primero). Validadores: `oneOf` y `flag` de
  `src/app/shared/validate.ts`. Operaciones: `PlayerService.create` (estatus) y `changeStatus`;
  `EnrollmentService.enroll` (sólo `PENDIENTE` o `ACTIVA`) y `setStatus`; `TrainingService.setStatus`;
  `AttendanceService.record`; `CompetitionService.save` (tipo y estatus), `register` y `setParticipationStatus`;
  `BillingService.registerPayment` (forma de pago), `addDiscount` (tipo), `saveConcept` (`recurring`) y
  `setConceptActive`; `setActive` de `UserService`, `CategoryService`, `ScheduleService`, `CoachService` y
  `VenueService`; `UniformService.setProductActive/setVariantActive`; `NoticeService.save` (`published`) y
  `setPublished`; `RoleService.setPermission` (`granted`); `SeasonService.save` (`active`, `isCurrent`);
  `TutorService.save` (`isPrimary` de cada vínculo). `CompetitionService.register` permite **omitir** `status`
  (HU-035.4): queda `INSCRITA`, también al reinscribir una participación en `BAJA`; `null` no cuenta como omitido. Los
  filtros de las consultas (listas, búsquedas) no se validan con estas reglas. Pruebas: `api/input-validation.test.ts`.
- **Modo estricto:** cada conexión de la API agrega `STRICT_TRANS_TABLES` a su `sql_mode` (`createPool`, después de
  cualquier `initSql`), aunque el servidor no lo tenga: si un valor inválido llegara a MariaDB, se rechaza en lugar de
  guardarse como `''`. Ese error no se traduce a `400`: responde `500` y se registra, porque indica una validación
  que falta en el servicio.
- **Cuerpo:** hasta 200 KB (formularios completos: listas de asistencia, avisos); el resto de los endpoints, 10 KB.
- **Sesión:** cada operación valida la cookie y renueva su uso (HU-002); un `401` hace que el frontend vuelva al
  login. Los permisos se recalculan en cada solicitud (HU-006).

## Práctica de laboratorio: dos endpoints GET

La práctica pide Node.js + Express + MySQL + Postman, una base existente y dos endpoints `GET`. Se cumple **extendiendo
esta API**, no con un proyecto aparte:

| La práctica pide   | Charales usa                       | Por qué                                                                              |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------------------ |
| MySQL + `mysql2`   | **MariaDB + driver `mariadb`**     | Es la base real del proyecto integrador (`escuela_futbol`); mismo SQL                |
| Express            | `node:http` (ya existente)         | La API ya está construida así; el objetivo (API REST + BD + Postman) se cumple igual |
| Endpoints públicos | Sesión (cookie HttpOnly) + permiso | `jugadores` tiene datos de menores; se respeta `AUTHORIZATION.md`                    |

- `GET /api/jugadores` → `SELECT * FROM jugadores ORDER BY id`, permiso `jugadores.consultar` (como
  `PlayerService.search`).
- `GET /api/categorias` → `SELECT * FROM categorias ORDER BY id`, cualquier permiso de oficina (como
  `CategoryService.list`).
- Devuelven las filas **tal como están en MariaDB** (columnas `snake_case`, `DATETIME` como `"YYYY-MM-DD HH:MM:SS"`,
  `BOOLEAN` como `0/1`) para compararlas 1:1 con la base. El contrato definitivo (`camelCase`, § Convenciones) se aplica
  cuando el frontend consuma estos datos.
- Datos: `npm run db:mariadb:dev-seed` (obsoleto; para la app usa `npm run db:setup -- --demo`), sólo sobre una base
  sin usuarios ni jugadores (ver arriba): carga la temporada actual, 3 categorías y 6 jugadores ficticios (los de
  `MockDb`).

**Comparar API y base:**

```bash
mariadb escuela_futbol -e "SELECT * FROM jugadores ORDER BY id;"
mariadb escuela_futbol -e "SELECT * FROM categorias ORDER BY id;"
curl -s -c jar -o /dev/null -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"demo1234"}' localhost:3000/auth/login
curl -s -b jar localhost:3000/api/jugadores
curl -s -b jar localhost:3000/api/categorias
```

Cada fila de la tabla es un objeto del arreglo, en el mismo orden (`id`), con las mismas columnas y valores; `NULL` es
`null`. Las pruebas de `api/api.test.ts` hacen esa comparación automáticamente (`deepEqual` contra el `SELECT *`).

## Frontend (Angular)

```text
Angular :4200 ──/api, /auth, /health──▶ proxy de ng serve (proxy.conf.json) ──▶ API :3000 ──▶ MariaDB
```

- **Sesión:** `ApiAuthService` (provisto como `AuthService` en `app.config.ts`) inicia y cierra sesión, cambia y
  recupera contraseñas por HTTP. Los guards preguntan a la API en cada navegación (`GET /auth/session`): la API valida
  la cookie (8 h, 30 min de inactividad, cuenta activa) y devuelve el `AuthUser` con los permisos vigentes. Una
  cookie válida restaura la sesión en otra pestaña. Angular nunca lee la cookie (`HttpOnly`).
- **Datos:** cada servicio de dominio es un cliente de `POST /api/rpc` con los mismos métodos (`rpcProviders()` en
  [`rpc-services.ts`](../src/app/core/api/rpc-services.ts)); las páginas no cambiaron. Un `401` de cualquier operación
  borra la sesión local y lleva al login con `expired=1`.
- **Mismo origen:** el navegador sólo habla con `:4200`; el proxy reenvía esos prefijos, así que la cookie viaja sola
  (sin CORS ni `withCredentials`). En producción el build debe servirse en el mismo origen que la API.
- **Pruebas del frontend:** usan `baseProviders` (sin la API): los servicios corren sobre `MockDb`, que es el mismo
  código que ejecuta la API. El lado del servidor lo prueban `api/*.test.ts` sobre MariaDB.
- La página `/admin/api` sigue mostrando la práctica de laboratorio (`CharalesApi.players/categories`).

```bash
npm run api:start   # terminal 1: API en :3000
npm start           # terminal 2: Angular en :4200 con el proxy
```

## Postman

Colección local versionada: [`postman/collections/Charales`](../postman/collections/Charales) (formato v3, un YAML por
request) y [`postman/environments/local.environment.yaml`](../postman/environments/local.environment.yaml) (sólo
cuentas de desarrollo). No requiere cuenta ni la nube de Postman; la API no depende de Postman.

```bash
postman collection lint postman/
postman collection run postman/collections/Charales -e postman/environments/local.environment.yaml   # API corriendo
```

La carpeta `Dominio` prueba `POST /api/rpc` (sólo lecturas). La carpeta `Auth` es una secuencia (el orden importa): la cookie que deja el login la reenvía el cookie jar de Postman.
Valores locales distintos: `postman/environments/*.local.environment.yaml` (no se versiona). Cada endpoint nuevo llega
con su request, ejemplos y `pm.test` en la misma PR; las pruebas propias del backend siguen siendo `api/*.test.ts`.

## Producción y despliegue

**Estado (auditoría 2026-10-15):** desarrollo verificado y preparado para revisión; **no desplegado**. Nada de lo
anterior corre en producción.

| Requisito del entorno objetivo            | Qué hacer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mismo origen                              | Servir `dist/project/browser` y la API detrás de un único dominio: el proxy inverso envía `/api`, `/auth` y `/health` a la API (como hace `e2e/app.e2e.ts`). La API no envía cabeceras CORS a propósito.                                                                                                                                                                                                                                                                                                                                                         |
| HTTPS y cookie                            | `NODE_ENV=production` (o `COOKIE_SECURE=true`): la cookie lleva `Secure`. Sin HTTPS el navegador no la enviaría.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| IP real del cliente                       | `TRUSTED_PROXIES` con las IP exactas del proxy inverso, separadas por comas (sin rangos ni nombres; una entrada inválida impide arrancar). Sólo cuando la conexión viene de una de ellas se usa `X-Forwarded-For`: el salto más a la derecha que no sea un proxy propio. El proxy debe **añadir** la IP del cliente a ese encabezado (nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`). Sin `TRUSTED_PROXIES` el encabezado se ignora y cuenta la IP de la conexión: detrás de un proxy, todos los clientes compartirían el límite por IP. |
| Base de datos                             | Base nueva: `docs/escuela_futbol_mariadb.sql` (**borra sus 39 tablas si la base existe**) + `db/mariadb/scripts/migrate.sh` + `010_permisos_app.sql`. Base existente: **sólo** `migrate.sh` (idempotente). Nunca `020_dev_seed.sql` ni `db:mariadb:demo`.                                                                                                                                                                                                                                                                                                        |
| Planificador de MariaDB                   | `event_scheduler=ON` en la configuración del servidor para el trabajo diario de VENCIDO (migración 002). Ver [`MARIADB.md`](database/MARIADB.md#migraciones).                                                                                                                                                                                                                                                                                                                                                                                                    |
| Zona horaria                              | Servidor de base de datos y API en la hora de la escuela (`America/Mexico_City`): `DATETIME` guarda hora local sin zona (`MARIADB.md` § 1).                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Correo (D4c: **Resend**, sin implementar) | Proveedor elegido el 2026-11-02 (DP-04). Tareas de despliegue: un transporte de Resend en `password.mailerFromEnv` (pasa por `withAppUrl`, que vuelve absolutos los enlaces con `APP_URL`), dominio remitente verificado con sus registros DNS, la clave de API como variable de entorno del servidor (nunca en el repositorio) y una prueba real de recuperación e invitación. Hasta entonces la recuperación y las invitaciones responden `503` y no crean nada.                                                                                               |
| Una sola instancia o varias               | Varias instancias son seguras para los datos (`version_datos`, candado por base) y para el límite del login (en MariaDB, S-01; cada instancia tiene además su pool de 2 conexiones para el limitador). El límite del cambio de contraseña y de la solicitud de recuperación sigue en la memoria de cada proceso.                                                                                                                                                                                                                                                 |
| Respaldo                                  | `db/mariadb/scripts/backup.sh` diario; periodicidad y restauración en [`MARIADB.md` § 6](database/MARIADB.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

**Seguridad de la sesión:** cookie `HttpOnly; SameSite=Strict; Path=/` de 8 h (30 min de inactividad), sólo el SHA-256
del token en `sesiones`. CSRF: además de `SameSite=Strict`, los cuerpos sólo se aceptan como `application/json`, que un
formulario de otro sitio no puede enviar sin una solicitud previa de CORS (que la API no autoriza). Probado en
`api/rpc.test.ts` («CSRF and CORS», «session cookie attributes»).

## Decisiones

- **Sin framework HTTP:** `node:http` y una tabla de rutas exactas; el dominio entra por un solo endpoint (D13), así
  que sigue sin hacer falta un router.
- **argon2id con `node:crypto`** (m=19 MiB, t=2, p=1; formato PHC). Sin dependencia nativa.
- **Permisos recalculados en cada `GET /auth/session` y en cada operación de dominio.** `sesiones` no tiene columna para guardar la foto de permisos
  del login, así que un cambio de permisos (HU-006) o de perfil se refleja ya en las sesiones abiertas, no sólo en las
  nuevas. Es más estricto que el mock; si se quiere la foto exacta hace falta una columna (cambio de esquema).
- **El límite de intentos sólo retiene contraseñas incorrectas:** la contraseña correcta de una cuenta deshabilitada no
  es un intento de adivinar y devuelve su reserva.

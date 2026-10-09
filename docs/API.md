# API — contrato de endpoints

Estado: **Milestone 1** (infraestructura + autenticación) + dos `GET` de la práctica de laboratorio. Código en [`api/`](../api); sobre el modelo
[`MARIADB.md`](database/MARIADB.md) (convenciones de JSON en § 1, sesión en § 8.3). El frontend todavía usa `MockDb`.

## Ejecutar

Requisitos: Node `>=24.7` (usa `crypto.argon2` y TypeScript sin compilar; probado con 26.11) y MariaDB local.

```bash
cp .env.example .env              # ajusta DB_* (TCP o DB_SOCKET); .env no se versiona
npm run db:mariadb:dev-seed       # 010_permisos_app.sql + 020_dev_seed.sql sobre DB_NAME (por defecto escuela_futbol)
npm run api:start                 # http://localhost:3000
npm run api:test                  # pruebas en una base temporal ef_apitest_* que se borra al terminar
```

| Variable                  | Por defecto      | Notas                                                                                                                          |
| ------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                    | `3000`           |                                                                                                                                |
| `DB_NAME`                 | `escuela_futbol` |                                                                                                                                |
| `DB_HOST` / `DB_PORT`     | `127.0.0.1:3306` | Se ignoran si hay `DB_SOCKET`                                                                                                  |
| `DB_SOCKET`               | —                | Socket local (autenticación `unix_socket`)                                                                                     |
| `DB_USER` / `DB_PASSWORD` | —                | Nunca en el repo                                                                                                               |
| `DB_POOL_SIZE`            | `5`              |                                                                                                                                |
| `COOKIE_SECURE`           | `false`          | Siempre `Secure` con `NODE_ENV=production`                                                                                     |
| `MAIL_CONSOLE`            | `false`          | Sólo desarrollo: imprime en la consola de la API el correo de recuperación (con el enlace). Ignorado con `NODE_ENV=production` |

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
- Login con 5 contraseñas incorrectas para el mismo correo desde la misma IP en 15 min → `429` hasta que pase la
  ventana (en memoria del proceso).
- `auditoria`: `LOGIN`, `LOGOUT` e «Intento de acceso fallido» (módulo `auth`), como el `AuthService` del mock.

## Endpoints

| Método y ruta                       | Sesión | Respuestas                                                                                                                                                      |
| ----------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                       | No     | `200 {status:"ok",database:"ok"}` · `503` si MariaDB no responde                                                                                                |
| `POST /auth/login`                  | No     | `200 AuthUser` + cookie · `400` faltan datos · `401` correo/contraseña incorrectos **o cuenta deshabilitada** (mismo mensaje) · `403` sin rol ni perfil · `429` |
| `GET /auth/session`                 | Sí     | `200 AuthUser` (renueva el uso) · `401` sin sesión, vencida o cerrada                                                                                           |
| `POST /auth/logout`                 | —      | `204` siempre; borra la cookie y cierra la sesión si había una                                                                                                  |
| `POST /auth/password`               | Sí     | `{currentPassword, newPassword}` → `204` (cierra las otras sesiones) · `400` actual incorrecta, política o igual a la actual · `401` sin sesión · `429`         |
| `POST /auth/password-reset/request` | No     | `{email}` → `204` siempre (exista o no la cuenta) · `400` sin correo · `429` · `503` sin transporte de correo                                                   |
| `POST /auth/password-reset/confirm` | No     | `{token, newPassword}` → `204` (cierra todas las sesiones y borra la cookie) · `400` política, o «El enlace no es válido o ya expiró.»                          |
| `GET /api/jugadores`                | Sí     | `200` arreglo de filas de `jugadores` · `401` sin sesión · `403` sin `jugadores.consultar` del rol de seguridad                                                 |
| `GET /api/categorias`               | Sí     | `200` arreglo de filas de `categorias` · `401` sin sesión · `403` sin ningún permiso de oficina                                                                 |

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
- **Correo:** no hay proveedor (D4c pendiente). Sin transporte, la solicitud responde `503` antes de consultar la
  cuenta, y la recuperación queda **deshabilitada en producción**. En desarrollo, `MAIL_CONSOLE=true` imprime el correo
  (con el enlace y su token) en la consola de la API; nunca con `NODE_ENV=production`.
- **Sólo tokens de recuperación (D3e):** `tokens_recuperacion` no tiene columna de finalidad, así que la API no emite
  invitaciones. Antes de hacerlo hará falta una migración con finalidad explícita (aprobación propia).
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
- Las páginas de contraseña de Angular **siguen usando el mock** hasta que se integre el login real (M4/M5).

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
- Datos: `npm run db:mariadb:dev-seed` carga la temporada actual, 3 categorías y 6 jugadores ficticios (los de `MockDb`).

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

Capa HTTP: [`src/app/core/api/charales-api.service.ts`](../src/app/core/api/charales-api.service.ts) (`CharalesApi`),
registrada con `provideHttpClient(withFetch())` en `app.config.ts`. Página de demostración: **`/admin/api`** («Datos
desde la API», menú Sistema, permiso `jugadores.consultar`).

```text
Angular :4200 ──/api, /auth, /health──▶ proxy de ng serve (proxy.conf.json) ──▶ API :3000 ──▶ MariaDB escuela_futbol
```

- **Mismo origen:** el navegador sólo habla con `:4200`; el proxy de `ng serve` reenvía esos prefijos a la API. Por eso
  la cookie `charales_sid` viaja sola: sin CORS y sin `withCredentials`. Angular nunca lee ni guarda la cookie
  (`HttpOnly`); sabe si hay sesión con `GET /auth/session` (401 = no hay).
- **Sesión separada:** el login de la app todavía es el mock (`AuthService` + `MockDb`); la API tiene su propia sesión.
  La página pide iniciar sesión en la API cuando no hay una. Se unifican al migrar `AuthService`.
- `CharalesApi` devuelve `Promise` de los modelos existentes (`Player`, `Category`): convierte las filas `snake_case`
  de la práctica, `DATETIME` → `"YYYY-MM-DDTHH:MM:SS"` y `activo` 0/1 → `boolean`. Los errores son `Error` con el
  mensaje de la API (401, 403…), o «No se pudo conectar con la API» si no responde (estado 0, o 502/504 del proxy), así
  que `Submission` y `<app-load-state>` los muestran sin cambios.
- **Producción:** el proxy sólo existe en `ng serve`; el build debe servirse en el mismo origen que la API (proxy
  inverso). Detrás de un proxy, la API ve la IP del proxy: el límite de intentos de login necesitará
  `X-Forwarded-For` de confianza.
- `PlayerService`, `CategoryService` y el resto siguen sobre `MockDb`; pasarlos a la API es la fase de integración
  ([`ROADMAP.md`](ROADMAP.md)).

```bash
npm run api:start   # terminal 1: API en :3000
npm start           # terminal 2: Angular en :4200 con el proxy → /admin/api
```

## Postman

Colección local versionada: [`postman/collections/Charales`](../postman/collections/Charales) (formato v3, un YAML por
request) y [`postman/environments/local.environment.yaml`](../postman/environments/local.environment.yaml) (sólo
cuentas de desarrollo). No requiere cuenta ni la nube de Postman; la API no depende de Postman.

```bash
postman collection lint postman/
postman collection run postman/collections/Charales -e postman/environments/local.environment.yaml   # API corriendo
```

La carpeta `Auth` es una secuencia (el orden importa): la cookie que deja el login la reenvía el cookie jar de Postman.
Valores locales distintos: `postman/environments/*.local.environment.yaml` (no se versiona). Cada endpoint nuevo llega
con su request, ejemplos y `pm.test` en la misma PR; las pruebas propias del backend siguen siendo `api/*.test.ts`.

## Decisiones

- **Sin framework HTTP:** `node:http` y una tabla de rutas exactas; un router entra cuando haya parámetros de ruta.
- **argon2id con `node:crypto`** (m=19 MiB, t=2, p=1; formato PHC). Sin dependencia nativa.
- **Permisos recalculados en cada `GET /auth/session`.** `sesiones` no tiene columna para guardar la foto de permisos
  del login, así que un cambio de permisos (HU-006) o de perfil se refleja ya en las sesiones abiertas, no sólo en las
  nuevas. Es más estricto que el mock; si se quiere la foto exacta hace falta una columna (cambio de esquema).
- **El límite de intentos sólo cuenta contraseñas incorrectas:** la contraseña correcta de una cuenta deshabilitada no
  es un intento de adivinar.

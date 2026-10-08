# API — contrato de endpoints

Estado: **Milestone 1** (infraestructura + autenticación). Código en [`api/`](../api); sobre el modelo
[`MARIADB.md`](database/MARIADB.md) (convenciones de JSON en § 1, sesión en § 8.3). El frontend todavía usa `MockDb`.

## Ejecutar

Requisitos: Node `>=24.7` (usa `crypto.argon2` y TypeScript sin compilar; probado con 26.11) y MariaDB local.

```bash
cp .env.example .env              # ajusta DB_* (TCP o DB_SOCKET); .env no se versiona
npm run db:mariadb:dev-seed       # 010_permisos_app.sql + 020_dev_seed.sql sobre DB_NAME (por defecto escuela_futbol)
npm run api:start                 # http://localhost:3000
npm run api:test                  # pruebas en una base temporal ef_apitest_* que se borra al terminar
```

| Variable                  | Por defecto      | Notas                                      |
| ------------------------- | ---------------- | ------------------------------------------ |
| `PORT`                    | `3000`           |                                            |
| `DB_NAME`                 | `escuela_futbol` |                                            |
| `DB_HOST` / `DB_PORT`     | `127.0.0.1:3306` | Se ignoran si hay `DB_SOCKET`              |
| `DB_SOCKET`               | —                | Socket local (autenticación `unix_socket`) |
| `DB_USER` / `DB_PASSWORD` | —                | Nunca en el repo                           |
| `DB_POOL_SIZE`            | `5`              |                                            |
| `COOKIE_SECURE`           | `false`          | Siempre `Secure` con `NODE_ENV=production` |

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

| Método y ruta       | Sesión | Respuestas                                                                                                                                                      |
| ------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`       | No     | `200 {status:"ok",database:"ok"}` · `503` si MariaDB no responde                                                                                                |
| `POST /auth/login`  | No     | `200 AuthUser` + cookie · `400` faltan datos · `401` correo/contraseña incorrectos **o cuenta deshabilitada** (mismo mensaje) · `403` sin rol ni perfil · `429` |
| `GET /auth/session` | Sí     | `200 AuthUser` (renueva el uso) · `401` sin sesión, vencida o cerrada                                                                                           |
| `POST /auth/logout` | —      | `204` siempre; borra la cookie y cierra la sesión si había una                                                                                                  |

`AuthUser` es la interfaz de `src/app/core/auth/session.store.ts`: `userId`, `sessionId`, `email`, `displayName`,
`roles`, `permissions`, `officePermissions`, `tutorId`, `coachId`, `isStaff`, `expiresAt`, `lastUsedAt`. Nunca incluye
`password_hash`.

```bash
curl -i -c jar -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"demo1234"}' localhost:3000/auth/login
curl -b jar localhost:3000/auth/session
curl -b jar -c jar -X POST localhost:3000/auth/logout
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

# Arquitectura

Estado: rama `jorgesucre/api-express` (2026-10-13). Cómo trabajar en el proyecto: [`DEVELOPMENT.md`](DEVELOPMENT.md).

## Lo que existe hoy

```text
Navegador · Angular 22 (standalone, zoneless, signals)
  páginas  features/<dominio>/*.page(s).ts            formularios y vistas; no cambian
    ↓
  servicios (clientes)  rpcProviders(): mismos métodos, cada llamada → POST /api/rpc
  sesión                ApiAuthService (como AuthService): /auth/login, /auth/session, /auth/password…
    ↓ HTTP, cookie HttpOnly (mismo origen: proxy de ng serve)
API · Node node:http (api/)
  /auth/*               argon2id, sesiones, límite de intentos, recuperación (HU-001..005, HU-072)
  /api/rpc              candado + transacción → carga tablas → SERVICIO DE DOMINIO de Angular → diff → COMMIT (D13)
    · los servicios  features/<dominio>/*.service.ts y core/services/, empaquetados por esbuild (api/domain)
    · validan reglas, escriben auditoría y verifican permiso y alcance con AuthorizationService, con el
      AuthUser de la cookie
    ↓
MariaDB · docs/escuela_futbol_mariadb.sql + db/mariadb/migrations + 010_permisos_app.sql
```

- Los servicios de dominio son **un solo código** con dos usos: en la API, sobre las tablas de MariaDB (una
  instancia de `MockDb` por solicitud, como unidad de trabajo); en las pruebas del frontend, sobre la semilla en
  memoria de `MockDb`. El navegador nunca los ejecuta: recibe clientes HTTP con los mismos métodos.
- `MockDb` ya no es el backend de la app: es la estructura en memoria de las tablas (y la semilla de las pruebas y de
  `npm run db:mariadb:demo`). `MockDb.transaction()` sigue revirtiendo en memoria; en la API, además, MariaDB hace
  ROLLBACK de la transacción completa.
- La sesión vive en el servidor (`sesiones`); el navegador guarda en `sessionStorage` una copia del `AuthUser` para
  menús y guards, que se revalida con la API en cada navegación.

## Capas y responsabilidades

| Capa                 | Dónde                                                           | Responsabilidad                                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arranque y rutas     | `app.ts`, `app.config.ts`, `app.routes.ts`                      | Rutas lazy por área: `/admin` (oficina), `/sports` (deportivo de oficina), `/coach` (panel del entrenador), `/portal` (tutor). Cada hoja declara su permiso (`page()`)                                    |
| Layout               | `layout/shell.ts`, `nav.ts`, `home.ts`                          | Marco, menú (`NAV_ITEMS`, cada entrada con su permiso) e inicio                                                                                                                                           |
| Páginas              | `features/<dominio>/`                                           | Componentes standalone con template inline, formularios reactivos tipados (`FieldError`, `Submission`), `resource()`. Sólo llaman servicios                                                               |
| Servicios            | `features/<dominio>/*.service.ts`                               | Una entidad = un servicio que la escribe ([`database/OWNERSHIP.md`](database/OWNERSHIP.md)). Devuelven `Promise`; los ejecuta la API (`/api/rpc`, D13)                                                    |
| Lecturas compartidas | `core/services/`                                                | `PlayerService`, `CategoryService`, `CompetitionService`, `AuditService`, `MailerService` (correo simulado en `outbox`)                                                                                   |
| Capa HTTP (API)      | `core/api/charales-api.service.ts`, `rpc-services.ts`           | `CharalesApi` sobre `HttpClient`: sesión, contraseñas y `rpc()`; `rpcProviders()` convierte cada servicio de dominio en su cliente (D13). Mismo origen vía `proxy.conf.json`                              |
| Reglas puras         | `features/billing/billing.rules.ts`                             | Saldos, estados de cargo, aplicación de pagos, ingresos: especificación de cobranza para la API                                                                                                           |
| Modelos              | `core/models/`                                                  | Tipos TypeScript por dominio (`common`, `security`, `people`, `sports`, `billing`, `uniforms`, `notices`). Mismos campos que las tablas MariaDB, en `camelCase`                                           |
| Autenticación        | `core/auth/api-auth.service.ts` (app), `auth.service.ts` (mock) | La app usa `ApiAuthService` contra la API (argon2id, cookie HttpOnly, 8 h / 30 min). `AuthService` es el mock que usan las pruebas y, en el servidor, los servicios de dominio (`accessOf`, invitaciones) |
| Autorización         | `core/auth/authorization.service.ts`                            | Permiso + alcance (relaciones) de cada operación. Ver abajo y [`AUTHORIZATION.md`](AUTHORIZATION.md)                                                                                                      |
| Permisos             | `core/auth/permissions.ts`                                      | Catálogo (`PERMISSION_CATALOG`, 59) y matriz inicial por rol (`DEFAULT_ROLE_PERMISSIONS`). `db/mariadb/010_permisos_app.sql` la replica                                                                   |
| Guards               | `core/auth/guards.ts`                                           | Sesión válida (la API la confirma en cada navegación) + permiso de la ruta. Sólo protegen la UI; la barrera real es el servicio, que corre en la API                                                      |
| Tablas en memoria    | `core/data/mock-db.ts`                                          | Un arreglo por tabla: unidad de trabajo en la API (cargada de MariaDB) y semilla de las pruebas y de `npm run db:mariadb:demo`                                                                            |
| Integridad           | `core/data/mock-db.integrity.ts`                                | `integrityViolations()`: las restricciones del SQL (FK, UNIQUE, CHECK) verificadas sobre `MockDb` después de cada prueba de flujo                                                                         |
| Utilidades           | `shared/`                                                       | Dinero en centavos (`money.ts`, `MoneyPipe`), fechas locales (`dates.ts`), paginación (`page.ts`), validación (`validate.ts`), UI común                                                                   |
| Estilos              | `src/styles.css`                                                | Estilos globales y responsive                                                                                                                                                                             |

## Autorización: dónde vive cada cosa

- **Definición de permisos:** `core/auth/permissions.ts`. Los permisos son filas `modulo.accion` de la tabla `permisos`.
  La matriz es editable en ejecución desde la pantalla Permisos (HU-006); la API recalcula los permisos en cada
  solicitud, así que un cambio aplica desde la siguiente acción, también en sesiones abiertas.
- **Cálculo de la sesión:** `AuthService.accessOf` arma, a partir del rol de seguridad y los perfiles vinculados:
  - `permissions`: unión del rol de seguridad y de los perfiles (TUTOR, ENTRENADOR), para menús y áreas de perfil;
  - `officePermissions`: **sólo** los del rol de seguridad (ADMINISTRADOR o SECRETARIA).
- **Regla única:** `grants()` en `core/auth/session.store.ts`. Un permiso de módulo de perfil (`portal`,
  `panel_entrenador`) sale del perfil; cualquier otro módulo cuenta **sólo si lo da el rol de seguridad**. La usan las
  rutas y el menú (`AuthService.can`) y los servicios (`AuthorizationService.has/require/assertPlayer/assertCategory`).
- **Validación de alcance (scopes):** `AuthorizationService` resuelve las relaciones a partir de la sesión, nunca de un
  id enviado por quien llama: `tutorChildren()` (tutor → `tutor_jugador`), `coachCategories()`,
  `coachParticipations()` y `coachPlayers()` (entrenador → asignaciones vigentes). Las sesiones de entrenamiento usan
  `TrainingService.inScope/canRecord`.
- **Catálogos de oficina:** `requireOffice()` exige al menos un permiso del rol de seguridad; un perfil solo no basta.
- **No escalada:** `assertCanGrantRole` / `assertCanManageAccount` sólo dejan asignar o administrar un rol cuyos
  permisos ya tiene el rol de seguridad de quien actúa; `UserService.profileAccount` impide vincular la propia cuenta a
  un perfil.

Matriz por rol, regla de perfiles vinculados y contrato por operación: [`AUTHORIZATION.md`](AUTHORIZATION.md).

## Base de datos

| Qué                          | Dónde                                                                              | Estado                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Modelo vigente (MariaDB)     | `docs/escuela_futbol_mariadb.sql` (39 tablas) + `db/mariadb/migrations` + checks   | Probado: 42/42 checks. Conectado a la app por la API (D13) |
| Permisos de la app           | `db/mariadb/010_permisos_app.sql`                                                  | 59 permisos, 106 filas de `rol_permiso`                    |
| Respaldo y restauración      | `db/mariadb/scripts/`                                                              | Probado: 39/39 tablas idénticas                            |
| Esquema anterior (histórico) | `db/migrations`, `db/seed`, `db/tests`, `db/queries`, `db/scripts` (PostgreSQL 16) | Sólo historial; no se le agregan migraciones               |

Detalle: [`database/MARIADB.md`](database/MARIADB.md).

## API y dominio

| Qué                         | Dónde                                                               |
| --------------------------- | ------------------------------------------------------------------- |
| Servidor y rutas            | `api/server.ts`                                                     |
| Autenticación, contraseñas  | `api/auth.ts`, `api/password.ts`                                    |
| Puente de dominio (D13)     | `api/rpc.ts` (unidad de trabajo), `api/tables.ts` (columnas)        |
| Servicios en el servidor    | `api/domain/index.ts` → `npm run api:build`                         |
| Lista blanca de operaciones | `src/app/core/api/rpc-methods.ts`                                   |
| Clientes en el navegador    | `src/app/core/api/rpc-services.ts`, `core/auth/api-auth.service.ts` |
| Datos de demostración       | `api/demo.ts` (`npm run db:mariadb:demo`)                           |

**Lo que sigue siendo temporal:** no hay proveedor de correo real (la recuperación y las invitaciones responden 503
en producción, D4b/D4c). El trabajo diario de VENCIDO (migración 002) necesita `event_scheduler = ON` en el
servidor.

## Requisitos y diagramas

- Las 76 HU: [`requirements/USER_STORIES.md`](requirements/USER_STORIES.md) (tabla oficial, no se edita).
- HU → código → pruebas y decisiones posteriores: [`TRACEABILITY.md`](TRACEABILITY.md).
- El diagrama «Flujo de la Plataforma — Escuela de Fútbol Infantil» está incrustado en el documento Word de revisión
  del Product Backlog, que **no** forma parte del repositorio. El único diagrama versionado es el ER (Mermaid) del
  esquema PostgreSQL histórico, en [`database/relationships.md`](database/relationships.md).

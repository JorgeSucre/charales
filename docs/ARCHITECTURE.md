# Arquitectura

Estado de `main` en `18178ba` (2026-10-07). Cómo trabajar en el proyecto: [`DEVELOPMENT.md`](DEVELOPMENT.md).

## Lo que existe hoy

```text
Navegador
  Angular 22 (standalone, zoneless, signals)
    páginas  src/app/features/<dominio>/*.page(s).ts      formularios y vistas; nunca inyectan MockDb
      ↓
    servicios de dominio  features/<dominio>/*.service.ts y core/services/
      · validan reglas de negocio, abren transacciones, escriben auditoría
      · verifican permiso y alcance con AuthorizationService
      ↓
    MockDb  src/app/core/data/mock-db.ts                   arreglos en memoria, uno por tabla MariaDB
```

**La API está en construcción** (`api/`, [`API.md`](API.md)): Milestone 1 tiene salud y autenticación sobre MariaDB,
pero la aplicación Angular **todavía no la consume**. `MockDb` no es un backend: es estado en memoria del navegador que imita las tablas
del modelo MariaDB.

**Persistencia actual:**

- Los datos viven en memoria y **se reinician al recargar la página** (el seed se reconstruye en cada carga).
- Lo único que sobrevive a una recarga es la sesión del usuario: una copia en `sessionStorage` (clave
  `charales.session`, `core/auth/session.store.ts`), que se descarta al cerrar la pestaña.
- `MockDb.respond()` simula 120 ms de latencia y devuelve copias (`structuredClone`) para que nadie modifique el estado
  "del servidor" por referencia. `MockDb.transaction()` revierte todos los cambios si la operación falla.

**Modelo MariaDB:** existe como DDL probado ([`database/MARIADB.md`](database/MARIADB.md)), pero la aplicación no se
conecta a él. Es el contrato que seguirán la API y la integración, que son la siguiente fase ([`ROADMAP.md`](ROADMAP.md)).

## Capas y responsabilidades

| Capa                 | Dónde                                      | Responsabilidad                                                                                                                                                        |
| -------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arranque y rutas     | `app.ts`, `app.config.ts`, `app.routes.ts` | Rutas lazy por área: `/admin` (oficina), `/sports` (deportivo de oficina), `/coach` (panel del entrenador), `/portal` (tutor). Cada hoja declara su permiso (`page()`) |
| Layout               | `layout/shell.ts`, `nav.ts`, `home.ts`     | Marco, menú (`NAV_ITEMS`, cada entrada con su permiso) e inicio                                                                                                        |
| Páginas              | `features/<dominio>/`                      | Componentes standalone con template inline, formularios reactivos tipados (`FieldError`, `Submission`), `resource()`. Sólo llaman servicios                            |
| Servicios            | `features/<dominio>/*.service.ts`          | Una entidad = un servicio que la escribe ([`database/OWNERSHIP.md`](database/OWNERSHIP.md)). Devuelven `Promise`; serán los endpoints de la API                        |
| Lecturas compartidas | `core/services/`                           | `PlayerService`, `CategoryService`, `CompetitionService`, `AuditService`, `MailerService` (correo simulado en `outbox`)                                                |
| Reglas puras         | `features/billing/billing.rules.ts`        | Saldos, estados de cargo, aplicación de pagos, ingresos: especificación de cobranza para la API                                                                        |
| Modelos              | `core/models/`                             | Tipos TypeScript por dominio (`common`, `security`, `people`, `sports`, `billing`, `uniforms`, `notices`). Mismos campos que las tablas MariaDB, en `camelCase`        |
| Autenticación        | `core/auth/auth.service.ts`                | Login contra hashes con sal del mock (`password.ts`), sesiones con expiración (8 h, 30 min de inactividad), recuperación de contraseña, auditoría de LOGIN/LOGOUT      |
| Autorización         | `core/auth/authorization.service.ts`       | Permiso + alcance (relaciones) de cada operación. Ver abajo y [`AUTHORIZATION.md`](AUTHORIZATION.md)                                                                   |
| Permisos             | `core/auth/permissions.ts`                 | Catálogo (`PERMISSION_CATALOG`, 59) y matriz inicial por rol (`DEFAULT_ROLE_PERMISSIONS`). `db/mariadb/010_permisos_app.sql` la replica                                |
| Guards               | `core/auth/guards.ts`                      | Sesión válida + permiso de la ruta. Sólo protegen la UI; la barrera real es el servicio                                                                                |
| Datos simulados      | `core/data/mock-db.ts`                     | Seed ficticio, AUTO_INCREMENT simulado, `transaction()`, `respond()`                                                                                                   |
| Integridad           | `core/data/mock-db.integrity.ts`           | `integrityViolations()`: las restricciones del SQL (FK, UNIQUE, CHECK) verificadas sobre `MockDb` después de cada prueba de flujo                                      |
| Utilidades           | `shared/`                                  | Dinero en centavos (`money.ts`, `MoneyPipe`), fechas locales (`dates.ts`), paginación (`page.ts`), validación (`validate.ts`), UI común                                |
| Estilos              | `src/styles.css`                           | Estilos globales y responsive                                                                                                                                          |

## Autorización: dónde vive cada cosa

- **Definición de permisos:** `core/auth/permissions.ts`. Los permisos son filas `modulo.accion` de la tabla `permisos`.
  La matriz es editable en ejecución desde la pantalla Permisos (HU-006); los cambios aplican a sesiones nuevas.
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

| Qué                          | Dónde                                                                                    | Estado                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------- |
| Modelo vigente (MariaDB)     | `docs/escuela_futbol_mariadb.sql` (39 tablas) + `docs/escuela_futbol_mariadb_checks.sql` | Probado: 42/42 checks. No conectado a la app |
| Permisos de la app           | `db/mariadb/010_permisos_app.sql`                                                        | 59 permisos, 106 filas de `rol_permiso`      |
| Respaldo y restauración      | `db/mariadb/scripts/`                                                                    | Probado: 39/39 tablas idénticas              |
| Esquema anterior (histórico) | `db/migrations`, `db/seed`, `db/tests`, `db/queries`, `db/scripts` (PostgreSQL 16)       | Sólo historial; no se le agregan migraciones |

Detalle: [`database/MARIADB.md`](database/MARIADB.md).

## Partes temporales (pre-API)

Se sustituyen al conectar la API ([`database/MARIADB.md` § 8](database/MARIADB.md)):

- `MockDb`, su seed y su latencia simulada → llamadas `HttpClient` dentro de cada servicio (las páginas no cambian).
- Hash de contraseñas SHA-256 con sal de `password.ts` → argon2id/bcrypt en el servidor.
- Sesión en `sessionStorage` → cookie HttpOnly y sesión validada en el servidor.
- `MailerService` / `outbox` → envío real de correo.
- Las verificaciones de `AuthorizationService` → la API debe repetirlas en cada endpoint (el navegador es manipulable).

## Requisitos y diagramas

- Las 76 HU: [`requirements/USER_STORIES.md`](requirements/USER_STORIES.md) (tabla oficial, no se edita).
- HU → código → pruebas y decisiones posteriores: [`TRACEABILITY.md`](TRACEABILITY.md).
- El diagrama «Flujo de la Plataforma — Escuela de Fútbol Infantil» está incrustado en el documento Word de revisión
  del Product Backlog, que **no** forma parte del repositorio. El único diagrama versionado es el ER (Mermaid) del
  esquema PostgreSQL histórico, en [`database/relationships.md`](database/relationships.md).

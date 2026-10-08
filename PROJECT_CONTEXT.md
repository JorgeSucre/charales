# Contexto del proyecto — Charales

Documento de contexto para personas **y** para IAs. Resume y **enlaza**; no repite reglas.

Si algo aquí contradice a su fuente, manda la fuente:

- datos: [`DATA_CONTRACT.md`](docs/database/DATA_CONTRACT.md);
- ownership: [`OWNERSHIP.md`](docs/database/OWNERSHIP.md);
- fases: [`ROADMAP.md`](docs/ROADMAP.md).

## Proyecto

Proyecto escolar integrador: una **WebApp para administrar una escuela formativa de fútbol**.

- **Problema:** hoy la escuela lleva inscripciones, categorías, cobros, uniformes y calendario de forma dispersa. La
  plataforma los centraliza con acceso por rol y un portal para padres.
- **Usuarios:** Administrador, Secretaría, Entrenador y Padre/Tutor.
- **Áreas funcionales:**
  - seguridad y acceso;
  - jugadores y tutores;
  - categorías e inscripciones;
  - entrenadores y asignaciones;
  - competencias y agenda;
  - cobranza;
  - uniformes;
  - portal del tutor;
  - reportes.

Las historias de usuario se organizan por épicas (EP01–EP12) y cada una tiene un responsable.

## Estado del proyecto

| Área                  | Estado          | Detalle                                                                                                                                                                          |
| --------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arquitectura frontend | **COMPLETADO**  | Angular standalone por dominio, RBAC por permisos, capa de servicios                                                                                                             |
| Frontend              | **EN REVISIÓN** | Las 76 HU implementadas sobre `MockDb` en `main` (`18178ba`, local) ([`TRACEABILITY.md`](docs/TRACEABILITY.md)); cada responsable revisa las suyas                               |
| Base de datos         | **COMPLETADO**  | Modelo **MariaDB** adoptado ([`MARIADB.md`](docs/database/MARIADB.md)); 42/42 checks del esquema. El PostgreSQL de `db/` queda como historial                                    |
| Backend               | **EN PROGRESO** | Milestone 1 en `api/`: Node `node:http` + MariaDB, configuración por variables de entorno, pruebas `node:test`, colección Postman local                                          |
| API                   | **EN PROGRESO** | `GET /health`, `POST /auth/login`, `GET /auth/session`, `POST /auth/logout` ([`API.md`](docs/API.md)). El frontend aún no la consume                                             |
| Autenticación         | **EN PROGRESO** | API: argon2id, cookie HttpOnly, 8 h / 30 min, límite de intentos, auditoría. El frontend sigue con el mock (SHA-256); recuperación y cambio de contraseña aún sólo en el mock    |
| Autorización          | **COMPLETADO**  | Permiso + alcance en cada servicio; matriz D12 (Administrador 56, Secretaría 45, Entrenador 3, Tutor 2); sin escalada por perfiles ([`AUTHORIZATION.md`](docs/AUTHORIZATION.md)) |
| Cobranza              | **EN REVISIÓN** | Conceptos, cargos, mensualidades, pagos parciales, folios, cancelación, estado de cuenta, adeudos, descuentos/becas. Sin backend                                                 |
| Uniformes             | **EN REVISIÓN** | Catálogo, pedidos con precio histórico, cargo vinculado (`cargo_id`), pagado derivado, entrega, cancelación. Sin backend                                                         |
| Portal del tutor      | **EN REVISIÓN** | Tarjetas por hijo, datos deportivos, partidos/resultados por plantel, estado de cuenta, asistencia, uniformes, avisos, perfil                                                    |
| Reportes              | **EN REVISIÓN** | Tablero con fuentes, jugadores por categoría, ingresos, agenda global                                                                                                            |
| Agenda                | **EN REVISIÓN** | Sesiones (también desde horarios), partidos con reprogramación y resultados                                                                                                      |
| Pruebas               | **EN PROGRESO** | 138 pruebas Angular (flujos críticos, reglas por HU, autorización independiente, integridad 21/21, rendimiento). Sin E2E de navegador ([`TESTING.md`](docs/TESTING.md))          |
| Deployment            | **NO INICIADO** | —                                                                                                                                                                                |

### Terminado

- Frontend de las 76 HU sobre `MockDb`, con autorización por permiso y alcance en los servicios.
- Modelo MariaDB (39 tablas, 42/42 checks), permisos de la app (106 filas de `rol_permiso`), respaldo y restauración
  probados.
- Matriz de roles D12 y corrección de la escalada por perfiles vinculados (`18178ba`).
- 138 pruebas Angular; documentación de handoff ([`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md),
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)).

### Pendiente

- **Siguiente fase:** API/backend sobre MariaDB e integración frontend ↔ API
  ([`MARIADB.md` § 8](docs/database/MARIADB.md)).
- Revisión de cada HU por su responsable (la implementación base ya está en `main`).
- Publicar `main` en `origin` por PR: hoy `main` local está en `18178ba` y `origin/main` en `47b926c`.
- Limitaciones conocidas P2/P3 (E2E, validación visual, decisiones de modelo):
  [`ROADMAP.md` › Limitaciones conocidas](docs/ROADMAP.md#limitaciones-conocidas-y-siguiente-fase).

### Decisiones pendientes

Las fronteras **C1–C6 quedaron resueltas** con la tabla oficial
([`DATA_CONTRACT.md` § 7](docs/database/DATA_CONTRACT.md)) y la matriz de roles con D12
([`MARIADB.md` § 4](docs/database/MARIADB.md)). `LICENSE` (MIT) ya está en el repositorio (`69ac519`). Para publicar
falta la **limpieza de identidad del historial Git** ([`ROADMAP.md`](docs/ROADMAP.md)). Decisiones no bloqueantes: en
el mismo `ROADMAP.md`.

### Fuera de alcance actual

Correo real, pagos en línea, almacenamiento de archivos, Docker, CI/CD y deployment.

## Historias de usuario

**Fuente oficial:** [`docs/requirements/USER_STORIES.md`](docs/requirements/USER_STORIES.md). Son **76 historias**
en 12 épicas (EP01–EP12), con responsable, módulo, dependencias, entidades sugeridas, release (MVP, Versión 1,
Versión 2) y sprint.

| Responsable                      | HU  | Estado                                                                                                                 |
| -------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------- |
| Borrayo                          | 22  | EN REVISIÓN: implementación base en `main`; cada responsable valida sus HU ([`TRACEABILITY.md`](docs/TRACEABILITY.md)) |
| Joss                             | 19  | EN REVISIÓN: implementación base en `main`; cada responsable valida sus HU ([`TRACEABILITY.md`](docs/TRACEABILITY.md)) |
| Armando                          | 19  | EN REVISIÓN: implementación base en `main`; cada responsable valida sus HU ([`TRACEABILITY.md`](docs/TRACEABILITY.md)) |
| Dani (en HU-003 aparece «Dany»)  | 15  | EN REVISIÓN: implementación base en `main`; cada responsable valida sus HU ([`TRACEABILITY.md`](docs/TRACEABILITY.md)) |
| Todos (HU-073, integridad de BD) | 1   | EN REVISIÓN: implementación base en `main`; cada responsable valida sus HU ([`TRACEABILITY.md`](docs/TRACEABILITY.md)) |

«Implementada» significa frontend + servicios + `MockDb` + modelo MariaDB + prueba. **Ninguna HU está respaldada por
una API**: no existe todavía. Las decisiones posteriores a la tabla oficial (p. ej. D12 sobre HU-070) están en
[`MARIADB.md` § 4](docs/database/MARIADB.md); la tabla oficial no se modifica.

## Equipo y ownership

Integrantes: **Borrayo, Joss, Armando y Dani**. Cada quien conserva las HU que la tabla oficial le asigna.

| Integrante | Dominios (por sus HU)                                                                                                                                                                                                                                      | Tablas MariaDB que escribe (owner)                                                                                                                                                                                                                 | Servicios                                                                                                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Borrayo    | Usuarios, contraseñas y seguridad, tutores, grupos, inscripción anual, entrenadores, asignación a torneos, cobranza (modelo), uniformes, portal (torneos, uniformes), reportes financieros, agenda global, temporadas, pruebas                             | `usuarios`, `tokens_recuperacion`, `tutores`, `tutor_jugador`, `entrenadores`, `temporadas`, `inscripciones`, `entrenador_competencia_categoria`, `conceptos_cobro`, `cargos`, `pagos`/`pago_aplicacion` (modelo), tablas de uniformes             | `UserService`, `TutorService`, `SeasonService`, `EnrollmentService`, `CoachService`, `BillingService`, `UniformService`                                                                                                          |
| Joss       | Login (HU-001), permisos por rol, auditoría, alta y edición de jugadores, horarios y sesiones de entrenamiento, inscripción a categoría, cupos, asistencia, plantel, partidos, cancelación de pagos, descuentos, dashboard                                 | `jugadores`, `jugador_categoria`, `partidos`, `sesiones_entrenamiento` y, por sus HU, `roles`/`permisos`/`rol_permiso`, `auditoria`, `sesiones`, `horarios_entrenamiento`, `asistencias`, `jugador_competencia_categoria`, `rivales`, `descuentos` | `AuthService`, `AuditService`, `RoleService`, `PlayerService`, `PlayerCategoryService`, `ScheduleService`, `TrainingService`, `AttendanceService`, `MatchService`; plantel con `CompetitionService.addToRoster/removeFromRoster` |
| Armando    | Login de entrenador, vinculación de cuenta de tutor, categorías, entrenador ↔ categoría, consultas del entrenador, inscripción de categorías a torneos, estado de cuenta, portal (partidos, resultados, perfil), reportes de asistencia y jugadores, sedes | `categorias`, `competencia_categoria`, `sedes`, `entrenador_categoria`                                                                                                                                                                             | `CategoryService`, `VenueService`; participación con `CompetitionService.register`; asignación con `CoachService.assignCategory`                                                                                                 |
| Dani       | Login de tutor, estatus de jugador, expediente, búsqueda, cambio de categoría, competencias, resultados, registro de pagos, avisos, portal (inicio, datos deportivos), responsive, rendimiento, respaldos                                                  | `competencias`, `historial_estatus`, `avisos` (y `aviso_destinatario`; HU-058 es de Joss)                                                                                                                                                          | `CompetitionService`, `NoticeService`                                                                                                                                                                                            |

Los servicios de lectura compuesta (`PortalService`, `CoachPanelService`, `ReportService`) son compartidos: cada
responsable implementa ahí sus HU. Correspondencia completa tabla → servicio: [`MARIADB.md` § 2](docs/database/MARIADB.md); owner por tabla:
[`OWNERSHIP.md`](docs/database/OWNERSHIP.md).

Cuando la HU de un integrante escribe una tabla de otro (por ejemplo, Dani con HU-045 → `payments`), la implementa
como operación del servicio owner, en un PR que revisa el owner.

**Regla:** una entidad = un owner de escritura. Los demás leen o llaman al servicio del owner.

- Detalle por tabla: [`OWNERSHIP.md`](docs/database/OWNERSHIP.md).
- Dependencias entre módulos: [`INTEGRATION_MAP.md`](docs/INTEGRATION_MAP.md).

## Arquitectura

Detalle en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```text
Angular (src/app)        páginas → servicios de dominio (+ AuthorizationService) → MockDb (en memoria)   ← HOY
                                             ↓ (siguiente fase: HttpClient)
API / Backend            api/ (Milestone 1: salud + autenticación, docs/API.md); contrato: MARIADB.md, AUTHORIZATION.md, DOMAIN_RULES.md
                                             ↓
MariaDB 10.6+            docs/escuela_futbol_mariadb.sql (39 tablas) + db/mariadb/   ← modelo probado, sin conectar
(histórico) PostgreSQL 16 en db/migrations: diseño anterior, ya no es la fuente de verdad
```

| Qué                      | Dónde                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Modelos (contratos TS)   | `src/app/core/models/` (agrupados por dominio)                                                                                     |
| Servicios de dominio     | `src/app/features/<dominio>/*.service.ts`; lecturas compartidas en `src/app/core/services/`                                        |
| Reglas de negocio puras  | `src/app/features/billing/billing.rules.ts`                                                                                        |
| Datos simulados          | `src/app/core/data/mock-db.ts` (único lugar; se elimina al conectar la API)                                                        |
| Autenticación y permisos | `src/app/core/auth/`: `AuthService` **mock**, `permissions.ts` (catálogo y matriz D12), `grants()`, `AuthorizationService`, guards |
| Rutas                    | `src/app/app.routes.ts` (áreas `/admin`, `/sports`, `/coach`, `/portal`)                                                           |
| Base de datos            | MariaDB: `docs/escuela_futbol_mariadb*.sql`, `db/mariadb/`. Histórico PostgreSQL: `db/migrations`, `db/seed`, `db/tests`…          |
| Pruebas                  | Angular: `src/**/*.spec.ts` (Vitest, 138). MariaDB: `npm run db:mariadb:test-backup` ([`TESTING.md`](docs/TESTING.md))             |

## Stack

Versiones instaladas, tomadas de `package-lock.json` y las herramientas locales al 2026-09-30.

| Tecnología                          | Versión                                       | Nota                                                  |
| ----------------------------------- | --------------------------------------------- | ----------------------------------------------------- |
| Node.js                             | 26.10.0                                       | Angular 22 acepta `^22.22.3`, `^24.15.0` o `>=26.0.0` |
| npm                                 | 11.19.1                                       | Fijado en `packageManager`                            |
| Angular (core, CLI, build)          | 22.2.0                                        | Standalone, zoneless, OnPush por defecto              |
| TypeScript                          | 6.0.3                                         | `strict` por defecto                                  |
| Vitest (vía `ng test`) + jsdom      | 5.0.3 + 30.1.1                                | Pruebas del frontend                                  |
| Prettier                            | 3.9.9                                         | Formato; configurado en `.prettierrc`                 |
| MariaDB (`mariadb`, `mariadb-dump`) | 10.6+ (probado con 13.0.2)                    | Modelo objetivo, checks del esquema y respaldo        |
| PostgreSQL (`psql`)                 | 16 (probado con 16.15)                        | Sólo el esquema histórico de `db/migrations`          |
| Git                                 | cualquier versión reciente (probado con 2.54) | —                                                     |

No hay ESLint configurado.

## Dependencias principales

Sólo las que un desarrollador necesita entender; las demás son transitivas.

| Paquete                                                   | Versión       | Para qué                                             | Tipo        |
| --------------------------------------------------------- | ------------- | ---------------------------------------------------- | ----------- |
| `@angular/core`, `common`, `compiler`, `platform-browser` | 22.2.0        | Framework                                            | Obligatoria |
| `@angular/router`                                         | 22.2.0        | Rutas lazy y guards por permiso                      | Obligatoria |
| `@angular/forms`                                          | 22.2.0        | Formularios reactivos tipados                        | Obligatoria |
| `rxjs`                                                    | 7.8.2         | Requerida por Angular; la app no la usa directamente | Obligatoria |
| `tslib`                                                   | 2.8.1         | Helpers de TypeScript (`importHelpers`)              | Obligatoria |
| `@angular/cli`, `@angular/build`, `@angular/compiler-cli` | 22.2.0        | Build, servidor de desarrollo y runner de pruebas    | Desarrollo  |
| `typescript`                                              | 6.0.3         | Compilador                                           | Desarrollo  |
| `vitest`, `jsdom`                                         | 5.0.3, 30.1.1 | Pruebas unitarias en Node con DOM simulado           | Desarrollo  |
| `prettier`                                                | 3.9.9         | Formato                                              | Desarrollo  |

La BD no usa paquetes npm: los scripts llaman a `mariadb`/`mariadb-dump` (`db/mariadb/scripts`) y, para el esquema
histórico, a `psql`.

## Documentación importante

| Documento                                                                | Propósito                                                                          | Cuándo leerlo                                |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------- |
| [`README.md`](README.md)                                                 | Instalar, ejecutar, comandos, herramientas                                         | Al clonar                                    |
| `PROJECT_CONTEXT.md`                                                     | Este documento: qué es, estado, quién hace qué                                     | Antes de cualquier tarea                     |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)                             | **Onboarding**: instalar, comandos, dónde está cada cosa, PR                       | Primer día                                   |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                           | Capas, autorización, `MockDb`, qué es temporal (pre-API)                           | Antes de tocar código                        |
| [`docs/AUTHORIZATION.md`](docs/AUTHORIZATION.md)                         | Matriz de roles D12, perfiles vinculados, contrato por operación                   | Antes de tocar permisos o servicios          |
| [`docs/TESTING.md`](docs/TESTING.md)                                     | Qué valida cada grupo de pruebas y cómo correrlas                                  | Antes de un PR                               |
| [`docs/API.md`](docs/API.md)                                             | **API**: ejecutar, endpoints, sesión, Postman, decisiones                          | Antes de tocar `api/` o `postman/`           |
| [`docs/DOMAIN_RULES.md`](docs/DOMAIN_RULES.md)                           | Reglas que el esquema no garantiza y la API debe repetir                           | Al diseñar la API                            |
| [`AGENTS.md`](AGENTS.md)                                                 | Reglas de trabajo para cualquier IA                                                | Si eres una IA, antes de tocar nada          |
| [`CLAUDE.md`](CLAUDE.md)                                                 | Notas específicas de Claude Code                                                   | Si usas Claude Code                          |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)                                     | Branches, commits, PRs, migraciones                                                | Antes del primer commit                      |
| [`docs/ROADMAP.md`](docs/ROADMAP.md)                                     | Fases y lo que sigue (**fuente de verdad del roadmap**)                            | Al planear                                   |
| [`docs/requirements/USER_STORIES.md`](docs/requirements/USER_STORIES.md) | **Tabla oficial de las 76 HU** (responsable, sprint, criterios)                    | Antes de empezar cualquier HU                |
| [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md)                           | Estado real de cada HU → código → pruebas                                          | Antes de tomar o revisar una HU              |
| [`docs/database/MARIADB.md`](docs/database/MARIADB.md)                   | **Modelo MariaDB vigente**: convenciones, tablas → servicios, decisiones, respaldo | Antes de tocar datos, modelos o la API       |
| [`docs/INTEGRATION_MAP.md`](docs/INTEGRATION_MAP.md)                     | **Histórico**: reparto de servicios de backend previo a MariaDB                    | Sólo como antecedente                        |
| [`docs/PLAN.md`](docs/PLAN.md)                                           | **Histórico**: decisiones del frontend de las fases 1–2                            | Sólo como antecedente                        |
| [`docs/database/README.md`](docs/database/README.md)                     | **Histórico (PostgreSQL)**: levantar la bd, estructura de `db/`, seed              | Al trabajar con la BD                        |
| [`docs/database/DATA_CONTRACT.md`](docs/database/DATA_CONTRACT.md)       | **Reglas de datos congeladas** y proceso de cambios                                | Antes de tocar datos, modelos o SQL          |
| [`docs/database/OWNERSHIP.md`](docs/database/OWNERSHIP.md)               | **Quién escribe cada tabla**; cobertura por historia; conflictos                   | Antes de escribir en una tabla               |
| [`docs/database/schema.md`](docs/database/schema.md)                     | **Histórico (PostgreSQL)**: cada tabla: pk, fk, restricciones                      | Al diseñar consultas o endpoints             |
| [`docs/database/relationships.md`](docs/database/relationships.md)       | **Histórico (PostgreSQL)**: relaciones en lenguaje sencillo + diagrama er          | Para entender el modelo                      |
| [`docs/database/api-contract.md`](docs/database/api-contract.md)         | **Histórico (PostgreSQL)**: mapeo angular ↔ api ↔ tabla                            | Al implementar la API o conectar el frontend |
| [`docs/database/decisions.md`](docs/database/decisions.md)               | **Histórico (PostgreSQL)**: el porqué de cada decisión de bd                       | Antes de proponer un cambio de diseño        |
| [`docs/database/queries.md`](docs/database/queries.md)                   | **Histórico (PostgreSQL)**: las 21 consultas críticas                              | Al implementar reportes o el portal          |

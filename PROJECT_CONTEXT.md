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

| Área                  | Estado          | Detalle                                                                                                                     |
| --------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Arquitectura frontend | **COMPLETADO**  | Angular standalone por dominio, RBAC por permisos, capa de servicios                                                        |
| Frontend              | **EN PROGRESO** | Pantallas de las historias de Borrayo, con datos simulados (`MockDb`). Faltan los módulos de los demás                      |
| Base de datos         | **COMPLETADO**  | PostgreSQL 16: 9 migraciones, 24 tablas, seed ficticio, 57 pruebas de integridad, 21 consultas críticas, contrato congelado |
| Backend               | **NO INICIADO** | —                                                                                                                           |
| API                   | **PENDIENTE**   | Sólo existe el contrato propuesto ([`api-contract.md`](docs/database/api-contract.md))                                      |
| Autenticación         | **PENDIENTE**   | Hay un login **simulado**, sin verificación de contraseña, más guards y permisos. La autenticación real no existe           |
| Cobranza              | **EN PROGRESO** | UI + reglas probadas + esquema de BD. Sin backend. Registro de pagos: Dani (HU-045); cancelación: Joss (HU-049)             |
| Uniformes             | **EN PROGRESO** | UI + esquema de BD. Sin backend                                                                                             |
| Portal del tutor      | **EN PROGRESO** | UI filtrada por tutor + consultas en BD. Sin backend (la seguridad real depende del backend)                                |
| Reportes              | **EN PROGRESO** | Ingresos y agenda en UI + consultas SQL. Sin backend                                                                        |
| Agenda                | **EN PROGRESO** | Consulta lista (HU-068). Partidos y sesiones los escribe Joss (HU-037, HU-028), sin iniciar                                 |
| Pruebas               | **EN PROGRESO** | 32 pruebas unitarias/de integración Angular + 57 de integridad de BD. Sin E2E                                               |
| Deployment            | **NO INICIADO** | —                                                                                                                           |

### Terminado

- Arquitectura frontend, RBAC por permisos y pantallas de las historias de Borrayo con datos simulados.
- Esquema de BD, seed, pruebas de integridad y consultas críticas.
- Contrato de datos, ownership y mapa de integración.

### En integración

Preparado y a la espera de backend o de otros módulos:

- conexión frontend ↔ API: cambios de TS listados en [`INTEGRATION_MAP.md` § 2](docs/INTEGRATION_MAP.md);
- contrato de pagos (`registerPayment`) para Dani (HU-045) y `cancelPayment` para Joss (HU-049);
- lecturas compartidas (`PlayerService`, `CategoryService`, `CompetitionService`).

### Pendiente

- Backend y API.
- Autenticación real (hash de contraseñas, sesión o token, correo de recuperación).
- Historias de Joss, Armando y Dani (ninguna iniciada) y las tablas que el backlog pide y aún no existen
  ([`OWNERSHIP.md`](docs/database/OWNERSHIP.md#tablas-y-columnas-que-pide-el-backlog-y-todavía-no-existen)).
- Pruebas E2E.
- Deployment.
- Merge de las ramas de Borrayo a `main`.

### Decisiones pendientes

Las fronteras **C1–C6 quedaron resueltas** con la tabla oficial
([`DATA_CONTRACT.md` § 7](docs/database/DATA_CONTRACT.md)). Para publicar faltan decisiones humanas: la **licencia**
(los 4 integrantes) y la **limpieza de identidad del historial Git**. Ver [`ROADMAP.md`](docs/ROADMAP.md).
Otras decisiones técnicas abiertas: [`INTEGRATION_MAP.md` § 1](docs/INTEGRATION_MAP.md).

### Fuera de alcance actual

Backend, API, JWT/sesiones, correo real, pagos en línea, almacenamiento de archivos, Docker, CI/CD y deployment.

## Historias de usuario

**Fuente oficial:** [`docs/requirements/USER_STORIES.md`](docs/requirements/USER_STORIES.md). Son **76 historias**
en 12 épicas (EP01–EP12), con responsable, módulo, dependencias, entidades sugeridas, release (MVP, Versión 1,
Versión 2) y sprint.

| Responsable                      | HU  | Estado                                                               |
| -------------------------------- | --- | -------------------------------------------------------------------- |
| Borrayo                          | 22  | EN PROGRESO (tabla de abajo)                                         |
| Joss                             | 19  | NO INICIADO                                                          |
| Armando                          | 19  | NO INICIADO                                                          |
| Dani (en HU-003 aparece «Dany»)  | 15  | NO INICIADO                                                          |
| Todos (HU-073, integridad de BD) | 1   | EN PROGRESO: la BD ya tiene PK/FK, unicidad y transacciones en pagos |

**Historias de Borrayo.** En todas el backend está **pendiente**. «EN PROGRESO» = existen la UI (con datos simulados)
y el soporte en BD.

| HU  | Descripción                                       | Owner   | Estado                                                                                           |
| --- | ------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| 004 | Admin crea, edita, activa y desactiva usuarios    | Borrayo | EN PROGRESO. Falta ligar tutor o entrenador al crear                                             |
| 005 | Usuario recupera o cambia su contraseña           | Borrayo | EN PROGRESO. Sólo la UI; el envío real va en el backend                                          |
| 072 | Contraseñas seguras y accesos protegidos          | Borrayo | EN PROGRESO. Guards, permisos y `CHECK` de hash en BD; el hashing va en el backend               |
| 011 | Secretaría registra uno o más tutores por jugador | Borrayo | EN PROGRESO. Falta la edición                                                                    |
| 018 | Lista de jugadores por categoría                  | Borrayo | EN PROGRESO. Lectura (escritura: C3)                                                             |
| 020 | Inscripción administrativa anual                  | Borrayo | EN PROGRESO. Falta la cancelación                                                                |
| 022 | Registrar entrenadores                            | Borrayo | EN PROGRESO. Falta la edición                                                                    |
| 026 | Entrenador por torneo/liga y categoría            | Borrayo | EN PROGRESO. Exige participación (C2); falta «sólo asignaciones vigentes» (HU-023, Armando)      |
| 043 | Configurar conceptos de cobro                     | Borrayo | EN PROGRESO                                                                                      |
| 044 | Generar mensualidades para jugadores activos      | Borrayo | EN PROGRESO                                                                                      |
| 048 | Consultar o reimprimir recibos                    | Borrayo | EN PROGRESO                                                                                      |
| 050 | Listado de adeudos                                | Borrayo | EN PROGRESO                                                                                      |
| 052 | Catálogo de uniformes y tallas                    | Borrayo | EN PROGRESO. Falta la edición                                                                    |
| 053 | Pedido de uniforme por jugador                    | Borrayo | EN PROGRESO. Falta el estado «cancelado» del backlog                                             |
| 054 | Vincular el cobro del uniforme con pagos          | Borrayo | EN PROGRESO                                                                                      |
| 055 | Registrar la entrega de uniforme                  | Borrayo | EN PROGRESO                                                                                      |
| 056 | Tutor consulta los uniformes de sus hijos         | Borrayo | EN PROGRESO                                                                                      |
| 063 | Tutor consulta los torneos de cada hijo           | Borrayo | EN PROGRESO. Usa la participación de la categoría (C2); falta filtrar por plantel (HU-036, Joss) |
| 067 | Reporte de ingresos por periodo y concepto        | Borrayo | EN PROGRESO                                                                                      |
| 068 | Agenda global de entrenamientos y partidos        | Borrayo | EN PROGRESO                                                                                      |
| 070 | Configurar temporadas                             | Borrayo | EN PROGRESO                                                                                      |
| 074 | Pruebas de flujos críticos                        | Borrayo | EN PROGRESO. Unitarias y BD listas; falta E2E                                                    |

La cobertura de datos por historia está en [`OWNERSHIP.md`](docs/database/OWNERSHIP.md). Las pantallas están en
`src/app/features/<dominio>/`.

## Equipo y ownership

Integrantes: **Borrayo, Joss, Armando y Dani**. Cada quien conserva las HU que la tabla oficial le asigna.

| Integrante | Dominios (por sus HU)                                                                                                                                                                                                                                      | Tablas que escribe (existentes)                                                                                                                                                                              | Servicios owner                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Borrayo    | Usuarios, contraseñas y seguridad, tutores, grupos, inscripción anual, entrenadores, asignación a torneos, cobranza (modelo), uniformes, portal (torneos, uniformes), reportes financieros, agenda global, temporadas, pruebas                             | `users`, `password_reset_tokens`, `tutors`, `tutor_players`, `coaches`, `seasons`, `enrollments`, `coach_assignments`, `charge_concepts`, `charges`, `payments`/`payment_applications` (modelo), `uniform_*` | `UserService`, `TutorService`, `SeasonService`, `EnrollmentService`, `CoachService`, `BillingService`, `UniformService` |
| Joss       | Login (HU-001), permisos por rol, auditoría, alta y edición de jugadores, horarios y sesiones de entrenamiento, inscripción a categoría, cupos, asistencia, plantel, partidos, cancelación de pagos, descuentos, dashboard                                 | `players`, `player_categories`, `matches`, `training_sessions`                                                                                                                                               | `AuthService`, `AuditService`, `PlayerService`, `PlayerCategoryService`, `ScheduleService`, `RosterService`             |
| Armando    | Login de entrenador, vinculación de cuenta de tutor, categorías, entrenador ↔ categoría, consultas del entrenador, inscripción de categorías a torneos, estado de cuenta, portal (partidos, resultados, perfil), reportes de asistencia y jugadores, sedes | `categories`, `competition_categories`, `venues`                                                                                                                                                             | `CategoryService`, `CompetitionCategoryService`, `CoachCategoryService`, `VenueService`                                 |
| Dani       | Login de tutor, estatus de jugador, expediente, búsqueda, cambio de categoría, competencias, resultados, registro de pagos, avisos, portal (inicio, datos deportivos), responsive, rendimiento, respaldos                                                  | `competitions`                                                                                                                                                                                               | `CompetitionService`, `NoticeService`                                                                                   |

Cuando la HU de un integrante escribe una tabla de otro (por ejemplo, Dani con HU-045 → `payments`), la implementa
como operación del servicio owner, en un PR que revisa el owner.

**Regla:** una entidad = un owner de escritura. Los demás leen o llaman al servicio del owner.

- Detalle por tabla: [`OWNERSHIP.md`](docs/database/OWNERSHIP.md).
- Dependencias entre módulos: [`INTEGRATION_MAP.md`](docs/INTEGRATION_MAP.md).

## Arquitectura

```text
Angular (src/app)        páginas → servicios de dominio → MockDb   ← HOY
                                             ↓ (futuro: HttpClient)
API / Backend            no existe todavía; contrato propuesto en docs/database/api-contract.md
                                             ↓
PostgreSQL 16 (db/)      esquema, restricciones, vista de saldos   ← EXISTE, sin conectar
```

| Qué                      | Dónde                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| Modelos (contratos TS)   | `src/app/core/models/` (agrupados por dominio)                                                           |
| Servicios de dominio     | `src/app/features/<dominio>/*.service.ts`; lecturas compartidas en `src/app/core/services/`              |
| Reglas de negocio puras  | `src/app/features/billing/billing.rules.ts` (su espejo SQL es la vista `charge_balances` y los triggers) |
| Datos simulados          | `src/app/core/data/mock-db.ts` (único lugar; se elimina al conectar la API)                              |
| Autenticación y permisos | `src/app/core/auth/`: `AuthService` **mock**, `permissions.ts` (rol → permisos) y guards por permiso     |
| Rutas                    | `src/app/app.routes.ts` (áreas `/admin`, `/sports`, `/portal`)                                           |
| Base de datos            | `db/migrations`, `db/seed`, `db/tests`, `db/queries`, `db/scripts`                                       |
| Pruebas                  | Angular: `src/**/*.spec.ts` (Vitest). BD: `db/tests/integrity.sql` y `db/queries/critical.sql`           |

## Stack

Versiones instaladas, tomadas de `package-lock.json` y las herramientas locales al 2026-09-30.

| Tecnología                                | Versión                                       | Nota                                                  |
| ----------------------------------------- | --------------------------------------------- | ----------------------------------------------------- |
| Node.js                                   | 26.10.0                                       | Angular 22 acepta `^22.22.3`, `^24.15.0` o `>=26.0.0` |
| npm                                       | 11.19.1                                       | Fijado en `packageManager`                            |
| Angular (core, CLI, build)                | 22.2.0                                        | Standalone, zoneless, OnPush por defecto              |
| TypeScript                                | 6.0.3                                         | `strict` por defecto                                  |
| Vitest (vía `ng test`) + jsdom            | 5.0.3 + 30.1.1                                | Pruebas del frontend                                  |
| Prettier                                  | 3.9.9                                         | Formato; configurado en `.prettierrc`                 |
| PostgreSQL (`psql`, `createdb`, `dropdb`) | 16 (probado con 16.15)                        | BD y sus pruebas                                      |
| Git                                       | cualquier versión reciente (probado con 2.54) | —                                                     |

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

La BD no usa paquetes npm: los scripts llaman a `psql`.

## Documentación importante

| Documento                                                                | Propósito                                                                  | Cuándo leerlo                                |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------- |
| [`README.md`](README.md)                                                 | Instalar, ejecutar, comandos, herramientas                                 | Al clonar                                    |
| `PROJECT_CONTEXT.md`                                                     | Este documento: qué es, estado, quién hace qué                             | Antes de cualquier tarea                     |
| [`AGENTS.md`](AGENTS.md)                                                 | Reglas de trabajo para cualquier IA                                        | Si eres una IA, antes de tocar nada          |
| [`CLAUDE.md`](CLAUDE.md)                                                 | Notas específicas de Claude Code                                           | Si usas Claude Code                          |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)                                     | Branches, commits, PRs, migraciones                                        | Antes del primer commit                      |
| [`docs/ROADMAP.md`](docs/ROADMAP.md)                                     | Fases y lo que sigue (**fuente de verdad del roadmap**)                    | Al planear                                   |
| [`docs/requirements/USER_STORIES.md`](docs/requirements/USER_STORIES.md) | **Tabla oficial de las 76 HU** (responsable, sprint, criterios)            | Antes de empezar cualquier HU                |
| [`docs/INTEGRATION_MAP.md`](docs/INTEGRATION_MAP.md)                     | Servicios de backend, owners, dependencias, cambios TS pendientes          | Antes de trabajar en backend o integración   |
| [`docs/PLAN.md`](docs/PLAN.md)                                           | Decisiones del frontend de las fases 1–2 (Enrollment, pagos, portal, RBAC) | Al tocar el frontend existente               |
| [`docs/database/README.md`](docs/database/README.md)                     | Levantar la BD, estructura de `db/`, seed                                  | Al trabajar con la BD                        |
| [`docs/database/DATA_CONTRACT.md`](docs/database/DATA_CONTRACT.md)       | **Reglas de datos congeladas** y proceso de cambios                        | Antes de tocar datos, modelos o SQL          |
| [`docs/database/OWNERSHIP.md`](docs/database/OWNERSHIP.md)               | **Quién escribe cada tabla**; cobertura por historia; conflictos           | Antes de escribir en una tabla               |
| [`docs/database/schema.md`](docs/database/schema.md)                     | Cada tabla: PK, FK, restricciones                                          | Al diseñar consultas o endpoints             |
| [`docs/database/relationships.md`](docs/database/relationships.md)       | Relaciones en lenguaje sencillo + diagrama ER                              | Para entender el modelo                      |
| [`docs/database/api-contract.md`](docs/database/api-contract.md)         | Mapeo Angular ↔ API ↔ tabla                                                | Al implementar la API o conectar el frontend |
| [`docs/database/decisions.md`](docs/database/decisions.md)               | El porqué de cada decisión de BD                                           | Antes de proponer un cambio de diseño        |
| [`docs/database/queries.md`](docs/database/queries.md)                   | Las 21 consultas críticas                                                  | Al implementar reportes o el portal          |

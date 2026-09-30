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

| Área                  | Estado          | Detalle                                                                                                           |
| --------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------- |
| Arquitectura frontend | **COMPLETADO**  | Angular standalone por dominio, RBAC por permisos, capa de servicios                                              |
| Frontend              | **EN PROGRESO** | Pantallas de las historias de Borrayo, con datos simulados (`MockDb`). Faltan los módulos de los demás            |
| Base de datos         | **COMPLETADO**  | PostgreSQL 16: 7 migraciones, seed ficticio, 50 pruebas, contrato congelado. Dos decisiones abiertas (C2, C3)     |
| Backend               | **NO INICIADO** | —                                                                                                                 |
| API                   | **PENDIENTE**   | Sólo existe el contrato propuesto ([`api-contract.md`](docs/database/api-contract.md))                            |
| Autenticación         | **PENDIENTE**   | Hay un login **simulado**, sin verificación de contraseña, más guards y permisos. La autenticación real no existe |
| Cobranza              | **EN PROGRESO** | UI + reglas probadas + esquema de BD. Sin backend. La captura de pagos es de otro integrante                      |
| Uniformes             | **EN PROGRESO** | UI + esquema de BD. Sin backend                                                                                   |
| Portal del tutor      | **EN PROGRESO** | UI filtrada por tutor + consultas en BD. Sin backend (la seguridad real depende del backend)                      |
| Reportes              | **EN PROGRESO** | Ingresos y agenda en UI + consultas SQL. Sin backend                                                              |
| Agenda                | **EN PROGRESO** | Consulta lista. Los datos de partidos y entrenamientos los escribe otro integrante (no iniciado)                  |
| Pruebas               | **EN PROGRESO** | 32 pruebas unitarias/de integración Angular + 50 de integridad de BD. Sin E2E                                     |
| Deployment            | **NO INICIADO** | —                                                                                                                 |

### Terminado

- Arquitectura frontend, RBAC por permisos y pantallas de las historias de Borrayo con datos simulados.
- Esquema de BD, seed, pruebas de integridad y consultas críticas.
- Contrato de datos, ownership y mapa de integración.

### En integración

Preparado y a la espera de backend o de otros módulos:

- conexión frontend ↔ API: cambios de TS listados en [`INTEGRATION_MAP.md` § 4](docs/INTEGRATION_MAP.md);
- contrato de pagos (`registerPayment`) para quien capture pagos;
- lecturas compartidas (`PlayerService`, `CategoryService`, `CompetitionService`).

### Pendiente

- Backend y API.
- Autenticación real (hash de contraseñas, sesión o token, correo de recuperación).
- Módulos de los demás integrantes.
- Pruebas E2E.
- Deployment.
- Merge de las ramas de Borrayo a `main`.

### Decisiones pendientes

Son las que bloquean la integración: **C1–C6** (detalle y recomendación en [`INTEGRATION_MAP.md` § 1](docs/INTEGRATION_MAP.md)).
Las no bloqueantes y la licencia están en [`ROADMAP.md`](docs/ROADMAP.md).

### Fuera de alcance actual

Backend, API, JWT/sesiones, correo real, pagos en línea, almacenamiento de archivos, Docker, CI/CD y deployment.

## Historias de usuario

> **Limitación:** el documento completo de historias **no está en el repositorio**. Sólo se conocen las asignadas a
> Borrayo, así que las de Joss, Armando y Dani no se listan aquí para no inventarlas.

En todas las historias de Borrayo el backend está **pendiente**. «EN PROGRESO» significa que existen la UI (con datos
simulados) y el soporte en BD.

| HU  | Descripción                                       | Owner   | Estado                                                                             |
| --- | ------------------------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| 004 | Admin crea, edita, activa y desactiva usuarios    | Borrayo | EN PROGRESO. Falta ligar tutor o entrenador al crear                               |
| 005 | Usuario recupera o cambia su contraseña           | Borrayo | EN PROGRESO. Sólo la UI; el envío real va en el backend                            |
| 072 | Contraseñas seguras y accesos protegidos          | Borrayo | EN PROGRESO. Guards, permisos y `CHECK` de hash en BD; el hashing va en el backend |
| 011 | Secretaría registra uno o más tutores por jugador | Borrayo | EN PROGRESO. Falta la edición                                                      |
| 018 | Lista de jugadores por categoría                  | Borrayo | EN PROGRESO. Lectura (escritura: C3)                                               |
| 020 | Inscripción administrativa anual                  | Borrayo | EN PROGRESO. Falta la cancelación                                                  |
| 022 | Registrar entrenadores                            | Borrayo | EN PROGRESO. Falta la edición                                                      |
| 026 | Entrenador por torneo/liga y categoría            | Borrayo | EN PROGRESO (C2)                                                                   |
| 043 | Configurar conceptos de cobro                     | Borrayo | EN PROGRESO                                                                        |
| 044 | Generar mensualidades para jugadores activos      | Borrayo | EN PROGRESO                                                                        |
| 048 | Consultar o reimprimir recibos                    | Borrayo | EN PROGRESO                                                                        |
| 050 | Listado de adeudos                                | Borrayo | EN PROGRESO                                                                        |
| 052 | Catálogo de uniformes y tallas                    | Borrayo | EN PROGRESO. Falta la edición                                                      |
| 053 | Pedido de uniforme por jugador                    | Borrayo | EN PROGRESO                                                                        |
| 054 | Vincular el cobro del uniforme con pagos          | Borrayo | EN PROGRESO                                                                        |
| 055 | Registrar la entrega de uniforme                  | Borrayo | EN PROGRESO                                                                        |
| 056 | Tutor consulta los uniformes de sus hijos         | Borrayo | EN PROGRESO                                                                        |
| 063 | Tutor consulta los torneos de cada hijo           | Borrayo | EN PROGRESO (C2)                                                                   |
| 067 | Reporte de ingresos por periodo y concepto        | Borrayo | EN PROGRESO                                                                        |
| 068 | Agenda global de entrenamientos y partidos        | Borrayo | EN PROGRESO                                                                        |
| 070 | Configurar temporadas                             | Borrayo | EN PROGRESO                                                                        |
| 074 | Pruebas de flujos críticos                        | Borrayo | EN PROGRESO. Unitarias y BD listas; falta E2E                                      |

La cobertura de datos por historia está en [`OWNERSHIP.md`](docs/database/OWNERSHIP.md). Las pantallas están en
`src/app/features/<dominio>/`.

## Equipo y ownership

Integrantes: **Borrayo, Joss, Armando y Dani**. Sólo el reparto de Borrayo está documentado en el repo; el resto
aparece como «otro integrante» hasta que el equipo lo asigne.

| Owner           | Módulos / servicios de backend                                                                                                            | Tablas que escribe                                                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Borrayo         | Usuarios, Tutores, Temporadas, Inscripciones, Entrenadores y asignaciones, Cobranza (modelo), Uniformes, Reportes y Portal (sólo lectura) | `users`, `tutors`, `tutor_players`, `coaches`, `seasons`, `enrollments`, `coach_assignments`, `charge_concepts`, `charges`, `payments`, `payment_applications`, `uniform_*` |
| Otro integrante | Jugadores, Categorías, Competencias, Agenda (partidos, entrenamientos, sedes), captura de pagos                                           | `players`, `categories`, `competitions`, `venues`, `matches`, `training_sessions`                                                                                           |
| Por definir     | Autenticación (C5), `player_categories` (C3), cancelación de pagos (C4)                                                                   | —                                                                                                                                                                           |

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

| Documento                                                          | Propósito                                                                  | Cuándo leerlo                                |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------- |
| [`README.md`](README.md)                                           | Instalar, ejecutar, comandos, herramientas                                 | Al clonar                                    |
| `PROJECT_CONTEXT.md`                                               | Este documento: qué es, estado, quién hace qué                             | Antes de cualquier tarea                     |
| [`AGENTS.md`](AGENTS.md)                                           | Reglas de trabajo para cualquier IA                                        | Si eres una IA, antes de tocar nada          |
| [`CLAUDE.md`](CLAUDE.md)                                           | Notas específicas de Claude Code                                           | Si usas Claude Code                          |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)                               | Branches, commits, PRs, migraciones                                        | Antes del primer commit                      |
| [`docs/ROADMAP.md`](docs/ROADMAP.md)                               | Fases y lo que sigue (**fuente de verdad del roadmap**)                    | Al planear                                   |
| [`docs/INTEGRATION_MAP.md`](docs/INTEGRATION_MAP.md)               | Servicios de backend, owners, dependencias, decisiones C1–C7, cambios TS   | Antes de trabajar en backend o integración   |
| [`docs/PLAN.md`](docs/PLAN.md)                                     | Decisiones del frontend de las fases 1–2 (Enrollment, pagos, portal, RBAC) | Al tocar el frontend existente               |
| [`docs/database/README.md`](docs/database/README.md)               | Levantar la BD, estructura de `db/`, seed                                  | Al trabajar con la BD                        |
| [`docs/database/DATA_CONTRACT.md`](docs/database/DATA_CONTRACT.md) | **Reglas de datos congeladas** y proceso de cambios                        | Antes de tocar datos, modelos o SQL          |
| [`docs/database/OWNERSHIP.md`](docs/database/OWNERSHIP.md)         | **Quién escribe cada tabla**; cobertura por historia; conflictos           | Antes de escribir en una tabla               |
| [`docs/database/schema.md`](docs/database/schema.md)               | Cada tabla: PK, FK, restricciones                                          | Al diseñar consultas o endpoints             |
| [`docs/database/relationships.md`](docs/database/relationships.md) | Relaciones en lenguaje sencillo + diagrama ER                              | Para entender el modelo                      |
| [`docs/database/api-contract.md`](docs/database/api-contract.md)   | Mapeo Angular ↔ API ↔ tabla                                                | Al implementar la API o conectar el frontend |
| [`docs/database/decisions.md`](docs/database/decisions.md)         | El porqué de cada decisión de BD                                           | Antes de proponer un cambio de diseño        |
| [`docs/database/queries.md`](docs/database/queries.md)             | Las 20 consultas críticas                                                  | Al implementar reportes o el portal          |

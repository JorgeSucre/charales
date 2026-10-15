# Charales — WebApp Escuela de Fútbol

Proyecto escolar integrador: plataforma web para administrar una escuela formativa de fútbol, con usuarios, tutores,
inscripciones, entrenadores, cobranza, uniformes, portal para padres y reportes. Las historias de usuario están
organizadas por épicas y responsables.

> **Estado:** las 76 historias (HU-001…076) funcionan sobre una **API Node + MariaDB**: la app inicia sesión contra
> la API (cookie HttpOnly, argon2id) y cada pantalla llama a su servicio de dominio, que corre en el servidor (decisión
> D13, [`docs/database/MARIADB.md`](docs/database/MARIADB.md)). Trazabilidad y evidencia por HU:
> [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md). Contexto completo: [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md).
>
> **Para empezar a trabajar:** [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) (onboarding),
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) y [`docs/API.md`](docs/API.md).

## Requisitos

| Herramienta | Versión                                            | Para qué                                                              |
| ----------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| Node.js     | `^24.15.0` o `>=26` (`engines`; probado con 26.11) | Frontend, API (`crypto.argon2`) y pruebas                             |
| npm         | 11 (probado con 11.19.1)                           | Dependencias y scripts                                                |
| MariaDB     | 10.6+, con `mariadb` y `mariadb-dump` en el `PATH` | La base de la app (la API la necesita), checks del esquema y respaldo |
| PostgreSQL  | 16, con `psql`, `createdb` y `dropdb` en el `PATH` | Sólo el esquema histórico de `db/migrations`                          |
| Git         | reciente                                           | —                                                                     |
| `sh`        | macOS/Linux; en Windows usa Git Bash o WSL         | Scripts de BD                                                         |

## Empezar desde cero

Guía completa, con la instalación de MariaDB por sistema operativo y la cuenta con privilegios mínimos:
**[`docs/SETUP.md`](docs/SETUP.md)**. En corto (con MariaDB ya instalado y la base/cuenta de su sección 3):

```bash
git clone https://github.com/JorgeSucre/charales.git && cd charales   # rama main
npm ci
cp .env.example .env                 # pon tu DB_PASSWORD; .env no se versiona
npm run db:setup                     # esquema + migraciones + permisos; seguro de repetir, nunca borra
npm run db:admin                     # tu administrador (o `npm run db:setup -- --demo` para datos de ejemplo)
npm run api:start                    # terminal 1: API en http://localhost:3000
npm start                            # terminal 2: app en http://localhost:4200 (proxy a la API)
```

Con `--demo` se crean cuentas ficticias con la contraseña pública `demo1234`: `admin@example.com`,
`secretaria@example.com`, `coach@example.com`, `tutor@example.com` y `marta@example.com` (entrenadora y tutora en la
misma cuenta). Los datos se guardan en tu MariaDB local.

Modelo MariaDB: `docs/escuela_futbol_mariadb.sql` + `db/mariadb/migrations` + `db/mariadb/010_permisos_app.sql`;
pruebas del esquema en `docs/escuela_futbol_mariadb_checks.sql` (ver su encabezado; sólo sobre una copia vacía).

Esquema PostgreSQL anterior (historial; ya no es la fuente de verdad):

```bash
npm run db:reset             # crea charales_dev: migraciones + seed ficticio
npm run db:test              # crea charales_test desde cero y corre las pruebas de integridad
```

**Variables de entorno:** la API lee `.env` (copia de [`.env.example`](.env.example), no versionado; tabla en
[`docs/SETUP.md`](docs/SETUP.md)). El frontend no usa variables de entorno. Los scripts del esquema PostgreSQL histórico
usan `DATABASE_URL` (opcional).

## Comandos

Todos están definidos en `package.json`.

| Comando                                 | Qué hace                                                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `npm start`                             | Servidor de desarrollo (`ng serve`)                                                                               |
| `npm run build`                         | Build de producción en `dist/`                                                                                    |
| `npm run watch`                         | Build de desarrollo en modo watch                                                                                 |
| `npm test`                              | Pruebas Angular (Vitest) en modo watch. Para una sola corrida: `npx ng test --watch=false`                        |
| `npm run ng -- <args>`                  | Angular CLI                                                                                                       |
| `npm run db:setup`                      | Prepara `DB_NAME` (esquema si está vacía, migraciones, permisos); seguro de repetir. `-- --demo`: datos ficticios |
| `npm run db:admin`                      | Crea un administrador (pide correo y contraseña); nunca sobrescribe una cuenta                                    |
| `npm run test:all`                      | Frontend + typecheck + API sobre MariaDB                                                                          |
| `npm run api:start`                     | API en :3000 (empaqueta el dominio con `api:build`; lee `.env`)                                                   |
| `npm run api:test`                      | Pruebas de la API sobre MariaDB, en bases temporales `ef_*` que se borran al terminar                             |
| `npm run api:typecheck`                 | Typecheck de `api/`, `api/domain` y `e2e/`                                                                        |
| `npm run e2e`                           | Build + E2E en Chrome headless sobre una base temporal (necesita Google Chrome)                                   |
| `npm run db:mariadb:migrate`            | Aplica `db/mariadb/migrations` a `DB_NAME` (idempotentes)                                                         |
| `npm run db:mariadb:demo`               | Datos de demostración en `DB_NAME` (sólo si la base está vacía)                                                   |
| `npm run db:mariadb:test-backup`        | MariaDB: 42 checks del esquema + respaldo/restauración en bases temporales `ef_bktest_*`                          |
| `npx prettier --check .` / `--write .`  | Revisar / aplicar formato (no hay script `format`)                                                                |
| `npx tsc -p tsconfig.app.json --noEmit` | Typecheck de la app (igual con `tsconfig.spec.json` para las pruebas)                                             |
| `npm run db:migrate`                    | Histórico (PostgreSQL): aplica las migraciones pendientes a `$DATABASE_URL`                                       |
| `npm run db:reset`                      | Histórico (PostgreSQL): **borra** y recrea `charales_dev` con migraciones + seed                                  |
| `npm run db:test`                       | Histórico (PostgreSQL): recrea `charales_test`, 57 pruebas de integridad y 21 consultas                           |

No existen `db:seed` ni `lint`: el seed se carga con `db:reset` y no hay ESLint configurado.

## Herramientas

**Requeridas:** las de la tabla de requisitos.

**Recomendadas:**

- Un editor con soporte de Angular y Prettier.
- El cliente `mariadb` o uno gráfico (DBeaver, TablePlus) para explorar la BD.

**Opcionales:** cualquier editor sirve. Si usas VS Code o Code OSS, `.vscode/extensions.json` recomienda:

- `angular.ng-template`: plantillas Angular;
- `esbenp.prettier-vscode`: formato al guardar;
- `editorconfig.editorconfig`: respeta `.editorconfig`.

También son útiles una extensión de PostgreSQL/SQL, `bierner.markdown-mermaid` (el diagrama ER de
`docs/database/relationships.md` es Mermaid) y GitLens. Ninguna es obligatoria.

## Estructura

```text
src/app/     frontend Angular: core/ (modelos, auth, datos mock, servicios compartidos), features/, shared/, layout/
db/          mariadb/ (seed de permisos de la app) y el esquema PostgreSQL anterior: migrations/, seed/, tests/…
docs/        documentación: DEVELOPMENT, ARCHITECTURE, AUTHORIZATION, TESTING, TRACEABILITY, ROADMAP, DOMAIN_RULES,
             requirements/USER_STORIES.md (76 HU), database/ (MARIADB.md = contrato vigente), escuela_futbol_mariadb*.sql
             (INTEGRATION_MAP y PLAN son históricos)
```

## Documentación

- [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md): qué es, estado e índice de toda la documentación.
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md): onboarding (comandos, dónde está cada cosa, antes del PR).
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): capas, API y dominio (D13), autorización y qué es temporal.
- [`docs/AUTHORIZATION.md`](docs/AUTHORIZATION.md): matriz de roles y perfiles vinculados.
- [`docs/TESTING.md`](docs/TESTING.md): qué valida cada grupo de pruebas.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): branches, commits, PRs y migraciones.
- [`AGENTS.md`](AGENTS.md) y [`CLAUDE.md`](CLAUDE.md): reglas para IAs.
- [`docs/database/MARIADB.md`](docs/database/MARIADB.md): el modelo MariaDB vigente y las decisiones D1–D12.

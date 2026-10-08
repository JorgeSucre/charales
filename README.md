# Charales — WebApp Escuela de Fútbol

Proyecto escolar integrador: plataforma web para administrar una escuela formativa de fútbol, con usuarios, tutores,
inscripciones, entrenadores, cobranza, uniformes, portal para padres y reportes. Las historias de usuario están
organizadas por épicas y responsables.

> **Estado:** el frontend Angular implementa el backlog (HU-001…076) sobre **datos simulados** (`MockDb`) que siguen el
> modelo **MariaDB** adoptado ([`docs/database/MARIADB.md`](docs/database/MARIADB.md)). Todavía **no hay backend**: la
> autenticación y los datos viven en el navegador. Trazabilidad HU → código → pruebas: [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md).
> Contexto completo, estado por área y quién hace qué: [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md).

## Requisitos

| Herramienta | Versión                                               | Para qué                                                                   |
| ----------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| Node.js     | `^22.22.3`, `^24.15.0` o `>=26` (probado con 26.10.0) | Frontend                                                                   |
| npm         | 11 (probado con 11.19.1)                              | Dependencias y scripts                                                     |
| MariaDB     | 10.6+, con `mariadb` y `mariadb-dump` en el `PATH`    | Modelo objetivo: checks del esquema y respaldo (opcional para el frontend) |
| PostgreSQL  | 16, con `psql`, `createdb` y `dropdb` en el `PATH`    | Sólo el esquema histórico de `db/migrations`                               |
| Git         | reciente                                              | —                                                                          |
| `sh`        | macOS/Linux; en Windows usa Git Bash o WSL            | Scripts de BD                                                              |

## Empezar desde cero

```bash
git clone <url-del-repo> charales && cd charales
npm install
npm start                    # http://localhost:4200
```

Usuarios de demostración (contraseña `demo1234`, se verifica contra un hash con sal del mock): `admin@example.com`,
`secretaria@example.com`, `coach@example.com`, `tutor@example.com` y `marta@example.com` (entrenadora y tutora en la
misma cuenta). Los datos simulados se reinician al recargar la página.

Modelo MariaDB (opcional para el frontend): `docs/escuela_futbol_mariadb.sql` + `db/mariadb/010_permisos_app.sql`;
pruebas del esquema en `docs/escuela_futbol_mariadb_checks.sql` (ver su encabezado; sólo sobre una copia vacía).

Esquema PostgreSQL anterior (historial; ya no es la fuente de verdad):

```bash
npm run db:reset             # crea charales_dev: migraciones + seed ficticio
npm run db:test              # crea charales_test desde cero y corre las pruebas de integridad
```

**Variables de entorno:** no hay archivo `.env` ni secretos. Los scripts de BD usan `DATABASE_URL`, que es opcional
(por defecto `postgresql:///charales_dev`, local y sin contraseña), y las variables estándar de `psql` (`PGHOST`,
`PGUSER`…) si tu servidor las necesita. El frontend no usa variables de entorno.

## Comandos

Todos están definidos en `package.json`.

| Comando                                | Qué hace                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm start`                            | Servidor de desarrollo (`ng serve`)                                                        |
| `npm run build`                        | Build de producción en `dist/`                                                             |
| `npm run watch`                        | Build de desarrollo en modo watch                                                          |
| `npm test`                             | Pruebas Angular (Vitest) en modo watch. Para una sola corrida: `npx ng test --watch=false` |
| `npm run ng -- <args>`                 | Angular CLI                                                                                |
| `npm run db:migrate`                   | Aplica las migraciones pendientes a `$DATABASE_URL`                                        |
| `npm run db:reset`                     | **Borra** y recrea `charales_dev` con migraciones + seed (sólo local)                      |
| `npm run db:test`                      | Recrea `charales_test` y corre las 57 pruebas de integridad y las 21 consultas críticas    |
| `npx prettier --check .` / `--write .` | Revisar / aplicar formato (no hay script `format`)                                         |

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
docs/        documentación: TRACEABILITY, ROADMAP, INTEGRATION_MAP, PLAN, database/ (MARIADB.md = contrato vigente)
```

## Documentación

- [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md): qué es, estado e índice de toda la documentación.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): branches, commits, PRs y migraciones.
- [`AGENTS.md`](AGENTS.md) y [`CLAUDE.md`](CLAUDE.md): reglas para IAs.
- [`docs/database/README.md`](docs/database/README.md): la base de datos en detalle.

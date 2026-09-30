# Charales — WebApp Escuela de Fútbol

Proyecto escolar integrador: plataforma web para administrar una escuela formativa de fútbol, con usuarios, tutores,
inscripciones, entrenadores, cobranza, uniformes, portal para padres y reportes. Las historias de usuario están
organizadas por épicas y responsables.

> **Estado:** el frontend Angular funciona con **datos simulados** y el esquema PostgreSQL está listo, pero **todavía
> no están conectados**: no hay backend ni autenticación real.
> Contexto completo, estado por área y quién hace qué: [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md).

## Requisitos

| Herramienta | Versión                                               | Para qué                      |
| ----------- | ----------------------------------------------------- | ----------------------------- |
| Node.js     | `^22.22.3`, `^24.15.0` o `>=26` (probado con 26.10.0) | Frontend                      |
| npm         | 11 (probado con 11.19.1)                              | Dependencias y scripts        |
| PostgreSQL  | 16, con `psql`, `createdb` y `dropdb` en el `PATH`    | Sólo para la BD y sus pruebas |
| Git         | reciente                                              | —                             |
| `sh`        | macOS/Linux; en Windows usa Git Bash o WSL            | Scripts de BD                 |

## Empezar desde cero

```bash
git clone <url-del-repo> charales && cd charales
npm install
npm start                    # http://localhost:4200
```

Usuarios de demostración (la contraseña **no se verifica**; escribe cualquiera): `admin@example.com`,
`secretaria@example.com`, `coach@example.com`, `tutor@example.com`.

Base de datos local (opcional para el frontend):

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
| `npm run db:test`                      | Recrea `charales_test` y corre las 55 pruebas de integridad y las 21 consultas críticas    |
| `npx prettier --check .` / `--write .` | Revisar / aplicar formato (no hay script `format`)                                         |

No existen `db:seed` ni `lint`: el seed se carga con `db:reset` y no hay ESLint configurado.

## Herramientas

**Requeridas:** las de la tabla de requisitos.

**Recomendadas:**

- Un editor con soporte de Angular y Prettier.
- `psql` o un cliente gráfico de PostgreSQL (pgAdmin, DBeaver, TablePlus) para explorar la BD.

**Opcionales:** cualquier editor sirve. Si usas VS Code o Code OSS, `.vscode/extensions.json` recomienda:

- `angular.ng-template`: plantillas Angular;
- `esbenp.prettier-vscode`: formato al guardar;
- `editorconfig.editorconfig`: respeta `.editorconfig`.

También son útiles una extensión de PostgreSQL/SQL, `bierner.markdown-mermaid` (el diagrama ER de
`docs/database/relationships.md` es Mermaid) y GitLens. Ninguna es obligatoria.

## Estructura

```text
src/app/     frontend Angular: core/ (modelos, auth, datos mock, servicios compartidos), features/, shared/, layout/
db/          PostgreSQL: migrations/, seed/, tests/, queries/, scripts/
docs/        documentación: ROADMAP, INTEGRATION_MAP, PLAN y database/ (contrato de datos)
```

## Documentación

- [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md): qué es, estado e índice de toda la documentación.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): branches, commits, PRs y migraciones.
- [`AGENTS.md`](AGENTS.md) y [`CLAUDE.md`](CLAUDE.md): reglas para IAs.
- [`docs/database/README.md`](docs/database/README.md): la base de datos en detalle.

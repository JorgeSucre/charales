# Desarrollo y onboarding

Guía para empezar a trabajar en Charales sin preguntar cómo funciona. Arquitectura: [`ARCHITECTURE.md`](ARCHITECTURE.md).
Contexto, equipo y estado por área: [`../PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md).

## 0. Qué hay y qué no hay

- **Hay:** frontend Angular que implementa las 76 HU sobre datos simulados en memoria (`MockDb`), el modelo MariaDB
  probado (DDL, checks, permisos, respaldo) y 138 pruebas.
- **API (Milestone 1):** `api/` con `GET /health` y autenticación sobre MariaDB, más su colección Postman
  ([`API.md`](API.md)).
- **No hay todavía:** conexión del frontend a la API. Los datos de la app se reinician al recargar la página.

> **Estado de `main` (2026-10-07):** el `main` local de quien integró está en `18178ba` (fast-forward desde
> `jorgesucre/fix/audit-go-with-fixes`), **sin publicar**: `origin/main` sigue en `47b926c`, que no tiene el trabajo
> descrito en esta documentación. Hasta que esos commits lleguen a `origin` (por PR, según
> [`CONTRIBUTING.md`](../CONTRIBUTING.md)), un clon nuevo de `main` no corresponde a estos documentos.

## 1. Requisitos

| Herramienta | Versión                                                                        | Para qué                                           |
| ----------- | ------------------------------------------------------------------------------ | -------------------------------------------------- |
| Node.js     | `^22.22.3`, `^24.15.0` o `>=26.0.0` (lo exige Angular 22; probado con 26.10.0) | Frontend y pruebas                                 |
| npm         | 11 (fijado en `packageManager`: `npm@11.19.1`)                                 | Dependencias y scripts. No se usa pnpm ni yarn     |
| MariaDB     | 10.6+ con `mariadb` y `mariadb-dump` en el `PATH` (probado con 13.0.2)         | API, checks del esquema y respaldo                 |
| Postman CLI | Opcional (probado con 1.71.0, sin iniciar sesión)                              | Correr la colección `postman/` contra la API       |
| `sh`        | macOS/Linux; en Windows, Git Bash o WSL                                        | Scripts de base de datos                           |
| PostgreSQL  | 16                                                                             | Sólo para el esquema **histórico** (no hace falta) |

El frontend no usa variables de entorno y los scripts de MariaDB usan las opciones estándar del cliente `mariadb`. La
API lee `.env` (no versionado; copia [`.env.example`](../.env.example)): detalle en [`API.md`](API.md).

## 2. Instalar y ejecutar

```bash
git clone <url-del-repo> charales && cd charales
npm install
npm start                       # ng serve → http://localhost:4200
```

Cuentas de demostración (contraseña `demo1234`):

| Cuenta                   | Rol / perfil                                     |
| ------------------------ | ------------------------------------------------ |
| `admin@example.com`      | ADMINISTRADOR                                    |
| `secretaria@example.com` | SECRETARIA                                       |
| `coach@example.com`      | Entrenador (Sub-10)                              |
| `tutor@example.com`      | Tutora (dos hijos)                               |
| `marta@example.com`      | Entrenadora (Sub-12) y tutora en la misma cuenta |
| `baja@example.com`       | Cuenta desactivada (no puede iniciar sesión)     |

## 3. Comandos de verificación

Todos son los que usa el proyecto (`package.json`, [`CONTRIBUTING.md`](../CONTRIBUTING.md)).

| Qué                        | Comando                                                                            | Resultado actual                     |
| -------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------ |
| Pruebas (una corrida)      | `npx ng test --watch=false`                                                        | 138/138                              |
| Pruebas en modo watch      | `npm test` (no termina solo)                                                       | —                                    |
| Typecheck                  | `npx tsc -p tsconfig.app.json --noEmit` y `npx tsc -p tsconfig.spec.json --noEmit` | Sin errores                          |
| Formato                    | `npx prettier --check .` (aplicar: `npx prettier --write .`)                       | Todo con formato                     |
| Build de producción        | `npm run build` (salida en `dist/`)                                                | Sin errores                          |
| Esquema MariaDB + respaldo | `npm run db:mariadb:test-backup`                                                   | 42/42 checks; 39/39 tablas idénticas |
| Pruebas de la API          | `npm run api:test` (base temporal `ef_apitest_*`)                                  | 10/10                                |
| Colección Postman          | `postman collection lint postman/` y `postman collection run …` (ver `API.md`)     | 8 requests, 9/9 aserciones           |
| Lint                       | No hay ESLint configurado                                                          | —                                    |

`npm run db:mariadb:test-backup` crea y borra sólo sus propias bases temporales `ef_bktest_*`. Los scripts
`npm run db:reset` y `npm run db:test` son del esquema PostgreSQL **histórico** y **borran y recrean** `charales_dev` y
`charales_test`: nunca los apuntes a una base compartida.

Qué cubre cada grupo de pruebas: [`TESTING.md`](TESTING.md).

## 4. Revisar la base MariaDB (opcional)

El DDL ejecuta `DROP TABLE IF EXISTS` dentro de la base que crea: cárgalo **siempre con un nombre propio** (el script
de checks se niega a correr sobre `escuela_futbol` o sobre una base con datos).

```bash
sed 's/escuela_futbol/ef_checks/g' docs/escuela_futbol_mariadb.sql | mariadb   # esquema vacío en ef_checks
mariadb ef_checks < db/mariadb/010_permisos_app.sql                              # permisos y rol_permiso de la app
mariadb ef_checks < docs/escuela_futbol_mariadb_checks.sql                       # 42 casos (inserta datos de prueba)
mariadb ef_checks                                                                # explorar
```

Al terminar: `mariadb -e 'DROP DATABASE ef_checks'`. Contrato completo: [`database/MARIADB.md`](database/MARIADB.md).

## 5. Dónde está cada cosa

| Busco…                          | Está en                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| Las 76 HU (fuente oficial)      | `docs/requirements/USER_STORIES.md`                                                               |
| Estado de cada HU → código      | `docs/TRACEABILITY.md`                                                                            |
| Decisiones funcionales (D1–D12) | `docs/database/MARIADB.md` § 4                                                                    |
| Permisos y matriz por rol       | `src/app/core/auth/permissions.ts` (+ `db/mariadb/010_permisos_app.sql`), `docs/AUTHORIZATION.md` |
| Autorización y alcance          | `src/app/core/auth/authorization.service.ts`, `grants()` en `session.store.ts`                    |
| Rutas y su permiso              | `src/app/app.routes.ts`; tabla de seguridad en `src/app/app.routes.spec.ts`                       |
| Servicios de dominio            | `src/app/features/<dominio>/*.service.ts`, lecturas compartidas en `src/app/core/services/`       |
| Páginas                         | `src/app/features/<dominio>/*.page.ts` / `*.pages.ts`                                             |
| Modelos                         | `src/app/core/models/`                                                                            |
| Datos simulados                 | `src/app/core/data/mock-db.ts` (+ verificador `mock-db.integrity.ts`)                             |
| Pruebas                         | `src/**/*.spec.ts` ([`TESTING.md`](TESTING.md))                                                   |
| Esquema MariaDB                 | `docs/escuela_futbol_mariadb.sql`, `docs/escuela_futbol_mariadb_checks.sql`                       |
| Respaldo                        | `db/mariadb/scripts/`                                                                             |
| Quién escribe cada tabla        | `docs/database/OWNERSHIP.md`                                                                      |

Convenciones de código (dinero en centavos, fechas locales, servicios que devuelven `Promise`, autorización por permiso
y nunca por nombre de rol): [`AGENTS.md`](../AGENTS.md) y [`database/MARIADB.md` § 1](database/MARIADB.md).

## 6. Ramas y PR

- `main` está protegida: **no se trabaja ni se hace push directo en `main`**.
- Una rama por HU desde `main` actualizado: `<integrante>/<tipo>/<hu-descripcion>` (detalle en
  [`CONTRIBUTING.md`](../CONTRIBUTING.md)).
- El merge a `main` sólo ocurre por PR, con al menos una revisión aprobada y las pruebas en verde; si tocas una tabla o
  contrato de otro owner, revisa ese owner.

### Antes de abrir un PR

1. `npm run build`, `npx ng test --watch=false`, `npx prettier --check .` (y los dos `tsc` de arriba).
2. `npm run db:mariadb:test-backup` si tocaste el modelo MariaDB o `db/mariadb`.
3. Si agregaste una ruta, va en la tabla de `app.routes.spec.ts`; si agregaste una operación de servicio, verifica
   permiso y alcance con `AuthorizationService` ([`AUTHORIZATION.md`](AUTHORIZATION.md)).
4. Actualiza en el mismo PR el documento fuente del contrato que cambiaste.
5. Llena `.github/pull_request_template.md`.

## 7. No modificar sin revisar las decisiones

| Archivo                                                                                          | Por qué                                                                                                                                    |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/requirements/USER_STORIES.md`                                                              | Tabla oficial de HU. Las decisiones posteriores se documentan en `MARIADB.md` § 4, no aquí                                                 |
| `src/app/core/auth/permissions.ts` y `db/mariadb/010_permisos_app.sql`                           | Matriz de roles D12; deben generar la misma matriz (106 filas) y la cubren `authorization.spec.ts`                                         |
| `core/auth/session.store.ts` (`grants`), `authorization.service.ts`, `TrainingService.canRecord` | Protegen contra la escalada por perfiles vinculados                                                                                        |
| `docs/escuela_futbol_mariadb.sql`                                                                | Modelo vigente: un cambio se acuerda con el equipo y lleva su caso en el script de checks, su modelo TS, `MockDb` y `mock-db.integrity.ts` |
| `db/migrations/` (PostgreSQL)                                                                    | Histórico: no se agregan ni editan migraciones                                                                                             |
| `docs/database/evidence/*`                                                                       | Salidas de los scripts oficiales: se regeneran, no se editan a mano                                                                        |

## 8. Limitaciones conocidas

En [`ROADMAP.md` › Limitaciones conocidas](ROADMAP.md#limitaciones-conocidas-y-siguiente-fase).

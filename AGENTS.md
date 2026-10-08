# AGENTS.md — reglas para cualquier IA en este repo

## Antes de modificar código

1. Lee [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md): qué es, estado, quién hace qué. Comandos y mapa del código:
   [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) y [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). La API está en `api/` (Milestone 1: salud y autenticación; contrato en [`docs/API.md`](docs/API.md)).
2. Lee el contrato de lo que vas a tocar: modelo de datos → [`MARIADB.md`](docs/database/MARIADB.md) (vigente) y las
   reglas de dominio de [`DATA_CONTRACT.md`](docs/database/DATA_CONTRACT.md); reglas que la API debe garantizar →
   [`DOMAIN_RULES.md`](docs/DOMAIN_RULES.md); autorización → [`AUTHORIZATION.md`](docs/AUTHORIZATION.md); estado de
   cada HU → [`TRACEABILITY.md`](docs/TRACEABILITY.md). `INTEGRATION_MAP.md` y `PLAN.md` son históricos.
3. Identifica al **responsable de la HU** ([`USER_STORIES.md`](docs/requirements/USER_STORIES.md), la tabla oficial) y
   al **owner de cada tabla** ([`OWNERSHIP.md`](docs/database/OWNERSHIP.md)). Trabaja sólo en lo que te pidieron; no
   reasignes historias; para lo ajeno, usa los contratos del owner.
4. Revisa `git status`, `git log` y la rama actual. No pises trabajo existente.
5. **No inventes** tablas, modelos, requisitos ni historias. Si falta información, pregunta o documenta la ambigüedad.
6. **No modifiques migraciones ya aplicadas**; crea una nueva (`db/migrations/NNN_*.sql`) con su prueba.
7. **No escribas en tablas de otro owner.** Llama a su servicio.
8. Ejecuta las pruebas antes de decir que algo funciona:
   `npm run build`, `npx ng test --watch=false` y `npx prettier --check .`; si tocaste el modelo MariaDB o
   `db/mariadb`, también `npm run db:mariadb:test-backup` (checks del esquema + respaldo). `npm run db:test` sólo
   aplica al esquema PostgreSQL histórico. Si tocaste `api/`: `npm run api:test`, `postman collection lint postman/` y
   `postman collection run` contra la API local ([`docs/API.md`](docs/API.md)).
9. Toda operación de servicio verifica permiso y propiedad con `AuthorizationService`
   ([`docs/AUTHORIZATION.md`](docs/AUTHORIZATION.md)); no basta con la ruta.
10. Si cambias un contrato (modelo, tabla, API, permiso), actualiza su documento fuente **en el mismo cambio**.
11. **Nunca hagas push a `main`.** Trabaja en una rama y abre un PR (ver [`CONTRIBUTING.md`](CONTRIBUTING.md)).

## Siempre

- No elimines funcionalidad existente sin autorización.
- No agregues dependencias si unas líneas o la plataforma lo resuelven.
- No toques infraestructura (build, configuración, CI) sin necesidad.
- No expongas secretos: nada de claves, contraseñas reales ni `.env` en el repo; en el frontend todo es público.
- No declares verificado algo que no ejecutaste. Si una prueba falla, repórtalo con la salida.
- Termina con un reporte: qué cambiaste, comandos ejecutados y resultados, y qué quedó pendiente.

## Convenciones de código (resumen; la fuente es cada documento enlazado)

- Flujo: páginas → servicios de dominio → `core/data/mock-db.ts`. Las páginas nunca inyectan `MockDb`. Los servicios
  devuelven `Promise`.
- Modelos sólo en `src/app/core/models/`; no se redeclaran en los módulos.
- Autorización por **permiso** (`core/auth/permissions.ts`), nunca `role === '…'`. Toda ruta nueva va en la tabla de
  `app.routes.spec.ts`.
- Decide con `AuthorizationService` / `grants()`. `user.permissions` incluye los permisos de perfil: sólo se lee dentro
  de una verificación de alcance de ese perfil (como `TrainingService.canRecord`); usarlo para algo global abriría una
  escalada lateral. La matriz de roles (D12) no se cambia sin acuerdo; `permissions.ts` y
  `db/mariadb/010_permisos_app.sql` deben quedar sincronizados.
- Dinero en centavos enteros; fechas locales con `today()` (`shared/dates.ts`). Detalle en `DATA_CONTRACT.md` § 1.
- Componentes standalone, templates inline, signals, `resource()`, formularios reactivos con `FieldError` y
  `Submission`. OnPush es el default en Angular 22.
- Estilos globales en `src/styles.css`. Código en inglés, UI en español.

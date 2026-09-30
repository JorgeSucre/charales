# AGENTS.md — reglas para cualquier IA en este repo

## Antes de modificar código

1. Lee [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md): qué es, estado, quién hace qué.
2. Lee el contrato de lo que vas a tocar: datos → [`DATA_CONTRACT.md`](docs/database/DATA_CONTRACT.md); integración →
   [`INTEGRATION_MAP.md`](docs/INTEGRATION_MAP.md); frontend existente → [`docs/PLAN.md`](docs/PLAN.md).
3. Identifica al **responsable de la HU** ([`USER_STORIES.md`](docs/requirements/USER_STORIES.md), la tabla oficial) y
   al **owner de cada tabla** ([`OWNERSHIP.md`](docs/database/OWNERSHIP.md)). Trabaja sólo en lo que te pidieron; no
   reasignes historias; para lo ajeno, usa los contratos del owner.
4. Revisa `git status`, `git log` y la rama actual. No pises trabajo existente.
5. **No inventes** tablas, modelos, requisitos ni historias. Si falta información, pregunta o documenta la ambigüedad.
6. **No modifiques migraciones ya aplicadas**; crea una nueva (`db/migrations/NNN_*.sql`) con su prueba.
7. **No escribas en tablas de otro owner.** Llama a su servicio.
8. Ejecuta las pruebas antes de decir que algo funciona:
   `npm run db:test`, `npm run build`, `npx ng test --watch=false` y `npx prettier --check .`.
9. Si cambias un contrato (modelo, tabla, API, permiso), actualiza su documento fuente **en el mismo cambio**.
10. **Nunca hagas push a `main`.** Trabaja en una rama y abre un PR (ver [`CONTRIBUTING.md`](CONTRIBUTING.md)).

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
- Dinero en centavos enteros; fechas locales con `today()` (`shared/dates.ts`). Detalle en `DATA_CONTRACT.md` § 1.
- Componentes standalone, templates inline, signals, `resource()`, formularios reactivos con `FieldError` y
  `Submission`. OnPush es el default en Angular 22.
- Estilos globales en `src/styles.css`. Código en inglés, UI en español.

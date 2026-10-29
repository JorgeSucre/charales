# Desarrollo y onboarding

Guía para empezar a trabajar en Charales sin preguntar cómo funciona. Arquitectura: [`ARCHITECTURE.md`](ARCHITECTURE.md).
Contexto, equipo y estado por área: [`../PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md).

## 0. Qué hay y qué no hay

- **Hay:** frontend Angular con las 76 HU, que usa la API para la sesión y los datos; el modelo MariaDB probado (DDL,
  migraciones, checks, permisos, respaldo); 241 pruebas del frontend, 192 de la API y 18 E2E (2026-10-29).
- **API:** `api/` con autenticación y contraseñas, y `POST /api/rpc`, que ejecuta los servicios de dominio sobre
  MariaDB (D13), más su colección Postman ([`API.md`](API.md)).
- **La app usa la API para todo** (sesión y datos): sin la API corriendo, el login muestra «No se pudo conectar con la
  API». Datos de prueba: `npm run db:mariadb:demo` sobre un esquema vacío.

> **Estado:** toda la app corre sobre la API y MariaDB (D13) desde `main`; se instala desde `main`
> ([`SETUP.md`](SETUP.md)).

## 1. Requisitos

| Herramienta | Versión                                                                       | Para qué                                           |
| ----------- | ----------------------------------------------------------------------------- | -------------------------------------------------- |
| Node.js     | `^24.15.0` o `>=26.0.0` (Angular 22 y la API; probado con 26.11)              | Frontend, API y pruebas                            |
| npm         | 11 (fijado en `packageManager`: `npm@11.19.1`)                                | Dependencias y scripts. No se usa pnpm ni yarn     |
| MariaDB     | 10.6+ local (probado con 13.0.2); el cliente `mariadb` sólo para scripts `sh` | Base de la app, pruebas, checks y respaldo         |
| Postman CLI | Opcional (probado con 1.71.0, sin iniciar sesión)                             | Correr la colección `postman/` contra la API       |
| `sh`        | macOS/Linux; en Windows, Git Bash o WSL                                       | Scripts de base de datos                           |
| PostgreSQL  | 16                                                                            | Sólo para el esquema **histórico** (no hace falta) |

El frontend no usa variables de entorno y los scripts de MariaDB usan las opciones estándar del cliente `mariadb`. La
API lee `.env` (no versionado; copia [`.env.example`](../.env.example)): detalle en [`API.md`](API.md).

## 2. Instalar y ejecutar

Paso a paso (MariaDB por sistema operativo, cuenta, `.env`, base, administrador, arranque y problemas comunes):
**[`SETUP.md`](SETUP.md)**. Resumen:

```bash
npm ci && cp .env.example .env   # pon tu DB_PASSWORD
npm run db:setup                 # esquema + migraciones + permisos (seguro de repetir)
npm run db:admin                 # o: npm run db:setup -- --demo  (cuentas de abajo)
npm run api:start                # terminal 1: API en :3000
npm start                        # terminal 2: http://localhost:4200 (proxy de /api, /auth y /health a :3000)
```

Cuentas de demostración de `npm run db:setup -- --demo` (contraseña `demo1234`):

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
| Pruebas (una corrida)      | `npx ng test --watch=false`                                                        | 241/241                              |
| Pruebas en modo watch      | `npm test` (no termina solo)                                                       | —                                    |
| Typecheck                  | `npx tsc -p tsconfig.app.json --noEmit` y `npx tsc -p tsconfig.spec.json --noEmit` | Sin errores                          |
| Formato                    | `npx prettier --check .` (aplicar: `npx prettier --write .`)                       | Todo con formato                     |
| Build de producción        | `npm run build` (salida en `dist/`)                                                | Sin errores                          |
| Esquema MariaDB + respaldo | `npm run db:mariadb:test-backup`                                                   | 42/42 checks; 40/40 tablas idénticas |
| Pruebas de la API          | `npm run api:test` (bases temporales `ef_*` que se borran al terminar)             | 192/192                              |
| E2E en navegador           | `npm run e2e` (necesita Google Chrome; base temporal `ef_e2e_*`)                   | 18/18                                |
| Colección Postman          | `postman collection lint postman/` y `postman collection run …` (ver `API.md`)     | 37 requests, 42/42 aserciones        |
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
| Capa HTTP a la API              | `src/app/core/api/charales-api.service.ts`; proxy en `proxy.conf.json`                            |
| Datos simulados                 | `src/app/core/data/mock-db.ts` (+ verificador `mock-db.integrity.ts`)                             |
| Pruebas                         | `src/**/*.spec.ts` ([`TESTING.md`](TESTING.md))                                                   |
| Esquema MariaDB                 | `docs/escuela_futbol_mariadb.sql`, `docs/escuela_futbol_mariadb_checks.sql`                       |
| Respaldo                        | `db/mariadb/scripts/`                                                                             |
| Quién escribe cada tabla        | `docs/database/OWNERSHIP.md`                                                                      |

Convenciones de código (dinero en centavos, fechas locales, servicios que devuelven `Promise`, autorización por permiso
y nunca por nombre de rol): [`AGENTS.md`](../AGENTS.md) y [`database/MARIADB.md` § 1](database/MARIADB.md).

## 5.1 Mensajes de validación y error

Convención única (cierre 2026-10-29). La regla vive **una vez** en el servidor (servicio de dominio, ejecutado por la
API); el formulario repite sólo lo que ayuda a corregir antes de enviar, con la misma regla y la misma redacción. La
validación del navegador nunca es la defensa.

| Tipo                           | Formulario (junto a su etiqueta)                      | API (nombra el campo)                                                                                                          | Dónde                                       |
| ------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Obligatorio                    | «Este campo es obligatorio.»                          | «Falta el nombre. Es un dato obligatorio.» (sirve para cualquier género)                                                       | `required()`, `requiredMessage()`           |
| Longitud                       | «Escribe como máximo N caracteres.»                   | «La dirección admite como máximo 255 caracteres.»                                                                              | `optional()`/`required()`, `tooLongMessage` |
| Correo                         | «Ingresa un correo electrónico válido, por ejemplo …» | igual                                                                                                                          | `EMAIL_MESSAGE`, `emailValidator`           |
| Teléfono                       | «Ingresa un número de teléfono válido: de 10 a 15 …»  | igual                                                                                                                          | `PHONE_MESSAGE`, `phoneValidator`           |
| Formato de fecha/hora          | —(el control es `date`/`time`)                        | «Ingresa una fecha de nacimiento válida.», «Ingresa una hora válida (HH:MM).»                                                  | `DATE_MESSAGE`, `TIMES_MESSAGE`             |
| Importe                        | «Ingresa un importe de al menos $0.01.»               | «Ingresa un importe válido, por ejemplo 150 o 150.50.»                                                                         | `MONEY_MESSAGE`                             |
| Valor de catálogo              | —(el control es un `select`)                          | «Selecciona un estatus válido.»                                                                                                | `oneOf(valor, LABELS, mensaje)`             |
| Rango                          | «Ingresa un valor de al menos N.»                     | la regla concreta: «La fecha de fin no puede ser anterior al inicio.»                                                          | cada servicio                               |
| Duplicado                      | —                                                     | el dato concreto: «Ya existe un usuario con ese correo.»; si lo detecta MariaDB: «Ya existe un registro con esos datos.» (409) | servicio; `api/rpc.ts`                      |
| Referencia inexistente         | —                                                     | «Jugador inexistente: actualiza la página e inténtalo de nuevo.»                                                               | `MockDb.get` → `notFoundMessage()`          |
| Conflicto de estado            | —                                                     | qué impide la acción y qué hacer: «El cargo tiene pagos aplicados: cancela primero esos pagos.»                                | cada servicio                               |
| Permiso (403)                  | —                                                     | «No tienes permiso para realizar esta acción.» (o el alcance concreto)                                                         | `ForbiddenError`, `api/auth.ts`             |
| Sesión (401)                   | —                                                     | «Tu sesión no está iniciada o ya expiró. Inicia sesión de nuevo.»                                                              | `NO_SESSION`                                |
| Inesperado (500, 400 genérico) | «Ocurrió un error inesperado. Inténtalo de nuevo; …»  | igual; nunca trazas, SQL ni nombres de tablas (se registran en el log)                                                         | `UNEXPECTED_MESSAGE`, `TYPE_ERROR_MESSAGE`  |

- Los textos compartidos están en `src/app/shared/validate.ts`; los del formulario, en `shared/field-error.ts`
  (`FieldError`). No escribas mensajes a mano en las páginas.
- **Accesibilidad:** importa `FieldA11y` junto con `FieldError`. Marca el campo con `aria-invalid` y lo enlaza con su
  mensaje (`aria-describedby`) mientras el error se muestra; el mensaje tiene `role="alert"`. Tras un envío rechazado,
  `focusFirstInvalid` lleva el foco al primer campo con error.
- Los valores lógicos que sólo llegan por la API (`flag()`) conservan «Valor de «activo» inválido.»: la interfaz no
  puede producirlos.
- Cada mensaje nuevo llega con su prueba: el texto exacto en `api/*.test.ts` (`refused(…, 400, /^…$/)`) y, si lo
  muestra un formulario, en el `*.spec.ts` de la página.

## 5.2 Pantallas de lista y formulario (CRUD)

La **lista es la vista principal**. Cada módulo de administración se organiza así:

1. **Cabecera (`.page-head`):** el título, a la izquierda, y la acción de alta a la derecha («Registrar tutor», «Nueva
   sede»…). Es un botón de divulgación con `aria-expanded` y `aria-controls`; sólo lo ve quien tiene el permiso de
   alta.
2. **Aviso de resultado (`SubmissionAlert`):** va fuera del formulario, así que la confirmación sigue visible después
   de que el formulario se cierra.
3. **Formulario:** está **cerrado por defecto**. Se abre en un panel debajo de la cabecera, con «Guardar» y «Cancelar»
   (también se cancela con Escape). Hay un solo formulario a la vez: «Editar» abre el mismo panel con los datos del
   registro, nunca junto a uno de alta vacío.
4. **Búsqueda o filtros, tabla, paginación y estado vacío.**

`shared/form-panel.ts` (`FormPanel`) hace el trabajo común:

- **Al abrir:** lleva el foco al primer campo.
- **Al cerrar:** devuelve el foco al botón que abrió el panel.
- **Cambios sin guardar:** si el formulario cambió (`dirty`), al cerrarlo, cancelar o abrir otro registro pregunta
  «Hay cambios sin guardar. ¿Descartarlos?». Un formulario sin tocar se cierra sin preguntar.
- **Al guardar:** se cierra (`done()`), se limpia y se recarga la lista; la búsqueda y los filtros se conservan.
- **Al enviar con errores:** `focusFirstInvalid` lleva el foco al primer campo con error.

Para saber si hay cambios sin guardar, un formulario reactivo usa `form.dirty`; uno con `ngModel` compara su borrador
con una copia que se toma al abrir el panel.

**Excepciones (a propósito):**

| Pantalla                                                                               | Motivo                                                                                  |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Jugadores                                                                              | El alta es extensa: tiene su propia ruta (`/admin/players/new`).                        |
| Registrar pago, Generar mensualidades, Permisos por rol, Bitácora de sesión, Mi perfil | El formulario es la tarea misma de la página, no un alta sobre una lista.               |
| Expediente del jugador: cambio de categoría y de estatus                               | Son acciones del registro, dentro de su pestaña.                                        |
| Plantel de una participación                                                           | Es una fila compacta para agregar un jugador, dentro de la tarjeta de la participación. |
| Partidos: reprogramar o registrar resultado                                            | Ya se abre sólo al elegir la acción sobre un partido.                                   |

## 5.3 Tablero (página principal) y gráficas

**Entrada.** `homeUrlOf` (`core/auth/session.store.ts`) decide la página principal de cada sesión:

- el personal con `reportes.consultar` va al **Tablero** (`/admin/dashboard`);
- un tutor, al portal (`/portal`);
- un entrenador, a su panel (`/coach`).

Allí llevan el inicio de sesión, el escudo del menú y la ruta `/`, que se conserva para marcadores antiguos. `/` sólo
muestra contenido si la sesión no tiene ninguna de esas páginas (por ejemplo, un rol al que se le quitó el Tablero en
la matriz de permisos): un aviso breve, sin directorio de módulos. El menú lateral ya no tiene «Inicio»; el Tablero es
la primera entrada, en «Resumen».

**Contenido del Tablero** (`features/reports/reports.pages.ts#DashboardPage`):

| Bloque                                                                                                                                                           | Fuente (API)                                                                                                                                                                             | Depende del periodo                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Cinco indicadores: jugadores activos, categorías activas de la temporada actual, partidos de los próximos 14 días, adeudo vencido y jugadores con adeudo vencido | `ReportService.dashboard()`                                                                                                                                                              | No: son una foto de hoy y no se recargan al cambiar el periodo                                                                        |
| Ingresos del periodo e Ingresos por mes                                                                                                                          | `ReportService.income(from, to)` (la consulta de HU-067: pagos APLICADO por la fecha del pago; cada aplicación cuenta una vez, así que un pago repartido en varios cargos no se duplica) | Sí. Por omisión, el mes en curso hasta hoy, como siempre; también «Mes actual» y «Últimos 6 meses». Un rango invertido no se consulta |
| Jugadores por estatus (dona)                                                                                                                                     | `dashboard().playersByStatus`                                                                                                                                                            | No                                                                                                                                    |
| Estado de cobranza (barras)                                                                                                                                      | `dashboard().chargesByStatus`: cargos no cancelados por su estado derivado, con importe neto (después de descuentos) y saldo                                                             | No                                                                                                                                    |
| Ocupación por categoría (barras)                                                                                                                                 | `dashboard().categories`: integrantes con inscripción vigente frente al cupo; «sin límite» si el cupo es nulo, «cupo 0» si es cero                                                       | No                                                                                                                                    |
| Próximos partidos                                                                                                                                                | `dashboard().upcoming`                                                                                                                                                                   | No                                                                                                                                    |
| Accesos rápidos                                                                                                                                                  | `QUICK_TASKS` (`layout/nav.ts`)                                                                                                                                                          | —                                                                                                                                     |

- **Ocupación:** cuenta las inscripciones vigentes, igual que la página de Categorías. Que un jugador en baja temporal
  conserve su cupo es una decisión pendiente de HU-021; el Tablero no la resuelve.
- **Accesos rápidos:** son siete tareas frecuentes, no un segundo menú. Cada una exige todos sus permisos (el de la
  página y el de la acción). Las que abren un formulario llevan `?nuevo=1`, y la página lo abre al llegar.
- **Clics:** cada estado de jugador o de cargo enlaza a su lista ya filtrada (`/admin/players?status=…`,
  `/admin/billing/charges?status=…`, valores validados con `catalogParam`), y cada categoría, a su detalle. El ingreso
  por mes no enlaza, porque el reporte de ingresos no recibe filtros por URL.
- **Pendiente de datos:** no hay gráfica de tendencia de adeudos, porque el sistema no guarda el saldo histórico; sólo
  existe el saldo de hoy.

**Gráficas** (`shared/charts.ts`): son SVG y CSS, sin bibliotecas.

- `DonutChart`: proporciones de un total.
- `BarChart`: barras horizontales para comparar cantidades.

Ninguna depende sólo del color:

- la dona imprime etiqueta, valor y porcentaje, y su SVG tiene un nombre accesible con el mismo resumen;
- cada barra es un elemento de lista con su texto (la barra en sí es decorativa).

Si no hay datos, lo dicen («No hay pagos registrados en el periodo.»). Un error de la API se muestra como error, nunca
como $0.

**Colores** (`--chart-*` en `styles.css`): un significado por color en todas las gráficas, igual que en las etiquetas
de estado (`shared/status-tone.ts`).

| Token               | Significado                                                                   |
| ------------------- | ----------------------------------------------------------------------------- |
| `--chart-brand`     | serie principal (ingresos, ocupación)                                         |
| `--chart-ok`        | favorable o completado (activo, pagado)                                       |
| `--chart-warn`      | pendiente o que requiere atención (baja temporal, pendiente, categoría llena) |
| `--chart-warn-soft` | avance parcial (pago parcial)                                                 |
| `--chart-danger`    | crítico (vencido, baja definitiva)                                            |
| `--chart-neutral`   | secundario (categoría sin límite de cupo)                                     |

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

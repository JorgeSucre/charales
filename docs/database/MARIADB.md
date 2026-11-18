# Modelo MariaDB adoptado — contrato del frontend

**Modelo físico objetivo:** [`docs/escuela_futbol_mariadb.sql`](../escuela_futbol_mariadb.sql) (MariaDB 10.6+), con sus
pruebas de integridad en [`docs/escuela_futbol_mariadb_checks.sql`](../escuela_futbol_mariadb_checks.sql).

Sustituye al esquema PostgreSQL de `db/migrations` (UUID, `*_cents`) como **fuente de verdad del dominio**. El esquema
PostgreSQL y sus pruebas se conservan sin cambios como historial (sus documentos `schema.md`, `relationships.md`,
`api-contract.md` y `queries.md` describen ese esquema anterior). Cuando un documento anterior contradiga a este, manda
este.

## 1. Convenciones (MariaDB ↔ API ↔ TypeScript)

Fuente en código: [`src/app/core/models/common.ts`](../../src/app/core/models/common.ts).

| MariaDB                          | API (JSON)                                     | TypeScript (dominio)                                      | Helpers                                                                            |
| -------------------------------- | ---------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `BIGINT UNSIGNED AUTO_INCREMENT` | número                                         | `Id = number`                                             | `MockDb.insert` simula el AUTO_INCREMENT                                           |
| `DECIMAL(12,2)`                  | **cadena decimal** `"1234.50"`                 | `Cents` (entero de centavos)                              | `shared/money.ts`: `parseMoney`, `toDecimal`, `sumCents`; `MoneyPipe` para mostrar |
| `DATE`                           | `"YYYY-MM-DD"`                                 | `ISODate` (cadena)                                        | `shared/dates.ts`: `today`, `ageOn`, `addDays`, `weekday`                          |
| `TIME`                           | `"HH:MM"`                                      | `Time` (cadena)                                           | `isTime`, `overlaps`                                                               |
| `DATETIME`                       | `"YYYY-MM-DDTHH:MM:SS"` **sin zona**           | `DateTime` (cadena)                                       | `nowDateTime`, `dateTimeIn`, `dateOf`                                              |
| `ENUM(...)`                      | el valor SQL tal cual (`"ACTIVO"`, `"TORNEO"`) | unión de literales con los mismos valores                 | etiquetas de UI en cada servicio (`*_LABELS`)                                      |
| columna `NULL`                   | `null` (nunca se omite)                        | `T \| null`                                               | `shared/validate.ts`: vacío → `null`                                               |
| nombres `snake_case` en español  | `camelCase` en inglés                          | `camelCase` en inglés (tabla en el comentario del modelo) | —                                                                                  |

- **DATETIME = hora local de la escuela (`America/Mexico_City`) sin offset**, exactamente lo que guarda MariaDB. La API
  no convierte a UTC. Para comparar días se usa la parte de fecha (`dateOf`).
- **Dinero:** nunca se suma con `number` decimal. La API serializa `DECIMAL` como cadena; el frontend la convierte con
  `parseMoney` (sin aritmética flotante) y devuelve `toDecimal(cents)`. Prueba: `shared/shared.spec.ts` (0.10 + 0.20 =
  0.30 exacto).
- `password_hash` nunca sale de la API: el modelo `User` no lo tiene (`UserRow` sólo existe en `MockDb`).

## 2. Tablas → modelo → servicio

| Tabla(s) MariaDB                                                                   | Modelo TS (`core/models`)                                              | Servicio que escribe                                            |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| `roles`, `permisos`, `rol_permiso`                                                 | `Role`, `Permission`, `RolePermission`                                 | `RoleService` (HU-006)                                          |
| `usuarios`                                                                         | `User`                                                                 | `UserService` (HU-004, cuentas de perfil HU-012/022)            |
| `sesiones`, `tokens_recuperacion`                                                  | `Session`, `PasswordResetToken`                                        | `AuthService` (HU-001/002/003/005)                              |
| `auditoria`                                                                        | `AuditEntry`                                                           | `AuditService` (todas las escrituras; HU-007)                   |
| `jugadores`, `historial_estatus`                                                   | `Player`, `PlayerStatusChange`                                         | `PlayerService` (HU-008/009/010/013/014)                        |
| `tutores`, `tutor_jugador`                                                         | `Tutor`, `TutorPlayer`                                                 | `TutorService` (HU-011/012/064)                                 |
| `entrenadores`, `entrenador_categoria`, `entrenador_competencia_categoria`         | `Coach`, `CoachCategory`, `CoachCompetition`                           | `CoachService` (HU-022/023/026)                                 |
| `temporadas`                                                                       | `Season`                                                               | `SeasonService` (HU-070)                                        |
| `sedes`                                                                            | `Venue`                                                                | `VenueService` (HU-069)                                         |
| `categorias`                                                                       | `Category`                                                             | `CategoryService` (HU-015/018/021)                              |
| `inscripciones`                                                                    | `Enrollment`                                                           | `EnrollmentService` (HU-020)                                    |
| `jugador_categoria`, `historial_categoria`                                         | `PlayerCategory`, `CategoryChange`                                     | `PlayerCategoryService` (HU-017/019/021)                        |
| `horarios_entrenamiento`                                                           | `TrainingSchedule`                                                     | `ScheduleService` (HU-016)                                      |
| `sesiones_entrenamiento`                                                           | `TrainingSession`                                                      | `TrainingService` (HU-028/029/031)                              |
| `asistencias`                                                                      | `Attendance`                                                           | `AttendanceService` (HU-030/032/033)                            |
| `competencias`, `competencia_categoria`, `jugador_competencia_categoria`           | `Competition`, `CompetitionCategory`, `RosterEntry`                    | `CompetitionService` (HU-034/035/036)                           |
| `rivales`, `partidos`                                                              | `Opponent`, `Match`                                                    | `MatchService` (HU-037/040)                                     |
| `conceptos_cobro`, `cargos`, `pagos`, `pago_aplicacion`, `descuentos`              | `ChargeConcept`, `Charge`, `Payment`, `PaymentApplication`, `Discount` | `BillingService` (HU-043…051) + reglas puras `billing.rules.ts` |
| `productos_uniforme`, `variantes_uniforme`, `pedidos_uniforme`, `detalle_uniforme` | `UniformProduct`, `UniformVariant`, `UniformOrder`, `UniformOrderLine` | `UniformService` (HU-052…056)                                   |
| `avisos`, `aviso_destinatario`                                                     | `Notice`, `NoticeRecipient`                                            | `NoticeService` (HU-057…060)                                    |
| (lecturas compuestas)                                                              | vistas en cada servicio                                                | `PortalService`, `CoachPanelService`, `ReportService`           |

**El esquema tiene 39 tablas** y todas tienen modelo y arreglo en `MockDb`. `MockDb` tiene además **`outbox`**, que
**no es una tabla de MariaDB**: es infraestructura del mock para simular el correo (`MailerService`, HU-005 y HU-012).
Con la API se sustituye por un proveedor de correo del backend; no debe crearse una tabla `outbox`.

No existen entidades `equipos`, `evaluaciones` ni configuración general: la **categoría es el grupo deportivo**,
`competencias.tipo` distingue TORNEO/LIGA/OTRO y `sedes` son las canchas.

## 3. Roles, perfiles y permisos

- `usuarios.rol_id` sólo admite roles de tipo **SEGURIDAD** (ADMINISTRADOR, SECRETARIA). **TUTOR** y **ENTRENADOR** son
  roles de **PERFIL**: los otorga tener `tutores.usuario_id` / `entrenadores.usuario_id` (y `entrenadores.activo`). Una
  misma cuenta puede ser, p. ej., entrenadora y tutora (`marta@example.com` en el seed).
- Al iniciar sesión, `AuthService.accessOf` calcula roles = rol de seguridad + perfiles, permisos = unión de
  `rol_permiso` de esos roles, y aparte los permisos **sólo del rol de seguridad** (`officePermissions`). Se guardan en
  la sesión: **los cambios de permisos aplican a sesiones nuevas** (HU-006.2). Un permiso de módulo de oficina cuenta
  globalmente sólo si lo da el rol de seguridad; el que trae un perfil vale sólo en el alcance del perfil (sin escalada
  lateral; ver [`AUTHORIZATION.md`](../AUTHORIZATION.md)).
- Rutas y menú verifican **permisos** (`modulo.accion`), nunca nombres de rol. Tabla de seguridad: `app.routes.spec.ts`.
- **Módulos de permiso agregados** (son filas de `permisos`, no cambios de esquema; el comentario de la columna `modulo`
  dice «Ejemplo»): `roles`, `tutores`, `entrenadores`, `temporadas`, `sedes`, `cobranza`, `descuentos`, `reportes`,
  `portal`, `panel_entrenador`. Script idempotente: [`db/mariadb/010_permisos_app.sql`](../../db/mariadb/010_permisos_app.sql)
  (probado sobre MariaDB 13.0.2: 59 permisos; `rol_permiso` 106 filas: ADMINISTRADOR 56, SECRETARIA 45, ENTRENADOR 3,
  TUTOR 2 — la misma matriz, fila por fila, que `DEFAULT_ROLE_PERMISSIONS`; ver D12).
- Cada operación pública de servicio verifica permiso y propiedad en `AuthorizationService` a partir de la sesión
  (`tutor → tutor_jugador → jugadores`; `entrenador → entrenador_categoria / entrenador_competencia_categoria`), nunca a
  partir de un id enviado por el cliente. Matriz completa y estrategia: [`AUTHORIZATION.md`](../AUTHORIZATION.md).
  (Antes de 2026-10-07 esto sólo se cumplía en el portal y en sesiones/asistencia; lo corrigió la auditoría.)

## 4. Decisiones y contradicciones resueltas (HU ↔ SQL)

| #   | HU pide                                                                | SQL permite                                                                                   | Resolución en el código                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | HU-043: conceptos «mensualidad, inscripción, uniforme u otros»         | `conceptos_cobro` sólo tiene `recurrente`                                                     | Se eliminó `ConceptKind`. `recurrente` filtra los conceptos para generar mensualidades; en inscripción y pedidos de uniforme el usuario elige el concepto (se preselecciona el que se llama «Uniforme»).                                                                  |
| D2  | HU-020.2: la inscripción «puede vincular pago»                         | `inscripciones` no tiene `cargo_id`                                                           | Se crea un cargo con `temporada_id` y `referencia = 'INS-<id>'`; el vínculo se resuelve por jugador + referencia. Cancelar la inscripción cancela ese cargo si no tiene pagos.                                                                                            |
| D3  | HU-036/HU-026: «conserva historial» de plantel y asignaciones          | `UNIQUE (jugador_id, competencia_categoria_id)` y `(entrenador_id, competencia_categoria_id)` | Una baja cierra la fila (`fecha_baja`/`fecha_fin`, `activo = FALSE`). Si la persona regresa se **reabre la misma fila**; las fechas anteriores quedan en `auditoria` (antes/después).                                                                                     |
| D4  | HU-015.1: nombre único por temporada «si aplica»                       | Con `temporada_id NULL` el `UNIQUE` no compara                                                | La app también rechaza nombres repetidos sin temporada (decisión pendiente señalada en el script de checks).                                                                                                                                                              |
| D5  | HU-044.3: estados PENDIENTE/PARCIAL/PAGADO/VENCIDO                     | `cargos.estado` almacenado                                                                    | El estado se **deriva** (`billing.rules.chargeStatus`: original − descuentos − pagos aplicados) y se sincroniza en cada escritura y lectura de cobranza. VENCIDO depende de la fecha: **resuelto 2026-10-13** con el `EVENT` diario de la migración 002.                  |
| D6  | HU-054.2: «estado pagado se deriva del saldo»                          | `pedidos_uniforme.estado` almacenado                                                          | `UniformService` sincroniza SOLICITADO ↔ PAGADO con el saldo del cargo vinculado (`cargo_id`). La API debe hacerlo dentro de la transacción del pago.                                                                                                                     |
| D7  | HU-054: pedido gratuito                                                | `cargos.monto_original >= 0` y `cargo_id` nullable                                            | Pedido con total 0 → `cargo_id NULL` (se conserva la decisión de la PR #4).                                                                                                                                                                                               |
| D8  | HU-019: cambio de categoría                                            | `jugador_categoria` con una vigente por jugador                                               | Transacción: cierra la vigente (`fecha_fin` = día anterior, `activo = FALSE`), abre la nueva, escribe `historial_categoria` y cierra los planteles de la categoría anterior (HU-036.1).                                                                                   |
| D9  | HU-057: «a todos o a audiencias seleccionadas»                         | `aviso_destinatario` GENERAL/CATEGORIA/TUTOR/ENTRENADOR (con su FK)                           | Sin selección = GENERAL; si no, una fila por categoría, tutor o entrenador elegido. «Todos los tutores» sin entrenadores no es expresable sin enumerarlos.                                                                                                                |
| D10 | HU-031: «solo entrenador asignado o admin» edita la bitácora           | sin columna de autor de la bitácora                                                           | Requiere `asistencias.editar` y alcance de entrenador; la secretaría (sin ese permiso) sólo consulta.                                                                                                                                                                     |
| D11 | HU-045.1: el pago «captura … fecha»                                    | `pagos.fecha_pago DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`: admite un valor explícito     | **Resuelto 2026-10-07:** la fecha y hora del pago se capturan (por omisión, ahora); no puede ser futura; `creado_en` conserva el momento de captura, así un pago registrado con fecha anterior queda trazable. Antes la ponía siempre el servidor y contradecía la HU.    |
| D12 | Roles de oficina (ver abajo)                                           | `rol_permiso` editable                                                                        | Administrador administra el sistema; Secretaría administra la operación de la escuela.                                                                                                                                                                                    |
| D13 | Conectar las 76 HU a MariaDB sin reescribir los servicios              | Esquema completo; ningún servicio lo usaba                                                    | **Resuelto 2026-10-13:** la API ejecuta los mismos servicios de dominio (ver abajo).                                                                                                                                                                                      |
| D14 | HU-037.2 «registra … sede» vs HU-027.4 «sede … cuando esté registrada» | `partidos.sede_id` NULL                                                                       | **Resuelto 2026-10-13:** la sede se registra y valida (si se elige, debe existir y estar activa) y puede quedar «Por definir» hasta conocerse; los datos mínimos son categoría inscrita, rival, fecha, hora y local/visitante. Cierra el pendiente P2 «sede obligatoria». |

### D13 · La API ejecuta los servicios de dominio sobre MariaDB (resuelta 2026-10-13)

El § 8 preveía reescribir en la API las reglas de cada servicio y convertir los servicios del navegador en clientes
HTTP. Los servicios ya contienen y prueban esas reglas (validación, transacciones, auditoría, `AuthorizationService`);
reescribirlas duplicaba ~7 000 líneas y abría divergencias. Decisión mínima y compatible:

- **Servidor:** `POST /api/rpc {service, method, args}` ([`API.md`](../API.md#operaciones-de-dominio)) ejecuta en la
  API el servicio de Angular de la lista blanca
  ([`rpc-methods.ts`](../../src/app/core/api/rpc-methods.ts): sólo métodos que usan las páginas, todos con verificación
  de permiso o alcance), con el `AuthUser` de la cookie. Por solicitud, bajo un candado con nombre por base
  (`GET_LOCK`) y en una transacción: carga las tablas ([`api/tables.ts`](../../api/tables.ts) mapea columna ↔ campo),
  ejecuta, escribe sólo las filas que cambiaron (INSERT/UPDATE/DELETE en orden de FK) y confirma. Cualquier error →
  ROLLBACK. MariaDB aplica además sus PK/FK/UNIQUE/CHECK (HU-073).
- **Navegador:** cada servicio de dominio es un cliente con los mismos métodos (`rpcProviders()`), así que las
  páginas no cambian; la sesión es la de la API (`ApiAuthService`).
- **Pruebas:** las del frontend siguen probando las reglas sobre `MockDb` (el mismo código que corre en el servidor);
  `api/rpc.test.ts` prueba sobre MariaDB real la persistencia, la autorización por HTTP, el rollback, la integridad,
  la concurrencia y que el mapa de columnas reproduce toda la semilla.
- **Rendimiento (HU-075):** las tablas que sólo escribe el puente se guardan en memoria y se releen cuando cambia
  `version_datos` (migración 003; lo incrementan cada escritura y el trabajo diario, así que varias instancias de la API
  quedan consistentes); las que también escriben los endpoints de sesión se leen siempre (`auditoria`, sólo para
  `AuditService`). Después de escribir, la API relee de MariaDB las tablas que tocó (dentro de la transacción), así
  que la copia en memoria es lo que quedó guardado, con valores por omisión y columnas generadas. Con 5 000 jugadores, 20 000 cargos y 10 000 pagos, las consultas habituales tardan 19–67 ms. Un
  cambio manual con SQL sobre esas tablas debe incrementar `version_datos` o reiniciar la API. Límite que queda: un
  candado global para las operaciones (suficiente para una escuela).
- `auditoria` y `tokens_recuperacion` se insertan sin id explícito (también los escriben los endpoints de
  autenticación, que no toman el candado); ninguna otra tabla los referencia.

### D12 · Administrador administra el sistema; Secretaría administra la operación (resuelta 2026-10-07)

Fuentes en conflicto: la **Matriz Roles** del backlog (Secretaría: asistencia sólo consulta, pagos alta/consulta, sin
auditoría; «CRUD usuarios; permisos según política»), **HU-070** (temporadas: rol Administrador), y el **Word de
revisión § 5** (posterior: Administrador y Secretaría con los mismos privilegios _operativos_, roles separados para
trazabilidad) con el **diagrama** («Crear categorías y temporadas» para ambos). Resolución aprobada por el equipo:

- **Secretaría** = toda la operación cotidiana (lo que enumera el Word § 5): jugadores, tutores, entrenadores,
  categorías, **temporadas** (incluida la actual; prevalece el Word/diagrama sobre HU-070), inscripciones, sedes,
  sesiones, competencias, partidos, cobranza (incluido **cancelar cargos sin pagos**), registrar pagos, uniformes,
  avisos y reportes; **consulta** asistencia y descuentos/becas. Las cuentas de tutores y entrenadores las gestiona con
  `tutores.editar`/`entrenadores.editar`, sin `usuarios.*`.
- **Exclusivo del Administrador** (administración del sistema y decisiones o reversiones financieras): `usuarios.*`,
  `roles.*`, `auditoria.consultar`, `pagos.cancelar` (HU-049), `descuentos.crear` (HU-051). La captura de asistencia es
  del entrenador (HU-030); el Administrador la conserva para cualquier sesión.
- Una persona puede ser SECRETARIA **y** ENTRENADORA; los permisos que trae el perfil sólo valen en su alcance
  (sus sesiones y categorías): no obtiene asistencia global, jugadores globales, catálogos de oficina ni permisos
  administrativos adicionales. Lo garantizan `officePermissions` + `grants()` y `requireOffice()`
  ([`AUTHORIZATION.md`](../AUTHORIZATION.md)).
- **Entrenador:** opera sólo dentro de sus categorías y sesiones (asistencia, observaciones, completar la sesión).
- **Tutor:** sólo información propia y de sus hijos; **consulta** uniformes en el portal y no hace pedidos (HU-056 es
  de sólo lectura).
- `USER_STORIES.md` (tabla oficial) no se modifica: esta decisión es posterior y queda documentada aquí.

Resultado: SECRETARIA 42 → 45 permisos (+`temporadas.crear`, +`temporadas.editar`, +`descuentos.consultar`).
`permissions.ts` y `010_permisos_app.sql` generan la misma matriz (106 filas de `rol_permiso`).

## 5. Rendimiento (HU-075)

- Listados con paginación (`shared/page.ts`, `Paginator`): jugadores, cargos, pagos/recibos y auditoría.
- Las vistas compuestas (expediente HU-013, portal HU-061, estado de cuenta) se resuelven en **una** llamada de servicio
  que hace los joins en el servicio (hoy sobre `MockDb`; con la API, en el servidor); la página no consulta por cada fila (sin N+1).
- Índices del esquema que respaldan las búsquedas y filtros: `idx_jugador_nombre`, `idx_jugador_estatus`,
  `idx_jugador_categoria_categoria`, `idx_cargo_jugador`, `idx_cargo_vencimiento`, `idx_cargo_estado`,
  `idx_pago_jugador_fecha`, `idx_sesion_ent_fecha`, `idx_partido_fecha`, `idx_aviso_vigencia`,
  `idx_auditoria_modulo_fecha`.
- **Medición reproducible** (`src/app/performance.spec.ts`, corre con las pruebas): 5 000 jugadores, 20 000 cargos,
  10 000 pagos; cada consulta < 300 ms sin la latencia simulada. Resultado 2026-10-07 (Apple Silicon, Node 26):
  búsqueda 11 ms · integrantes de categoría 4 ms · adeudos 23 ms · cargos (página 1) 61 ms · estado de cuenta 4 ms ·
  tablero 10 ms. La primera medición encontró algoritmos cuadráticos (cargos 3 151 ms, tablero 988 ms, adeudos 1 234 ms);
  se corrigieron indexando pagos por cargo, nombres y contactos principales por jugador.
- **Medido por la API sobre MariaDB (2026-10-13)** con los mismos volúmenes (`api/hu-fase6.test.ts`, `api/perf-data.sql`):
  búsqueda 20 ms · integrantes 22 ms · adeudos 40 ms · cargos 30 ms · estado de cuenta 19 ms · tablero 22 ms ·
  auditoría 67 ms (medianas; objetivo < 300 ms). Sin caché eran ~430 ms (recarga completa por solicitud).

## 6. Respaldo y restauración (HU-076)

Scripts reproducibles en [`db/mariadb/scripts/`](../../db/mariadb/scripts) (conexión por las variables y el archivo de
opciones estándar de `mariadb`; no hay contraseñas en el repositorio):

| Script                                                      | Qué hace                                                                                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `backup.sh <base> [dir]`                                    | `mariadb-dump --single-transaction --routines --triggers --events`, comprimido y verificado con `gzip -t`                                 |
| `restore.sh <archivo.sql.gz> <base_nueva>`                  | Restaura **sólo en una base nueva** (se niega si existe)                                                                                  |
| `verify-backup.sh <original> <restaurada>`                  | Compara filas y `CHECKSUM TABLE` de **todas** las tablas; termina con error si difieren                                                   |
| `test-backup-restore.sh` (`npm run db:mariadb:test-backup`) | Prueba completa en bases temporales propias: esquema + permisos + datos de los checks → respaldo → restauración → verificación → limpieza |

- **Periodicidad sugerida:** respaldo completo diario (fuera de horario), conservando 7 diarios + 4 semanales + 12
  mensuales; respaldo adicional antes de cada migración o despliegue. Guardar una copia fuera del servidor.
- **Prueba de restauración:** mensual, en un ambiente de prueba, con la verificación de sumas.
- **Evidencia (2026-10-07, MariaDB 13.0.2 local):** salida completa de `test-backup-restore.sh` en
  [`evidence/backup-restore-2026-10-07.txt`](evidence/backup-restore-2026-10-07.txt): checks del esquema **42/42**,
  respaldo restaurado y **39/39 tablas idénticas** (filas y checksum). Reproducible en cualquier máquina con MariaDB.

### Migraciones

El esquema base es `docs/escuela_futbol_mariadb.sql`; los cambios posteriores son migraciones idempotentes en
[`db/mariadb/migrations/`](../../db/mariadb/migrations), aplicadas en orden con `npm run db:mariadb:migrate`
(`migrate.sh [base]`). Las pruebas (`test-backup-restore.sh`, `api/*.test.ts`) las aplican después del esquema.

| Migración                 | Qué cambia                                                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `001_token_finalidad.sql` | `tokens_recuperacion.finalidad ENUM('RECUPERACION','INVITACION')` (D3e): la recuperación sólo revoca tokens de recuperación; las invitaciones (HU-004/012/022) duran 24 h (D3c).                                                                  |
| `002_cargos_vencidos.sql` | Procedimiento `marcar_cargos_vencidos()` y `EVENT ev_cargos_vencidos` diario (D5): PENDIENTE/PARCIAL con vencimiento pasado → VENCIDO. Requiere `event_scheduler = ON` en el servidor.                                                            |
| `003_version_datos.sql`   | Tabla `version_datos` (una fila) que invalida la caché de la API (D13, HU-075); `marcar_cargos_vencidos()` la incrementa cuando cambia algo.                                                                                                      |
| `004_pago_referencia.sql` | `pagos.referencia VARCHAR(100) NULL` (HU-045, criterio 5 pendiente de ratificación): referencia del comprobante, obligatoria en la API para transferencia y tarjeta. `NULL` en los pagos anteriores; sin `CHECK`, para no invalidar el historial. |

**Cómo se aplican:** no hay tabla de historial; `migrate.sh` ejecuta siempre la secuencia completa, en orden, y cada
archivo es idempotente (`IF NOT EXISTS`, `INSERT IGNORE`, `DROP PROCEDURE IF EXISTS`). Por eso una base nueva y una
existente terminan igual. 002 y 003 definen el mismo procedimiento: la versión vigente es la de 003, que queda al final.
Probado sobre una base con datos (esquema + 010 + 020 + un token previo), aplicando dos veces: sin pérdida de filas, el
token previo queda `RECUPERACION` (auditoría 2026-10-15).

**Trabajo diario de VENCIDO (002):** `EVENT ev_cargos_vencidos` cada día a las 00:05 de la hora del servidor, que llama
a `marcar_cargos_vencidos()` (PENDIENTE/PARCIAL con vencimiento anterior a hoy → VENCIDO; incrementa `version_datos`).

- Sólo corre con `event_scheduler=ON` (configuración del servidor, `my.cnf`; no se cambia desde la app). Comprobar:
  `SELECT @@event_scheduler;` y `SELECT LAST_EXECUTED FROM information_schema.EVENTS WHERE EVENT_NAME = 'ev_cargos_vencidos';`.
- Con el planificador apagado el evento existe pero no corre: la API sigue recalculando VENCIDO en cada operación de
  cobranza (`BillingService.syncStatuses`), así que las pantallas son correctas; lo que queda atrasado es el valor
  guardado para consultas SQL directas hasta la siguiente operación de cobranza.
- El evento se ejecuta con los permisos de su `DEFINER` (la cuenta que aplicó la migración): esa cuenta debe existir y
  conservar permisos sobre la base, o el evento falla.

## 7. Reglas que la API debe garantizar

Las reglas que el esquema no asegura (suma de aplicaciones = pago, no sobrepagar, importe del pedido = cargo, sincronía
de estados, transiciones, motivos, contactos…) están en [`DOMAIN_RULES.md`](../DOMAIN_RULES.md).

## 8. Conexión con la API (hecha, D13)

1. La API ejecuta los servicios de dominio sobre este esquema (D13): mismas reglas, validación, transacciones y
   alcance por sesión. Las reglas puras de cobranza (`billing.rules.ts`) siguen siendo la especificación.
2. En el navegador, cada servicio es un cliente de `POST /api/rpc` con los mismos modelos (`rpcProviders()`); las
   páginas no cambiaron. `DECIMAL` ↔ centavos, `BOOLEAN` ↔ `boolean`, `DATETIME` con `T` y `TIME` `HH:MM` se convierten
   en el borde (`api/rpc.ts`).
3. Autenticación: login/logout/sesión/contraseñas por HTTP con cookie HttpOnly y argon2id ([`API.md`](../API.md)); el
   hash SHA-256 de `core/auth/password.ts` es sólo del mock de las pruebas.
4. VENCIDO: además del recálculo en cada operación de cobranza, el `EVENT` diario de la migración 002 (D5).
   Sincronía de pedidos (D6): `BillingService.syncStatuses` la hace en la misma transacción del pago.
5. `integrityViolations` sigue verificando las restricciones sobre `MockDb` en las pruebas del frontend; en la API las
   aplica MariaDB.

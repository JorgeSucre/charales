# Charales — Auditoría de alcance ampliado y plan de finalización

- **Fecha:** 2026-10-15
- **Base:** `main` @ `71e7d1d`. Sin cambios desde la auditoría anterior: `git fetch` muestra `main` = `origin/main`.
- **Verificaciones que siguen vigentes:** las corrí hoy sobre una copia limpia de ese mismo commit:
  - build y typecheck;
  - 156/156 Angular y 136/136 API;
  - 13/13 E2E;
  - checks 42/42 y respaldo idéntico (40 tablas);
  - Postman: 37 solicitudes y 42/42 aserciones.
- **Verificaciones nuevas de esta intervención:**
  - una segunda sonda sobre una base temporal `ef_probe2_*`, borrada al terminar;
  - la comparación de los PR #1–#4 contra `02d9e3f`;
  - la lectura de código de las HU agregadas.
- **Sin modificaciones:** no hubo cambios al repositorio, ramas, stashes, worktrees ni PR.

> **Procedencia de este documento.** Es el informe de la auditoría del 2026-10-15, hecha con Claude Code por encargo
> de Jorge Sucre. Se transcribe sin cambios en sus resultados ni en sus decisiones; la primera persona («corrí»,
> «comparé») es la del auditor. Los avisos de esta nota son lo único agregado.
>
> - Es un **plan**: el estado oficial de cada HU sigue en [`TRACEABILITY.md`](TRACEABILITY.md), y la asignación
>   oficial en [`requirements/USER_STORIES.md`](requirements/USER_STORIES.md). La reasignación de las HU de Dani está
>   pendiente de registrarse (tarea T12).
> - Las **sondas** de entradas inválidas (§ 2, § 5, § 7) fueron scripts temporales de la auditoría y **no están en el
>   repositorio**. Aquí se conservan sus resultados; las tareas T1 y T2 los convierten en pruebas de `api/*.test.ts`.
> - Los registros de las corridas de prueba citadas tampoco se versionaron. Para reproducirlas, usa los comandos del
>   § 7 sobre `main` @ `71e7d1d`.
> - «D-1», «D-2», «D-3», «B-1» y «B-2» son identificadores de defectos de la auditoría de cierre previa, del mismo día;
>   el § 5 resume cada uno.

## 1. Alcance: 53 HU

**Criterio:** el rol de la tabla oficial incluye Administrador o Secretaría:

- «Administrador / Secretaría»: 43 HU;
- «Administrador»: 6 HU;
- «Todos»: 4 HU. Incluye a ambos roles.

| #   | HU     | Título corto                               | Resp. anterior | Dependencias oficiales  |
| --- | ------ | ------------------------------------------ | -------------- | ----------------------- |
| 1   | HU-001 | Login administración                       | Joss           | —                       |
| 2   | HU-004 | CRUD usuarios                              | Borrayo        | HU-001                  |
| 3   | HU-005 | Recuperar o cambiar contraseña (Todos)     | Borrayo        | HU-001                  |
| 4   | HU-006 | Permisos por rol                           | Joss           | HU-004                  |
| 5   | HU-007 | Bitácora                                   | Joss           | HU-004                  |
| 6   | HU-008 | Alta jugador                               | Joss           | HU-001                  |
| 7   | HU-009 | Editar jugador                             | Joss           | HU-008                  |
| 8   | HU-010 | Estatus jugador                            | **Dani**       | HU-008                  |
| 9   | HU-011 | Tutores                                    | Borrayo        | HU-008                  |
| 10  | HU-012 | Cuenta de tutor                            | Armando        | HU-003, HU-011          |
| 11  | HU-013 | Expediente                                 | **Dani**       | HU-008, 020, 046, 057   |
| 12  | HU-014 | Búsqueda                                   | **Dani**       | HU-008, 018             |
| 13  | HU-015 | Categorías                                 | Armando        | HU-001                  |
| 14  | HU-016 | Horarios                                   | Joss           | HU-015                  |
| 15  | HU-017 | Inscripción a categoría                    | Joss           | HU-008, 015             |
| 16  | HU-018 | Lista por categoría                        | Borrayo        | HU-017                  |
| 17  | HU-019 | Cambio de categoría                        | **Dani**       | HU-017                  |
| 18  | HU-020 | Inscripción anual                          | Borrayo        | HU-008                  |
| 19  | HU-021 | Cupos                                      | Joss           | HU-015, 017             |
| 20  | HU-022 | Entrenadores                               | Borrayo        | HU-001                  |
| 21  | HU-023 | Entrenador ↔ categoría                     | Armando        | HU-015, 022             |
| 22  | HU-026 | Entrenador ↔ torneo                        | Borrayo        | HU-023, 034             |
| 23  | HU-028 | Programar sesión                           | Joss           | HU-016, 023             |
| 24  | HU-032 | Reporte de asistencia                      | Armando        | HU-030 (rol Entrenador) |
| 25  | HU-034 | Competencias                               | **Dani**       | HU-001                  |
| 26  | HU-035 | Categoría ↔ competencia                    | Armando        | HU-015, 034             |
| 27  | HU-036 | Plantel                                    | Joss           | HU-017, 035             |
| 28  | HU-037 | Partidos                                   | Joss           | HU-035, 036             |
| 29  | HU-040 | Resultados                                 | **Dani**       | HU-037                  |
| 30  | HU-043 | Conceptos de cobro                         | Borrayo        | HU-001                  |
| 31  | HU-044 | Mensualidades                              | Borrayo        | HU-043, 017             |
| 32  | HU-045 | Registrar pago                             | **Dani**       | HU-044                  |
| 33  | HU-046 | Estado de cuenta                           | Armando        | HU-045                  |
| 34  | HU-048 | Comprobante                                | Borrayo        | HU-045                  |
| 35  | HU-049 | Cancelar pago                              | Joss           | HU-045                  |
| 36  | HU-050 | Adeudos                                    | Borrayo        | HU-044, 045             |
| 37  | HU-051 | Descuentos y becas                         | Joss           | HU-044                  |
| 38  | HU-052 | Catálogo de uniformes                      | Borrayo        | HU-001                  |
| 39  | HU-053 | Pedido de uniforme                         | Borrayo        | HU-052                  |
| 40  | HU-054 | Cargo de uniforme                          | Borrayo        | HU-053, 044             |
| 41  | HU-055 | Entrega de uniforme                        | Borrayo        | HU-053                  |
| 42  | HU-057 | Avisos                                     | **Dani**       | HU-001                  |
| 43  | HU-058 | Avisos por categoría                       | Joss           | HU-057                  |
| 44  | HU-065 | Dashboard                                  | Joss           | MVP                     |
| 45  | HU-066 | Reporte de jugadores                       | Armando        | HU-017                  |
| 46  | HU-067 | Reporte de ingresos                        | Borrayo        | HU-045                  |
| 47  | HU-068 | Agenda global                              | Borrayo        | HU-028, 037             |
| 48  | HU-069 | Sedes                                      | Armando        | HU-001                  |
| 49  | HU-070 | Temporadas                                 | Borrayo        | HU-001                  |
| 50  | HU-071 | Responsive (Todos)                         | **Dani**       | MVP                     |
| 51  | HU-072 | Seguridad de contraseñas y accesos (Todos) | Borrayo        | HU-001                  |
| 52  | HU-075 | Rendimiento (Todos)                        | **Dani**       | Modelo y listados       |
| 53  | HU-076 | Respaldos                                  | **Dani**       | Modelo                  |

**Fuera del alcance por rol:**

- **Exclusivas de Padre/Tutor (11):** HU-003, 033, 039, 042, 047, 056, 059, 061, 062, 063 y 064. Son de Armando,
  Borrayo y Dani.
- **Exclusivas de Entrenador (10):** HU-002, 024, 025, 027, 029, 030, 031, 038, 041 y 060. Son de Armando y Joss.
- **De Equipo de desarrollo:** HU-073 (Todos) y HU-074 (Borrayo). HU-073 se toca de todos modos, porque D-1 es un
  defecto de su criterio 4. No se reclama.

> **Pendiente de confirmar con la profesora:** las 4 HU de Dani con rol Padre/Tutor (HU-003, 059, 061, 062) quedan sin
> responsable. Están **completas** según el código y las pruebas (todas pasan hoy). Este plan **no** las incluye; si la
> profesora quiere que las asumas, sólo hace falta reasignarlas en el registro y revisarlas. No requieren trabajo de
> código conocido.

## 2. Matriz de estado por HU y criterio

**Leyenda:**

- **✔** criterio verificado con una prueba automatizada que pasó hoy.
- **◐** implementado, pero con una prueba débil, ausente en MariaDB o con una validación incompleta.
- **✖** defecto reproducido.
- **UI** sólo de interfaz.
- **Cond.** criterio condicional no implementado.
- **dev** funciona en desarrollo; en producción depende de D4c.

**Interfaz:** la E2E abre cada página del menú y de detalle de los roles Administrador y Secretaría a 375, 768 y
1280 px, sin errores, excepciones ni scroll horizontal. Prueba que las pantallas existen y cargan datos de MariaDB.
**No** prueba cada interacción. Interacciones por UI probadas: login, alta de jugador (HU-008), confirmación de
estatus (HU-010), persistencia tras recargar y desactivación de cuenta.

| HU     | C1    | C2  | C3    | C4    | C5  | Estado real              | Observación                                                                                                                                  |
| ------ | ----- | --- | ----- | ----- | --- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| HU-001 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-004 | ✔     | ✔   | ✔     | ✔     |     | Completa (dev)           | Invitación por correo: D4c                                                                                                                   |
| HU-005 | ✔     | ✔   | ✔     | ✔     |     | Completa (dev)           | Recuperación: 503 en producción sin proveedor (D4c)                                                                                          |
| HU-006 | ✔     | ✔*  | ✔     | ✔     |     | Completa                 | *Se aplica en la siguiente solicitud (más estricto; documentado)                                                                             |
| HU-007 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-008 | ◐     | ✔   | ✔     | ✔     |     | **Parcial (validación)** | `create(draft, 'XX')` → **500** (D-1)                                                                                                        |
| HU-009 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-010 | ✔ E2E | ✔   | ◐     | ◐     |     | **Parcial**              | Estatus inválido → 500 en `main` (PR #12 lo corrige). C3 torneos sin prueba. C4 aserción vacía                                               |
| HU-011 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-012 | ✔     | ✔   | ✔ dev | ✔     |     | Completa (dev)           | D4c                                                                                                                                          |
| HU-013 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-014 | ✔     | ✔   | ✔     | UI    |     | Completa                 |                                                                                                                                              |
| HU-015 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-016 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-017 | ✔     | ✔*  | ✔     | ✔     |     | Completa                 | *Sin columna `autorizada_por` (P2 del ROADMAP; queda en el historial y la auditoría)                                                         |
| HU-018 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-019 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-020 | ◐     | ✔   | ✔     | ✔     |     | **Parcial (validación)** | `enroll` no valida `status` (lectura de código) y acepta CANCELADA/FINALIZADA al crear. `setStatus` responde «a undefined»                   |
| HU-021 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-022 | ✔     | ✔   | ✔ dev | ✔     |     | Completa (dev)           | D4c                                                                                                                                          |
| HU-023 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-026 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-028 | ✔     | ✔   | ✔     | ✖     |     | **Parcial**              | `TrainingService.setStatus` inválido → **500**                                                                                               |
| HU-032 | ✔     | ✔   | ✔     | Cond. |     | Completa                 | Depende de HU-030 (Entrenador), completa. Comparte D-1 vía `AttendanceService.record`                                                        |
| HU-034 | ✔     | ✔   | ✔     | ✔     |     | Completa                 | La sonda: tipo y estado inválidos → 400                                                                                                      |
| HU-035 | ✔     | ✔   | ✔     | ✖     |     | **Parcial**              | `setParticipationStatus` inválido → **500**                                                                                                  |
| HU-036 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-037 | ✔     | ✔   | ✔     | ✔     |     | Completa                 | Sede «Por definir» según D14                                                                                                                 |
| HU-040 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-043 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-044 | ✔     | ✔   | ✔*    | ✔     |     | Completa                 | *El trabajo diario requiere `event_scheduler=ON`; la app lo recalcula en cada operación                                                      |
| HU-045 | ✔     | ✔   | ✔     | ✔     |     | Completa                 | La sonda: 6 entradas inválidas → 400                                                                                                         |
| HU-046 | ◐     | ✔   | ✔     | ◐     |     | **Prueba débil**         | Filtro por fechas implementado y sin prueba; un `.every` pasaría con la lista vacía                                                          |
| HU-048 | ✔     | ✔   | ✔     | ✔     |     | Completa                 | Impresión: sólo UI, sin revisión visual                                                                                                      |
| HU-049 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-050 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-051 | ✔     | ✔   | ✔     | ✔     |     | **Parcial (validación)** | `addDiscount` con un tipo inválido → **500**                                                                                                 |
| HU-052 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-053 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-054 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-055 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-057 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-058 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-065 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-066 | ✔     | ✔   | ✔     | Cond. |     | Completa                 |                                                                                                                                              |
| HU-067 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-068 | ✔ E2E | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-069 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-070 | ✔     | ✔   | ✔     | ✔     |     | Completa                 |                                                                                                                                              |
| HU-071 | ✔ E2E | ✔   | ✔ E2E | ✔ E2E |     | Completa (automática)    | Sin revisión visual manual: la extensión de Chrome no se conectó                                                                             |
| HU-072 | ✔     | ✔   | ✔     | ✔     |     | Completa                 | argon2id; SQL con `?` y nombres del mapa estático; sesión validada en cada solicitud; `.env` ignorado y sin versionar                        |
| HU-075 | ◐     | ✔*  | ✔     | ✔     |     | Completa (con nota)      | C1: paginan jugadores, pagos y bitácora; tutores, entrenadores, partidos y avisos no. *Los índices existen, pero el puente filtra en memoria |
| HU-076 | ✔     | ✔   | ✔     | ✔     |     | Completa                 | Repetido hoy                                                                                                                                 |

**Totales:**

- **Completas: 46.** Incluye 4 completas sólo en desarrollo por D4c (HU-004, 005, 012, 022) y 2 con nota (HU-071,
  HU-075).
- **Parciales: 7.** Seis por validación de entrada (HU-008, 010, 020, 028, 035, 051), que se resuelven con T1 y T2.
  Una sólo por pruebas insuficientes (HU-046); HU-010 también tiene pruebas débiles, además del defecto de
  validación.
- **Pendientes de implementar: 0.**
- **No verificables hoy:** ninguna de forma completa. Lo que falta es revisión visual manual (HU-048 impresión, HU-071)
  y producción (D4c).

## 3. Pendientes heredados de Dani

**En el alcance (11):** HU-010, 013, 014, 019, 034, 040, 045, 057, 071, 075 y 076.

| HU                                        | Pendiente concreto                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HU-010                                    | Fusionar el PR #12. Prueba de que un jugador en baja no entra a un plantel (C3). Sustituir la aserción vacía de C4 por una que compruebe que los pagos y partidos se conservan |
| HU-071                                    | Revisión visual manual a 375/768/1280 px (sólo se hizo la automática)                                                                                                          |
| HU-075                                    | Decidir si C1 exige paginar también tutores, entrenadores, partidos y avisos, o documentar qué cuenta como «listado común»                                                     |
| HU-013, 014, 019, 034, 040, 045, 057, 076 | Ninguno funcional. Sólo cambiar el responsable en la trazabilidad (tras la decisión de la profesora)                                                                           |

**Fuera del alcance (4, rol Padre/Tutor):** HU-003, 059, 061 y 062. Están completas y quedan sin responsable; lo decide
la profesora (§ 1).

## 4. Dependencias y bloqueos

- **Ninguna HU del alcance está bloqueada por otra incompleta.** Todas las dependencias oficiales están completas,
  incluidas las de otros roles: HU-003, HU-030 y HU-047.
- **Impacto de D-1 entre historias:** el defecto toca servicios compartidos:
  - `PlayerService`: HU-008/010, y por extensión HU-013, HU-014 e HU-017;
  - `TrainingService`: HU-028/068;
  - `CompetitionService`: HU-035/036/037;
  - `BillingService`: HU-051/046/050;
  - `EnrollmentService`: HU-020;
  - `AttendanceService`: HU-032, que también es de Entrenador.

  Por eso se corrige una sola vez, en el puente.

**Bloqueos reales externos:**

| Bloqueo                                                         | HU afectadas                        | Quién decide                                                       |
| --------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| D4c: proveedor de correo                                        | HU-004, 005, 012, 022 en producción | Equipo / profesora                                                 |
| Despliegue (no existe)                                          | Todas en producción                 | Equipo / profesora; fuera del alcance actual según PROJECT_CONTEXT |
| Reasignación oficial de las HU de Dani en el backlog (el Excel) | Registro de responsables            | Profesora                                                          |

## 5. Hallazgos de infraestructura que afectan varias HU (revaluados contra `main` actual)

| ID                                             | ¿Sigue vigente?                             | Estado actual                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-1**                                        | **Sí, y es más amplio**                     | 7 operaciones dan 500 ante un valor enumerado inválido (detalle abajo). La API sigue sin fijar `sql_mode` y el puente no mapea 1265, 1048 ni 1366 |
| **D-2**                                        | Sí                                          | 35 de 78 rechazos 400 sin mensaje; `TypeError` → 400 sigue enmascarando fallos                                                                    |
| **D-3**                                        | Sí                                          | Ningún documento cambió (`main` igual)                                                                                                            |
| PR #12                                         | Abierto, `MERGEABLE`, sin revisiones ni CI  | En su rama: 137/137 API, 156/156 Angular, prettier OK. Sólo corrige `changeStatus`                                                                |
| PR #1–#4                                       | Abiertos; #4 `CONFLICTING`, #1–#3 `UNKNOWN` | Los archivos que toca cada rama son **idénticos** a `02d9e3f`, que está en `main`. Ya están integrados; es seguro cerrarlos con un comentario     |
| Worktrees `charales-wt/hu-0xx-*` y `stash@{0}` | —                                           | Los 4 worktrees apuntan a las ramas de esos PR. No se tocan; borrarlos es decisión de su dueño                                                    |
| D4c / despliegue                               | Sí                                          | Sin cambios                                                                                                                                       |
| B-1 (conteos de `db:setup`)                    | Sí                                          |                                                                                                                                                   |
| B-2 (alcance después de buscar la fila)        | Sí                                          | En `AttendanceService.record` y `TrainingService.get/saveNotes`                                                                                   |

**D-1, operaciones afectadas:**

- Cinco verificadas con la sonda: `PlayerService.changeStatus`, `PlayerService.create(…, status)`,
  `TrainingService.setStatus`, `CompetitionService.setParticipationStatus` y `BillingService.addDiscount`.
- Una por la vía del prototipo: `AttendanceService.record`. Valida con `LABELS[x]`, así que `'toString'` pasa.
- Una por lectura de código: `EnrollmentService.enroll`, que no valida `status`.
- Los datos quedan íntegros sólo porque el servidor local es estricto.

## 6. Plan de implementación priorizado

Una rama nueva desde `main`. Propuesta: `jorgesucre/cierre-admin-secretaria`, **a crear sólo con tu autorización**.
Los cambios se reparten en PR pequeños, en este orden.

### Bloque 1 — Infraestructura (tuyo)

**T1. D-1, raíz en el puente.** Esfuerzo: **S**.

- **Archivos:** `api/server.ts` (`createPool`), `api/rpc.ts` (`INTEGRITY`, errno 1265/1048/1366) y `api/rpc.test.ts`.
- **Cambio:**
  - `initSql` que fije `STRICT_TRANS_TABLES`. Ojo: `test-db.ts` ya usa `initSql` para el reloj, así que hay que
    combinarlos.
  - Mapear esos errno a 409 con el mensaje de integridad.
- **Prueba:** una sesión con `sql_mode=''` que intente un ENUM inválido debe recibir 409 sin escribir nada. Además, las
  7 operaciones con un valor inválido deben responder 4xx.
- **Terminado cuando:** la sonda de las 7 operaciones da 0 respuestas 500 y `api:test` está en verde.

**T2. Validación explícita de enumerados.** Esfuerzo: **S**.

- **HU:** 008, 010, 020, 028, 035, 051 y 032/030.
- **Archivos:**
  - `src/app/shared/validate.ts`: un helper `oneOf(value, LABELS, 'El estatus')` con `Object.hasOwn`, el mismo patrón
    del PR #12;
  - los 7 métodos de D-1;
  - los dos que hoy usan `LABELS[x]` (`CompetitionService.save` y `AttendanceService.record`).
- **Por qué además de T1:** T1 garantiza la integridad; T2 da un 400 con un mensaje útil y cierra la vía del prototipo.
  Reutiliza los mapas `*_LABELS` existentes y no duplica reglas.
- **Pruebas:** en `api/hu-fase2..4.test.ts`, un caso inválido por operación, con el mensaje comprobado.
- **Depende de:** fusionar antes el PR #12, para no chocar en `player.service.ts`.
- **Terminado cuando:** las 9 operaciones responden 400 con un mensaje en español; Angular y API en verde.

**T3. D-2, endurecer el arnés.** Esfuerzo: **S** el arnés, **M** si hay que ajustar mensajes.

- **Archivos:** `api/test-db.ts#refused` y las 35 llamadas.
- **Cambio:** `refused()` falla si el error es el genérico «Datos de la solicitud inválidos.» y la prueba no lo pidió.
  Luego, revisar las 35 llamadas sin mensaje; basta con que ninguna caiga en el genérico, sin reescribirlas todas.
- **Terminado cuando:** `api:test` está en verde con el arnés estricto.

**T4. B-1, conteos de `db:setup`.** Esfuerzo: **XS**.

- **Archivos:** `api/setup.ts` y `api/setup.test.ts`.
- **Terminado cuando:** después de `--demo` o `--dev-seed` imprime los conteos reales y no sugiere `db:admin`.

### Bloque 2 — HU parciales (ahora tuyas)

**T5. HU-010.** Esfuerzo: **S**.

- Fusionar el PR #12 tras revisarlo.
- Agregar pruebas para:
  - C3: `addToRoster` con un jugador en BAJA → 400 «Sólo jugadores activos…»;
  - C4: después de la baja, los conteos de `pagos`, `cargos` y `partidos` del jugador no cambian.
- Reemplazar `count >= 0`.

**T6. HU-020.** Esfuerzo: **XS**.

- `enroll` acepta sólo PENDIENTE/ACTIVA (el tipo ya lo dice: `'PENDIENTE' | 'ACTIVA'`).
- Arreglar el mensaje «a undefined» de `setStatus`.
- Se cubre en T2 con su prueba.

**T7. HU-028, 035 y 051.** Quedan resueltas por T1 y T2. Sin trabajo adicional.

### Bloque 3 — Pruebas insuficientes

**T8. HU-046.** Esfuerzo: **XS**.

- Pruebas del filtro `from`/`to` en MariaDB.
- Comprobar que la lista filtrada no está vacía antes del `.every`.
- Comprobar el saldo (C2) contra un valor esperado.

**T9. B-2 (alcance antes que existencia).** Esfuerzo: **XS**.

- En `AttendanceService.record` y `TrainingService.get/saveNotes`, un id ajeno o inexistente responde igual (403).
- Afecta a HU-028/032 y a las de Entrenador; el servicio es compartido. Acordarlo con Joss o hacerlo tú, porque ahora
  la HU-028 es tuya.

**T10. HU-075 C1.** Esfuerzo: **XS** si se documenta, **M** si se paginan más listados.

- Decidir el criterio.
- Recomendación: documentar que los listados de alto volumen (jugadores, pagos, bitácora) paginan y que el resto es de
  catálogo, y medirlo con la prueba de 300 ms existente.

**T11. Revisión visual manual (HU-071, HU-048).** Esfuerzo: **S**.

- Con la extensión de Chrome conectada, sobre una base temporal `ef_*` con `--demo`, revisar los menús de
  Administrador y Secretaría a 3 anchos y la vista de impresión del comprobante.
- Si la extensión no se conecta, se reporta así.

### Bloque 4 — Documentación y trazabilidad (tuyo)

**T12. D-3 y reasignación.** Esfuerzo: **S**.

- **`PROJECT_CONTEXT.md`:** quitar «Sin backend», «`AuthService` mock», «se elimina al conectar la API» y el PR de
  `api-express` como pendiente; actualizar la tabla de responsables con la decisión de la profesora.
- **Encabezados:** cambiar «rama `api-express`» por `main` en ARCHITECTURE, AUTHORIZATION, TESTING, TRACEABILITY y
  ROADMAP.
- **Cifras:** 136 (o las que resulten), 40 tablas.
- **`API.md`:** fila Correo/APP_URL.
- **`SETUP.md`:** nota de `sql_mode`, si T1 no la vuelve innecesaria.
- **`TRACEABILITY.md`:** estado real de las 53 HU y el responsable nuevo de las de Dani.
- **`USER_STORIES.md` no se edita:** es la transcripción del Excel. La reasignación se registra en
  `PROJECT_CONTEXT.md` y `TRACEABILITY.md` como decisión de la profesora, con fecha.

**T13. Cerrar los PR #1–#4.** Esfuerzo: **XS**. Sólo con tu autorización: comentario «integrado en `02d9e3f`», luego
cerrar. No borrar ramas ni worktrees.

### Bloque 5 — Decisiones externas (no implementables por ti sin acuerdo)

- D4c: proveedor de correo. Afecta a HU-004, 005, 012 y 022 en producción.
- Despliegue.
- Reasignación formal en el Excel del backlog.
- Responsable de las HU-003, 059, 061 y 062.
- P2 del ROADMAP: `autorizada_por`, `temporada_id` NOT NULL y N:M sesión–entrenador. No son criterios oficiales
  incumplidos, sino mejoras.

**Orden:** T1 → PR #12 → T2 (+T6) → T5 → T3 → T8 → T9 → T4 → T10 → T11 → T12 → T13.

**Agrupación sugerida en 3 PR:**

- A: T1–T6 y T9 (validación).
- B: T3, T4, T8 y T10 (pruebas).
- C: T12 (documentación).

T11 y T13 no son cambios de código.

## 7. Pruebas necesarias y criterios de cierre

En cada PR y al final, sobre `main` fusionado, en una copia limpia (`npm ci`):

1. `npm run api:typecheck` y `npm run build`.
2. `npx ng test --watch=false`: todo en verde.
3. `npm run api:test`: todo en verde, con las pruebas nuevas de T1, T2, T3, T5, T6, T8 y T9.
4. `npm run db:mariadb:test-backup`: 42/42 checks y respaldo idéntico. Sólo hace falta si cambia el esquema; T1 no lo
   cambia.
5. `npm run e2e`: 13/13 o más.
6. `postman collection lint postman/` y `postman collection run` contra una API sobre `ef_*`.
7. `npx prettier --check .`
8. Sonda de entradas inválidas (las 33 de ambas sondas): **0 respuestas 500, 0 escrituras**. Se puede convertir en
   prueba permanente.
9. Roles: Secretaría → 403 al cancelar un pago y al editar permisos; tutor → 403 en operaciones de oficina. Ya está en
   las pruebas.
10. Revisión criterio por criterio: cada ✔ de la matriz con su prueba citada en TRACEABILITY.
11. Revisión visual (T11), o la constancia de que no fue posible.

Todo sólo sobre bases temporales `ef_*`. Nunca `escuela_futbol`, `db:reset` ni `db:test`.

## 8. Estimación relativa (sin tiempos)

| Tarea               | Esfuerzo                          | Riesgo                                                                            |
| ------------------- | --------------------------------- | --------------------------------------------------------------------------------- |
| T1                  | S                                 | Bajo: un solo punto, pero toca todas las operaciones (por eso, la suite completa) |
| T2                  | S                                 | Bajo                                                                              |
| T3                  | S–M                               | Medio: puede destapar pruebas que pasaban por el motivo equivocado                |
| T4, T6, T8, T9, T13 | XS                                | Bajo                                                                              |
| T5                  | S                                 | Bajo                                                                              |
| T10                 | XS (documentar) / M (paginar más) | Depende de la decisión                                                            |
| T11                 | S                                 | Depende de la extensión de Chrome                                                 |
| T12                 | S                                 | Bajo                                                                              |

**Total relativo:** pequeño. No hay HU por implementar desde cero; el trabajo es endurecer, probar y documentar.

## 9. Definición de «etapa terminada»

1. Las 53 HU del alcance tienen todos sus criterios ✔, o Cond./dev con la decisión registrada, en `TRACEABILITY.md`,
   cada uno con su prueba citada.
2. Ninguna entrada del navegador produce un 500 en `/api/rpc` (sonda en verde) y MariaDB corre en modo estricto,
   impuesto por la API.
3. Toda la suite del § 7 en verde sobre `main` en una copia limpia, con las cifras registradas en `TESTING.md` y una
   evidencia nueva en `docs/database/evidence/`.
4. PR #12 fusionado; PR #1–#4 cerrados con su justificación; ningún PR abierto propio.
5. La documentación describe `main` tal como está y la nueva asignación de responsables.
6. Los pendientes externos (D4c, despliegue, HU de tutor huérfanas) están registrados como decisiones de la
   profesora o del equipo, no como trabajo tuyo pendiente.

## 10. Checklist final de entrega al equipo

- [ ] Rama de trabajo autorizada y PR A, B y C fusionados en orden.
- [ ] PR #12 fusionado; PR #1–#4 cerrados (sin borrar ramas ni worktrees ajenos).
- [ ] Suite completa en verde sobre `main` limpio; evidencia guardada.
- [ ] `TRACEABILITY.md`: 53 HU con estado y responsable actualizados.
- [ ] `PROJECT_CONTEXT.md`: responsables (Dani fuera), estado real y decisiones pendientes.
- [ ] Aviso al equipo:
  - el flujo de una HU nueva: servicio → `rpc-methods.ts` → autorización en la primera línea → `oneOf`/validación →
    prueba en `api/hu-*.test.ts` con el mensaje comprobado;
  - `.env` con `MAIL_CONSOLE=true`;
  - `event_scheduler=ON`;
  - nunca modificar migraciones aplicadas.
- [ ] Lista a la profesora: D4c, despliegue, reasignación en el Excel y las HU-003, 059, 061 y 062.
- [ ] Pendientes P2/P3 del ROADMAP confirmados como «fase siguiente».

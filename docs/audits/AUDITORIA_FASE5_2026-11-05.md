# Auditoría Fase 5 — seguridad, integridad y preparación para producción

| Dato            | Valor                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Fecha           | 2026-11-05                                                                                                                                     |
| Commit auditado | `9e08b111cc4180ebab89d56f5e99510c42f6e2cf` (`origin/main`, merge de la PR #29)                                                                 |
| Entorno         | Worktree separado `charales-wt/verificacion-secuencial` (detached). macOS, Node 26.13.0, MariaDB 13.0.2 local por socket, sin archivos `.env`  |
| Tipo            | Inspección y sondeos. Sin cambios de código, commits, push, merge ni despliegue                                                                |
| Bases usadas    | Sólo bases temporales nuevas `ef_aud5*` y las propias de las suites. En las bases existentes sólo se leyeron metadatos de `information_schema` |
| Archivo nuevo   | Este informe, sin commit                                                                                                                       |
| Dictamen        | **NO APTO PARA PRODUCCIÓN** (§ 12)                                                                                                             |

## 1. Resumen ejecutivo

**Charales no puede ponerse en producción hoy.** El código es sólido en lo que se pudo comprobar, pero faltan piezas sin las que el sistema no funciona de forma segura:

- **No existe un entorno de producción que auditar.** El repositorio no tiene configuración de proxy, TLS, cabeceras ni CI. No se pudo verificar ningún control que dependa de ese entorno.
- **No hay proveedor de correo.** En producción no se pueden crear cuentas de personal, vincular tutores o entrenadores, ni recuperar contraseñas: responden 503.
- **La fuerza bruta distribuida sigue abierta (R-1).** Medido: 150 contraseñas incorrectas contra una cuenta, desde direcciones de un mismo /64, sin un solo 429.
- **Un `TRUSTED_PROXIES` vacío bloquea a toda la escuela.** Medido: tras 50 fallos, incluso una contraseña correcta recibe 429, y la API arranca sin avisar.
- **`main` no tiene protección de rama ni CI.** La PR #30 llevó a `main` una operación sin autorización en la lista blanca RPC; la PR #32 la retiró el mismo día.

**Lo que sí está bien, con evidencia de hoy:**

- La batería completa pasa sobre el SHA auditado: API 264/264, Angular 247/247, E2E 19/19.
- Sin sesión, las 126 operaciones RPC responden 401. Tutor y entrenador no alcanzaron datos ajenos en la muestra probada.
- S-01 y S-02 están integrados y su lógica coincide con su diseño.
- Las migraciones son idempotentes, y una base actualizada queda igual que una nueva.
- **46 de las 49 HU** quedan completas y verificadas a nivel funcional. **HU-004, HU-012 y HU-022 quedan parciales**, por el correo.

**No se confirmó ningún hallazgo CRÍTICO en el código.** Eso no autoriza producción: los controles críticos de § 10 siguen sin poder verificarse.

| Severidad   | Hallazgos |
| ----------- | --------- |
| CRÍTICO     | 0         |
| ALTO        | 5         |
| MEDIO       | 8         |
| BAJO        | 6         |
| INFORMATIVO | 6         |

## 2. Estado del repositorio

Verificado hoy, sin dar por buenos los informes anteriores.

| Elemento                 | Estado                                                                                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `origin/main`            | `9e08b11`                                                                                                                                                                                    |
| `main` local             | `71e7d1d`: **54 commits por detrás** de `origin/main`, sin commits propios                                                                                                                   |
| Checkout original        | `project` en la rama `backup/wip-2026-10-27` (`ceb3036`), limpio. No está en `main`                                                                                                          |
| PR abiertas              | Sólo la #17 (S-03), sin Draft, sin actualizar desde 2026-10-16                                                                                                                               |
| PR fusionadas hoy        | #29 (S-02), #30 y #32 (`PaymentsGatewayService`), #31 (S-01)                                                                                                                                 |
| PR cerradas sin fusionar | #1 a #4, cuyo contenido consta como incorporado en `02d9e3f` (`ROADMAP.md`)                                                                                                                  |
| Ramas                    | 32 locales y 33 referencias remotas                                                                                                                                                          |
| Worktrees                | 32. Con cambios sin commit: `hu-045-referencia` (21), `cierre-borrayo` (2), `auditoria-final`, `fix-s01-hardening-cleanup`, `t9-orden-autorizacion` y `verificacion-post-merge` (1 cada uno) |
| Stashes                  | 2: `WIP antes de actualizar Charales` y `pre-backlog: working tree = borrayo fix PRs #1-#4`                                                                                                  |
| Protección de `main`     | **Ninguna** (`gh api …/branches/main/protection` → `Branch not protected`). Ninguna de las últimas 12 PR fusionadas registra una revisión                                                    |
| CI                       | **No existe.** `.github/` sólo contiene la plantilla de PR                                                                                                                                   |
| Despliegues              | Ninguno registrado en GitHub hoy. No hay configuración de despliegue en el repositorio                                                                                                       |

Las diferencias entre código y documentación están en § 9.

## 3. Matriz de historias de usuario

**Alcance.** El Excel oficial (`Product_Backlog_Escuela_Futbol_Infantil.xlsx`, leído sin modificarlo) y `USER_STORIES.md` coinciden en las 76 HU, en criterios, estado, responsable, prioridad y rol. Jorge Luis Borrayo De Anda tiene 49. Las otras 27 no tienen responsable, están «Pendiente» en el Excel y quedan fuera de esta matriz.

**Criterio de clasificación.** El estado «Terminado» del Excel no se tomó como evidencia.

- **COMPLETA Y VERIFICADA:** el comportamiento pasa por la API sobre MariaDB, con autorización en el servidor; hay pruebas de los criterios que pasaron hoy sobre este SHA, y no depende de una pieza que no existe.
- **PARCIAL:** algún criterio sólo se cumple con una pieza que aún no existe.
- **IMPLEMENTADA, PENDIENTE DE VERIFICACIÓN / PENDIENTE / BLOQUEADA:** ninguna HU quedó en estas clases.

**Límites de esta verificación:**

- Se contrastaron los títulos y las aserciones extraídas de cada prueba con los criterios oficiales. El cuerpo de la prueba, entero o en buena parte, sólo se leyó en HU-012, HU-015, HU-034, HU-035, HU-036, HU-040, HU-053 a HU-055 y HU-066. **No es una lectura línea por línea de las 196 aceptaciones.**
- **No hubo revisión visual manual.** La evidencia de pantalla son las pruebas de componentes y la E2E, que recorre todas las páginas de cada rol a 375, 768 y 1280 px sin revisar cada formulario.
- Los recuentos de la columna de pruebas cuentan sólo títulos que citan la HU. HU-001 tiene además sus pruebas de login en `api/api.test.ts` y `api/login-limit*.test.ts`, que no citan el identificador.

**Resultado:** 46 COMPLETA Y VERIFICADA · 0 IMPLEMENTADA, PENDIENTE DE VERIFICACIÓN · 3 PARCIAL · 0 PENDIENTE · 0 BLOQUEADA.

| ID     | Módulo                 | Historia de usuario (texto original)                                                                                                                   | Prio.  | Excel     | Clasificación             | Pruebas (API / pantalla / E2E) | Observación                                                                                                                                  |
| ------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | --------- | ------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| HU-001 | Autenticación          | Como administrador o secretaria quiero iniciar sesión con correo/usuario y contraseña para acceder al sistema según mi rol.                            | Must   | Terminado | **COMPLETA Y VERIFICADA** | 0 / 2 / 0                      | Criterios cumplidos. La fuerza bruta distribuida sigue abierta, pero no es un criterio (F5-03).                                              |
| HU-004 | Usuarios               | Como administrador quiero crear, editar, activar o desactivar usuarios para controlar quién entra al sistema.                                          | Must   | Terminado | **PARCIAL**               | 4 / 2 / 1                      | C1: el alta envía invitación. Sin transporte real, en producción responde 503 y hace rollback (F5-02). Verificada sólo con correo de prueba. |
| HU-006 | Autorización           | Como administrador quiero configurar permisos por rol para controlar las acciones disponibles.                                                         | Should | Terminado | **COMPLETA Y VERIFICADA** | 2 / 2 / 0                      | C2 es más estricto de lo pedido: un cambio aplica también a sesiones abiertas (decisión en `API.md`).                                        |
| HU-007 | Auditoría              | Como administrador quiero consultar una bitácora de acciones relevantes para saber quién modificó información sensible.                                | Should | Terminado | **COMPLETA Y VERIFICADA** | 2 / 1 / 0                      |                                                                                                                                              |
| HU-008 | Jugadores              | Como secretaria quiero registrar a un alumno/jugador con sus datos personales para incorporarlo a la escuela.                                          | Must   | Terminado | **COMPLETA Y VERIFICADA** | 3 / 0 / 1                      |                                                                                                                                              |
| HU-009 | Jugadores              | Como secretaria quiero editar los datos de un jugador para mantener su expediente actualizado.                                                         | Must   | Terminado | **COMPLETA Y VERIFICADA** | 1 / 1 / 0                      |                                                                                                                                              |
| HU-010 | Jugadores              | Como secretaria quiero cambiar el estatus de un jugador a activo, baja temporal o baja definitiva para reflejar su situación.                          | Must   | Terminado | **COMPLETA Y VERIFICADA** | 4 / 1 / 1                      |                                                                                                                                              |
| HU-011 | Tutores                | Como secretaria quiero registrar uno o más padres/tutores por jugador para disponer de responsables y contactos.                                       | Must   | Terminado | **COMPLETA Y VERIFICADA** | 3 / 4 / 0                      |                                                                                                                                              |
| HU-012 | Tutores                | Como secretaria quiero vincular una cuenta de acceso a un tutor para habilitar el portal familiar.                                                     | Must   | Terminado | **PARCIAL**               | 1 / 1 / 0                      | C3: el acceso inicial se entrega por correo. No existe transporte real (F5-02). C1, C2 y C4 verificados, con aserciones leídas.              |
| HU-013 | Expediente             | Como secretaria quiero consultar el expediente integral de un jugador para ver sus datos, categoría, pagos, uniformes y participación deportiva.       | Should | Terminado | **COMPLETA Y VERIFICADA** | 2 / 0 / 0                      |                                                                                                                                              |
| HU-014 | Búsqueda               | Como secretaria quiero buscar jugadores por nombre, categoría o estatus para localizarlos rápidamente.                                                 | Should | Terminado | **COMPLETA Y VERIFICADA** | 1 / 3 / 0                      |                                                                                                                                              |
| HU-015 | Categorías             | Como secretaria quiero crear categorías deportivas con nombre y rango de edades para organizar a los jugadores.                                        | Must   | Terminado | **COMPLETA Y VERIFICADA** | 2 / 1 / 0                      |                                                                                                                                              |
| HU-016 | Categorías             | Como secretaria quiero configurar horarios regulares de entrenamiento por categoría para publicar cuándo y dónde entrena cada grupo.                   | Must   | Terminado | **COMPLETA Y VERIFICADA** | 1 / 1 / 0                      |                                                                                                                                              |
| HU-017 | Inscripciones          | Como secretaria quiero inscribir a un jugador en una categoría para que forme parte de su grupo de entrenamiento.                                      | Must   | Terminado | **COMPLETA Y VERIFICADA** | 1 / 1 / 0                      |                                                                                                                                              |
| HU-018 | Grupos                 | Como secretaria quiero consultar la lista de jugadores por categoría para conocer la integración de cada grupo.                                        | Must   | Terminado | **COMPLETA Y VERIFICADA** | 2 / 1 / 0                      |                                                                                                                                              |
| HU-019 | Inscripciones          | Como secretaria quiero cambiar a un jugador de categoría conservando el historial para reflejar su avance deportivo.                                   | Should | Terminado | **COMPLETA Y VERIFICADA** | 1 / 1 / 0                      |                                                                                                                                              |
| HU-020 | Inscripción anual      | Como secretaria quiero registrar la inscripción administrativa del jugador para controlar su alta por ciclo o temporada.                               | Must   | Terminado | **COMPLETA Y VERIFICADA** | 1 / 1 / 0                      |                                                                                                                                              |
| HU-021 | Cupos                  | Como secretaria quiero definir cupo máximo por categoría para controlar la capacidad del grupo.                                                        | Could  | Terminado | **COMPLETA Y VERIFICADA** | 2 / 1 / 0                      | R23 (la baja temporal conserva el cupo) no tiene prueba de regresión. Sondeo propio: ocupación 2 → 2 y lista 2 → 1.                          |
| HU-022 | Entrenadores           | Como secretaria quiero registrar entrenadores con sus datos de contacto para administrar al personal deportivo.                                        | Must   | Terminado | **PARCIAL**               | 3 / 1 / 0                      | C3: vincular la cuenta depende de la invitación (F5-02). C1, C2 y C4 verificados.                                                            |
| HU-023 | Asignación             | Como secretaria quiero asignar uno o más entrenadores a una categoría para indicar quién atiende cada grupo.                                           | Must   | Terminado | **COMPLETA Y VERIFICADA** | 1 / 1 / 0                      |                                                                                                                                              |
| HU-026 | Asignación a torneos   | Como secretaria quiero indicar qué entrenador participa en cada torneo/liga y con qué categoría para tener clara la responsabilidad deportiva.         | Must   | Terminado | **COMPLETA Y VERIFICADA** | 2 / 1 / 0                      |                                                                                                                                              |
| HU-028 | Sesiones               | Como secretaria quiero programar una sesión de entrenamiento para llevar un registro real de cada entrenamiento realizado.                             | Must   | Terminado | **COMPLETA Y VERIFICADA** | 2 / 1 / 0                      | Afectada por la fuga S-03 en `TrainingService`, ajena a sus criterios.                                                                       |
| HU-032 | Asistencia             | Como secretaria quiero consultar asistencia por jugador, categoría y periodo para detectar inasistencias frecuentes.                                   | Should | Terminado | **COMPLETA Y VERIFICADA** | 2 / 1 / 0                      | C4 condicional, diferido por DP-03. Afectada por S-03 en `AttendanceService.record`.                                                         |
| HU-034 | Competencias           | Como secretaria quiero registrar torneos o ligas para controlar las competencias donde participa la escuela.                                           | Must   | Terminado | **COMPLETA Y VERIFICADA** | 2 / 1 / 0                      | C3: la prueba afirma `contacto`; envía `notes`, pero no lo afirma.                                                                           |
| HU-035 | Competencias           | Como secretaria quiero inscribir categorías en un torneo o liga para registrar qué equipos participan.                                                 | Must   | Terminado | **COMPLETA Y VERIFICADA** | 2 / 1 / 0                      |                                                                                                                                              |
| HU-036 | Plantel de competencia | Como secretaria quiero registrar qué jugadores participan en cada torneo/liga para conocer el plantel de cada categoría.                               | Must   | Terminado | **COMPLETA Y VERIFICADA** | 1 / 1 / 0                      |                                                                                                                                              |
| HU-037 | Partidos               | Como secretaria quiero programar partidos de una competencia para publicar fecha, hora, rival y sede.                                                  | Must   | Terminado | **COMPLETA Y VERIFICADA** | 2 / 0 / 0                      |                                                                                                                                              |
| HU-040 | Resultados             | Como secretaria quiero registrar el resultado de un partido para conservar el historial deportivo.                                                     | Should | Terminado | **COMPLETA Y VERIFICADA** | 2 / 1 / 0                      |                                                                                                                                              |
| HU-043 | Conceptos de cobro     | Como secretaria quiero configurar conceptos de cobro como mensualidad, inscripción, uniforme u otros para registrar ingresos de forma consistente.     | Must   | Terminado | **COMPLETA Y VERIFICADA** | 1 / 1 / 0                      |                                                                                                                                              |
| HU-044 | Mensualidades          | Como secretaria quiero generar mensualidades para jugadores activos para conocer lo que cada familia debe pagar.                                       | Must   | Terminado | **COMPLETA Y VERIFICADA** | 2 / 3 / 0                      |                                                                                                                                              |
| HU-045 | Pagos                  | Como secretaria quiero registrar un pago para aplicarlo al cargo correspondiente y actualizar el saldo.                                                | Must   | Terminado | **COMPLETA Y VERIFICADA** | 7 / 7 / 2                      | C5 ratificado por DP-01.                                                                                                                     |
| HU-046 | Estado de cuenta       | Como secretaria quiero consultar el estado de cuenta de un jugador para conocer cargos, pagos, saldos y adeudos.                                       | Must   | Terminado | **COMPLETA Y VERIFICADA** | 2 / 1 / 0                      |                                                                                                                                              |
| HU-048 | Recibos                | Como secretaria quiero consultar o reimprimir un comprobante de pago para entregarlo al padre/tutor.                                                   | Should | Terminado | **COMPLETA Y VERIFICADA** | 2 / 0 / 0                      |                                                                                                                                              |
| HU-049 | Cancelaciones          | Como administrador quiero cancelar un pago registrado por error sin borrarlo para mantener trazabilidad financiera.                                    | Should | Terminado | **COMPLETA Y VERIFICADA** | 2 / 2 / 0                      |                                                                                                                                              |
| HU-050 | Cobranza               | Como secretaria quiero obtener un listado de adeudos para dar seguimiento a mensualidades vencidas.                                                    | Should | Terminado | **COMPLETA Y VERIFICADA** | 2 / 2 / 0                      |                                                                                                                                              |
| HU-051 | Descuentos/Becas       | Como administrador quiero registrar descuentos o becas autorizadas para ajustar el monto a pagar sin perder el importe original.                       | Could  | Terminado | **COMPLETA Y VERIFICADA** | 1 / 2 / 0                      |                                                                                                                                              |
| HU-052 | Catálogo               | Como secretaria quiero registrar productos de uniforme y tallas para controlar lo que ofrece la escuela.                                               | Must   | Terminado | **COMPLETA Y VERIFICADA** | 1 / 0 / 0                      |                                                                                                                                              |
| HU-053 | Pedidos                | Como secretaria quiero registrar una solicitud de uniforme por jugador para conocer qué necesita y su estatus.                                         | Must   | Terminado | **COMPLETA Y VERIFICADA** | 2 / 1 / 0                      |                                                                                                                                              |
| HU-054 | Pagos                  | Como secretaria quiero vincular el cobro del uniforme con el módulo de pagos para evitar registrar información duplicada.                              | Should | Terminado | **COMPLETA Y VERIFICADA** | 2 / 2 / 0                      |                                                                                                                                              |
| HU-055 | Entrega                | Como secretaria quiero registrar la entrega de uniforme para saber qué pedidos ya fueron entregados.                                                   | Should | Terminado | **COMPLETA Y VERIFICADA** | 1 / 1 / 0                      |                                                                                                                                              |
| HU-057 | Avisos                 | Como secretaria quiero publicar avisos generales para comunicar información importante a las familias y entrenadores.                                  | Must   | Terminado | **COMPLETA Y VERIFICADA** | 1 / 1 / 0                      |                                                                                                                                              |
| HU-058 | Avisos                 | Como secretaria quiero dirigir un aviso a una o varias categorías para enviar información específica sin mostrarla a toda la escuela.                  | Should | Terminado | **COMPLETA Y VERIFICADA** | 2 / 1 / 0                      |                                                                                                                                              |
| HU-065 | Dashboard              | Como administrador o secretaria quiero ver un tablero general para conocer jugadores activos, categorías, próximos partidos y adeudos.                 | Should | Terminado | **COMPLETA Y VERIFICADA** | 3 / 1 / 0                      |                                                                                                                                              |
| HU-066 | Reportes               | Como secretaria quiero obtener un reporte de jugadores por categoría para apoyar controles administrativos.                                            | Should | Terminado | **COMPLETA Y VERIFICADA** | 1 / 1 / 0                      | C4 condicional: existe el botón «Imprimir» (`reports.pages.ts:313`), sin prueba propia.                                                      |
| HU-067 | Reportes               | Como secretaria quiero obtener un reporte de ingresos por periodo y concepto para conocer la cobranza registrada.                                      | Should | Terminado | **COMPLETA Y VERIFICADA** | 2 / 2 / 0                      |                                                                                                                                              |
| HU-068 | Reportes               | Como secretaria quiero consultar agenda global de entrenamientos y partidos para evitar conflictos operativos.                                         | Should | Terminado | **COMPLETA Y VERIFICADA** | 1 / 2 / 0                      |                                                                                                                                              |
| HU-069 | Catálogos              | Como secretaria quiero administrar sedes/canchas para reutilizarlas en entrenamientos y partidos.                                                      | Should | Terminado | **COMPLETA Y VERIFICADA** | 2 / 0 / 0                      |                                                                                                                                              |
| HU-070 | Temporadas             | Como administrador quiero configurar temporadas o ciclos deportivos para separar información histórica de la escuela.                                  | Could  | Terminado | **COMPLETA Y VERIFICADA** | 1 / 1 / 0                      |                                                                                                                                              |
| HU-076 | Respaldo               | Como administrador quiero contar con un procedimiento de respaldo y restauración de la base de datos para reducir el riesgo de pérdida de información. | Should | Terminado | **COMPLETA Y VERIFICADA** | `db:mariadb:test-backup`       | Pasó hoy el ciclo respaldo → restauración (43 tablas). La programación real es P-06.                                                         |

## 4. Estado de S-01 a S-04

### S-01 — Límite de intentos del login: integrado, con riesgo residual

| Control                       | Estado      | Evidencia                                                                                                           |
| ----------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| Límite por correo e IP        | Cumple      | 5 por cuenta + IP y 50 por IP en 15 min (`api/login-limit.ts:31`). Sondeo propio: 5×401 y luego 429                 |
| Identidad de la cuenta        | Cumple      | Peso de colación de `usuarios.email`, con pruebas H-1 de variantes                                                  |
| Orden de bloqueos             | Cumple      | Primero la IP y luego la pareja (`login-limit.ts:127-154`). Pruebas `lock order` en `api/login-limit-order.test.ts` |
| Reintentos y deadlocks        | Cumple      | Errores 1213, 1205 y 1020; 6 intentos en 1,5 s con jitter (`:45-50`, `:177-184`). Si no se resuelve, 503            |
| Rollback ante 429             | Cumple      | `AtLimit` revierte la transacción (`:158-159`). Prueba: «a refusal… commits nothing»                                |
| Pool dedicado                 | Cumple      | 2 conexiones y 3 s de espera (`api/server.ts:223-236`)                                                              |
| Timeout de bloqueo            | Cumple      | `LIMITER_LOCK_WAIT_S = 2`, sólo en ese pool, con pruebas                                                            |
| Comportamiento 503            | Cumple      | Falla cerrado (`api/auth.ts:125-130`). Medido en una base sin la migración 005: 503                                 |
| `X-Forwarded-For` falsificado | Cumple      | Sin proxy de confianza se ignora. Sondeo con 7 direcciones falsas: 5×401 y 2×429                                    |
| Fuerza bruta distribuida      | **Abierto** | R-1, medido (F5-03)                                                                                                 |
| IPv6                          | **Abierto** | La clave usa la dirección completa, sin agrupar por /64 (`login-limit.ts:81-82`)                                    |

**Pendientes de la auditoría del 2026-11-03:**

- Agotamiento de reintentos: **cubierto** por una prueba de `login-limit-order.test.ts`.
- Sin una prueba identificable por su título: fallo al devolver una reserva, purga concurrente con una reserva e IPv6.
- La colación tiene una prueba, pero no se comprueba al arrancar.
- R-2 (disponibilidad del login con pool de 2) y R-3 (relojes entre instancias) siguen vigentes.

### S-02 — Semáforo de Argon2id: integrado

| Control                | Estado      | Evidencia                                                                                                                       |
| ---------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Argon2id               | Cumple      | m = 19456 KiB, t = 2, p = 1 (`api/auth.ts:32`)                                                                                  |
| Semáforo por proceso   | Cumple      | En memoria, sin MariaDB (`api/argon2-guard.ts`)                                                                                 |
| Concurrencia           | Cumple      | 3 por defecto, de 1 a 64                                                                                                        |
| Cola y espera          | Cumple      | Máximo 32 en cola y 2000 ms de espera; después, 503 sin ejecutar Argon2id                                                       |
| Rutas protegidas       | Cumple      | Login, cambio de contraseña y confirmación de recuperación usan `ctx.argon2.run`. Comprobado con `grep` de todos los llamadores |
| Liberación de turnos   | Cumple      | En `finally`, idempotente, con prueba de excepción                                                                              |
| Configuración inválida | Cumple      | `ARGON2_MAX_CONCURRENT=0` y `ARGON2_WAIT_MS=abc` → exit 1, verificado arrancando la API real                                    |
| Fuera del semáforo     | Documentado | Hash señuelo al arrancar, `create-admin` y `demo`                                                                               |

**Riesgos al escalar:**

- Con N procesos, el máximo es N × 3 operaciones y unos N × 57 MiB. Hay que dimensionarlo con la memoria real, que aún no se conoce.
- El límite del cambio de contraseña y de la solicitud de recuperación también vive en la memoria de cada proceso.
- Un flood admitido desde muchas IP puede dejar a usuarios legítimos en 503. Es la contrapartida documentada de fallar cerrado.

### S-03 — Fuga de existencia de sesiones (PR #17): abierto, BAJO

**Qué implementa.** Añade `TrainingService.sessionFor` y lo usa en `TrainingService.get`, `TrainingService.saveNotes` y `AttendanceService.record`. También añade `api/authorization-order.test.ts`. No añade dependencias.

**Defecto vigente, medido hoy:**

| Rol        | Operación                                                       | Sesión existente | Sesión inexistente        |
| ---------- | --------------------------------------------------------------- | ---------------- | ------------------------- |
| Tutor      | `TrainingService.get`, `saveNotes` y `AttendanceService.record` | 403              | 400 «Sesión inexistente…» |
| Entrenador | `TrainingService.get`, con una sesión ajena                     | 403              | 400 «Sesión inexistente…» |
| Secretaría | `TrainingService.saveNotes` y `AttendanceService.record`        | 403              | 400 «Sesión inexistente…» |

El barrido sólo encontró esta diferencia 403/400 en estas tres operaciones. Otras operaciones de tutor y entrenador responden 200 con un id propio y 403 con uno inexistente, lo cual no revela nada ajeno.

**Estado de la PR:**

- Base 42 commits por detrás de `main`. `git merge-tree` no muestra conflictos.
- **No se puede fusionar tal cual.** Sobre el árbol combinado, `npm run api:test` da **271/274**. Las 3 pruebas T9 nuevas fallan porque esperan mensajes antiguos, por ejemplo `/^Sesión no iniciada o expirada\.$/`.
- Los fallos son de las pruebas de la PR, no se observaron regresiones en las demás.
- Riesgo de `sessionFor`: conserva el 400 «no encontrado» sólo para quien tiene `entrenamientos.consultar`, lo cual es correcto porque ya puede listar todas las sesiones.
- No se fusionó ni se modificó.

### S-04 — Dependencias: abierto, sin vía explotable identificada en el uso actual

`npm audit --omit=dev` → 2 paquetes altos. `npm audit` completo → 8 (1 bajo, 1 moderado, 6 altos). Todos tienen corrección disponible.

| Paquete                                                                                        | Alcance                                     | Avisos                                   | Impacto en Charales                                                                                                             |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `@angular/router` 22.2.0                                                                       | Producción                                  | GHSA-62vg-58rm-qff7, GHSA-57xq-rjx2-v5xh | **Sin impacto identificado:** ambos son DoS en renderizado del lado del servidor. No hay `@angular/ssr` ni configuración de SSR |
| `zod` 4.6.5                                                                                    | Producción (transitiva de `@angular/forms`) | GHSA-mrhx-c7xc-m3w5                      | **Sin impacto identificado:** 0 apariciones en `dist/project/browser` y en `api/.build/domain.mjs`; el código no lo importa     |
| `@angular/cli`, `@angular/build`, `vite`, `undici`, `@modelcontextprotocol/server`, `fast-uri` | Desarrollo                                  | Varios                                   | Sólo equipos de desarrollo y herramientas. No llegan al build. Riesgo local bajo: servidor de desarrollo y `ng mcp`             |

**Corrección a la auditoría del 2026-11-01:** decía que el DoS del router afectaba al navegador del usuario, pero los avisos actuales lo limitan a SSR.

**Alcance propuesto:** actualizar `@angular/*` a ≥ 22.2.1 y `zod` a ≥ 4.6.6, y después el grupo de desarrollo. Conviene hacerlo antes de producción aunque el riesgo sea bajo: es barato y deja `npm audit` limpio para futuras alertas. **No se actualizó nada.**

### Otros controles

Comprobados con sondeos propios contra la API real sobre una base temporal, además de las pruebas.

| Control                 | Resultado                                                                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protección de endpoints | Sin sesión: 126/126 operaciones RPC → 401. Fuera de la lista blanca (`Object.constructor`, `__proto__`, `AuthService.login`, `PaymentsGatewayService.crearPreferencia`…) → 404                        |
| Autorización vertical   | Con 3 formas de argumentos y además otras 6 formas de borrador, tutor y entrenador sólo reciben 200 en operaciones de su portal, su panel o su alcance. 0 respuestas 500                              |
| Aislamiento horizontal  | Tutor: 200 sólo en sus 2 hijos de 6 jugadores. Entrenador: 200 sólo en su categoría de 3, y sólo en sus 2 sesiones de 4                                                                               |
| Sesiones                | Cookie `HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`, y `Secure` con `NODE_ENV=production` (medido). Reutilizar la cookie tras cerrar sesión → 401. Token de 32 bytes; sólo se guarda su SHA-256 |
| Validación de entradas  | `text/plain` → 400; JSON inválido → 400; 20 KB en el login → 413. Consultas parametrizadas                                                                                                            |
| CORS                    | Sin cabeceras CORS; preflight → 404. Correcto para el despliegue de mismo origen documentado                                                                                                          |
| Errores                 | Mensajes genéricos en 500, con dos excepciones (F5-08 y F5-17)                                                                                                                                        |
| Frontend                | Sin `innerHTML`, `bypassSecurityTrust*`, `eval` ni `insertAdjacentHTML` en `src/app`                                                                                                                  |
| Seguridad de archivos   | **No hay subida ni descarga de archivos.** La API sólo lee sus propios `.sql` al preparar la base. Los respaldos son el único archivo sensible (F5-09)                                                |
| Secretos                | Git sólo versiona `.env.example`. No hay claves ni certificados versionados                                                                                                                           |

**Límite:** el barrido usa formas de argumentos genéricas y una muestra pequeña de datos. Reduce el riesgo, pero no demuestra la ausencia de fallos de autorización en todos los caminos.

## 5. Hallazgos de seguridad y preparación por severidad

«Medido» significa reproducido hoy en este commit. «Por código» significa que se dedujo de la lectura y no se ejecutó.

### CRÍTICO

Ninguno confirmado en el código.

### ALTO

| ID    | Hallazgo                                                                                                                                                                                                                             | Evidencia                                                                                                                                | Acción                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| F5-01 | **No hay entorno de producción auditable.** Faltan proxy, TLS, CSP, HSTS, `frame-ancestors`, gestión de procesos y de secretos, y un procedimiento de despliegue. La API no envía esas cabeceras                                     | Por código: `api/server.ts:122-123` sólo envía `Cache-Control` y `X-Content-Type-Options`. Sin archivos de despliegue en el repositorio  | Definir y versionar el despliegue; auditarlo después                                                                      |
| F5-02 | **Sin transporte de correo.** En producción no hay altas de personal, vinculación de tutores o entrenadores, ni recuperación                                                                                                         | Medido: `POST /auth/password-reset/request` con `NODE_ENV=production` → 503. Prueba: alta sin transporte → 503 con rollback              | Implementar Resend (DP-04) y hacer una prueba real                                                                        |
| F5-03 | **Fuerza bruta distribuida e IPv6 (R-1).** Cada dirección tiene su propio límite. El tope real son los 3 turnos de Argon2id. Con la política de contraseñas actual (F5-16), el riesgo es mayor                                       | Medido: 150 intentos contra `tutor@example.com` desde 30 direcciones de un /64 → 150×401, 0×429                                          | Agrupar IPv6 por /64, añadir un control por cuenta que no bloquee al dueño (espera o aviso) y limitar también en el proxy |
| F5-04 | **`TRUSTED_PROXIES` vacío detrás de un proxy bloquea el login de todos.** Todos los clientes comparten la IP del proxy, y un atacante sin cuenta agota los 50 intentos. La API arranca sin avisar                                    | Medido: 60 logins fallidos de clientes y cuentas distintos → 50×401 y 10×429. Después, un usuario legítimo con contraseña correcta → 429 | Verificarlo en el despliegue, y añadir un aviso o bloqueo al arrancar en producción                                       |
| F5-05 | **Sin barrera automática antes de `main`:** sin CI, sin protección de rama y sin revisiones registradas. La batería es manual. La PR #30 añadió a la lista blanca una operación sin autorización, en contra de la regla del proyecto | Medido: `Branch not protected`. Diff de #30 y su corrección en #32, ambas de hoy. Sin impacto real: no hay despliegue                    | CI con la batería, rama protegida y revisión obligatoria                                                                  |

### MEDIO

| ID    | Hallazgo                                                                                                                                                                                                   | Evidencia                                                                                                                                 | Acción                                                                                        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| F5-06 | **Bases existentes sin migrar (P-01).** Falla cerrado: el login queda inservible hasta migrar                                                                                                              | Medido en una base con 001–003: login → 503. Por metadatos: `escuela_futbol` y `escuela_futbol_demo` locales no tienen 004, 005 ni 006    | Ejecutar `db:setup` en cada base con autorización y respaldo previo                           |
| F5-07 | **Memoria sin límite en `POST /auth/password-reset/request`.** Es público, se limita por IP + correo, y las claves de `failures` nunca se borran (`api/auth.ts:86-93`). Sólo aplica con correo configurado | Medido: 40 000 correos distintos en 3,6 s → 40 000×204, 0×429; RSS +30 MB. Extrapolando, unos 0,75 KB por solicitud, sin liberarse        | Añadir un límite por IP, purgar la estructura y usar `limite_acceso` o el proxy               |
| F5-08 | **Un fallo de correo tras el COMMIT devuelve el error interno y deja la cuenta creada** (`api/rpc.ts:95`). Hoy no se alcanza en producción: sólo existe la consola, pero afectará a Resend                 | Medido con un transporte que falla: 400 con el texto literal del error, incluido el valor de prueba `re_SENTINEL`; cuenta y token creados | Capturar el error, responder sin detalle y permitir reenviar la invitación                    |
| F5-09 | **Respaldos sin protección (P-06).** `backup.sh` escribe por defecto en `backups/`, que **no está en `.gitignore`**. Contienen datos de menores sin cifrar. No hay programación, rotación ni copia externa | Medido: `git check-ignore backups` no lo ignora. Por código: `backup.sh` no cifra ni fija permisos                                        | Ignorar la carpeta, cifrar, programar, copiar fuera del servidor y ensayar la restauración    |
| F5-10 | **Candado global en cada operación RPC, también de lectura** (`api/rpc.ts:147`, espera de 10 s). Cualquier usuario autenticado puede encolar a los demás. Es un límite conocido (`ponytail`)               | Por código. Rendimiento medido en HU-075, sin prueba de abuso                                                                             | Limitar por sesión en el proxy o la API; separar lecturas si hace falta                       |
| F5-11 | **Disponibilidad del login (R-2).** Con pool de 2 conexiones, un flood desde muchas IP deja el login en 503, y el resto de la API sigue bien                                                               | Prueba M-1 de `login-limit-instances.test.ts`, que pasó hoy                                                                               | Limitar en el proxy y dimensionar con carga real                                              |
| F5-12 | **Sin validación de la configuración de producción al arrancar.** Sin `NODE_ENV=production` ni `COOKIE_SECURE=true`, la cookie sale sin `Secure` y sin aviso                                               | Medido: sin esas variables, la cookie no lleva `Secure`. Por código: `api/server.ts:246`                                                  | Exigir la configuración mínima al arrancar con `NODE_ENV=production`; revisar el entorno real |
| F5-13 | **La misma cuenta de MariaDB migra y atiende (S-07):** privilegios `CREATE`, `ALTER`, `EVENT`, `TRIGGER` en ejecución. No se encontró inyección SQL                                                        | Por documento: `docs/SETUP.md:57-59`                                                                                                      | Separar la cuenta de migraciones de la de ejecución                                           |

### BAJO

| ID    | Hallazgo                                                                                                                                                                          | Evidencia                                                                       | Acción                                                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| F5-14 | **S-03 / PR #17:** revela qué ids de sesión existen                                                                                                                               | Medido, § 4                                                                     | Actualizar las pruebas de la PR e integrarla                           |
| F5-15 | **S-06:** posible enumeración por tiempos en la solicitud de recuperación, porque una cuenta existente hace una transacción y envía correo. Sigue sin medirse                     | Por código: `api/password.ts:169-210`                                           | Enviar fuera de la respuesta, y medirlo con el transporte real         |
| F5-16 | **Política de contraseñas débil:** 8 caracteres con una letra y un número, sin lista de contraseñas filtradas. Agrava F5-03                                                       | Por código: `api/password.ts:62-68`                                             | Subir la longitud mínima y rechazar contraseñas filtradas              |
| F5-17 | **Mensajes internos al cliente:** en una base sin migrar, RPC responde 400 con el nombre de una columna. La auditoría del 2026-11-01 lo describía como 500                        | Medido: 400 «Columna pagos.referencia no existe: aplica db/mariadb/migrations.» | Responder con un error genérico y dejar el detalle en el log           |
| F5-18 | **Restos de desarrollo:** `GET /api/jugadores` y `/api/categorias` (práctica, `SELECT *`, con permiso), y el texto `demo1234` y correos `@example.com` en el bundle de producción | Medido en `dist/project/browser`. `/admin/api` exige permiso                    | Retirarlos del build de producción o decidir conservarlos por escrito  |
| F5-19 | **Operaciones peligrosas a mano:** `docs/escuela_futbol_mariadb.sql` borra sus tablas si la base existe, y `db:reset` recrea bases del esquema histórico. Está documentado        | Por documento: `docs/API.md` y `CLAUDE.md`                                      | Retirar los scripts históricos y añadir una barrera por nombre de base |

### INFORMATIVO

| ID    | Hallazgo                                                                                                                                                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F5-20 | `@angular/router` y `zod`: alertas altas sin vía explotable identificada en el uso actual (§ 4).                                                                                                                                     |
| F5-21 | `PaymentsGatewayService` no tiene ningún llamador. Su comentario dice que hace pasar pruebas de `hu-fase4`, que no lo usan, y `validarReferencia` (≥ 8 caracteres) contradice R22 (cualquier referencia no vacía). Es código muerto. |
| F5-22 | IPv6: cuatro formas de escribir una misma dirección cuentan por separado (medido: 20 intentos sin 429). Sólo importa si el proxy reenvía la dirección sin normalizar; lo normal es que no ocurra.                                    |
| F5-23 | `limite_acceso.ambito` conserva el valor `'CUENTA'`, que ya no se usa. Es inocuo; se decidió no reescribir la migración 005.                                                                                                         |
| F5-24 | Deuda local: `main` local con 54 commits de retraso, 32 worktrees, 6 de ellos con cambios sin commit, y 2 stashes. No se tocó nada.                                                                                                  |
| F5-25 | No se encontró una política de privacidad o de retención de datos personales en la documentación, y el sistema guarda datos de menores. Requiere una revisión de quien corresponda; esta auditoría no da una opinión legal.          |

## 6. Base de datos y migraciones

### Esquema (base temporal nueva con todas las migraciones)

| Elemento                                  | Valor                                                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Tablas                                    | **43** (39 del esquema base + `version_datos`, `limite_acceso`, `turnos_argon2` y `turnos_argon2_guarda`) |
| Claves foráneas                           | 62                                                                                                        |
| `CHECK`                                   | 41                                                                                                        |
| `UNIQUE`                                  | 32                                                                                                        |
| Índices                                   | 148                                                                                                       |
| FK sin índice que empiece por esa columna | **0**                                                                                                     |
| Checks del esquema                        | 42/42                                                                                                     |

### Migraciones

| Comprobación                    | Resultado                                                                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orden                           | 001 a 006, por nombre de archivo, en `migrate.sh` y en `api/schema.ts`                                                                                         |
| Idempotencia                    | Medido: segunda ejecución con checksums iguales en 6 tablas. Reaplicar 005 y 006 no da error                                                                   |
| Compatibilidad                  | Medido: una base en 003 con datos llega al mismo esquema que una nueva (hash de columnas, rutinas y eventos `e853aa20b947e848` en ambas). Sin pérdida de filas |
| Historial                       | **No hay tabla de historial.** El estado de cada base sólo se conoce inspeccionándola                                                                          |
| Integridad que la base no cubre | Que la suma de aplicaciones no supere el pago ni el saldo. Depende de la aplicación y del candado global (límite conocido)                                     |

### Migración 005 — límite de acceso

- Sin cambios respecto a `36a8034`. No fue alterada por S-02.
- Sólo guarda claves SHA-256, sin correos ni IP. La usa únicamente `api/login-limit.ts`.
- **Su cabecera está desactualizada:** dice «correo en minúsculas», cuando la identidad usa la colación, y la tabla conserva el ámbito `'CUENTA'`, ya sin uso. No se modifica una migración ya publicada; conviene dejar constancia en la documentación.

### Migración 006 — tablas heredadas sin uso

- Las sentencias SQL no cambiaron con la corrección de cabecera (`97951b9`): el SHA-256 del contenido sin comentarios sigue siendo `7a643c7e…`.
- Ningún código consulta ni modifica `turnos_argon2` ni `turnos_argon2_guarda`. La única referencia fuera de la migración es un comentario y la lista de `api/setup.test.ts`.

**Qué se sabe y qué no sobre su estado:**

| Entorno                                                                             | Estado de 006                                                                             |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `escuela_futbol`, `escuela_futbol_demo`, `charales_restore_test_20261029` (locales) | **No aplicada** (verificado hoy por metadatos)                                            |
| `ef_s01lwt_64151`, `ef_s01lwt_64991` (temporales antiguas)                          | **Aplicada**, sin datos de uso                                                            |
| `ef_aud5*` de esta auditoría                                                        | Aplicada, salvo `ef_aud5old_*`, que se quedó en 003 a propósito                           |
| Equipos de otros integrantes                                                        | **Desconocido**                                                                           |
| Cualquier servidor compartido o de pruebas                                          | **Desconocido.** No consta ninguno en el repositorio, y no se puede afirmar que no exista |
| Producción                                                                          | No existe                                                                                 |

Ahora que 006 está en `main`, cualquiera que ejecute `db:setup` o `migrate.sh` creará esas tablas. No debe eliminarse hasta confirmar todos los entornos.

### Discrepancia en `docs/database/MARIADB.md:211` (no modificada)

| Lo que dice                                                              | Lo que se verificó                                                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| «Se conserva sin cambios»                                                | Sólo es cierto para el SQL: los comentarios de la cabecera cambiaron en `97951b9`                                        |
| «En este servidor no está aplicada en ninguna base»                      | Falso desde antes: las temporales `ef_s01lwt_64151` y `ef_s01lwt_64991` la tienen. Es cierto para las bases persistentes |
| «Se publicó en la rama de la PR #29»                                     | Ya está en `main`                                                                                                        |
| «Cuando el equipo confirme… se puede quitar con una migración posterior» | Es compatible con la cabecera, aunque no dice, como ella, que no debe eliminarse hasta confirmar todos los entornos      |

### Respaldo y restauración

- `npm run db:mariadb:test-backup` → OK hoy sobre este SHA: 42/42 checks y 43 tablas idénticas en filas y checksum.
- `restore.sh` se niega a escribir sobre una base existente.
- Limitaciones de operación en F5-09. **No se ha probado sobre datos reales ni en un entorno de producción.**

## 7. Checklist P-01 a P-07

Ningún punto se marca como completado: la configuración de producción no existe y no se pudo inspeccionar. **El responsable es «no consta»** salvo que se indique; el Excel sólo asigna historias.

| ID   | Requisito                                                                       | Evidencia                                                                                                                                                                                      | Estado                                         | Riesgo                                                                                         | Acción necesaria                                                                    | Responsable                                              |
| ---- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------- |
| P-01 | Migrar cada base existente. El texto original dice 001–004; hoy son **001–006** | Bases locales en 003. Medido: login → 503 sin 005. El proceso de actualización está probado en temporal                                                                                        | **PENDIENTE**                                  | Medio: login y operaciones inservibles hasta migrar                                            | Inventariar bases, respaldar y ejecutar `db:setup` con autorización                 | No consta                                                |
| P-02 | Proveedor de correo real                                                        | Decidido Resend (DP-04). Sin implementar: `mailerFromEnv` devuelve `null` en producción (`api/password.ts:44-49`). Medido: 503                                                                 | **PENDIENTE**                                  | Alto: sin altas, vinculaciones ni recuperación                                                 | Transporte, dominio, DNS, clave en el entorno, prueba real y corregir F5-08         | Decisión registrada en DP-04; implementación sin asignar |
| P-03 | TLS, `NODE_ENV` o `COOKIE_SECURE`, cabeceras e IP real del cliente              | Código listo: cookie `Secure` medida y `X-Forwarded-For` probado. Sin configuración de proxy en el repositorio; la API no envía CSP ni HSTS                                                    | **PENDIENTE** (parte externa no inspeccionada) | Alto: F5-01, F5-04 y F5-12                                                                     | Definir el proxy, las cabeceras y `TRUSTED_PROXIES`; verificarlo en el entorno real | No consta                                                |
| P-04 | Corregir S-01, S-02 y S-04                                                      | S-01 y S-02 fusionados y verificados. S-04 abierto (§ 4). R-1 abierto                                                                                                                          | **PARCIAL**                                    | Alto por R-1; bajo por S-04                                                                    | Resolver R-1 y actualizar dependencias                                              | No consta                                                |
| P-05 | `event_scheduler = ON`                                                          | Local: **OFF** (verificado hoy). El `EVENT` existe. La app recalcula VENCIDO en cada operación de cobranza; `db:setup` avisa. Producción sin inspeccionar                                      | **PENDIENTE**                                  | Bajo: consultas SQL directas con estado atrasado                                               | Activarlo en el servidor, comprobar `LAST_EXECUTED` y su `DEFINER`                  | No consta                                                |
| P-06 | Respaldos programados                                                           | Scripts probados hoy. Periodicidad sugerida en `MARIADB.md` § 6. Sin programación, rotación, cifrado ni copia externa                                                                          | **PENDIENTE**                                  | Medio-alto: pérdida de datos y exposición de datos de menores                                  | Programar, cifrar, copiar fuera, ignorar `backups/` y ensayar                       | No consta                                                |
| P-07 | Una sola instancia «mientras el límite viva en memoria»                         | **Redacción obsoleta:** el login ya está en MariaDB. Siguen por proceso el cambio y la solicitud de contraseña, y el semáforo de S-02. La arquitectura admite varias instancias para los datos | **PENDIENTE DE REFORMULAR**                    | Medio: con varias instancias, esos límites se multiplican. Sin verificar en un despliegue real | Reescribir el requisito, decidir el número de instancias y dimensionar la memoria   | No consta                                                |

## 8. Calidad y pruebas

### Ejecutado sobre el SHA auditado

`9e08b11` en este worktree, hoy. La batería se ejecutó en secuencia de 06:16 a 06:20, y no se repitió porque el código no ha cambiado.

| Comando                                   | Resultado                              |
| ----------------------------------------- | -------------------------------------- |
| `npm run api:typecheck`                   | OK                                     |
| `npm run build`                           | OK                                     |
| `npm run api:test`                        | 264/264                                |
| `npx ng test --watch=false`               | 247/247 (20 archivos)                  |
| `npm run e2e`                             | 19/19                                  |
| `npx prettier --check .`                  | OK                                     |
| `git diff --check 36a8034 HEAD`           | OK                                     |
| `npm run db:mariadb:test-backup`          | OK: 42/42 checks, 43 tablas idénticas  |
| `postman collection lint postman/`        | 37 archivos, 0 errores, 0 advertencias |
| `postman collection run …` (API temporal) | 42/42 aserciones                       |
| `npm audit --omit=dev`                    | 2 altas (§ 4)                          |
| `npm audit`                               | 8: 1 baja, 1 moderada, 6 altas (§ 4)   |

Tras escribir este informe se repitió `npx prettier --check .` para incluirlo (resultado en el resumen de cierre). **No se ejecutó** una revisión visual manual, una prueba de carga ni ninguna prueba en un entorno de producción.

### Problemas conocidos, sin corregir

| Problema                          | Estado                                                                                                                                                                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Carrera de foco del menú          | Causa demostrada: `settled` es cierto antes de terminar la redirección. Afecta igual a S-02 y a `main` (7/20 y 6/20 con instrumentación; 1/14 sin ella). Hoy no apareció. La suite puede fallar sin regresión. También afecta a usuarios con sesión lenta |
| Colisión de puertos con Tailscale | `listen(0)` en `::` puede coincidir con un puerto tcp4 ocupado y dar `ETIMEDOUT`. Reproducido 3/3, sin base de datos. Suceso raro, sólo en pruebas                                                                                                        |
| Fallo histórico de persistencia   | **Causa no demostrada.** 1/78 en S-02 y 0/78 en `main`; no se repitió en 142 ejecuciones. No hay trazas de aquel fallo                                                                                                                                    |

**Sin CI, estos fallos intermitentes se resuelven a mano.** Conviene corregirlos antes de activar CI, para que una barrera automática sea fiable.

## 9. Deuda técnica y documentación

No se modificó ningún documento.

| Documento                                                                               | Problema                                                                                 | Valor real hoy                                                                                  |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `PROJECT_CONTEXT.md:47,57,145`, `docs/DEVELOPMENT.md:9,62,68,69`, `docs/TESTING.md:4,6` | Cuentan 241 + 192 + 18 pruebas                                                           | 247 + 264 + 19                                                                                  |
| `docs/TESTING.md:41`                                                                    | E2E con 13 pruebas                                                                       | 19                                                                                              |
| `PROJECT_CONTEXT.md:54,132`, `docs/database/MARIADB.md:59`, `docs/TESTING.md:78`        | «39 tablas» sin aclarar que es sólo el esquema base                                      | 43 con migraciones                                                                              |
| `docs/DEVELOPMENT.md:67`                                                                | 40/40 tablas idénticas                                                                   | 43/43                                                                                           |
| `docs/TRACEABILITY.md:3`                                                                | «Estado verificado al 2026-10-29 sobre `9107042`»                                        | Muy anterior a S-01 y S-02                                                                      |
| `PROJECT_CONTEXT.md:64`                                                                 | Lista como pendiente la decisión de HU-021                                               | Resuelta por DP-02                                                                              |
| `docs/API.md` § Producción                                                              | «Estado (auditoría 2026-10-15)»                                                          | Anterior a varios cambios de seguridad                                                          |
| `docs/audits/AUDITORIA_FINAL_JORGE_LUIS_BORRAYO.md:365` (P-07)                          | Límite de intentos «en memoria»                                                          | Login en MariaDB. El informe es histórico; conviene que el requisito vigente viva en otro lugar |
| `docs/audits/AUDITORIA_FINAL_JORGE_LUIS_BORRAYO.md:244` (S-04)                          | Atribuye al navegador el DoS del router                                                  | Sólo SSR                                                                                        |
| `docs/database/MARIADB.md:211`                                                          | Discrepancia de § 6                                                                      | —                                                                                               |
| `db/mariadb/migrations/005_limite_acceso.sql`                                           | Cabecera con «correo en minúsculas»; ámbito `'CUENTA'`                                   | Colación; ámbito sin uso                                                                        |
| `docs/database/OWNERSHIP.md`, `DATA_CONTRACT.md`                                        | No mencionan `limite_acceso`, `turnos_argon2`, `turnos_argon2_guarda` ni `version_datos` | Cuatro tablas sin dueño documentado                                                             |
| `src/app/core/services/payments-gateway.service.ts`                                     | Comentario falso sobre `hu-fase4`; sin documentar                                        | F5-21                                                                                           |

**Arquitectura mal descrita:** no se encontró una descripción vigente de S-02 como sistema distribuido fuera de los comentarios históricos ya corregidos. `api/argon2-guard.ts`, `docs/API.md` y `docs/ROADMAP.md` lo describen como semáforo local.

**Instrucciones de despliegue incompletas** (`docs/API.md` § Producción):

- Es una lista de requisitos, no un procedimiento paso a paso.
- Falta cómo ejecutar la API en producción: gestor de procesos, reinicios y registros.
- Falta advertir que `api:build` necesita `esbuild`, que es dependencia de desarrollo, para generar `api/.build/domain.mjs`.
- Faltan ejemplos de configuración del proxy y sus cabeceras, y un procedimiento de restauración y de marcha atrás.

**Endpoints:** las 10 rutas de `api/server.ts` están documentadas en `docs/API.md`, y las 126 operaciones de 22 servicios coinciden con `rpc-methods.ts`. No se encontraron endpoints sin documentar.

**Historias, código y pruebas:** cada método de la lista blanca coincide por nombre con una llamada en la aplicación (comprobación automática, sin seguir cada llamada). Sin regresión para R23 (HU-021). `TRACEABILITY.md` marca como completas las 27 HU sin responsable; esta auditoría no las verificó, y siguen «Pendiente» en el Excel.

## 10. Riesgos antes de producción

**Controles críticos que no se pudieron verificar**, porque dependen de un entorno que no existe:

1. TLS y redirección a HTTPS.
2. Variables reales: `NODE_ENV`, `COOKIE_SECURE`, `TRUSTED_PROXIES` y `DB_*`.
3. Cabeceras de seguridad y aislamiento de la API y de MariaDB respecto a Internet.
4. Gestión de secretos y privilegios reales de la cuenta de base de datos.
5. Respaldos reales y restauración en ese entorno.
6. Envío de correo real.
7. Memoria y CPU disponibles para S-02, y comportamiento bajo carga real.

**Riesgos principales si se desplegara hoy:**

| Riesgo                                                 | Hallazgos    | Consecuencia                                             |
| ------------------------------------------------------ | ------------ | -------------------------------------------------------- |
| Adivinar contraseñas a escala                          | F5-03, F5-16 | Acceso a datos de menores y pagos                        |
| Bloqueo total del login por un atacante sin cuenta     | F5-04, F5-11 | La escuela se queda sin acceso                           |
| Personal y familias sin cuenta, y sin recuperar acceso | F5-02        | Funcionalidad principal inservible                       |
| Exposición o pérdida de respaldos                      | F5-09        | Datos de menores expuestos o perdidos                    |
| Un error llega a producción sin barrera                | F5-05, F5-01 | Regresiones sin detectar y despliegues sin procedimiento |

## 11. Plan recomendado de cierre

Cada paso requiere autorización, y cada corrección en su propia PR.

**Fase A — Barreras del proyecto (primero, para proteger todo lo demás)**

1. Corregir las pruebas intermitentes: carrera de foco y `listen(0, '127.0.0.1')`.
2. Activar CI con la batería, proteger `main` y exigir revisión (F5-05).
3. Ignorar `backups/` (F5-09).

**Fase B — Seguridad en el código**

4. Resolver R-1: agrupar IPv6 por /64, control por cuenta sin bloqueo del dueño (F5-03). Reforzar la política de contraseñas (F5-16).
5. Validar la configuración de producción al arrancar, incluido `TRUSTED_PROXIES` (F5-04, F5-12).
6. Acotar la memoria de la solicitud de recuperación (F5-07).
7. Actualizar y volver a probar la PR #17 (S-03).
8. Actualizar dependencias (S-04).
9. Decidir sobre los restos de desarrollo y `PaymentsGatewayService` (F5-18, F5-21). Limpiar los mensajes internos (F5-17).

**Fase C — Correo**

10. Implementar Resend, con la corrección de F5-08, y probar recuperación e invitaciones reales. Esto cierra HU-004, HU-012 y HU-022.

**Fase D — Entorno**

11. Elegir infraestructura y versionar el despliegue: proxy, TLS, cabeceras, procesos, secretos (F5-01).
12. Separar cuentas de base de datos (F5-13), activar `event_scheduler` y programar respaldos cifrados (P-05, P-06).
13. Inventariar el estado de todas las bases, incluida la 006, y migrar (P-01).
14. Reformular P-07 y dimensionar S-02 con la memoria real.

**Fase E — Verificación final**

15. Actualizar la documentación de § 9.
16. Hacer una revisión visual manual, una prueba de carga y un ensayo de restauración.
17. Repetir esta auditoría sobre el entorno real, incluida una revisión de la retención de datos personales (F5-25).

## 12. Dictamen general

**NO APTO PARA PRODUCCIÓN**

**Motivos:**

1. Hay controles críticos sin verificar, porque el entorno de producción no existe (§ 10).
2. Hay cinco hallazgos ALTO abiertos, varios de ellos reproducidos hoy (§ 5).
3. Tres HU `Must` (HU-004, HU-012 y HU-022) no pueden cumplir sus criterios en producción sin correo.

**La auditoría no queda incompleta para lo que se puede inspeccionar hoy:** repositorio, código, pruebas, migraciones y documentación se revisaron con los límites indicados en § 3 y § 4. Cuando exista un entorno, habrá que auditarlo antes de cambiar este dictamen.

**El código y el trabajo de S-01 y S-02 no son el bloqueo principal.** Lo que falta es, sobre todo, el entorno, el correo, R-1 y las barreras del proceso.

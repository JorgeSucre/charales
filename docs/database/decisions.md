# Decisiones de base de datos (fase 3, revisadas en la fase 3.5)

Fuente: modelos de `src/app/core/models`, servicios, `core/auth/permissions.ts`, `docs/PLAN.md` y las historias de
Borrayo. En esta fase el Markdown de historias no estaba en el repo. Hoy la tabla oficial está en
`docs/requirements/USER_STORIES.md`, y los owners vigentes en `OWNERSHIP.md`.

Este documento guarda el **porqué**. Las reglas vigentes están en [`DATA_CONTRACT.md`](DATA_CONTRACT.md).

## Estado tras la fase 3.5

**Congeladas** (contrato del proyecto; cambiarlas requiere acuerdo del equipo y una migración):
PostgreSQL 16, UUID, centavos enteros, `date` vs. `timestamptz` + `business_date()`, Enrollment ≠ PlayerCategory,
Charge/Payment/PaymentApplication con cancelación sin borrado, uniformes con **un cargo por pedido** (cuadre garantizado
por la BD desde la migración 007), `users` + `tutors`/`coaches` **sin** tabla `people`, RBAC con `users.role` y
permisos en código, `tutor_players` con parentesco y tutor principal.

**Pendientes de decisión humana** (marcadas ⚠ abajo): folios con huecos, sesiones vs. JWT, cancelación de cargos,
aprobar los cambios de TS listados en `api-contract.md`, y los owners y conflictos de `OWNERSHIP.md`.

## 1. Clasificación de los modelos del frontend

| Modelo (TS)                                                              | Clase                     | Tabla                                  | Nota                                   |
| ------------------------------------------------------------------------ | ------------------------- | -------------------------------------- | -------------------------------------- |
| `User`                                                                   | entidad principal         | `users`                                | Credenciales e identidad de acceso     |
| `Role`                                                                   | catálogo (fijo en código) | columna `users.role`                   | Ver RBAC                               |
| `Permission`, `ROLE_PERMISSIONS`                                         | catálogo (código)         | —                                      | Sin tabla (ver RBAC)                   |
| `Player`                                                                 | entidad principal         | `players`                              |                                        |
| `Tutor`                                                                  | entidad principal         | `tutors`                               |                                        |
| `Tutor.playerIds`                                                        | relación                  | `tutor_players`                        | Con parentesco y tutor principal       |
| `Coach`                                                                  | entidad principal         | `coaches`                              |                                        |
| `Season`                                                                 | catálogo                  | `seasons`                              |                                        |
| `Category`                                                               | catálogo                  | `categories`                           | Por temporada                          |
| `Enrollment`                                                             | transacción               | `enrollments`                          | Inscripción administrativa anual       |
| `PlayerCategory`                                                         | historial / relación      | `player_categories`                    | `jugador_categoria`                    |
| `Competition`                                                            | catálogo                  | `competitions`                         |                                        |
| `CoachAssignment`                                                        | relación                  | `coach_assignments`                    | Entrenador + competencia + categoría   |
| `Venue`                                                                  | catálogo                  | `venues`                               |                                        |
| `Match`, `TrainingSession`                                               | entidad (agenda)          | `matches`, `training_sessions`         |                                        |
| `ChargeConcept`                                                          | catálogo                  | `charge_concepts`                      |                                        |
| `Charge`                                                                 | transacción               | `charges`                              |                                        |
| `Payment`                                                                | transacción               | `payments`                             | Nunca se borra                         |
| `PaymentApplication`                                                     | relación / transacción    | `payment_applications`                 | Nunca se modifica                      |
| `PaymentDraft`                                                           | UI / entrada de API       | —                                      | No se persiste                         |
| `UniformProduct`, `UniformVariant`                                       | catálogo                  | `uniform_products`, `uniform_variants` |                                        |
| `UniformOrder`                                                           | transacción               | `uniform_orders`                       |                                        |
| `UniformOrderLine`                                                       | transacción               | `uniform_order_lines`                  | Precio histórico + entrega             |
| `UniformOrder.status`, `.chargeId`                                       | dato derivado             | —                                      | Se calculan con consultas              |
| Saldo, adeudo, `OpenCharge`, `DebtView`                                  | dato derivado             | vista `charge_balances`                | Nunca se guarda                        |
| `ReceiptView`, `OrderView`, `EnrollmentView`, `AgendaItem`, `IncomeView` | dato derivado             | consultas                              |                                        |
| Etiquetas (`ROLE_LABELS`, tipos, métodos)                                | sólo UI                   | —                                      |                                        |
| Recuperación de contraseña (HU-005)                                      | transacción               | `password_reset_tokens`                | Sin modelo en TS: vive sólo en backend |

## 2. Motor: PostgreSQL 16

No había decisión previa. Se recomienda PostgreSQL porque ofrece lo que el dominio necesita como restricción real:

- Índices únicos parciales: «una categoría actual por jugador», «una temporada activa», «una inscripción activa por temporada».
- `CHECK` siempre aplicado.
- Triggers diferibles para cuadrar pagos.
- `DATE` y `timestamptz` bien diferenciados.
- `gen_random_uuid()` nativo.

Además está instalado en el equipo de desarrollo y se usa con SQL estándar.

**Alternativas descartadas:**

- MySQL: no tiene índices parciales (hay que simularlos con columnas generadas) y no tiene triggers diferibles.
- SQLite: tipos débiles y un solo escritor.

**Congelada en la fase 3.5.**

## 3. IDs: UUID

`PLAN.md` dejaba el formato de IDs «por acordar». Opciones:

1. `bigint identity`: simple y compacto, pero enumerable (`/players/1`, `/players/2`…), justo lo que el portal debe evitar.
2. **UUID v4** (`gen_random_uuid()`): no enumerable, se puede generar en cualquier capa y viaja como `string`, igual que hoy en Angular.

**Decisión (congelada en la fase 3.5): UUID en todas las tablas.** Todas las PK son `uuid`, excepto las tablas puente, que usan PK
compuesta. Excepción deliberada: `payments.receipt_number` es un `bigint` consecutivo porque el folio lo lee una persona.

- El seed usa UUIDs fijos y legibles (ver `db/seed/dev_seed.sql`).
- Los IDs del `MockDb` (`p1`, `u2`…) no cambian: el mock desaparece al conectar la API.

## 4. Dinero: `integer` en centavos

```text
Frontend  amountCents: number (entero, centavos)
Base      *_cents integer (centavos)        → 1:1, sin conversión
Pantalla  MoneyPipe: cents / 100 → MXN
```

- Sin `float`/`double`.
- `NUMERIC(12,2)` también sería exacto, pero obligaría a convertir en cada capa; los centavos enteros ya son el contrato.
- `integer` alcanza para ±21 millones de pesos por fila. `SUM()` devuelve `bigint`, así que los totales no se desbordan.
- Todos los montos tienen `CHECK` (`> 0` o `>= 0`).

## 5. Fechas y zona horaria

| Tipo             | Uso                                  | Ejemplos                                                                                          |
| ---------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `date`           | Fecha de negocio **local**, sin hora | `birth_date`, `due_date`, `issued_on`, `enrolled_on`, `start_date`, `end_date`                    |
| `timestamptz`    | Instante real                        | `paid_at`, `cancelled_at`, `created_at`, `delivered_at`, `starts_at` de partidos y entrenamientos |
| `text 'YYYY-MM'` | Periodo de mensualidad               | `charges.period` (igual que el frontend)                                                          |

- Zona de negocio: `America/Mexico_City` (sin horario de verano desde 2022; lo resuelve tzdata).
- La función `business_date(timestamptz)` es el **único** lugar con ese nombre de zona. Los valores por defecto de
  fechas de negocio la usan, así que nunca se guarda «el día UTC» (el bug de la fase 2).
- Un `date` nunca se convierte a UTC.
- Formato de API: `date` como `YYYY-MM-DD`; `timestamptz` como ISO 8601 con zona (`2026-09-30T18:05:00-06:00`).
- Los reportes por periodo agrupan con `business_date(paid_at)`.

**Cambio de contrato pendiente:** hoy `Payment.paidAt` en TS es `YYYY-MM-DD`. La API devolverá un instante y la UI
mostrará la fecha. No se modificó el frontend en esta fase.

## 6. RBAC

- `users.role` con `CHECK` sobre los 4 roles de `Role`. Los permisos **siguen en código**: el backend usará la misma
  tabla `ROLE_PERMISSIONS`.
- No hay tablas `roles`/`permissions`: nada en las historias pide editar permisos en tiempo de ejecución.
  Se agregan cuando un administrador necesite configurarlos.
- Vínculo usuario ↔ persona: `tutors.user_id` y `coaches.user_id` (únicos y opcionales). Así puede existir un tutor
  o entrenador sin cuenta.
- Una FK compuesta `(user_id, user_role) → users(id, role)` obliga a que la cuenta vinculada tenga el rol correcto.
  Esto impide ligar una cuenta de secretaría a un tutor y exponer datos del portal.
- El nombre y el correo de tutores y entrenadores se guardan en su propia tabla, aunque se repitan en `users`: no todos
  tienen cuenta. `users` guarda sólo el acceso. **Congelado en la fase 3.5: no habrá tabla `people`.** Sólo evitaría
  repetir nombre y correo, a cambio de más joins en todos los módulos y de reescribir el contrato probado.
- Contraseñas: `password_hash` debe tener formato argon2id o bcrypt (`CHECK`), así un texto plano no se puede guardar
  por error. `NULL` = cuenta invitada sin contraseña. El seed **no** contiene contraseñas.
- Recuperación: `password_reset_tokens` guarda sólo el **hash** del token, con expiración y marca de uso.
- No hay tabla de sesiones: depende de si el backend usa cookie de sesión o JWT. **⚠ Requiere acuerdo** en la fase de backend.

## 7. Tutores ↔ jugadores

`tutor_players(tutor_id, player_id, relationship, is_primary)`:

- `relationship` va en la relación y no en el tutor: la misma persona puede ser madre de uno y tía de otro.
  El frontend lo tiene en `Tutor`; mientras tanto, el backend escribe el mismo parentesco en cada fila.
  **⚠ Requiere acuerdo** para mover el campo en TS.
- `is_primary`: el reporte de adeudos necesita **un** tutor de contacto por jugador. Como máximo uno por jugador
  (índice único parcial).
- No se agregaron «autorización» ni «estado»: ninguna historia los usa.

## 8. Enrollment vs. PlayerCategory

Se mantiene la separación de la fase 2:

- `enrollments(player_id, season_id, status, enrolled_on)`, **sin** `category_id`. Única activa por jugador y temporada.
- `player_categories(player_id, category_id, start_date, end_date)`. Una sola fila abierta (`end_date IS NULL`) por jugador.
- La temporada de la pertenencia sale de `categories.season_id`.
- No se exige, a nivel de BD, que exista inscripción para asignar categoría. Es regla de backend, porque el orden
  real de captura no está definido en las historias.

## 9. Cobranza

- `charges`, `payments` y `payment_applications` están separados. Un pago puede aplicarse a varios cargos y un cargo
  puede recibir varios pagos.
- **Mismo jugador garantizado por FK compuesta:** `payment_applications.player_id` debe coincidir con el del pago y con
  el del cargo.
- **Cuadre**, con trigger diferido que se revisa al hacer `COMMIT`:
  - Un pago vigente debe estar aplicado exactamente por su monto.
  - Un cargo no puede recibir más de su monto sumando pagos vigentes.
- **Trazabilidad:**
  - `payments` no se borra; sólo se cancela una vez, con `cancelled_at`, `cancelled_by` y `cancellation_reason`
    obligatorios juntos.
  - Tampoco se modifican sus montos, jugador, método ni fecha.
  - `payment_applications` es de sólo inserción.
- **Saldo:** vista `charge_balances` = `amount_cents − Σ aplicaciones de pagos no cancelados`. Mismo cálculo que
  `billing.rules.ts`. Estado derivado: `paid`, `partial`, `pending` u `overdue`.
- Recibo: `receipt_number bigint` generado por la BD (`GENERATED ALWAYS`), único. La API lo formatea como `R-0001`.
  Puede haber huecos si una transacción se revierte. **⚠ Requiere acuerdo** si la escuela exige folios sin huecos.
- `charges.season_id` es obligatorio: sin él no se puede responder «mensualidades de una temporada». El frontend no lo
  tiene todavía; el backend lo llena con la temporada activa.
- Mensualidad duplicada imposible: índice único `(player_id, concept_id, period)` cuando `period` no es nulo.
- `charge_concepts` no tiene temporada ni descripción: `kind` ya indica la periodicidad y el cargo guarda la temporada
  y la descripción. No hay cancelación de **cargos**: ninguna historia la pide. **⚠ Requiere acuerdo.**

## 10. Uniformes

- Estructura: `uniform_products` → `uniform_variants` (talla y precio actual) → `uniform_orders` → `uniform_order_lines`.
- **Precio histórico:** `uniform_order_lines.unit_price_cents` se copia al crear la línea y no depende del precio actual.
- **Cargo por pedido**, no por línea: `charges.uniform_order_id` es único. Es lo que hace el código actual (HU-054) y
  el saldo ya permite pagos parciales. Una FK compuesta obliga a que el cargo sea del mismo jugador que el pedido.
- **Entrega por línea:** `delivered_at`, `delivered_by` y `delivered_to` se registran en cada línea, lo que permite
  entregas parciales. El «pedido entregado» del frontend = todas sus líneas entregadas.
- **Congelado en la fase 3.5: un cargo por pedido.** El diagrama del encargo de la fase 3 ponía el cargo en la línea; se
  eligió por pedido para no contradecir el contrato ya probado.
- Desde la migración 007 la BD garantiza, al `COMMIT`, que el cargo = Σ(`quantity × unit_price_cents`). Que exista un
  cargo para todo pedido con total > 0 es regla del backend, porque un pedido de total 0 no puede tener cargo.
- Cobrar por línea sigue siendo posible con una migración aditiva (ver `DATA_CONTRACT.md` § 5).

## 11. Competencias y agenda

- `coach_assignments`, `matches` y `categories` guardan `season_id` para validar con FKs compuestas que la categoría
  y la competencia sean de la **misma temporada**.
- `competitions` agrega `start_date` y `end_date` opcionales (lo pidió el encargo para portal y agenda). No tiene
  columna de estado: se deriva de las fechas.
- La agenda sale de `matches` + `training_sessions`. No hay tabla de agenda ni se duplican competencias.
- **Fase 6 (C2):** migración 008 agrega `competition_categories`, que es la participación explícita (HU-035). La
  participación ya no se deduce de `coach_assignments`, y tanto asignaciones como partidos la exigen por FK.

## 12. Fuera de alcance

Backend, endpoints, JWT, sesiones, correo, archivos, pagos en línea, Docker, CI/CD. Tampoco se modificó el frontend.

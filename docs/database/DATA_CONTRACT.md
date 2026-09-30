# Contrato de datos del equipo (congelado — fase 3.5)

**Léelo antes de tocar datos.** Es el contrato común: si tu módulo necesita algo distinto, se propone un cambio
(ver [«¿Cómo modificar la BD?»](#cómo-modificar-la-bd)). No se inventa por separado.

- Quién escribe qué: [`OWNERSHIP.md`](OWNERSHIP.md).
- Detalle de tablas: [`schema.md`](schema.md).
- Por qué es así: [`decisions.md`](decisions.md).
- Mapeo a Angular: [`api-contract.md`](api-contract.md).

## 1. Convenciones globales (congeladas)

| Tema                    | Regla                                                                                                                                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Motor                   | **PostgreSQL 16**. Migraciones SQL en `db/migrations/NNN_*.sql`                                                                                                                                                                         |
| IDs                     | **UUID** (`uuid DEFAULT gen_random_uuid()`) en todas las tablas; PK compuesta sólo en tablas puente. En TS y en la API es `string`. **Ningún módulo crea otro sistema de IDs** (ni `serial`, ni códigos propios como PK)                |
| Folio de recibo         | `payments.receipt_number` es un `bigint` consecutivo **generado por la BD**. Es para personas, **no es un ID**: nunca se usa en FKs ni en URLs. Se muestra como `R-` + número con al menos 4 dígitos, sin truncar (`R-0001`, `R-12345`) |
| Dinero                  | **`integer` en centavos.** Columnas `*_cents`; en TS `amountCents`, `unitPriceCents`, `priceCents`… (enteros). **Nunca `float`, `double` ni `numeric` con decimales.** Para mostrar: `MoneyPipe` (`cents / 100`). $600.00 = `60000`     |
| Fecha de negocio        | **`date`**: un día del calendario de México, sin hora. API/TS: `'YYYY-MM-DD'`. Nunca se convierte a UTC                                                                                                                                 |
| Instante                | **`timestamptz`**: un momento real. API/TS: ISO 8601 **con zona** (`2026-09-30T19:30:00-06:00`)                                                                                                                                         |
| Zona de negocio         | `America/Mexico_City`. **`business_date(ts)`** convierte un instante en su fecha de negocio. Es el único lugar de la BD con ese nombre de zona. En TS: `today()` de `shared/dates.ts`. **Nunca** `toISOString().slice(0, 10)`           |
| Periodo mensual         | `text 'YYYY-MM'` (`charges.period`)                                                                                                                                                                                                     |
| Nombres                 | Tablas en plural y `snake_case`. FK `<entidad>_id`. `date` termina en `_date`/`_on`; `timestamptz` en `_at`. En API/TS, `camelCase`                                                                                                     |
| Timestamps de auditoría | `created_at timestamptz DEFAULT now()` donde importa quién o cuándo (`users`, `players`, `uniform_orders`). No hay `updated_at` genérico                                                                                                |
| Borrado                 | Catálogos y personas se **desactivan** (`active = false`). En cobranza nada se borra                                                                                                                                                    |

### Qué tipo lleva cada fecha

| Dato                           | Columna                                             | Tipo                                                        |
| ------------------------------ | --------------------------------------------------- | ----------------------------------------------------------- |
| Fecha de nacimiento            | `players.birth_date`                                | `date`                                                      |
| Fecha de inscripción           | `enrollments.enrolled_on`                           | `date`                                                      |
| Inicio / fin de temporada      | `seasons.start_date` / `end_date`                   | `date`                                                      |
| Inicio / fin en categoría      | `player_categories.start_date` / `end_date`         | `date`                                                      |
| Emisión / vencimiento de cargo | `charges.issued_on` / `due_date`                    | `date`                                                      |
| Fecha de pago                  | `payments.paid_at`                                  | `timestamptz`; su día de negocio = `business_date(paid_at)` |
| Fecha de cancelación           | `payments.cancelled_at`                             | `timestamptz`                                               |
| Fecha/hora de entrega          | `uniform_order_lines.delivered_at`                  | `timestamptz`                                               |
| Partido / entrenamiento        | `matches.starts_at` / `training_sessions.starts_at` | `timestamptz`                                               |
| Pedido de uniforme             | `uniform_orders.created_at`                         | `timestamptz`                                               |

## 2. Entidades principales

| Entidad                    | Tabla                                                                           | Propósito                                   | Owner (HU)                                                            |
| -------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------- |
| Usuario                    | `users`                                                                         | Cuenta de acceso y rol                      | Borrayo (HU-004)                                                      |
| Sesión / login             | `AuthService` (tablas futuras de HU-001 y HU-006)                               | Autenticación y permisos                    | Joss (HU-001)                                                         |
| Jugador                    | `players`                                                                       | Persona que entrena                         | Joss (HU-008)                                                         |
| Tutor                      | `tutors` + `tutor_players`                                                      | Padre/tutor y sus hijos                     | Borrayo (HU-011)                                                      |
| Entrenador                 | `coaches`                                                                       | Persona que entrena equipos                 | Borrayo (HU-022)                                                      |
| Temporada                  | `seasons`                                                                       | Ciclo deportivo                             | Borrayo (HU-070)                                                      |
| Categoría                  | `categories`                                                                    | Grupo por edad dentro de una temporada      | Armando (HU-015)                                                      |
| Inscripción administrativa | `enrollments`                                                                   | Registro anual por temporada                | Borrayo (HU-020)                                                      |
| Pertenencia a categoría    | `player_categories`                                                             | Historial jugador ↔ categoría               | Joss (HU-017)                                                         |
| Competencia                | `competitions`                                                                  | Torneo o liga                               | Dani (HU-034)                                                         |
| Participación              | `competition_categories`                                                        | Categoría inscrita en una competencia       | Armando (HU-035)                                                      |
| Asignación                 | `coach_assignments`                                                             | Entrenador responsable de una participación | Borrayo (HU-026)                                                      |
| Sede                       | `venues`                                                                        | Sede o cancha                               | Armando (HU-069)                                                      |
| Partido, sesión            | `matches`, `training_sessions`                                                  | Agenda deportiva                            | Joss (HU-037, HU-028)                                                 |
| Concepto de cobro          | `charge_concepts`                                                               | Catálogo de cobros                          | Borrayo (HU-043)                                                      |
| Cargo                      | `charges`                                                                       | Lo que se debe                              | Borrayo (HU-044)                                                      |
| Pago + aplicación          | `payments`, `payment_applications`                                              | Dinero recibido y a qué se aplicó           | Borrayo (modelo); registro: Dani (HU-045); cancelación: Joss (HU-049) |
| Uniformes                  | `uniform_products`, `uniform_variants`, `uniform_orders`, `uniform_order_lines` | Catálogo, pedidos, entregas                 | Borrayo (HU-052–055)                                                  |

Quién más puede escribir cada tabla, y cómo: [`OWNERSHIP.md`](OWNERSHIP.md).

## 3. Relaciones críticas

```text
User ─0..1── Tutor           tutors.user_id (único, opcional); la cuenta DEBE tener role='tutor'
User ─0..1── Coach           coaches.user_id (único, opcional); la cuenta DEBE tener role='coach'
Tutor >──<  Player           tutor_players (parentesco por par, máx. 1 tutor principal por jugador)
Player >──< Season           enrollments          (inscripción administrativa; 1 activa por temporada)
Player >──< Category         player_categories    (historial; 1 fila abierta = categoría actual)
Season ──<  Category, Competition, Charge
Category >──< Competition   competition_categories (participación; misma temporada)          ← C2
Coach  ──<  CompetitionCategory  coach_assignments (responsabilidad; exige participación)
Player ──<  Charge ──< PaymentApplication >── Payment >── Player   (mismo jugador en los tres)
UniformOrder ──< UniformOrderLine >── UniformVariant >── UniformProduct
UniformOrder ──0..1 Charge   charges.uniform_order_id (único); mismo jugador; monto = Σ líneas
```

### Personas y cuentas (congelado)

- **User** existe si alguien inicia sesión: admin, secretaría, entrenador o tutor con acceso al portal.
- **Tutor** existe si es responsable de al menos un jugador, tenga cuenta o no. Sin cuenta, simplemente no entra al
  portal; sigue apareciendo como contacto y en adeudos.
- **Coach** existe si entrena, tenga cuenta o no. Sin cuenta, igual se le asignan competencias y entrenamientos.
- Una persona con cuenta de tutor tiene `tutors.user_id`. La BD rechaza ligar una cuenta con otro rol y cambiar el rol
  de una cuenta ya ligada. La vinculación la hace HU-012 (Armando) a través de `TutorService`.
- **No hay tabla `people`.** Unificar personas sólo evitaría repetir nombre y correo entre `users` y
  `tutors`/`coaches`, a cambio de más joins en todos los módulos y de reescribir el contrato probado. No compensa en
  este proyecto.

### Enrollment ≠ PlayerCategory (congelado)

```text
Enrollment      = player + season                  "está inscrito administrativamente en 2026-2027"
PlayerCategory  = player + category + [start, end) "juega en Sub-10 desde el 5 de agosto"
```

- `enrollments` **no tiene** `category_id` (hay una prueba que lo verifica).
- La categoría actual es la fila de `player_categories` con `end_date IS NULL`; sólo puede haber una por jugador.
- Cambio de categoría = en una transacción, cerrar la fila abierta (`end_date`) e insertar la nueva. No se borran filas.
- Mensualidades (HU-044) usan `enrollments`. Listas por categoría, portal y agenda usan `player_categories`.
- `player_categories` la crea Joss (HU-017) y la cambia Dani (HU-019) con el mismo contrato (**C3**). Borrayo sólo la
  lee (HU-018, HU-063).

## 4. Cobranza: contrato oficial

```text
            Charge  ◄── PaymentApplication ──►  Payment
     (lo que se debe)     (cuánto de qué pago       (dinero recibido,
                           se usó en qué cargo)      folio, método, quién)
```

- Un **Payment** puede aplicarse a **varios Charges**, y un **Charge** puede recibir **varios Payments**.
- **Saldo** de un cargo = `amount_cents − Σ aplicaciones de pagos NO cancelados`. Es **derivado**: vista
  `charge_balances` en SQL y `billing.rules.ts` en TS. Nunca se guarda.
- Un Payment **cancelado** no cuenta para el saldo. **No se borra**, y sus PaymentApplication **tampoco**: quedan
  como historial.
- Un pago no puede aplicarse al cargo de **otro jugador**, ni quedar aplicado por más o menos de su monto.
- La única forma de registrar pagos desde la app es `BillingService.registerPayment(PaymentDraft)`
  (ver `docs/PLAN.md` › Pagos).

### Qué capa valida qué

| Regla                                            | Angular                              | Backend                     | BD                                |
| ------------------------------------------------ | ------------------------------------ | --------------------------- | --------------------------------- |
| Monto entero > 0                                 | Formulario + `allocatePayment`       | Repetir                     | `CHECK`                           |
| No pagar más que el adeudo                       | `allocatePayment`                    | Repetir                     | Trigger: ningún cargo sobrepagado |
| Pago aplicado exactamente por su monto           | `allocatePayment`                    | Repetir, en una transacción | Trigger diferido al `COMMIT`      |
| Mismo jugador en pago y cargo                    | `registerPayment` filtra `chargeIds` | Repetir                     | FKs compuestas                    |
| Cancelado no cuenta                              | `effectiveApplications`              | Usar la vista               | `charge_balances`                 |
| No borrar ni editar pagos; cancelar una sola vez | Sin UI de borrado                    | No exponer `DELETE`         | Triggers de inmutabilidad         |
| Cancelación con fecha, quién y motivo            | —                                    | `cancelled_by` del token    | `CHECK`                           |
| Folio                                            | Muestra `R-…`                        | Formatea                    | `GENERATED ALWAYS AS IDENTITY`    |
| Mensualidad única por periodo                    | `generateMonthlyCharges`             | Repetir                     | Índice único parcial              |

Angular valida para dar buena experiencia. El backend es la regla de negocio y traduce errores. La BD es la última
línea: rechaza el estado imposible aunque las otras capas fallen.

## 5. Uniformes (congelado)

**Los uniformes generan UN cargo por pedido, no uno por línea.**

```text
UniformOrder ──< UniformOrderLine (quantity, unit_price_cents histórico, entrega por línea)
      └──0..1 Charge (charges.uniform_order_id, mismo jugador)
```

- **Garantizado por la BD** (migración 007, se revisa al `COMMIT`): si un pedido tiene cargo,
  `charge.amount_cents = Σ(quantity × unit_price_cents)` de sus líneas. Cambiar una línea sin ajustar el cargo en la
  misma transacción falla.
- **Garantizado por el backend:** todo pedido con total > 0 tiene su cargo. No puede ir en la BD porque un pedido de
  total 0 no puede tener cargo (`amount_cents > 0`). Además, pedido, líneas y cargo se crean en una sola transacción.
- **Precio histórico:** se copia a `unit_price_cents` al pedir. Cambiar `uniform_variants.price_cents` no afecta
  pedidos existentes.
- **Pedido entregado** = todas sus líneas tienen `delivered_at`. Se permiten entregas parciales.
- **Por qué esto no bloquea cobrar por línea en el futuro:** bastaría una migración aditiva, sin tocar datos
  existentes. Por ejemplo, `charges.uniform_order_line_id`, que obligue a elegir entre ligar el cargo al pedido o a la
  línea, con su propia regla de monto. `payment_applications` y el saldo funcionan igual, porque se basan en
  `charges`. No se implementa ahora.

## 6. Reglas que nadie debe romper

1. **NO** agregar `category_id` a `enrollments`. La categoría vive en `player_categories`.
2. **NO** crear otra tabla ni columna de «categoría actual». Es la fila abierta de `player_categories`.
3. **NO** borrar filas de `player_categories`. Se cierran con `end_date`.
4. **NO** crear otra tabla de pagos, abonos o saldos. Todo es `charges` + `payments` + `payment_applications`.
5. **NO** guardar saldos. Se calculan con `charge_balances`.
6. **NO** borrar ni editar `payments`: se cancelan. **NO** borrar ni editar `payment_applications`.
7. **NO** guardar dinero en `float`, `double` ni `numeric` con decimales. Siempre centavos enteros.
8. **NO** duplicar la relación tutor–jugador (por ejemplo, un `tutor_id` en `players`). Es `tutor_players`.
9. **NO** calcular «hoy» en UTC. En la BD `business_date(now())`; en TS `today()`.
10. **NO** crear otro sistema de IDs ni usar `receipt_number` como ID.
11. **NO** decidir qué hijos ve un tutor con un `playerId` enviado por el navegador. Siempre desde el usuario del token →
    `tutors.user_id` → `tutor_players`.
12. **NO** crear un segundo mecanismo de permisos ni comparar roles sueltos. Hoy la única fuente es
    `core/auth/permissions.ts`. HU-006 (Joss) puede **reemplazarla** por tablas `roles`/`permisos`/`rol_permiso`
    con su migración; nadie más crea permisos (**C5**).
13. **NO** deducir que una categoría juega una competencia a partir de `coach_assignments`: eso lo dice
    `competition_categories` (**C2**).
14. **NO** implementar login o sesión propios en un módulo: todo pasa por `AuthService` (**C5**).
15. **NO** leer el precio actual de la variante para un pedido existente. Se usa `unit_price_cents`.
16. **NO** crear una tabla de reportes o agenda. Son consultas sobre las tablas transaccionales.
17. **NO** editar una migración ya aplicada.

## 7. Contratos de frontera C1–C6 (resueltos con la tabla oficial)

**C1 — Tutor ↔ jugador.** `tutor_players` sólo se escribe con `TutorService` (Borrayo, HU-011): `create(tutor, links)`,
`linkPlayer(tutorId, playerId, relationship, isPrimary)`, `unlinkPlayer`. El alta de jugador (Joss, HU-008) pide ahí
el vínculo si captura tutor. La vinculación de cuenta (Armando, HU-012) y la edición de contacto (Armando, HU-064) son
operaciones de `TutorService`.

**C2 — Competencia ↔ categoría.** Hay dos conceptos distintos:

- `competition_categories` = la categoría **participa** en la competencia. Owner: Armando (HU-035).
- `coach_assignments` = qué entrenador es **responsable** de esa participación (Borrayo, HU-026).

La BD exige participación para asignar entrenador y para programar partidos (HU-037), desde la migración 008. El
portal (HU-063) lee la participación. Cuando exista el plantel (HU-036, Joss), filtrará además por el plantel del hijo.

**C3 — PlayerCategory.** Owner Joss (HU-017): `assign(playerId, categoryId, startDate)`. Dani (HU-019) agrega
`move(playerId, newCategoryId, date, reason)` al mismo contrato: cierra la fila abierta y abre la nueva en una
transacción. Borrayo sólo lee.

**C4 — Pagos.** El dominio Billing (modelo de Borrayo) expone:

- `registerPayment(PaymentDraft)`: lo implementa y usa Dani (HU-045). Es la única vía para crear `payments` y
  `payment_applications`.
- `cancelPayment(paymentId, reason)`: lo implementa Joss (HU-049). Sólo con un permiso de administrador; requiere
  motivo, registra quién cancela en `cancelled_by` y en la auditoría (HU-007). No borra nada y las aplicaciones dejan
  de contar.

Ambas operaciones son transaccionales en el backend. El recibo usa `receipt_number`, independiente del id técnico.

**C5 — Autenticación.** Un solo `AuthService` (Joss, HU-001) es la frontera:

- `login`: devuelve la sesión con usuario y rol.
- `logout`.
- `currentUser()`.
- `can(permission)`.
- Middleware del backend: exige sesión y permiso en cada endpoint.

Además:

- HU-002 (Armando) y HU-003 (Dani) son flujos o pantallas por rol sobre ese servicio, no mecanismos nuevos.
- HU-005 (Borrayo) agrega `requestPasswordReset`, `resetPassword` y `changePassword` al mismo servicio.
- **Decisión:** sesión del lado del servidor con cookie `HttpOnly`, no JWT. El backlog pide la entidad `sesiones`
  (HU-001), expiración según política (HU-002) y validación de sesión en el backend (HU-072). Se implementa en la fase
  de backend; hoy el frontend usa un `AuthService` simulado con la misma interfaz.

**C6 — Inscripción + cargo.** `EnrollmentService.enroll()` (Borrayo, HU-020) coordina en **una** transacción el
`INSERT` en `enrollments` y `BillingService.createCharge(concepto kind='enrollment', seasonId, monto)`. El «monto» de
HU-020 es el del cargo. Dirección única: `EnrollmentService → BillingService`. Billing **lee** `enrollments` para las
mensualidades (HU-044) y nunca llama a `EnrollmentService`.

## ¿Cómo modificar la BD?

1. **Nunca** editar una migración ya aplicada en una BD compartida.
2. Crear `db/migrations/NNN_descripcion.sql` con el siguiente número. Una migración = un cambio coherente.
3. Actualizar la documentación: `schema.md`, `OWNERSHIP.md` si cambia quién escribe, este contrato si cambia una
   regla, y `api-contract.md` si cambia el mapeo.
4. Agregar al menos una prueba en `db/tests/integrity.sql` por cada restricción nueva y, si aplica, una consulta en
   `db/queries/critical.sql`. Si el seed debe cambiar, cambiarlo.
5. Aplicar: `npm run db:migrate` (o `npm run db:reset` en local).
6. Probar: `npm run db:test`.
7. Si cambió un contrato compartido (modelo TS, servicio, API): `npm run build`, `npx ng test --watch=false` y
   `npx prettier --check .`.
8. Si el cambio rompe una regla de la sección 6 o afecta tablas de otro owner, se acuerda **antes** con el equipo.

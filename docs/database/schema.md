# Esquema

Todas las PK son `uuid DEFAULT gen_random_uuid()`, salvo que se indique otra cosa. La fuente de verdad son las
migraciones en `db/migrations/`; este documento las resume.

## Usuarios y acceso — `001`

| Tabla                   | Propósito                           | FK                          | Campos importantes                                                    | Restricciones                                                                                                                               |
| ----------------------- | ----------------------------------- | --------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                 | Identidad de acceso (HU-004)        | —                           | `email`, `full_name`, `role`, `active`, `password_hash`, `created_at` | `email` único y en minúsculas; `role` ∈ admin/secretary/coach/tutor; `password_hash` con formato argon2id/bcrypt o NULL; `UNIQUE(id, role)` |
| `password_reset_tokens` | Recuperación de contraseña (HU-005) | `user_id → users` (cascade) | `token_hash`, `expires_at`, `used_at`                                 | `token_hash` único; expira después de crearse                                                                                               |

Además: función `business_date(timestamptz) → date` (hora de México).

## Personas — `002`

| Tabla           | Propósito             | FK                                         | Campos importantes                                 | Restricciones                                                       |
| --------------- | --------------------- | ------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------- |
| `players`       | Jugador               | —                                          | `full_name`, `birth_date`, `active`                |                                                                     |
| `tutors`        | Padre/tutor (HU-011)  | `(user_id, user_role) → users(id, role)`   | `full_name`, `phone`, `email`, `user_id`           | `user_id` único y opcional; la cuenta ligada debe tener rol `tutor` |
| `tutor_players` | Tutor ↔ jugador (N:M) | `tutor_id → tutors`, `player_id → players` | `relationship`, `is_primary`                       | PK `(tutor_id, player_id)`; como máximo un `is_primary` por jugador |
| `coaches`       | Entrenador (HU-022)   | `(user_id, user_role) → users(id, role)`   | `full_name`, `phone`, `email`, `active`, `user_id` | La cuenta ligada debe tener rol `coach`                             |

## Temporadas, categorías e inscripción — `003`

| Tabla               | Propósito                                    | FK                                                | Campos importantes                         | Restricciones                                                                    |
| ------------------- | -------------------------------------------- | ------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| `seasons`           | Temporada (HU-070)                           | —                                                 | `name`, `start_date`, `end_date`, `active` | `end_date > start_date`; una sola activa                                         |
| `categories`        | Categoría de una temporada                   | `season_id → seasons`                             | `name`, `birth_year_from`, `birth_year_to` | `(season_id, name)` único; rango de años válido; `UNIQUE(id, season_id)`         |
| `enrollments`       | Inscripción administrativa anual (HU-020)    | `player_id → players`, `season_id → seasons`      | `enrolled_on`, `status`, `notes`           | **Sin categoría**; una activa por jugador y temporada                            |
| `player_categories` | `jugador_categoria`: pertenencia e historial | `player_id → players`, `category_id → categories` | `start_date`, `end_date`                   | Una sola fila abierta (`end_date IS NULL`) por jugador; `end_date >= start_date` |

## Competencias y agenda — `004`

| Tabla               | Propósito                                     | FK                                                                                          | Campos importantes                       | Restricciones                                                     |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| `venues`            | Sede                                          | —                                                                                           | `name`, `address`                        | `name` único                                                      |
| `competitions`      | Torneo o liga                                 | `season_id → seasons`                                                                       | `name`, `kind`, `start_date`, `end_date` | `kind` ∈ tournament/league; `(season_id, name)` único             |
| `coach_assignments` | Entrenador + competencia + categoría (HU-026) | `coach_id → coaches`; `(competition_id, season_id)` y `(category_id, season_id)` compuestas | `season_id`                              | Categoría y competencia de la **misma temporada**; sin duplicados |
| `matches`           | Partido                                       | igual que arriba + `venue_id → venues`                                                      | `starts_at`, `opponent`                  | Misma temporada                                                   |
| `training_sessions` | Entrenamiento                                 | `category_id`, `coach_id`, `venue_id`                                                       | `starts_at`, `duration_min`              | Duración entre 1 y 600 minutos                                    |

## Uniformes — `005`

| Tabla                 | Propósito                                  | FK                                                                                   | Campos importantes                                             | Restricciones                                                                          |
| --------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `uniform_products`    | Producto (HU-052)                          | —                                                                                    | `name`, `active`                                               | `name` único                                                                           |
| `uniform_variants`    | Talla y precio **actual**                  | `product_id → uniform_products`                                                      | `size`, `price_cents`, `active`                                | `(product_id, size)` único; precio ≥ 0                                                 |
| `uniform_orders`      | Pedido (HU-053)                            | `player_id → players`, `requested_by → users`                                        | `created_at`                                                   | `UNIQUE(id, player_id)`                                                                |
| `uniform_order_lines` | Línea: precio histórico y entrega (HU-055) | `order_id → uniform_orders`, `variant_id → uniform_variants`, `delivered_by → users` | `quantity`, `unit_price_cents`, `delivered_at`, `delivered_to` | Cantidad > 0; `(order_id, variant_id)` único; los datos de entrega van juntos o no van |

## Cobranza — `006`

| Tabla                  | Propósito                        | FK                                                                                                      | Campos importantes                                                                             | Restricciones                                                                                                           |
| ---------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `charge_concepts`      | Concepto de cobro (HU-043)       | —                                                                                                       | `name`, `kind`, `default_amount_cents`, `active`                                               | `kind` ∈ monthly/enrollment/uniform/other                                                                               |
| `charges`              | Lo que se debe (HU-044, HU-054)  | `player_id`, `concept_id`, `season_id`; `(uniform_order_id, player_id) → uniform_orders(id, player_id)` | `amount_cents`, `description`, `issued_on`, `due_date`, `period`                               | Monto > 0; `period` en formato `YYYY-MM`; una mensualidad por jugador + concepto + periodo; un cargo por pedido         |
| `payments`             | Dinero recibido; recibo (HU-048) | `player_id`, `received_by → users`, `cancelled_by → users`                                              | `receipt_number` (bigint, generado), `amount_cents`, `method`, `paid_at`, datos de cancelación | Monto > 0; los tres campos de cancelación juntos o ninguno; **no se borra**; sólo se cancela una vez; campos inmutables |
| `payment_applications` | Pago ↔ cargo (N:M)               | `(payment_id, player_id) → payments`, `(charge_id, player_id) → charges`                                | `amount_cents`                                                                                 | PK `(payment_id, charge_id)`; **mismo jugador** en pago y cargo; sólo inserción                                         |

**Triggers de cuadre (diferidos, se revisan al `COMMIT`):**

- Un pago vigente se aplica exactamente por su monto.
- Un cargo no recibe más que su monto sumando pagos vigentes.

**Vista `charge_balances`:** `charges.*`, `paid_cents`, `balance_cents` y `status` (`paid`, `overdue`, `partial`,
`pending`).

## Control

`schema_migrations(version, applied_at)` registra las migraciones aplicadas. La crea `migrate.sh`.

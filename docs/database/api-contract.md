# Contrato Angular ↔ API ↔ BD

Propuesta para acordar. **No hay API implementada.** Las rutas de API son sugeridas y siguen las áreas del frontend.
La API usa `camelCase` y la BD `snake_case`. Los IDs viajan como `string` (UUID).

## Reglas generales

| Tema             | Angular                        | API (JSON)         | BD                 |
| ---------------- | ------------------------------ | ------------------ | ------------------ |
| ID               | `string`                       | UUID `string`      | `uuid`             |
| Dinero           | `amountCents: number` (entero) | entero en centavos | `*_cents integer`  |
| Fecha de negocio | `'YYYY-MM-DD'`                 | `'YYYY-MM-DD'`     | `date`             |
| Instante         | `string`                       | ISO 8601 con zona  | `timestamptz`      |
| Periodo          | `'YYYY-MM'`                    | `'YYYY-MM'`        | `text` con `CHECK` |
| Opcional         | `prop?`                        | ausente o `null`   | `NULL`             |

**Autorización:** toda ruta de API exige el mismo permiso que la ruta de Angular (`ROLE_PERMISSIONS`). Todo lo que sea
`/portal/*` filtra por el tutor del token.

## Entidades simples (1 modelo ≈ 1 tabla)

| Angular                             | API sugerida                                        | Tabla                                    | Diferencias                                                                                               |
| ----------------------------------- | --------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `User`                              | `GET/POST/PATCH /users`                             | `users`                                  | `tutorId`/`coachId` salen de `tutors.user_id`/`coaches.user_id`. `password_hash` **nunca** sale de la API |
| `Player`                            | `GET /players`                                      | `players`                                | —                                                                                                         |
| `Coach`                             | `GET/POST/PATCH /coaches`                           | `coaches`                                | + `user_id` opcional                                                                                      |
| `Season`                            | `GET/POST/PATCH /seasons`                           | `seasons`                                | Activar una desactiva las demás en la misma transacción (índice único)                                    |
| `Category`                          | `GET /categories?seasonId=`                         | `categories`                             | —                                                                                                         |
| `Competition`                       | `GET /competitions`                                 | `competitions`                           | BD agrega `start_date`/`end_date` opcionales (pendiente en TS)                                            |
| `Venue`, `Match`, `TrainingSession` | `GET /agenda?from=&to=&categoryId=`                 | `venues`, `matches`, `training_sessions` | `matches.season_id` lo llena el backend                                                                   |
| `ChargeConcept`                     | `GET/POST/PATCH /charge-concepts`                   | `charge_concepts`                        | —                                                                                                         |
| `UniformProduct`, `UniformVariant`  | `GET/POST /uniforms/products`, `/uniforms/variants` | `uniform_products`, `uniform_variants`   | —                                                                                                         |

## Relaciones y casos compuestos

### Tutor ↔ jugadores

```text
Tutor { id, fullName, relationship, phone, email?, playerIds[] }
  ↓  POST /tutors
tutors (1 fila) + tutor_players (1 fila por playerId, relationship copiado, is_primary=false salvo indicación)
```

`relationship` está en la relación en la BD. Mientras TS no cambie, se usa el mismo valor para cada hijo.

### Enrollment y PlayerCategory

```text
Enrollment { id, playerId, seasonId, enrolledAt, status, notes? }  ↔  POST /enrollments   ↔  enrollments (enrolled_on)
PlayerCategory { id, playerId, categoryId, startDate, endDate? }   ↔  POST /player-categories  ↔  player_categories
```

Cambiar de categoría = una transacción: `UPDATE … SET end_date` en la fila abierta + `INSERT` de la nueva.

### CoachAssignment

`CoachAssignment { coachId, competitionId, categoryId }` ↔ `POST /coach-assignments` ↔ `coach_assignments`.
El backend obtiene `season_id` de la competencia; si la categoría es de otra temporada, la FK lo rechaza.

### Cobranza: Charge, Payment, PaymentApplication

```text
Charge { id, playerId, conceptId, amountCents, description, dueDate, period?, source? }
  ↔ charges (+ season_id obligatorio, issued_on; source = { type: 'uniform-order', id: uniform_order_id })

PaymentDraft { playerId, amountCents, method, chargeIds? }
  ↓ POST /payments   (BillingService.registerPayment)
  1 transacción:
    INSERT payments (received_by = usuario del token)            → receipt_number generado
    INSERT payment_applications (1 fila por cargo, más antiguo primero, player_id = playerId)
  COMMIT → los triggers verifican: Σ aplicaciones = monto del pago; ningún cargo sobrepagado
  ↑ Payment { id, receiptNumber: 'R-' + lpad(receipt_number, 4), playerId, amountCents, method, paidAt, cancelledAt? }

POST /payments/:id/cancel { reason }  →  UPDATE payments SET cancelled_at, cancelled_by, cancellation_reason
GET /players/:id/open-charges         →  charge_balances WHERE balance_cents > 0 ORDER BY due_date   (OpenCharge[])
GET /billing/debts                    →  consulta Q20                                               (DebtView[])
GET /payments/:id/receipt             →  consulta Q10                                               (ReceiptView)
```

**Responsabilidad del frontend:** capturar, validar para UX y mostrar.
**Backend:** repetir validaciones, usar la transacción, tomar `received_by` y `cancelled_by` del token y traducir los
errores de la BD a mensajes.
**BD:** rechaza cualquier estado imposible aunque el backend falle.

### Uniformes

```text
POST /uniforms/orders { playerId, items: [{ variantId, quantity }] }
  1 transacción:
    INSERT uniform_orders (requested_by = token)
    INSERT uniform_order_lines (unit_price_cents = precio ACTUAL de la variante, copiado)
    INSERT charges (concepto kind='uniform', amount = Σ líneas, uniform_order_id, temporada activa)
  ↑ UniformOrder { id, playerId, createdAt, lines[], chargeId, status }
      chargeId = charges.id WHERE uniform_order_id = order.id
      status   = 'delivered' si todas las líneas tienen delivered_at, si no 'pending'

POST /uniforms/orders/:id/deliver { deliveredTo }  → UPDATE uniform_order_lines SET delivered_* (todas las pendientes)
```

## Portal del tutor

| Angular (`PortalService`) | API                          | Consulta                                                                 |
| ------------------------- | ---------------------------- | ------------------------------------------------------------------------ |
| `children()`              | `GET /portal/children`       | Q5 (por `user_id` del token)                                             |
| `competitions()`          | `GET /portal/competitions`   | Q5 → `player_categories` abiertas → `coach_assignments` → `competitions` |
| `uniformOrders()`         | `GET /portal/uniform-orders` | Q14 filtrado por los hijos de Q5                                         |

Ninguna ruta del portal recibe `playerId` ni `tutorId` del cliente.

## Cambios de contrato pendientes en TS (no aplicados)

| Modelo               | Cambio sugerido                           | Motivo                                        |
| -------------------- | ----------------------------------------- | --------------------------------------------- |
| `Charge`             | + `seasonId`, `issuedOn`                  | La BD los exige para reportes por temporada   |
| `Payment.paidAt`     | Fecha → instante ISO                      | Se guarda el instante; la UI muestra la fecha |
| `Payment`            | + `cancelledBy`, `cancellationReason`     | Trazabilidad                                  |
| `Tutor.relationship` | Mover a la relación por jugador           | Parentesco por jugador                        |
| `Competition`        | + `startDate?`, `endDate?`                | Agenda y portal                               |
| `UniformOrder`       | Entrega por línea (`lines[].deliveredAt`) | Entregas parciales                            |

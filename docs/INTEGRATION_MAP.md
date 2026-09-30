# Mapa de integración del equipo (fase 4)

Preparación para repartir el backend. **No hay backend implementado.** Reglas de datos:
[`database/DATA_CONTRACT.md`](database/DATA_CONTRACT.md). Owner de cada tabla: [`database/OWNERSHIP.md`](database/OWNERSHIP.md).

## Regla fundamental

- **Un solo owner de escritura por entidad.** Sólo el servicio owner hace `INSERT`, `UPDATE` o `DELETE` en sus tablas.
- **Leer tablas ajenas sí se permite:** consultas de sólo lectura, vistas como `charge_balances`, joins para reportes.
- **Escribir en una entidad ajena = llamar al servicio owner**, en la misma transacción cuando haga falta.

```text
PlayerService ─ necesita crear un tutor ─► TutorService.create() ─► tutors / tutor_players   ✔
PlayerService ─ INSERT INTO tutors ────────────────────────────────────────────────────────   ✘
```

El frontend actual ya cumple esta regla: el único servicio que escribe en una entidad ajena es `UniformService`, y lo
hace a través de `BillingService.createCharge`.

## 1. Decisiones que requieren aprobación

### Bloquean la integración (decidir antes de repartir el backend)

| #   | Decisión                                                   | Qué bloquea                                                                                        | Recomendación                                                                                  |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| C3  | Owner de escritura de `player_categories`                  | HU-018, HU-063 y la agenda por categoría no tienen datos reales; nadie implementaría la asignación | **Owner de categorías** (§ 3)                                                                  |
| C2  | ¿Se crea `competition_categories`?                         | El contrato de escritura de competencias, el flujo de HU-026 y la consulta de HU-063               | **Sí, antes del backend** (§ 2)                                                                |
| C5  | Owner de autenticación (login, sesión) y sesiones vs. JWT  | Todo el backend: todos los endpoints dependen de la identidad del token                            | Decidir primero; `permissions.ts` sigue como única fuente de permisos                          |
| C4  | Quién captura y quién **cancela** pagos, y con qué permiso | Backend de cobranza                                                                                | La captura usa `registerPayment`; cancelar con un permiso nuevo `payments.cancel` (sólo admin) |
| C1  | ¿El alta de jugador captura tutores?                       | Backend de jugadores y tutores                                                                     | Si sí: `PlayerService` llama a `TutorService`, nunca escribe `tutor_players`                   |
| C6  | Quién crea el cargo de inscripción                         | Backend de inscripción y cobranza                                                                  | `EnrollmentService.enroll()` llama a `BillingService.createCharge()` en la misma transacción   |

### No bloquean la integración

| Decisión                                | Cuándo decidir                            |
| --------------------------------------- | ----------------------------------------- |
| Aplicar los cambios de TypeScript (§ 4) | En el mismo PR que conecte la API         |
| Folios de recibo con o sin huecos       | Antes de imprimir recibos reales          |
| Cancelación de **cargos**               | Cuando una historia la pida               |
| C7: reglas de edad de categorías        | Con el owner de categorías, vía migración |

## 2. Impacto de C2 — `competition_categories`

**Problema:** hoy «la categoría X participa en la competencia Y» sólo existe si hay un entrenador asignado. Una
categoría inscrita en un torneo sin entrenador no aparece en el portal (HU-063), y un partido puede registrarse para
una categoría que no participa.

**Diseño propuesto (migración aditiva 008, no aplicada):**

```sql
CREATE TABLE competition_categories (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL,
  category_id    uuid NOT NULL,
  season_id      uuid NOT NULL,
  FOREIGN KEY (competition_id, season_id) REFERENCES competitions (id, season_id),
  FOREIGN KEY (category_id, season_id)    REFERENCES categories (id, season_id),
  UNIQUE (competition_id, category_id),
  UNIQUE (competition_id, category_id, season_id)
);
-- backfill: INSERT … SELECT DISTINCT competition_id, category_id, season_id FROM coach_assignments UNION matches
ALTER TABLE coach_assignments ADD FOREIGN KEY (competition_id, category_id, season_id)
  REFERENCES competition_categories (competition_id, category_id, season_id);
ALTER TABLE matches ADD FOREIGN KEY (competition_id, category_id, season_id)
  REFERENCES competition_categories (competition_id, category_id, season_id);
```

Se **conservan** las columnas actuales de `coach_assignments` y `matches` y sólo se agrega una FK. Así nada cambia de
forma en el contrato de API ni en TS.

| Área                           | Impacto exacto                                                                                                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coach_assignments`            | Ninguna columna cambia. Nueva regla: sólo se puede asignar entrenador a una participación ya registrada                                                                                                                          |
| Portal (HU-063)                | `PortalService.competitions()` y su consulta pasan de `coach_assignments` a `competition_categories`, con `LEFT JOIN coach_assignments` para mostrar el entrenador si lo hay. Las categorías sin entrenador **empiezan a verse** |
| Agenda (HU-068)                | Sin cambios de consulta: el entrenador del partido ya usa `LEFT JOIN coach_assignments`. `matches` gana la garantía de que la categoría participa                                                                                |
| Competencias (otro integrante) | Nueva escritura: registrar y quitar categorías participantes. Es su tabla                                                                                                                                                        |
| HU-026 (Borrayo)               | La UI elige entre **participaciones existentes** en vez de combinar competencia y categoría libremente. Dependencia de orden: competencias registra la participación, después se asigna entrenador                               |
| SQL                            | Q16: `FROM competition_categories LEFT JOIN coach_assignments`. El portal igual. Q17 sin cambios. Pruebas nuevas: FK de asignación y de partido, y participación sin entrenador visible. El seed necesita el backfill            |
| `api-contract.md`              | Nuevo recurso `CompetitionCategory { id, competitionId, categoryId }` (el backend deduce `seasonId`). `CoachAssignment` no cambia                                                                                                |
| TS                             | Nuevo modelo `CompetitionCategory`; `MockDb.competitionCategories`; `PortalService.competitions()`; el selector de HU-026                                                                                                        |
| Ownership                      | `competition_categories` → owner de competencias. `coach_assignments` sigue siendo de Borrayo y depende de ella                                                                                                                  |
| Datos                          | Sin riesgo: aditivo con backfill y sin datos de producción                                                                                                                                                                       |

**Recomendación:** aprobarlo **ahora**. Hoy cuesta una migración, 3 o 4 pruebas y un par de consultas. Después de que
exista el backend de competencias y el de HU-026, costaría reescribir contratos ya implementados por dos personas.

## 3. Impacto de C3 — owner de `player_categories`

**Recomendación: el owner de categorías.**

- Asignar un jugador a una categoría depende de las reglas de la categoría (rango de años, temporada). Esa lógica y su
  validación viven con quien define las categorías (C7).
- El owner de jugadores administra la identidad del jugador; si también asignara categoría, dos módulos tocarían las
  reglas de edad.
- Si jugadores y categorías resultan ser la misma persona, la pregunta desaparece.

| Operación                                              | Quién                                                     |
| ------------------------------------------------------ | --------------------------------------------------------- |
| Asignar (insertar fila abierta)                        | `CategoryService` (owner de categorías)                   |
| Cambiar de categoría (cerrar + abrir, una transacción) | `CategoryService`                                         |
| Cerrar al fin de temporada o baja                      | `CategoryService`; otros módulos lo piden por su contrato |
| Leer                                                   | Borrayo (HU-018, HU-063, agenda), reportes, portal        |

Mientras no se decida, **nadie** implementa la escritura; el seed y el `MockDb` cubren las pruebas.

## 4. Cambios pendientes en TypeScript

En todos cambia TypeScript; la BD ya está así. Ninguno se aplicó.

| #   | Modelo actual                                         | Cambio requerido                                                  | Motivo                                            | Historias          | Riesgo                                                                                                                                                                                     |
| --- | ----------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `Charge` sin `seasonId` ni `issuedOn`                 | + `seasonId`, `issuedOn`                                          | Son obligatorios en la BD; reportes por temporada | 044, 050, 054, 067 | Bajo (aditivo). `createCharge` y el seed del mock deben llenarlos                                                                                                                          |
| 2   | `Payment.paidAt: 'YYYY-MM-DD'`                        | Instante ISO con zona                                             | La BD guarda `timestamptz`                        | 048, 067           | **Medio:** `incomeByMonthAndConcept` compara `paidAt` como texto de fecha; hay que convertirlo a fecha local antes (`business_date` en BD, equivalente en TS) o el reporte se mueve de mes |
| 3   | `Payment` sin quién ni por qué se canceló             | + `cancelledBy`, `cancellationReason`                             | Trazabilidad (la BD los exige juntos)             | 048                | Bajo (aditivo)                                                                                                                                                                             |
| 4   | `Tutor.relationship` y `playerIds[]`                  | `players: { playerId, relationship, isPrimary }[]`                | Parentesco por jugador y tutor principal          | 011, 050, 056, 063 | **Medio:** rompe `TutorService`, `TutorsPage`, `PortalService.childIds()` y el mock. Depende de C1                                                                                         |
| 5   | `Competition` sin fechas                              | + `startDate?`, `endDate?`                                        | Portal y agenda                                   | 063, 068           | Bajo (opcionales)                                                                                                                                                                          |
| 6   | `UniformOrder.createdAt: 'YYYY-MM-DD'`                | Instante ISO                                                      | La BD guarda `timestamptz`                        | 053, 056           | Bajo (sólo se muestra)                                                                                                                                                                     |
| 7   | `startsAt: '2026-10-04T10:00'` (sin zona, en el mock) | Con zona: `…T10:00:00-06:00`                                      | Evitar que se interprete en la zona del navegador | 068                | Bajo (datos del mock; `DatePipe` ya lo muestra)                                                                                                                                            |
| 8   | `UniformOrder.status`, `deliveredAt`, `deliveredTo`   | Entrega por línea: `lines[].deliveredAt/By/To`; `status` derivado | Entregas parciales (la BD ya es por línea)        | 055, 056           | **Medio:** cambia `UniformService.deliver`, la página de pedidos y el portal                                                                                                               |

**Recomendación:** un solo PR, junto con la conexión a la API, porque todos cambian lo que llega del servidor. Los #2,
#4 y #8 llevan pruebas nuevas.

## 5. Mapa de integración

### Frontend (existe, con `MockDb`)

`features/`: `auth`, `users`, `tutors`, `seasons`, `categories` (sólo lectura, HU-018), `enrollments`, `coaches`
(entrenadores + asignaciones), `billing`, `uniforms`, `reports` (ingresos + agenda), `parent-portal`.

`core/services` (lecturas compartidas): `PlayerService`, `CategoryService`, `CompetitionService`.

### Base de datos (existe)

23 tablas en 7 migraciones + la vista `charge_balances`. Detalle en [`database/schema.md`](database/schema.md).

### Backend futuro: un servicio por área, un owner de escritura

| Servicio             | Owner                                                | Escribe                                                          | Historias                    |
| -------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------- |
| `AuthService`        | **Por definir (C5)**; HU-005/072 de Borrayo          | `password_reset_tokens`, `users.password_hash`                   | 005, 072, login              |
| `UserService`        | Borrayo                                              | `users`                                                          | 004                          |
| `PlayerService`      | Otro integrante                                      | `players`                                                        | Alta de jugadores            |
| `TutorService`       | Borrayo                                              | `tutors`, `tutor_players`                                        | 011                          |
| `CategoryService`    | Otro integrante                                      | `categories`, `player_categories` (si se aprueba C3)             | Categorías                   |
| `SeasonService`      | Borrayo                                              | `seasons`                                                        | 070                          |
| `EnrollmentService`  | Borrayo                                              | `enrollments`                                                    | 020                          |
| `CoachService`       | Borrayo                                              | `coaches`, `coach_assignments`                                   | 022, 026                     |
| `CompetitionService` | Otro integrante                                      | `competitions`, `competition_categories` (si se aprueba C2)      | Competencias                 |
| `ScheduleService`    | Otro integrante (puede ser el mismo de competencias) | `venues`, `matches`, `training_sessions`                         | Agenda                       |
| `BillingService`     | Borrayo (modelo); captura: otro integrante (C4)      | `charge_concepts`, `charges`, `payments`, `payment_applications` | 043, 044, 048, 050 + captura |
| `UniformService`     | Borrayo                                              | `uniform_*`                                                      | 052–055                      |
| `ReportService`      | Borrayo                                              | — (sólo lectura)                                                 | 067, 068                     |
| `PortalService`      | Borrayo                                              | — (sólo lectura, filtrado por el token)                          | 056, 063                     |

## 6. Dependencias entre módulos

| Módulo       | Escribe                                    | Lee                                                                                                         | Llama a (necesita)                                       | Ofrece                                                            |
| ------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------- |
| Auth         | tokens, `password_hash`                    | `users`, `tutors`, `coaches`                                                                                | —                                                        | Identidad del token, `can(permiso)`                               |
| Users        | `users`                                    | `tutors`, `coaches`                                                                                         | —                                                        | `create`, `setActive`, `linkTutor/linkCoach`                      |
| Players      | `players`                                  | —                                                                                                           | `TutorService` (C1), `CategoryService.assign` (opcional) | `list`, `get`                                                     |
| Tutors       | `tutors`, `tutor_players`                  | `players`, `users`                                                                                          | —                                                        | `create`, `linkPlayer`, `childrenOf(userId)`                      |
| Categories   | `categories`, `player_categories`          | `players`, `seasons`                                                                                        | —                                                        | `assign`, `move`, `close`, `members`                              |
| Seasons      | `seasons`                                  | —                                                                                                           | —                                                        | `active()`                                                        |
| Enrollments  | `enrollments`                              | `players`, `seasons`                                                                                        | `BillingService.createCharge` (C6)                       | `enroll`, `cancel`                                                |
| Coaches      | `coaches`, `coach_assignments`             | `competitions`, `categories`, (`competition_categories`)                                                    | —                                                        | `assign`, `unassign`                                              |
| Competitions | `competitions`, (`competition_categories`) | `seasons`, `categories`                                                                                     | —                                                        | `list`, `registerCategory`                                        |
| Schedule     | `venues`, `matches`, `training_sessions`   | `competitions`, `categories`, `coaches`                                                                     | —                                                        | Agenda                                                            |
| Billing      | Cobranza                                   | `players`, `seasons`, `enrollments` (mensualidades), `tutor_players` (adeudos)                              | —                                                        | `createCharge`, `registerPayment`, `cancelPayment`, `openCharges` |
| Uniforms     | `uniform_*`                                | `players`                                                                                                   | `BillingService.createCharge`                            | `createOrder`, `deliver`                                          |
| Reports      | —                                          | Todo (sólo lectura)                                                                                         | —                                                        | Ingresos, agenda                                                  |
| Portal       | —                                          | `tutor_players`, `player_categories`, `coach_assignments`/`competition_categories`, `uniform_*`, (cobranza) | `TutorService.childrenOf`                                | Vistas del tutor                                                  |

Relaciones pedidas:

- jugadores → tutores (C1)
- jugadores → categorías (C3)
- temporadas → inscripciones (lectura)
- inscripciones → cobranza (C6, una dirección)
- categorías → competencias (C2)
- competencias → entrenadores (lectura, HU-026)
- jugadores → cargos (lectura)
- pagos → cargos (dentro de Billing)
- uniformes → cargos (`createCharge`)
- tutor → portal (`childrenOf`)

### Ciclos y contratos ambiguos

- **No hay dependencias circulares de llamadas**, siempre que se respete que leer es directo y escribir va al owner.
  Todas las llamadas van en una dirección: Enrollments/Uniforms → Billing, Players → Tutors/Categories,
  Portal → Tutors.
- **Riesgo de ciclo a evitar:** si Billing llamara a `EnrollmentService` para generar mensualidades mientras Enrollments
  llama a Billing para el cargo de inscripción, habría un ciclo. Billing **lee** la tabla `enrollments`; no llama a su
  servicio.
- **Contratos ambiguos:** C1, C4 y C5 (§ 1) y C6, que define la única llamada Enrollments → Billing. El resto está definido.

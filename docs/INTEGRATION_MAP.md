# Mapa de integración del equipo

> **Documento histórico (diseño previo a MariaDB).** Los «cambios pendientes en TypeScript» de § 2 quedaron superados:
> el modelo se rehízo sobre MariaDB (IDs numéricos, `pagos.motivo_cancelacion`, `tutor_jugador` con parentesco,
> fechas `DATETIME` locales…). Lo vigente para conectar la API: [`database/MARIADB.md`](database/MARIADB.md) § 8,
> [`AUTHORIZATION.md`](AUTHORIZATION.md) y [`DOMAIN_RULES.md`](DOMAIN_RULES.md). La regla de un solo servicio que
> escribe cada tabla sigue vigente.

Cómo se reparte el backend sin duplicar modelos, tablas ni reglas. **No hay backend implementado.**

| Fuente                                                         | Manda sobre                       |
| -------------------------------------------------------------- | --------------------------------- |
| [`requirements/USER_STORIES.md`](requirements/USER_STORIES.md) | Quién hace cada HU                |
| [`database/OWNERSHIP.md`](database/OWNERSHIP.md)               | Quién escribe cada tabla          |
| [`database/DATA_CONTRACT.md`](database/DATA_CONTRACT.md)       | Reglas de datos y contratos C1–C6 |

## Regla fundamental

- **Un solo owner de escritura por tabla.** Los demás leen o llaman al servicio del owner.
- Si la HU de otro integrante escribe una tabla ajena, se implementa como operación del servicio owner, en un PR que
  revisa el owner ([`OWNERSHIP.md` › Reglas](database/OWNERSHIP.md#reglas)).

```text
PlayerService (Joss) ─ necesita vincular tutor ─► TutorService.linkPlayer() (Borrayo) ─► tutor_players   ✔
PlayerService (Joss) ─ INSERT INTO tutor_players ────────────────────────────────────────────────────────   ✘
```

El frontend actual ya cumple la regla: la única escritura entre módulos es `UniformService → BillingService.createCharge`.

## 1. Decisiones

**C1–C6 están resueltas** con la tabla oficial (detalle en `DATA_CONTRACT.md` § 7; resumen en
`OWNERSHIP.md` › Contratos de frontera). C2 ya está implementada: migración 008, portal (HU-063) y validación de
HU-026.

Quedan abiertas, sin bloquear el trabajo en paralelo:

| Tema                                                                 | Quién decide                      |
| -------------------------------------------------------------------- | --------------------------------- |
| Licencia del repositorio                                             | Los 4 integrantes                 |
| Folios con o sin huecos                                              | Owner de cobranza + Dani (HU-045) |
| Diseño de descuentos (HU-051) sin romper el monto original del cargo | Joss con el owner de cobranza     |
| HU-063 filtra por plantel cuando exista HU-036                       | Joss (tabla) → Borrayo (consulta) |

## 2. Cambios pendientes en TypeScript

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

## 3. Servicios de backend y owners

| Servicio                     | Owner                                        | Escribe                                                                              | HU que agregan operaciones al servicio                                               |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `AuthService`                | Joss (HU-001)                                | `sesiones` (futura), `users.password_hash` (vía HU-005), `roles`/`permisos` (HU-006) | Armando (HU-002), Dani (HU-003), Borrayo (HU-005, HU-072)                            |
| `UserService`                | Borrayo (HU-004)                             | `users`                                                                              | —                                                                                    |
| `AuditService`               | Joss (HU-007)                                | `auditoria` (futura)                                                                 | Lo llaman HU-009, HU-049 y HU-064                                                    |
| `PlayerService`              | Joss (HU-008, HU-009)                        | `players`                                                                            | Dani (HU-010: estatus)                                                               |
| `TutorService`               | Borrayo (HU-011)                             | `tutors`, `tutor_players`                                                            | Armando (HU-012, HU-064)                                                             |
| `CategoryService`            | Armando (HU-015)                             | `categories`                                                                         | Joss (HU-021: cupo)                                                                  |
| `PlayerCategoryService`      | Joss (HU-017)                                | `player_categories`                                                                  | Dani (HU-019: cambio)                                                                |
| `SeasonService`              | Borrayo (HU-070)                             | `seasons`                                                                            | —                                                                                    |
| `EnrollmentService`          | Borrayo (HU-020)                             | `enrollments` (+ cargo vía Billing, C6)                                              | —                                                                                    |
| `CoachService`               | Borrayo (HU-022, HU-026)                     | `coaches`, `coach_assignments`                                                       | —                                                                                    |
| `CoachCategoryService`       | Armando (HU-023)                             | `entrenador_categoria` (futura)                                                      | —                                                                                    |
| `CompetitionService`         | Dani (HU-034)                                | `competitions`                                                                       | —                                                                                    |
| `CompetitionCategoryService` | Armando (HU-035)                             | `competition_categories`                                                             | —                                                                                    |
| `RosterService`              | Joss (HU-036)                                | `jugador_competencia_categoria` (futura)                                             | —                                                                                    |
| `VenueService`               | Armando (HU-069)                             | `venues`                                                                             | —                                                                                    |
| `ScheduleService`            | Joss (HU-016, HU-028, HU-037)                | `horarios_entrenamiento` (futura), `training_sessions`, `matches`                    | Dani (HU-040: resultado), Joss (HU-030/031: asistencia, bitácora)                    |
| `BillingService`             | Borrayo (modelo: HU-043, 044, 048, 050, 054) | `charge_concepts`, `charges`, `payments`, `payment_applications`                     | Dani (HU-045: `registerPayment`), Joss (HU-049: `cancelPayment`; HU-051: descuentos) |
| `UniformService`             | Borrayo (HU-052–055)                         | `uniform_*` (+ cargo vía Billing)                                                    | —                                                                                    |
| `NoticeService`              | Dani (HU-057)                                | `avisos`, `aviso_destinatario` (futuras)                                             | Joss (HU-058)                                                                        |
| `ReportService`              | Sólo lectura                                 | —                                                                                    | Borrayo (HU-067, HU-068), Joss (HU-065), Armando (HU-066), Armando (HU-032)          |
| `PortalService`              | Sólo lectura, filtrado por el token          | —                                                                                    | Borrayo (HU-056, HU-063), Dani (HU-061, HU-062), Armando (HU-039, HU-042, HU-047)    |

## 4. Dependencias de llamadas (una sola dirección)

```text
Enrollment ─► Billing ◄─ Uniform            Player ─► Tutor, PlayerCategory
Billing(cancel) ─► Audit                    Coach(assign) ─► lee CompetitionCategory
Schedule(match) ─► lee CompetitionCategory  Portal/Report ─► sólo lecturas
todos ─► Auth (sesión, can)
```

- **Sin ciclos**, si se respeta que leer es directo y escribir va al owner.
- **Ciclo a evitar:** Billing **lee** la tabla `enrollments` para las mensualidades y nunca llama a
  `EnrollmentService` (C6).

## 5. Estado actual del frontend

- `src/app/features/` (todo de Borrayo, con `MockDb`): `auth` (mock), `users`, `tutors`, `seasons`, `categories`
  (lectura, HU-018), `enrollments`, `coaches`, `billing`, `uniforms`, `reports`, `parent-portal`.
- `src/app/core/services/`: lecturas compartidas (`PlayerService`, `CategoryService`, `CompetitionService`) que
  reemplazarán los owners reales.

# Ownership de datos

**Quién escribe cada tabla.** Las asignaciones salen de la tabla oficial
[`docs/requirements/USER_STORIES.md`](../requirements/USER_STORIES.md) (columna _Responsable_), que manda sobre el
trabajo. Este documento manda sobre la **escritura** de datos. Las reglas de datos están en
[`DATA_CONTRACT.md`](DATA_CONTRACT.md).

> En la tabla oficial HU-003 dice «Dany»; se trata como **Dani**. HU-073 es de «Todos».

## Reglas

1. **Owner de una tabla** = el integrante de la HU que **crea** esa entidad. Define y modifica su contrato (servicio,
   API, migraciones de esa tabla) y revisa los PRs que la tocan.
2. **Otros módulos leen** (consultas de sólo lectura, vistas) o **piden operaciones al servicio del owner**. Nunca
   hacen `INSERT`, `UPDATE` ni `DELETE` directo en una tabla ajena.
3. **Si la HU de otro integrante escribe una tabla ajena** (por ejemplo, HU-010 cambia el estatus de `players`), esa HU
   se implementa como **una operación nueva del servicio owner**: la programa el responsable de la HU, en un PR
   revisado por el owner de la tabla. Así la HU conserva a su responsable y la tabla sigue teniendo un solo contrato de
   escritura.
4. Nada se reasigna aquí: si cambia un responsable, se cambia primero la tabla oficial.

## Tablas existentes (9 migraciones, 24 tablas)

| Tabla                                   | Owner (HU)                       | Otras HU que escriben (vía el servicio owner)                                               | Lectores principales                                                      | Borrado                           |
| --------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------- |
| `users`                                 | Borrayo (HU-004)                 | Joss (HU-001: último acceso), Borrayo (HU-005: `password_hash`, dentro de `AuthService`)    | Todos                                                                     | Nunca: se desactiva               |
| `password_reset_tokens`                 | Borrayo (HU-005)                 | —                                                                                           | `AuthService`                                                             | Limpieza de expirados             |
| `players`                               | Joss (HU-008, HU-009)            | Dani (HU-010: estatus)                                                                      | Todos                                                                     | Nunca: estatus                    |
| `tutors`                                | Borrayo (HU-011)                 | Armando (HU-012: vincular cuenta; HU-064: contacto)                                         | Portal, cobranza, reportes                                                | Nunca                             |
| `tutor_players`                         | Borrayo (HU-011)                 | Joss (HU-008, si el alta captura tutor; **C1**)                                             | Portal (filtro de seguridad), reportes                                    | Desvincular: owner                |
| `coaches`                               | Borrayo (HU-022)                 | —                                                                                           | Deportivo, agenda                                                         | Nunca: `active = false`           |
| `seasons`                               | Borrayo (HU-070)                 | —                                                                                           | Todos                                                                     | Nunca                             |
| `categories`                            | Armando (HU-015)                 | Joss (HU-021: cupo)                                                                         | Todos los módulos deportivos                                              | Nunca con historial               |
| `enrollments`                           | Borrayo (HU-020)                 | —                                                                                           | Cobranza (HU-044), expediente                                             | Nunca: `status`                   |
| `player_categories`                     | **Joss (HU-017)** (**C3**)       | Dani (HU-019: cambio de categoría = cerrar + abrir)                                         | Borrayo (HU-018, HU-063), Armando (HU-024), Dani (HU-013, HU-014, HU-062) | Nunca: se cierra                  |
| `venues`                                | Armando (HU-069)                 | —                                                                                           | Agenda, partidos, entrenamientos                                          | Nunca con historial               |
| `competitions`                          | Dani (HU-034)                    | —                                                                                           | HU-026, HU-027, HU-063                                                    | Nunca con historial               |
| `competition_categories`                | **Armando (HU-035)** (**C2**)    | —                                                                                           | HU-026, HU-037, HU-063, agenda                                            | Owner                             |
| `coach_assignments`                     | Borrayo (HU-026)                 | —                                                                                           | Armando (HU-027), agenda                                                  | Owner (quitar)                    |
| `matches`                               | Joss (HU-037)                    | Dani (HU-040: resultado)                                                                    | HU-038, 039, 041, 042, 068                                                | Owner (con estatus cuando exista) |
| `training_sessions`                     | Joss (HU-028)                    | Joss (HU-031)                                                                               | HU-029, HU-068                                                            | Owner                             |
| `charge_concepts`                       | Borrayo (HU-043)                 | —                                                                                           | Cobranza                                                                  | Nunca: `active = false`           |
| `charges`                               | Borrayo (HU-044, HU-054)         | Borrayo (HU-020 vía `createCharge`, **C6**); Joss (HU-051, descuentos, pendiente de diseño) | Armando (HU-046, HU-047), reportes                                        | Nunca                             |
| `payments`                              | Borrayo (modelo: HU-048, HU-050) | **Dani (HU-045: `registerPayment`)**, **Joss (HU-049: `cancelPayment`)** (**C4**)           | Recibos, estados de cuenta, reportes                                      | **Nunca** (trigger)               |
| `payment_applications`                  | Borrayo (modelo)                 | Sólo dentro de `registerPayment`                                                            | Saldos                                                                    | **Nunca** (trigger)               |
| `uniform_products`, `uniform_variants`  | Borrayo (HU-052)                 | —                                                                                           | Pedidos                                                                   | Nunca: `active = false`           |
| `uniform_orders`, `uniform_order_lines` | Borrayo (HU-053, HU-055)         | —                                                                                           | Portal (HU-056)                                                           | Nunca                             |
| `schema_migrations`                     | Equipo (infraestructura)         | `migrate.sh`                                                                                | —                                                                         | —                                 |
| Vista `charge_balances`                 | Borrayo                          | —                                                                                           | Todos                                                                     | —                                 |

## Tablas y columnas que pide el backlog y todavía no existen

No se crearon; cada owner las agrega con **su** migración, siguiendo `DATA_CONTRACT.md`. Se listan para que nadie las
cree dos veces.

| Falta                                     | HU (owner)                      | Nota                                                                                                            |
| ----------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `roles`, `permisos`, `rol_permiso`        | HU-006 (Joss)                   | **Reemplaza** a `permissions.ts`; no conviven dos mecanismos (**C5**)                                           |
| `auditoria`                               | HU-007 (Joss)                   | La usan HU-009, HU-049, HU-064                                                                                  |
| `sesiones`                                | HU-001 (Joss)                   | Sesión del lado del servidor (**C5**)                                                                           |
| `historial_estatus` + estatus de jugador  | HU-010 (Dani)                   | `players.active` hoy es booleano; el backlog pide activo, baja temporal y baja definitiva                       |
| Motivo del cambio de categoría            | HU-019 (Dani)                   | Columna en `player_categories`                                                                                  |
| `categories.active`, `categories.cupo`    | HU-015 (Armando), HU-021 (Joss) | —                                                                                                               |
| `horarios_entrenamiento`                  | HU-016 (Joss)                   | Horario recurrente; `training_sessions` es la sesión concreta                                                   |
| `entrenador_categoria`                    | HU-023 (Armando)                | HU-026 exige «sólo asignaciones vigentes»: cuando exista, `coach_assignments` debe referenciarla                |
| `asistencias`                             | HU-030 (Joss)                   | —                                                                                                               |
| `jugador_competencia_categoria` (plantel) | HU-036 (Joss)                   | HU-063 (Borrayo) pide «sólo torneos donde el hijo está en plantel». Hoy se usa la participación de su categoría |
| `rivales`, estatus y marcador de partidos | HU-037 (Joss), HU-040 (Dani)    | —                                                                                                               |
| Organizador y estatus de competencias     | HU-034 (Dani)                   | —                                                                                                               |
| `descuentos`                              | HU-051 (Joss)                   | Debe conservar el monto original del cargo. Se diseña con el owner de cobranza                                  |
| `avisos`, `aviso_destinatario`            | HU-057 (Dani), HU-058 (Joss)    | —                                                                                                               |
| Cancelación de pedido de uniforme         | HU-053, HU-055 (Borrayo)        | El backlog pide estado «cancelado»; hoy no existe                                                               |

## Contratos de frontera (C1–C6)

Resueltos con la tabla oficial; el detalle técnico está en [`DATA_CONTRACT.md` § 7](DATA_CONTRACT.md).

| #   | Frontera                | Decisión                                                                                                                                                                                         |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | Tutor ↔ jugador         | `tutor_players` sólo la escribe `TutorService` (Borrayo, HU-011). El alta de jugador (Joss) y la vinculación de cuenta (Armando) le piden la operación                                           |
| C2  | Competencia ↔ categoría | `competition_categories` (Armando, HU-035) es la participación. `coach_assignments` (Borrayo) es la responsabilidad del entrenador y exige participación. Migración 008                          |
| C3  | `player_categories`     | Owner: Joss (HU-017). Dani (HU-019) cambia de categoría con el contrato de Joss. Borrayo sólo lee                                                                                                |
| C4  | Pagos                   | El modelo es de Billing (Borrayo). Se registra sólo con `registerPayment` (Dani, HU-045) y se cancela sólo con `cancelPayment` (Joss, HU-049: administrador, motivo y auditoría). Nunca se borra |
| C5  | Autenticación           | Un solo `AuthService` (Joss, HU-001). HU-002 y HU-003 son pantallas o flujos por rol sobre el mismo servicio. HU-005 (Borrayo) agrega operaciones de contraseña a ese servicio                   |
| C6  | Inscripción + cargo     | `EnrollmentService` (Borrayo) coordina `enrollments` + `BillingService.createCharge` en una transacción. Billing nunca llama a `EnrollmentService`                                               |

# Plan y decisiones — Borrayo

## Qué existía (auditoría 2026-09-30)

- Scaffold limpio de Angular 22.2 (standalone, zoneless, `@angular/build`), TypeScript 6 (strict por defecto), CSS plano.
- Tests: Vitest 5 vía `ng test` (jsdom). Sin rutas, servicios, entornos, backend ni configuración de agentes.
- El Markdown de historias de usuario **no está en el repo**; se usó la lista de historias del encargo.

## Fuera de alcance (deliberado)

- Backend, autenticación real, JWT, correo, hashing de contraseñas (HU-072 se cumple en el backend).
- La BD (PostgreSQL) se diseñó en la fase 3: ver `docs/database/`. El frontend todavía no se conecta a ella.
- Historias de Joss, Armando y Dani (ver «Límites con otros integrantes»).
- `environments/`: se agregan cuando exista una URL de API. E2E, CI/CD, Docker.

## Decisiones

- Flujo: página → servicio (`Promise`) → `core/data/mock-db.ts`. Al conectar la API sólo cambia el interior de los servicios.
- **Dinero en centavos (entero)**. Los saldos siempre se calculan, nunca se guardan.
- Autorización por **permisos**, nunca comparando roles.
- Código en inglés, UI en español.

---

## Enrollment vs. jugador_categoria (revisado en fase 2)

**Diagnóstico.** En la fase 1 `Enrollment` tenía `categoryId` y representaba **ambas** cosas (opción C):
la inscripción administrativa anual y la pertenencia del jugador a una categoría. Problemas reales:

- Cambiar a un jugador de categoría a media temporada obligaba a editar su inscripción administrativa.
- HU-018 (lista por categoría) y HU-063 (torneos del hijo) dependían de la inscripción administrativa, no de la categoría.
- La especificación usa `jugador_categoria` y otros integrantes la van a consumir: habría habido dos fuentes de verdad.

**Resolución (hecha en fase 2).**

| Modelo                                                               | Significa                                     | Quién escribe                                 | Quién lee                                                                            |
| -------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `Enrollment` (`playerId`, `seasonId`, `status`)                      | Inscripción administrativa/anual (HU-020)     | Borrayo (`EnrollmentService`)                 | Mensualidades (HU-044): sólo jugadores con inscripción activa en la temporada activa |
| `PlayerCategory` (`playerId`, `categoryId`, `startDate`, `endDate?`) | Pertenencia deportiva (= `jugador_categoria`) | **Otro integrante** (asignación a categorías) | HU-018, HU-063, agenda                                                               |

- La temporada de un `PlayerCategory` sale de `Category.seasonId`.
- Fila abierta (`endDate` vacío) = categoría actual. Un cambio de categoría cierra la fila y abre otra (historial).
- La «inscripción deportiva» no es una entidad aparte: es tener una fila abierta de `PlayerCategory`.
- Hoy nadie crea `PlayerCategory` desde la UI (sólo seed). Queda para quien tenga la historia de asignación a categorías.

## Pagos: contrato compartido

**Servicio:** `BillingService` (`features/billing/billing.service.ts`). Modelos en `core/models/billing.ts`.

| Método                              | Recibe                                                       | Devuelve                                                                                   |
| ----------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `openCharges(playerId)`             | id de jugador                                                | `OpenCharge[]` = `{ charge, balanceCents }` con saldo > 0, vencimiento más antiguo primero |
| `registerPayment(draft)`            | `PaymentDraft { playerId, amountCents, method, chargeIds? }` | `Payment` creado (con `receiptNumber`)                                                     |
| `createCharge(draft)`               | `Omit<Charge, 'id'>`                                         | `Charge` (lo usa uniformes, HU-054)                                                        |
| `receipt(paymentId)` / `receipts()` | —                                                            | `ReceiptView` (pago + líneas aplicadas)                                                    |
| `debts()`                           | —                                                            | `DebtView[]` por jugador                                                                   |

- `Charge` (lo que se debe) ≠ `Payment` (dinero recibido). Un pago se reparte en **uno o varios** cargos mediante
  `PaymentApplication { paymentId, chargeId, amountCents }` (pagos parciales incluidos).
- Sin `chargeIds` se aplica a todos los cargos abiertos del jugador; con `chargeIds`, sólo a esos. En ambos casos
  se paga primero el de vencimiento más antiguo.
- **Saldo de un cargo** = `amountCents` − Σ aplicaciones de pagos **no cancelados** (`effectiveApplications` + `chargeBalance`).
- **Pagos cancelados:** `Payment.cancelledAt`. No se borra nada; sus aplicaciones dejan de contar en saldos, adeudos e
  ingresos, y el recibo se muestra como CANCELADO. (No hay UI ni método para cancelar: no es historia de Borrayo.)
- Rechaza: monto ≤ 0 o no entero, monto mayor al saldo abierto (no hay saldo a favor todavía), cargos de otro jugador.

**Frontend:** captura, validación para UX y mostrar el resultado.
**Backend (obligatorio):** repetir todas las validaciones, ejecutar pago + aplicaciones en una transacción, asignar
folio consecutivo único, registrar quién cobró, autorizar cancelaciones y no aceptar montos calculados por el cliente.

**Reglas (`billing.rules.ts`):** todas son funciones puras sin Angular ni I/O y están probadas: mensualidades sin
duplicar (por jugador + concepto + periodo), aplicación de pagos, saldo, adeudos, ingresos y exclusión de pagos cancelados.
Límite conocido: dos conceptos distintos de tipo mensualidad para el mismo periodo generan dos cargos (se asume intencional).

## Portal del tutor

**Protección actual (frontend, sólo UX):**

- `/portal` exige `portal.view`; sólo el rol tutor lo tiene y el tutor no tiene ningún permiso de oficina (probado ruta por ruta).
- No hay IDs en la URL del portal: `PortalService` obtiene los hijos a partir del `tutorId` de la sesión
  (`User.tutorId` → `Tutor.playerIds`). Un usuario tutor sin `tutorId` no ve nada (probado).
- Datos del portal: hijos, torneos (vía `PlayerCategory` → `CoachAssignment` → `Competition`) y uniformes. **No** muestra
  pagos ni avisos (no existen todavía).

**Esto NO es seguridad:** la sesión mock vive en `sessionStorage` y cualquier servicio se puede llamar desde la consola.
**El backend debe:** obtener el tutor del token (nunca de un parámetro), filtrar cada endpoint del portal por los hijos
de ese tutor, responder 403/404 ante IDs ajenos y aplicar los mismos permisos a todos los endpoints de oficina.

## RBAC

- `core/auth/permissions.ts`: `Permission` + `ROLE_PERMISSIONS`. Único lugar donde aparece la relación rol → permiso.
- Rutas: cada ruta hoja tiene `canActivate: [can('<permiso>')]`; el shell exige sesión. Sin sesión → `/login?returnUrl=…`;
  sin permiso → `/forbidden`.
- Menú (`layout/nav.ts`) y Home filtran por `auth.can(permiso)`.
- `app.routes.spec.ts` recorre la configuración real de rutas: si alguien agrega una ruta sin declararla en la tabla de
  seguridad del test, o sin guard, el test falla (se comprobó quitando un guard: 3 pruebas fallaron).
- No quedan comparaciones directas de rol fuera de `permissions.ts` (sólo etiquetas de UI).

## Límites con otros integrantes

| Parte                                                                                                         | Clasificación                        | Nota                                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Modelos en `core/models`                                                                                      | Compartida                           | Borrador para acordar con el equipo                                                                     |
| `PlayerService`, `CategoryService`, `CompetitionService` (`core/services`, sólo lectura)                      | Dependencia necesaria                | Sus altas/ediciones son de otros                                                                        |
| `AuthService`, login, guards, shell, menú                                                                     | Compartida · **dudosa**              | Si el login es historia de otro integrante, puede reemplazar la página y conservar `AuthService`/guards |
| `BillingService.registerPayment` / `openCharges` (sin UI)                                                     | Compartida · **posible duplicación** | La captura de pagos es de otro integrante: debe usar este contrato, no crear otro                       |
| `BillingService.createCharge`                                                                                 | Compartida                           | Para cualquier módulo que genere cargos                                                                 |
| `Tutor.playerIds` (HU-011)                                                                                    | Borrayo · **dudosa**                 | Si el alta de jugador (otro integrante) también captura tutores, acordar que use `TutorService`         |
| `PlayerCategory` (escritura)                                                                                  | De otro integrante                   | Sólo seed hoy                                                                                           |
| Partidos, entrenamientos, sedes, competencias (datos)                                                         | Dependencia necesaria                | Sólo seed para la agenda (HU-068) y el portal (HU-063)                                                  |
| Usuarios, temporadas, tutores, inscripción, entrenadores, asignaciones, cobranza, uniformes, reportes, portal | Borrayo                              | —                                                                                                       |

## Contratos compartidos (estado)

Estables para acordar: `Player`, `Tutor`, `Category`, `PlayerCategory`, `Enrollment`, `Coach`, `CoachAssignment`,
`Competition`, `Season`, `Match`, `TrainingSession`, `Venue`, `ChargeConcept`, `Charge`, `Payment`, `PaymentDraft`,
`PaymentApplication`, `UniformProduct`, `UniformVariant`, `UniformOrder`, `UniformOrderLine`.

Puntos por acordar antes del backend. La fase 3 los resolvió de forma **provisional**; ver
`docs/database/decisions.md` y `docs/database/api-contract.md`:

- IDs → UUID. Fechas → `date` local vs. `timestamptz`, con `business_date()` en hora de México.
- Montos → `integer` en centavos, igual que el frontend.
- `Tutor.playerIds` → tabla `tutor_players` con parentesco y tutor principal.
- `Player` es mínimo a propósito: su dueño debe completarlo.

## MockDb

Verificado en fase 2: `core/data/mock-db.ts` es el único origen de datos simulados. Ningún componente inyecta
`MockDb` ni contiene datos. Los únicos mapas en componentes son etiquetas de UI (`ROLE_LABELS`, tipos de concepto,
métodos de pago). Los IDs del seed son consistentes (`u*`, `p*`, `t*`, `c*`, `s1`, `cat*`, `e*`, `pc*`, …).

## Validación en navegador (fase 2)

- Extensión de Chrome para agentes: **BLOCKED** (no conectada).
- Alternativa usada: Chrome headless local controlado por DevTools Protocol (script temporal, no está en el repo).
  Se revisaron 79 cargas de página: 26 rutas × escritorio 1280, tableta 820 y móvil 390, más el menú móvil abierto.
  Roles: secretaría, admin, coach y tutor, incluidas las URLs denegadas → `/forbidden`. Resultado: 0 errores de JS,
  0 desbordamiento horizontal de página, 0 errores de carga.
- Interacciones probadas: errores de validación (login y usuarios), error de servicio (correo duplicado), mensaje de
  éxito (recuperar contraseña) y recibo en modo impresión (sin menú).
- Corregido tras revisar capturas: en móvil el menú venía abierto por defecto; en páginas cortas quedaba un hueco
  enorme bajo el menú; `display:flex` en `<td>` rompía la celda; la caja de login no tenía margen lateral.
- Límites: las tablas anchas se desplazan horizontalmente dentro de su contenedor (la columna de acciones de
  usuarios requiere desplazar en móvil). `confirm()`/`prompt()` nativos no se probaron visualmente. No hay modales propios.

## Estado de historias de Borrayo

| HU                       | Estado                                                                                  | Dónde                             |
| ------------------------ | --------------------------------------------------------------------------------------- | --------------------------------- |
| 004 Usuarios             | Implementada (mock). Pendiente: vincular `tutorId`/`coachId` al crear                   | `features/users`                  |
| 005 Contraseñas          | UI implementada; envío real → backend                                                   | `features/auth/password.pages.ts` |
| 072 Seguridad            | Preparada: guards + permisos; hashing/tokens → backend                                  | `core/auth`                       |
| 011 Tutores              | Implementada (alta; edición pendiente)                                                  | `features/tutors`                 |
| 018 Grupos               | Implementada (lee `PlayerCategory`)                                                     | `features/categories`             |
| 020 Inscripción          | Implementada (alta por temporada; cancelación pendiente)                                | `features/enrollments`            |
| 022 Entrenadores         | Implementada (alta)                                                                     | `features/coaches`                |
| 026 Asignación a torneos | Implementada                                                                            | `features/coaches`                |
| 043 Conceptos            | Implementada                                                                            | `features/billing`                |
| 044 Mensualidades        | Implementada (idempotente)                                                              | `features/billing`                |
| 048 Recibos              | Implementada (consulta + imprimir, muestra cancelados)                                  | `features/billing`                |
| 050 Adeudos              | Implementada                                                                            | `features/billing`                |
| 052 Catálogo             | Implementada (alta)                                                                     | `features/uniforms`               |
| 053 Pedidos              | Implementada                                                                            | `features/uniforms`               |
| 054 Pago uniforme        | Implementada: el pedido crea un `Charge`                                                | `features/uniforms`               |
| 055 Entrega              | Implementada                                                                            | `features/uniforms`               |
| 056 Consulta tutor       | Implementada                                                                            | `features/parent-portal`          |
| 063 Torneos (tutor)      | Implementada                                                                            | `features/parent-portal`          |
| 067 Reporte ingresos     | Implementada (excluye pagos cancelados)                                                 | `features/reports`                |
| 068 Agenda global        | Implementada (filtros tipo/categoría)                                                   | `features/reports`                |
| 070 Temporadas           | Implementada                                                                            | `features/seasons`                |
| 074 Pruebas              | 32 pruebas: RBAC por ruta y rol, reglas de cobro, flujos de servicio, render de páginas | `*.spec.ts`                       |

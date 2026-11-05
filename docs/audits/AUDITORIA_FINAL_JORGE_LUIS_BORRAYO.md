# Auditoría independiente de cierre — HU de Jorge Luis Borrayo De Anda

| Dato              | Valor                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Fecha             | 2026-11-01                                                                                                                 |
| Commit auditado   | `b7cc137227756cb3d575401d523529a2f5e3a2c2` (`origin/main`: merge de la PR #23)                                             |
| Entorno           | Worktree aislado (detached) `charales-wt/auditoria-final`; MariaDB local con bases temporales `ef_*`, borradas al terminar |
| Alcance           | Las HU con «Responsable = Jorge Luis Borrayo De Anda» en `docs/requirements/USER_STORIES.md` y en el Excel oficial         |
| Cambios al código | Ninguno. El único archivo nuevo es este informe                                                                            |

## 1. Resumen ejecutivo

- **Alcance confirmado:** son **49 HU**, y la lista del repositorio coincide exactamente con la del Excel oficial (`Product_Backlog_Escuela_Futbol_Infantil.xlsx`, 2026-10-29).
- **HU-005 no es de este responsable.** Su rol es «Todos» y no tiene responsable asignado. Se revisó sólo como parte de la seguridad (§ 4.C).
- **Funcionalidad:** 48 de las 49 HU cumplen sus criterios oficiales con evidencia ejecutada hoy (pruebas de pantalla, API y E2E, más sondeos sobre la API real).
  - **HU-021 queda PARCIAL:** su criterio 4 depende de una decisión de producto pendiente.
  - Tres HU (HU-004, 012 y 022) sólo funcionan completas en desarrollo, porque no hay proveedor de correo para las invitaciones.
- **Estado formal:** el Excel oficial mantiene las 49 HU en «Pendiente». `TRACEABILITY.md` y `ROADMAP.md` dicen que se «cerraron», pero no hay evidencia de que el equipo haya registrado ese cierre.
- **Hallazgos del informe preliminar:**
  - B-2 sigue vigente (BAJA): la PR #17 está abierta y no integrada.
  - La carrera del login de HU-001 está **confirmada empíricamente**: 25 intentos simultáneos fueron evaluados con un límite de 5.
  - HU-045 está integrada y correcta, pero su criterio 5 **no está ratificado**.
  - HU-021 sigue sin decisión.
- **Pruebas de hoy:** pasan typecheck, build, Prettier, pantalla (247/247), API (198/198), respaldo y restauración, y Postman.
  - **La E2E falla 1 de 19:** la prueba del Tablero depende de la fecha y falla el día 1 de cada mes. El producto es correcto; la prueba no.
  - `npm audit` reporta 2 vulnerabilidades altas en dependencias de producción, ambas con corrección disponible.
- **Dictamen:** las HU pueden cerrarse formalmente con las condiciones de la § 12. **Charales no está listo para producción** hasta atender S-01, S-02, S-04 y las dependencias P-01 a P-04.

## 2. Las 49 historias

`HU-001 HU-004 HU-006 HU-007 HU-008 HU-009 HU-010 HU-011 HU-012 HU-013 HU-014 HU-015 HU-016 HU-017 HU-018 HU-019 HU-020 HU-021 HU-022 HU-023 HU-026 HU-028 HU-032 HU-034 HU-035 HU-036 HU-037 HU-040 HU-043 HU-044 HU-045 HU-046 HU-048 HU-049 HU-050 HU-051 HU-052 HU-053 HU-054 HU-055 HU-057 HU-058 HU-065 HU-066 HU-067 HU-068 HU-069 HU-070 HU-076`

- 43 son de «Administrador / Secretaría» y 6 de «Administrador».
- El repositorio tiene 76 HU en total; las 27 restantes no tienen responsable.
- La lista se verificó con un script sobre la tabla de `USER_STORIES.md` y con `openpyxl` sobre el Excel; las dos coinciden en los 49 identificadores.

## 3. Matriz HU → criterios → código → pruebas → estado

**Cómo se determinó el estado:**

- «COMPLETA» exige cuatro cosas:
  - implementación en Angular, en el servicio de dominio y en MariaDB, a través del puente RPC;
  - autorización en el servidor;
  - pruebas que citan la HU y **pasaron hoy** sobre `b7cc137`;
  - ningún defecto que contradiga un criterio oficial.
- La columna de pruebas cuenta los títulos de prueba que citan la HU (API / pantalla / E2E). También se cuentan los casos de las tablas de datos de `api/hu-fase*.test.ts` y `api/hu-criterios.test.ts`, que no siempre llevan la HU en el título; por eso hay HU con 0 títulos que sí tienen casos (por ejemplo HU-023, HU-036 y HU-055 en `hu-fase2/3/4`).
- Tras «·» se listan los criterios citados explícitamente (`HU-0XX.n`).

**Límites de esta verificación:**

- No se repitió a mano la verificación criterio por criterio de las 196 aceptaciones.
- Se revisaron a fondo HU-001, HU-021, HU-032, HU-045, HU-065 y HU-076. Además se sondeó en la API real el aislamiento de tutores y entrenadores, que afecta a HU-018, HU-026 y HU-050.
- El resto se apoya en las pruebas automatizadas que pasaron hoy.

| HU     | Prio.  | Criterios oficiales (resumen)                                                                                                                         | Código principal                                                                | Pruebas (API / unit / E2E · criterios citados)                                     | Estado                    | Observación                                                                                                                          |
| ------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| HU-001 | Must   | 1) Credenciales válidas permiten acceso. 2) Credenciales inválidas muestran mensaje sin revelar datos sensibles. 3) Se registra fecha/hora del acce…  | `api/auth.ts`, `api-auth.service.ts`, `auth.service.ts`                         | 0 (+8 de login y sesión en `api.test.ts`) / 2 / 0 (+5 E2E de login por rol) · 1, 3 | COMPLETA*                 | Criterios 1–4 cumplidos; el límite de intentos del login es evadible por concurrencia (S-01). Corregir antes del cierre formal.      |
| HU-004 | Must   | 1) Alta con datos mínimos. 2) Asignación de rol. 3) Usuario desactivado no puede iniciar sesión. 4) No se elimina físicamente un usuario con histor…  | `auth.service.ts`, `rpc.ts`, `system.pages.ts`                                  | 4 / 2 / 1 · 3                                                                      | COMPLETA (desarrollo)     | El alta envía una invitación: sin proveedor de correo responde 503 y no crea la cuenta (P-02).                                       |
| HU-006 | Should | 1) Existen permisos consultar/crear/editar/cancelar por módulo. 2) Cambios afectan nuevas sesiones. 3) Roles base no quedan sin acceso accidentalme…  | `auth.ts`, `home.ts`, `permissions.ts`                                          | 2 / 2 / 0 · 2                                                                      | COMPLETA                  |                                                                                                                                      |
| HU-007 | Should | 1) Registra usuario, acción, fecha/hora y entidad afectada. 2) Permite filtrar por usuario, fecha y módulo. 3) No permite edición desde interfaz. 4…  | `audit.service.ts`, `security.ts`, `system.pages.ts`                            | 2 / 1 / 0 · 1                                                                      | COMPLETA                  |                                                                                                                                      |
| HU-008 | Must   | 1) Captura nombre, fecha nacimiento, sexo opcional, contacto y estatus. 2) Calcula edad. 3) Evita duplicados evidentes. 4) Genera identificador int…  | `people.ts`, `player.service.ts`, `players.pages.ts`                            | 3 / 0 / 1                                                                          | COMPLETA                  |                                                                                                                                      |
| HU-009 | Must   | 1) Permite editar campos autorizados. 2) Conserva ID. 3) Registra fecha de modificación. 4) Valida campos obligatorios.                               | `player.service.ts`, `players.pages.ts`                                         | 1 / 1 / 0                                                                          | COMPLETA                  |                                                                                                                                      |
| HU-010 | Must   | 1) Cambio de estatus requiere confirmación. 2) Baja no borra historial. 3) Jugador inactivo no se inscribe a nuevos torneos/categorías. 4) Se conse…  | `player.service.ts`, `players.pages.ts`                                         | 4 / 1 / 1 · 3, 4                                                                   | COMPLETA                  |                                                                                                                                      |
| HU-011 | Must   | 1) Un jugador admite varios tutores. 2) Un tutor puede estar ligado a varios hijos. 3) Se define contacto principal. 4) Se valida teléfono/correo s…  | `players.pages.ts`, `tutor.service.ts`, `tutors.page.ts`                        | 2 / 5 / 0                                                                          | COMPLETA                  |                                                                                                                                      |
| HU-012 | Must   | 1) Solo tutores registrados pueden vincularse. 2) Una cuenta no duplica al tutor. 3) Se envía/entrega acceso inicial. 4) Tutor ve solo sus hijos.     | `auth.service.ts`, `mock-db.ts`, `tutor.service.ts`                             | 1 / 0 / 0                                                                          | COMPLETA (desarrollo)     | La invitación al tutor depende del correo (P-02).                                                                                    |
| HU-013 | Should | 1) Muestra datos generales. 2) Muestra categorías vigentes e históricas. 3) Resume pagos y adeudos. 4) Muestra uniformes y torneos asociados.         | `player.service.ts`, `players.pages.ts`                                         | 2 / 0 / 0                                                                          | COMPLETA                  |                                                                                                                                      |
| HU-014 | Should | 1) Búsqueda parcial por nombre. 2) Filtros combinables. 3) Resultados paginados. 4) Acceso al expediente desde resultado.                             | `page.ts`, `player.service.ts`, `players.pages.ts`                              | 1 / 3 / 0 · 4                                                                      | COMPLETA                  |                                                                                                                                      |
| HU-015 | Must   | 1) Nombre único por temporada si aplica. 2) Rango mínimo/máximo válido. 3) Estatus activa/inactiva. 4) No permite edades invertidas.                  | `categories.pages.ts`, `category.service.ts`                                    | 2 / 1 / 0 · 2                                                                      | COMPLETA                  |                                                                                                                                      |
| HU-016 | Must   | 1) Define día, hora inicio/fin y sede/cancha. 2) Evita fin anterior a inicio. 3) Permite varios horarios por categoría. 4) Puede desactivar horarios. | `categories.pages.ts`, `schedule.service.ts`, `sports.ts`                       | 1 / 1 / 0                                                                          | COMPLETA                  |                                                                                                                                      |
| HU-017 | Must   | 1) Solo jugadores activos. 2) Valida edad contra categoría y permite excepción autorizada. 3) Evita inscripción duplicada vigente. 4) Guarda fecha …  | `enrollments.page.ts`, `player-category.service.ts`, `players.pages.ts`         | 1 / 1 / 0                                                                          | COMPLETA                  |                                                                                                                                      |
| HU-018 | Must   | 1) Lista jugadores activos. 2) Muestra edad y tutor principal. 3) Permite filtros. 4) Indica total de integrantes.                                    | `categories.pages.ts`, `category.service.ts`                                    | 2 / 1 / 0 · 1                                                                      | COMPLETA                  |                                                                                                                                      |
| HU-019 | Should | 1) Cierra inscripción anterior. 2) Crea nueva inscripción. 3) No elimina historial. 4) Registra motivo y fecha.                                       | `player-category.service.ts`, `sports.ts`                                       | 1 / 1 / 0 · 4                                                                      | COMPLETA                  |                                                                                                                                      |
| HU-020 | Must   | 1) Guarda ciclo/temporada, fecha, monto y estatus. 2) Puede vincular pago. 3) Evita duplicar inscripción del mismo ciclo. 4) Distingue inscripción …  | `billing.service.ts`, `enrollment.service.ts`, `enrollments.page.ts`            | 1 / 1 / 0                                                                          | COMPLETA                  |                                                                                                                                      |
| HU-021 | Could  | 1) Cupo es configurable. 2) Sistema avisa al llegar al límite. 3) No bloquea excepciones autorizadas si se decide así. 4) Muestra ocupación actual.   | `categories.pages.ts`, `category.service.ts`, `player-category.service.ts`      | 1 / 0 / 0 · 3, 4                                                                   | PARCIAL                   | Criterio 4 sujeto a una decisión de producto: ¿un jugador en baja temporal ocupa cupo? Hoy sí (DP-02). El criterio 3 es condicional. |
| HU-022 | Must   | 1) Alta con nombre y contacto. 2) Estatus activo/inactivo. 3) Puede vincular cuenta de usuario. 4) Evita duplicados evidentes.                        | `auth.service.ts`, `coach.service.ts`, `coaches.pages.ts`                       | 2 / 1 / 0 · 2, 3                                                                   | COMPLETA (desarrollo)     | La invitación al entrenador depende del correo (P-02).                                                                               |
| HU-023 | Must   | 1) Permite varios entrenadores por categoría. 2) Guarda rol/responsabilidad opcional. 3) Maneja vigencia. 4) No duplica asignación activa.            | `coach.service.ts`, `coaches.pages.ts`, `sports.ts`                             | 0 / 0 / 0 · 1, 2                                                                   | COMPLETA                  |                                                                                                                                      |
| HU-026 | Must   | 1) Asocia entrenador + torneo/liga + categoría. 2) Solo usa asignaciones vigentes. 3) Permite varios entrenadores. 4) Evita duplicados exactos.       | `authorization.service.ts`, `coach.service.ts`, `coaches.pages.ts`              | 2 / 1 / 0                                                                          | COMPLETA                  |                                                                                                                                      |
| HU-028 | Must   | 1) Selecciona categoría, fecha, horario, sede y entrenador. 2) Puede originarse desde horario recurrente. 3) No permite fecha inválida. 4) Estado p…  | `sports.ts`, `training.service.ts`, `trainings.pages.ts`                        | 2 / 1 / 0 · 4                                                                      | COMPLETA                  |                                                                                                                                      |
| HU-032 | Should | 1) Filtra por fechas/categoría/jugador. 2) Calcula porcentaje de asistencia. 3) Distingue justificadas. 4) Permite exportar listado si se implement…  | `attendance.service.ts`, `trainings.pages.ts`                                   | 2 / 1 / 0                                                                          | COMPLETA (C4 condicional) | Exportación no implementada; el criterio dice «si se implementa exportación».                                                        |
| HU-034 | Must   | 1) Nombre, tipo torneo/liga, temporada, organizador y estatus. 2) Fechas inicio/fin válidas. 3) Puede adjuntar datos de contacto/observaciones. 4) …  | `competition.service.ts`, `competitions.pages.ts`                               | 2 / 1 / 0 · 4                                                                      | COMPLETA                  |                                                                                                                                      |
| HU-035 | Must   | 1) Asocia competencia y categoría. 2) Guarda fecha de inscripción. 3) Evita duplicados activos. 4) Puede registrar costo/estatus de inscripción si …  | `competition.service.ts`, `competitions.pages.ts`, `sports.ts`                  | 2 / 0 / 0 · 4                                                                      | COMPLETA                  |                                                                                                                                      |
| HU-036 | Must   | 1) Solo jugadores de la categoría seleccionada. 2) Guarda alta/baja del plantel. 3) Evita jugador duplicado. 4) Conserva historial.                   | `competition.service.ts`, `competitions.pages.ts`, `player-category.service.ts` | 0 / 0 / 0 · 1, 2                                                                   | COMPLETA                  |                                                                                                                                      |
| HU-037 | Must   | 1) Selecciona competencia y categoría inscrita. 2) Registra rival, fecha, hora y sede. 3) Estado programado/jugado/cancelado/reprogramado. 4) Valid…  | `match.service.ts`, `matches.page.ts`                                           | 2 / 0 / 0 · 1, 4                                                                   | COMPLETA                  |                                                                                                                                      |
| HU-040 | Should | 1) Solo partidos jugados o finalizados. 2) Captura goles a favor/en contra. 3) Guarda observaciones opcionales. 4) No admite valores negativos.       | `match.service.ts`, `matches.page.ts`                                           | 2 / 1 / 0 · 1                                                                      | COMPLETA                  |                                                                                                                                      |
| HU-043 | Must   | 1) Concepto con nombre, importe sugerido y estatus. 2) Puede marcar si es recurrente. 3) No elimina conceptos usados. 4) Permite modificar importe …  | `billing.pages.ts`, `billing.service.ts`                                        | 1 / 1 / 0 · 3                                                                      | COMPLETA                  |                                                                                                                                      |
| HU-044 | Must   | 1) Periodo mensual único por jugador/concepto. 2) Guarda monto esperado y vencimiento. 3) Estados pendiente/parcial/pagado/vencido. 4) Puede exclui…  | `billing.pages.ts`, `billing.rules.ts`, `billing.service.ts`                    | 2 / 2 / 0 · 3                                                                      | COMPLETA                  |                                                                                                                                      |
| HU-045 | Must   | 1) Captura jugador/tutor, concepto, fecha, importe y forma de pago. 2) Permite pago total o parcial. 3) Saldo se recalcula. 4) Genera folio.          | `billing.service.ts`, `billing.ts`, `mock-db.ts`                                | 7 / 7 / 2 · 2                                                                      | COMPLETA (criterios 1–4)  | El criterio 5 propuesto (referencia) está implementado y probado, pero no ratificado (DP-01).                                        |
| HU-046 | Must   | 1) Lista cargos y pagos por periodo. 2) Calcula saldo pendiente. 3) Distingue vencidos. 4) Filtros por fechas/concepto.                               | `billing.service.ts`, `payments.pages.ts`                                       | 2 / 1 / 0 · 1                                                                      | COMPLETA                  |                                                                                                                                      |
| HU-048 | Should | 1) Comprobante incluye folio, fecha, jugador, concepto, monto y forma de pago. 2) Recuperable por folio. 3) No altera pago. 4) Marca si pago fue ca…  | `billing.service.ts`, `payments.pages.ts`                                       | 2 / 0 / 0 · 1, 4                                                                   | COMPLETA                  |                                                                                                                                      |
| HU-049 | Should | 1) Solo rol autorizado. 2) Requiere motivo. 3) Revierte aplicación/saldo. 4) Conserva pago con estado cancelado y auditoría.                          | `billing.service.ts`, `billing.ts`, `enrollment.service.ts`                     | 1 / 2 / 0                                                                          | COMPLETA                  |                                                                                                                                      |
| HU-050 | Should | 1) Filtra por periodo/categoría. 2) Muestra tutor principal y contacto. 3) Calcula saldo vencido. 4) No incluye cargos cancelados.                    | `billing.rules.ts`, `billing.service.ts`, `payments.pages.ts`                   | 2 / 1 / 0 · 1                                                                      | COMPLETA                  |                                                                                                                                      |
| HU-051 | Could  | 1) Registra tipo y motivo. 2) Conserva monto original y monto final. 3) Solo usuarios autorizados. 4) Aplica por cargo o periodo según diseño.        | `billing.pages.ts`, `billing.service.ts`, `billing.ts`                          | 1 / 2 / 0                                                                          | COMPLETA                  |                                                                                                                                      |
| HU-052 | Must   | 1) Producto con nombre, talla/opciones, precio y estatus. 2) Puede existir mismo producto en varias tallas. 3) No borra productos usados. 4) Precio…  | `uniform.service.ts`, `uniforms.pages.ts`                                       | 1 / 0 / 0 · 4                                                                      | COMPLETA                  |                                                                                                                                      |
| HU-053 | Must   | 1) Selecciona jugador, producto, talla y cantidad. 2) Estado solicitado/pagado/entregado/cancelado. 3) Guarda precio al momento. 4) Fecha de solici…  | `uniform.service.ts`, `uniforms.pages.ts`                                       | 2 / 1 / 0 · 3, 4                                                                   | COMPLETA                  |                                                                                                                                      |
| HU-054 | Should | 1) Genera/vincula cargo de uniforme. 2) Estado pagado se deriva del saldo. 3) Cancelación respeta trazabilidad. 4) Importe coincide con pedido.       | `billing.service.ts`, `uniform.service.ts`, `uniforms.pages.ts`                 | 1 / 1 / 0 · 1, 2, 3                                                                | COMPLETA                  |                                                                                                                                      |
| HU-055 | Should | 1) Solo pedidos no cancelados. 2) Guarda fecha de entrega. 3) Puede registrar quién recibió. 4) Cambia estado a entregado.                            | `uniform.service.ts`, `uniforms.pages.ts`                                       | 0 / 0 / 0                                                                          | COMPLETA                  |                                                                                                                                      |
| HU-057 | Must   | 1) Título, mensaje, fecha publicación y vigencia. 2) Puede dirigir a todos o a audiencias seleccionadas. 3) Permite despublicar. 4) Se ordenan por …  | `notice.service.ts`, `notices.page.ts`                                          | 1 / 1 / 0                                                                          | COMPLETA                  |                                                                                                                                      |
| HU-058 | Should | 1) Selecciona categorías. 2) Solo lo ven tutores/entrenadores relacionados. 3) Un aviso puede tener varias categorías. 4) Conserva vigencia.          | `notice.service.ts`, `notices.page.ts`                                          | 2 / 0 / 0 · 4                                                                      | COMPLETA                  |                                                                                                                                      |
| HU-065 | Should | 1) KPIs básicos. 2) Datos actualizados desde BD. 3) Filtros por periodo cuando aplique. 4) Enlaces a módulos relacionados.                            | `report.service.ts`, `reports.pages.ts`                                         | 3 / 2 / 0 · 3                                                                      | COMPLETA*                 | Producto correcto; la E2E del Tablero falla el día 1 de cada mes (D-01).                                                             |
| HU-066 | Should | 1) Filtros categoría/estatus. 2) Incluye tutor principal y contacto. 3) Total por categoría. 4) Vista imprimible/exportable si se implementa.         | `report.service.ts`, `reports.pages.ts`                                         | 1 / 0 / 0                                                                          | COMPLETA                  |                                                                                                                                      |
| HU-067 | Should | 1) Filtra fechas. 2) Agrupa por concepto. 3) Excluye pagos cancelados. 4) Total general.                                                              | `billing.rules.ts`, `report.service.ts`, `reports.pages.ts`                     | 2 / 1 / 0 · 2, 3                                                                   | COMPLETA                  |                                                                                                                                      |
| HU-068 | Should | 1) Vista calendario. 2) Diferencia entrenamiento/partido. 3) Filtra categoría/entrenador. 4) Muestra sede y horario.                                  | `dates.ts`, `report.service.ts`, `reports.pages.ts`                             | 1 / 2 / 0 · 3                                                                      | COMPLETA                  |                                                                                                                                      |
| HU-069 | Should | 1) Alta/edición/estatus. 2) Nombre y ubicación/referencia. 3) No elimina sedes con historial. 4) Se reutiliza en horarios y partidos.                 | `venue.service.ts`, `venues.page.ts`                                            | 2 / 0 / 0 · 3                                                                      | COMPLETA                  |                                                                                                                                      |
| HU-070 | Could  | 1) Nombre, inicio, fin, estatus. 2) Una temporada puede marcarse actual. 3) Categorías/competencias/inscripciones pueden vincularse. 4) Historial p…  | `season.service.ts`, `seasons.page.ts`                                          | 1 / 1 / 0                                                                          | COMPLETA                  |                                                                                                                                      |
| HU-076 | Should | 1) Procedimiento documentado. 2) Genera respaldo recuperable. 3) Se realiza prueba de restauración en ambiente de prueba. 4) Define periodicidad su…  | `db/mariadb/scripts/*.sh`                                                       | 0 / 0 / 0                                                                          | COMPLETA                  | Respaldo y restauración ejecutados hoy: 40 tablas idénticas. Periodicidad en MARIADB.md § 6.                                         |

`*` = criterios cumplidos, con un defecto ajeno a los criterios que debe atenderse (ver la columna Observación).

**Resumen:** 41 COMPLETA · 3 COMPLETA sólo en desarrollo · 1 COMPLETA con criterio condicional no implementado · 1 COMPLETA en criterios 1–4 con un criterio propuesto sin ratificar · 2 COMPLETA* · **1 PARCIAL (HU-021)** · 0 PENDIENTE · 0 NO VERIFICADA.

## 4. Contraste con el informe preliminar

### A. B-2 — Filtración de la existencia de sesiones → **CONFIRMADO, vigente (BAJA)**

**PR #17:**

- Sigue **abierta** (rama `jorgesucre/fix-b2-autorizacion-sesiones`, commit `44ce218`, última actualización 2026-10-16).
- **No está en `main`:** `git merge-base --is-ancestor 44ce218 origin/main` → falso.
- Se fusionaría sin conflictos de texto, pero su prueba quedó desfasada: espera `/^Sesión no encontrad[oa]\.$/` y `/^Jugador no encontrad[oa]\.$/`, mientras que `main` responde «Sesión inexistente: actualiza la página e inténtalo de nuevo.» (`notFoundMessage`, PR #22). **Al integrarla, su prueba de control fallaría.**

**Código actual:** en los tres métodos se consulta el registro antes de autorizar.

- `src/app/features/trainings/training.service.ts:106-107` (`get`) y `:255-258` (`saveNotes`).
- `src/app/features/trainings/attendance.service.ts:68-70` (`record`).
- `db.get()` lanza un 400 «inexistente» antes de que el chequeo de alcance lance el 403.

**Evidencia reproducible** (API sobre la base temporal `ef_audprobe`; sesión 2 de otra entrenadora, sesión 999 inexistente):

| Usuario    | Operación                   | Sesión existente ajena | Sesión inexistente        |
| ---------- | --------------------------- | ---------------------- | ------------------------- |
| tutor      | `TrainingService.get`       | 403                    | 400 «Sesión inexistente…» |
| tutor      | `TrainingService.saveNotes` | 403                    | 400                       |
| tutor      | `AttendanceService.record`  | 403                    | 400                       |
| entrenador | las tres                    | 403                    | 400                       |

**Pruebas:**

- `api/authorization-order.test.ts` **no existe en `main`**: sólo está en la PR #17, que sí cubre los tres métodos para tutor y entrenador, más un control con administrador.
- En `main` no hay ninguna prueba de regresión de B-2.

**Mismo patrón en otros servicios:**

- Barrido de los 126 métodos de `RPC_METHODS` como tutor y como entrenador, con id 1: ningún 500. Los únicos 200 son de su propio alcance:
  - tutor: `PortalService.*` y `BillingService.statement`;
  - entrenador: `CoachPanelService.*`, `CategoryService.get/members` de su categoría y `TrainingService.get` de su sesión.
- `assertPlayer`, `assertCategory` y `PortalService.assertChild` autorizan **antes** de consultar. Un id inexistente recibe el mismo 403 que uno ajeno: se comprobó con `statement`, `child` y `CategoryService.get` para los ids 3, 4, 5 y 999.
- Los métodos de oficina (`receipt`, `PlayerService.get`, `TutorService.get`) exigen primero el permiso (`authz.require`).
- **El patrón se limita a los tres métodos de B-2.**

**Impacto:** permite saber si existe una sesión de entrenamiento. Los ids son secuenciales y el dato es de baja sensibilidad, así que la probabilidad es alta y el impacto bajo.

**Recomendación:** integrar la PR #17 después de actualizar sus expresiones regulares a `notFoundMessage(...)`.

**¿Bloquea?** No bloquea el cierre de ninguna HU de Borrayo, porque los métodos afectados son de HU-029, 030 y 031, de entrenador. No bloquea producción por sí solo, pero debe corregirse.

### B. HU-001 — Carrera en el límite de intentos del login → **CONFIRMADO (S-01, ALTA para producción)**

**Código (`api/auth.ts`):**

- `:97` la clave del límite es `${ctx.ip}|${email}`;
- `:98` se comprueba `recentFailures(key).length >= 5`;
- `:105` se espera a Argon2id;
- `:108` sólo después se registra el fallo (`push`).
- Entre la comprobación y el registro hay un `await`: cualquier número de solicitudes simultáneas pasa la comprobación.

**Evidencia empírica:**

- 25 solicitudes simultáneas con contraseña incorrecta para `marta@example.com` desde una IP → **25 respuestas 401, ninguna 429**: se evaluaron 25 contraseñas con un límite de 5.
- La solicitud siguiente, ya con la contraseña correcta, recibe 429. El bloqueo sólo empieza a contar después de la ráfaga.

**Otros aspectos:**

| Aspecto                  | Hallazgo                                                                                                                                                                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alcance de la clave      | IP + correo. Desde varias IP se multiplican los intentos sobre una misma cuenta: no hay un límite global por cuenta. Detrás de un proxy inverso, `req.socket.remoteAddress` (`api/server.ts:85`) es la IP del proxy, así que cualquiera podría bloquear 15 min la cuenta de otro usuario (DoS de bloqueo) |
| Almacenamiento           | `Map` en memoria (`api/auth.ts:61`): se pierde al reiniciar y no se comparte entre instancias. El propio código lo reconoce (comentario `ponytail:`)                                                                                                                                                      |
| Protección externa       | No hay configuración de proxy, WAF ni rate limit en el repositorio. No es verificable: es configuración externa                                                                                                                                                                                           |
| Pruebas                  | `api.test.ts` «5 wrong passwords… → 429» es secuencial. **No hay prueba concurrente del login**; sí la hay para el cambio de contraseña («C1: ten simultaneous wrong current passwords…»)                                                                                                                 |
| Agotamiento por Argon2id | Ver S-02                                                                                                                                                                                                                                                                                                  |

**Contraste:** el cambio de contraseña (`api/password.ts:78-90`) ya resuelve este mismo problema reservando el intento de forma síncrona, antes del `await` (C1). El login no aplica el mismo patrón.

**Solución recomendada (no implementada):**

1. Reservar el intento antes de `verifyPassword` y devolverlo si la contraseña es correcta, igual que C1.
2. Agregar un límite por cuenta, independiente de la IP, con retroceso progresivo, y otro por IP.
3. Si habrá varias instancias, llevar el contador a MariaDB o a un almacén compartido.
4. Detrás de un proxy, tomar la IP de `X-Forwarded-For` sólo desde un proxy de confianza.
5. Agregar una prueba concurrente equivalente a C1.

**¿Bloquea?** Los criterios 1–4 de HU-001 se cumplen, así que el cierre funcional no depende de esto, aunque conviene corregirlo antes del cierre formal. **Sí bloquea producción.**

### C. HU-005 — Cambio y recuperación de contraseña → **protecciones suficientes en código; dependencias de producción**

HU-005 **no pertenece** a las 49 de Borrayo: su rol es «Todos» y no tiene responsable. El comentario de `api/password.ts:2` («owner: Borrayo») es la asignación histórica.

| Control                              | Estado                  | Evidencia                                                                                                                                                                                                                       |
| ------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Límite de intentos (cambio)          | ✔                       | 5 por usuario y 15 min, reservado antes de Argon2id (C1). Prueba «C1: ten simultaneous…»                                                                                                                                        |
| Concurrencia (cambio y recuperación) | ✔                       | `FOR UPDATE` siempre en el mismo orden (usuarios → tokens → sesiones). Pruebas R1, R2 y «two simultaneous confirmations»                                                                                                        |
| Invalidación de sesiones             | ✔                       | El cambio cierra las demás sesiones (D2); la recuperación las cierra todas y limpia la cookie (D8)                                                                                                                              |
| Tokens                               | ✔                       | 32 bytes aleatorios; se guarda sólo su SHA-256; 60 min; uso único; una nueva solicitud revoca las anteriores (D3)                                                                                                               |
| Enumeración                          | ✔ funcional / ⚠ tiempos | Siempre responde 204. Pero una cuenta existente ejecuta una transacción y un envío de correo y una inexistente no: puede haber una diferencia de tiempo medible. **No se midió**; riesgo bajo (S-06)                            |
| Límite de la solicitud               | ✔                       | 5 por IP + correo, reservado de forma síncrona                                                                                                                                                                                  |
| Confirmación                         | ⚠                       | Sin límite. El token tiene 256 bits, así que adivinarlo no es viable, pero `confirmPasswordReset` calcula Argon2id (`api/password.ts:214`) **antes** de validar el token: es una vía anónima de consumo de CPU y memoria (S-02) |
| Transporte de correo                 | ⚠ producción            | Sólo existe la consola de desarrollo (`MAIL_CONSOLE=true` y nunca con `NODE_ENV=production`). En producción la recuperación responde 503 (P-02)                                                                                 |
| Tokens en registros                  | ✔ producción / dev      | Sólo el transporte de consola de desarrollo imprime el enlace con el token, y es intencional. Los errores no registran parámetros (`logParam: false`, prueba D4d)                                                               |
| Desarrollo frente a producción       | ✔                       | La cookie es `Secure` con `NODE_ENV=production` o `COOKIE_SECURE=true`; la consola de correo se desactiva en producción                                                                                                         |

**Dictamen:** las protecciones de HU-005 son suficientes en el código. Lo pendiente es de infraestructura (proveedor de correo) y de recursos (S-02).

### D. HU-045 — Referencia del pago → **integrada y correcta; criterio no ratificado**

- **Integración:** la PR #23 está fusionada en `main` (`b7cc137`, 2026-11-01T18:59Z) y contiene `d853629`.
- **Validación en la API** (sondeo sobre `ef_audprobe`):
  - transferencia sin referencia → 400 «Falta la referencia del comprobante…»;
  - tarjeta con `"   "` → 400;
  - 101 caracteres → 400 «…admite como máximo 100 caracteres.»;
  - efectivo sin referencia → 200, `referencia = NULL`;
  - transferencia con `"  SPEI-AUD-1  "` → 200, se guarda `SPEI-AUD-1`.
- **Recibo:** `api/hu-045.test.ts` verifica que la referencia vuelve en `BillingService.receipt`, y la E2E «a transfer needs its reference…» que aparece en la pantalla del recibo. Las dos pasaron hoy.
- **Migración 004:** `ADD COLUMN IF NOT EXISTS`, sin `CHECK`.
  - Repetir `npm run db:setup` sobre una base ya migrada no cambia los checksums de `pagos`, `pago_aplicacion` ni `cargos`.
  - La prueba «migration 004 on a database that already has payments» comprueba que conserva las filas, deja `NULL` y es idempotente.
- **Pruebas:** de API (`hu-045.test.ts`, 6 casos), de pantalla (`billing.pages.spec.ts`) y E2E (2 casos de HU-045). Todas pasaron hoy.
- **Ratificación: no existe.** El Excel oficial conserva los criterios 1–4 de HU-045 y «Estado = Pendiente». En el repositorio la regla figura como «Pendiente de ratificación» (`USER_STORIES.md`, R22 en `DOMAIN_RULES.md`). **No es un requisito oficial.**

### E. HU-021 — Cupo y baja temporal → **decisión pendiente; no está resuelta**

- `CategoryService.occupancy()` (`src/app/core/services/category.service.ts:196`) cuenta las inscripciones abiertas, incluidas las de jugadores en baja temporal, que no aparecen en el grupo de HU-018.
- `ROADMAP.md` (fila «Decisión») y `TRACEABILITY.md:55` registran la pregunta: «¿Debe conservar su cupo?».
- **Resuelta:** no. **Implementada:** sí, la opción actual, que no fue elegida por el responsable del producto. **Pruebas:** cubren el comportamiento actual (`hu-fase2` «HU-017/021», «HU-021.3/4»).
- **Necesita la decisión del responsable del producto.** Esta auditoría no la toma.

## 5. Seguridad (OWASP)

Se distingue entre código sin protección, controles existentes y configuración externa no verificable.

| ID   | Severidad   | Archivo:línea                                                                           | Evidencia                                                                                                                                                                                                                                                                                                    | Impacto                                                                                                               | Probabilidad           | Recomendación                                                                                        | ¿Bloquea el cierre de una HU?                                     | ¿Bloquea producción?                   |
| ---- | ----------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------- |
| S-01 | **ALTA**    | `api/auth.ts:97-108`, `api/server.ts:85`                                                | 25 inicios de sesión simultáneos → 25×401, 0×429                                                                                                                                                                                                                                                             | Fuerza bruta por encima del límite de 5 en 15 min; bloqueo de cuentas ajenas detrás de un proxy                       | Alta (basta un script) | Reserva síncrona (como C1), límite por cuenta e IP, almacén compartido, prueba concurrente           | No (criterios de HU-001 cumplidos); recomendable antes del cierre | **Sí**                                 |
| S-02 | MEDIA       | `api/auth.ts:29,105`; `api/password.ts:214`                                             | Argon2id de 19 MiB por verificación, sin límite global. Un login con correos distintos nunca alcanza el límite; `confirmPasswordReset` hashea antes de validar el token. Medido localmente: 40 logins simultáneos en 254 ms; la memoria residente pasó de 13 MB a 210 MB (incluye la carga del dominio)      | Saturación de CPU y del pool de hilos de libuv; degradación del servicio                                              | Media                  | Semáforo de concurrencia para Argon2id; validar el token antes de hashear; límite por IP en el proxy | No                                                                | **Sí** (con exposición pública)        |
| S-03 | BAJA        | `training.service.ts:106-107,255-258`; `attendance.service.ts:68-70`                    | § 4.A: 403 frente a 400                                                                                                                                                                                                                                                                                      | Revela qué ids de sesión existen                                                                                      | Alta / impacto bajo    | Integrar la PR #17 con sus pruebas actualizadas                                                      | No                                                                | No (corregir antes)                    |
| S-04 | MEDIA       | `package.json:37` (`@angular/router ^22.2.0`, instalado 22.2.0); `zod` 4.6.5 transitiva | `npm audit --omit=dev`: 2 altas (DoS del router: empty-path outlet y retención de query params; agotamiento de memoria en zod). `npm audit` completo: 8 (1 baja, 1 moderada, 6 altas), el resto en dependencias de desarrollo (`@angular/cli`, `vite`, `undici`, `@modelcontextprotocol/server`, `fast-uri`) | El DoS del router afecta al navegador del propio usuario con una URL manipulada; las de desarrollo no llegan al build | Baja a media           | Actualizar `@angular/*` a ≥ 22.2.1 y `zod` a ≥ 4.6.6 (`fixAvailable`)                                | No                                                                | **Sí** (actualizar antes de desplegar) |
| S-05 | INFORMATIVA | `api/server.ts:100-101`                                                                 | La API envía `Cache-Control: no-store` y `X-Content-Type-Options: nosniff`; no envía CSP, HSTS ni `X-Frame-Options`. El servidor de la SPA en producción no está en el repositorio                                                                                                                           | Clickjacking y XSS sin CSP como defensa en profundidad                                                                | —                      | Definir estos encabezados en el servidor web o proxy de producción                                   | No                                                                | Configuración externa no verificable   |
| S-06 | BAJA        | `api/password.ts:144-201`                                                               | Rama de cuenta existente más larga (transacción + correo). No se midió                                                                                                                                                                                                                                       | Posible enumeración por tiempos                                                                                       | Baja                   | Emitir el token y enviar el correo fuera de la respuesta (cola) o igualar los tiempos                | No                                                                | No                                     |
| S-07 | BAJA        | `docs/SETUP.md:57-59`                                                                   | La misma cuenta `charales` tiene `CREATE`, `ALTER`, `EVENT`, `TRIGGER`… y la usa la API en tiempo de ejecución                                                                                                                                                                                               | Una inyección SQL tendría privilegios DDL. No se encontró ninguna, porque todas las consultas son parametrizadas      | Baja                   | Una cuenta de migraciones (DDL) y otra de ejecución (DML)                                            | No                                                                | Recomendado                            |

**Controles verificados como correctos:**

- **Autenticación:** Argon2id con m = 19 MiB, t = 2, p = 1 (el mínimo de OWASP) y `timingSafeEqual`. Un correo inexistente se verifica contra un hash señuelo, así que tarda lo mismo. Un mismo mensaje para cuenta desconocida, inactiva o contraseña incorrecta (prueba «same 401, no cookie»).
- **Sesión:**
  - token de 32 bytes nuevo en cada login, así que no hay fijación de sesión;
  - en la base se guarda sólo su SHA-256;
  - cookie `HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`, y `Secure` cuando está configurada (verificado en la cabecera real);
  - 8 h de caducidad absoluta y 30 min por inactividad;
  - al desactivar una cuenta se cierran sus sesiones;
  - el logout es idempotente.
- **Autorización:**
  - lista blanca RPC (126 métodos); los nombres de `Object.prototype` responden 404 (prueba);
  - cada método autoriza en el servidor con la sesión de la cookie;
  - RBAC: `officePermissions` sólo del rol de seguridad (D12);
  - sin IDOR ni BOLA en el barrido (§ 4.A);
  - no se puede asignar un rol con más permisos que el propio (`authorization.service.ts:150`);
  - un permiso retirado aplica en la siguiente solicitud (prueba HU-006).
- **Entrada:**
  - todas las consultas SQL son parametrizadas (`?`);
  - validación de tipos y longitudes en los servicios, y `STRICT_TRANS_TABLES` forzado;
  - límite de cuerpo: 10 KB, y 200 KB para RPC (comprobado: 413 con 20 KB en el login);
  - prueba de asignación masiva;
  - una forma de argumentos inválida → `TypeError` → 400 sin escribir nada.
- **CSRF y CORS:** sólo se aceptan cuerpos JSON (`text/plain` → 400, verificado), con `SameSite=Strict`. No se envían cabeceras CORS: el preflight responde 404 sin `Access-Control-Allow-Origin`.
- **Errores:** un error inesperado responde 500 con un mensaje genérico, sin trazas ni SQL.
- **Frontend:**
  - no hay `innerHTML`, `bypassSecurityTrust*`, `eval` ni `insertAdjacentHTML` en `src/app`, y Angular escapa las interpolaciones;
  - en modo API, `sessionStorage` guarda sólo el perfil, con `token: ''` (`api-auth.service.ts:34`); el token sólo viaja en la cookie HttpOnly;
  - las rutas están protegidas en la pantalla, pero la autorización real está en el servidor (E2E «direct URLs are guarded by the server session»).
- **Secretos:** Git sólo versiona `.env.example`, con marcadores, y el entorno de Postman, con cuentas de demostración `@example.com`. No hay claves reales.
- **Respaldo:** `db/mariadb/scripts/backup.sh`, `restore.sh` y `verify-backup.sh`; la restauración se probó hoy con 40 tablas idénticas.

**TLS:** la API no termina TLS; se espera un proxy (configuración externa, P-03).

## 6. Integridad de la base de datos

- **Claves:** el esquema base tiene 62 FK y 37 `CHECK`.
  - FK compuestas `(id, jugador_id)` obligan a que pago, aplicación y cargo sean del mismo jugador (`pago_aplicacion`, `pedidos_uniforme`).
  - Únicos: `uq_pago_cargo`, `uq_cargo_periodo_concepto`, `folio`, `uq_pedido_uniforme_cargo` y otros.
  - `CHECK`: `importe > 0`, coherencia entre cancelación y motivo, coherencia entre entrega y fecha.
- **NULL:** `pagos.referencia` admite `NULL` y no tiene `CHECK`, a propósito: los pagos históricos no tienen referencia.
- **Transacciones:**
  - cada operación RPC corre en **una transacción bajo un lock global por base** (`GET_LOCK`, `api/rpc.ts`) y escribe sólo la diferencia;
  - un error de negocio o de MariaDB hace ROLLBACK de todo (pruebas «HU-073… the whole unit of work rolls back», «over-payment rolls back entirely»);
  - los endpoints de autenticación usan transacciones con `FOR UPDATE`.
- **Concurrencia financiera:** el lock global serializa las escrituras. Hay pruebas para dos pagos simultáneos por el saldo completo (exactamente uno gana), un pago cancelado dos veces (se revierte una vez) y escrituras y logins en paralelo.
- **Lo que la base no garantiza:** que la suma de las aplicaciones no supere el importe del pago ni el saldo del cargo. Depende de la aplicación y del lock global. Es un límite conocido (comentario `ponytail:`); con varias instancias sigue funcionando, porque el lock es de MariaDB.
- **Escritura parcial:** **no se encontró ningún escenario** de escritura parcial en la base.
  - Excepción menor: en una invitación, el correo se envía **después** del COMMIT (`api/rpc.ts`). Si el envío falla, la cuenta queda creada sin correo. Hoy sólo existe el transporte de consola (P-02), así que no ocurre.
- **Migraciones 001–004:** son idempotentes. Repetir `db:setup` dejó los checksums idénticos. `api/schema.ts` nunca borra nada y sólo aplica el esquema base a una base vacía.
- **Base original `escuela_futbol`:** no tiene la migración 004 (`pagos.referencia` no existe).
  - Con el código de `main`, el puente RPC **rechaza todas las operaciones** con «Columna pagos.referencia no existe: aplica db/mariadb/migrations» (`api/rpc.ts:229`) → 500.
  - Falla de forma cerrada, sin corrupción, pero cada base existente del equipo debe ejecutar `npm run db:setup` (P-01). Esta auditoría no la modificó.
- **Estados y eliminación lógica:** jugadores, usuarios, categorías, conceptos y otros catálogos se desactivan o cambian de estado; los cargos y los pagos se cancelan con motivo, sin borrarse; la auditoría guarda los valores anteriores y nuevos.
- **Respaldo y restauración:** `npm run db:mariadb:test-backup` → 40 tablas comparadas, checksums idénticos.

## 7. Pruebas ejecutadas hoy

Commit `b7cc137`, 2026-11-01, macOS, Node 26, MariaDB local, bases `ef_*` temporales.

| #   | Comando                                                                                                                                                                              | Inicio–fin        | Resultado                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------- |
| 1   | `npm ci`                                                                                                                                                                             | 13:17:49–13:17:53 | OK                                                                        |
| 2   | `npm run api:typecheck`                                                                                                                                                              | 13:17:53–13:17:56 | OK                                                                        |
| 3   | `npm run build`                                                                                                                                                                      | 13:17:56–13:18:01 | OK                                                                        |
| 4   | `npx prettier --check .`                                                                                                                                                             | 13:18:01–13:18:05 | OK                                                                        |
| 5   | `git diff --check d5ed339 b7cc137`                                                                                                                                                   | 13:18:05          | OK                                                                        |
| 6   | `npx ng test --watch=false`                                                                                                                                                          | 13:18:05–13:20:05 | **247/247** (20 archivos)                                                 |
| 7   | `npm run api:test` (12 archivos, incluye autorización, integridad y concurrencia)                                                                                                    | 13:20:05–13:20:30 | **198/198**                                                               |
| 8   | `npm run e2e`                                                                                                                                                                        | 13:20:30–13:21:34 | **18/19: falla «Tablero: six indicators…»** (D-01)                        |
| 9   | `npm run db:mariadb:test-backup`                                                                                                                                                     | 13:21:34–13:21:47 | OK, respaldo idéntico (40 tablas)                                         |
| 10  | `npm audit --omit=dev`                                                                                                                                                               | 13:21:47          | 2 altas (S-04)                                                            |
| 11  | `npm audit`                                                                                                                                                                          | 13:21:48          | 8 (1 baja, 1 moderada, 6 altas)                                           |
| 12  | `postman collection lint postman/`                                                                                                                                                   | 13:35             | 0 errores, 0 advertencias (37 archivos)                                   |
| 13  | `postman collection run postman/collections/Charales -e postman/environments/local.environment.yaml --env-var baseUrl=http://localhost:3100` (API sobre `ef_audpm` con `--dev-seed`) | 13:35             | 37 solicitudes, 42/42 aserciones                                          |
| 14  | `npm run db:setup -- --demo` y otra vez `npm run db:setup` sobre `ef_audprobe`                                                                                                       | 13:30 aprox.      | Migraciones 001–004 aplicadas; la repetición deja los checksums idénticos |
| 15  | Sondeos HTTP (`node probe.mjs`, `probe2.mjs`) contra la API sobre `ef_audprobe`                                                                                                      | 13:30 aprox.      | § 4 y § 5                                                                 |

- **Pruebas de autorización:** forman parte de `api:test` (`rpc.test.ts` «authorization runs on the server…», `hu-criterios.test.ts`) y del barrido manual de 126 métodos. `api/authorization-order.test.ts` no existe en `main`.
- **No se ejecutó:** una inspección visual manual en un navegador. La E2E recorre 375, 768 y 1280 px de forma automática, pero no sustituye la inspección.
- **Bases temporales:** `ef_audprobe` y `ef_audpm` se borraron. Quedan bases `ef_*` de sesiones anteriores (`ef_checks`, `ef_setup_83002_*`, `ef_verify_*`) que no creó esta auditoría y no se tocaron.

## 8. Defectos que bloquean el cierre

| ID   | Defecto                                                                                                                                                                                                                                            | Bloquea                                                                                                          | Corrección sugerida                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| D-01 | La E2E «Tablero: six indicators…» (`e2e/app.e2e.ts:455`) espera siempre «del X al Y». El día 1 de cada mes el periodo es de un solo día y la pantalla escribe «el 1 de noviembre de 2026» (`src/app/shared/dates.ts:145`, comportamiento correcto) | La evidencia de cierre: el gate E2E está en rojo hoy y lo estará el día 1 de cada mes                            | Ajustar la expresión regular para aceptar `el \d+ de \w+ de \d{4}` o fijar la fecha en la prueba |
| D-02 | HU-021 sin decisión de producto sobre la baja temporal y el cupo                                                                                                                                                                                   | El cierre de HU-021                                                                                              | El responsable del producto decide (DP-02) y se ajusta el código o las pruebas                   |
| D-03 | Estado formal: el Excel oficial tiene las 49 HU en «Pendiente»                                                                                                                                                                                     | El cierre **formal**                                                                                             | Que el equipo registre el cierre en el Excel con esta evidencia                                  |
| D-04 | S-01, carrera del límite de intentos del login                                                                                                                                                                                                     | No bloquea los criterios de HU-001; se recomienda corregirlo antes de declarar cerrada la HU de inicio de sesión | § 4.B                                                                                            |

## 9. Mejoras recomendadas no bloqueantes

1. Integrar la PR #17 (B-2 / S-03) después de actualizar sus expresiones regulares a los mensajes de la § 5.1.
2. Agregar una prueba de regresión que, por cada método RPC, compruebe que un id ajeno y uno inexistente reciben la misma respuesta para tutor y entrenador.
3. Separar la cuenta de migraciones (DDL) de la cuenta de ejecución (S-07).
4. Cortar S-02 en `confirmPasswordReset`: validar el token antes de hashear.
5. **Documentación (falsos positivos de la documentación propia):**
   - `TRACEABILITY.md:55` marca HU-021 «Completa» y «Decisión pendiente» a la vez;
   - `TRACEABILITY.md:90` dice «Completas: **49**»;
   - `ROADMAP.md` dice que las 49 «se cerraron el 2026-10-29», mientras el Excel dice «Pendiente»;
   - `TRACEABILITY.md:244` (HU-076) todavía cita «39/39 tablas», cuando hoy son 40.
6. HU-032.4 (exportación) es un criterio condicional que no se implementó; decidir si se descarta formalmente.
7. Alinear la parte superior en la rejilla de dos columnas del formulario de pago: con un mensaje de error, el campo vecino se estira (observado en la PR #23; cosmético).
8. Actualizar las dependencias de desarrollo marcadas por `npm audit` (`@angular/cli`, `vite`).

## 10. Dependencias de producción

| ID   | Dependencia                                                                                                                                                             | Afecta                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| P-01 | Ejecutar `npm run db:setup` (migraciones 001–004) en cada base existente antes de usar el código de `main`. Sin la 004, todas las operaciones de dominio fallan con 500 | Todas las HU; especialmente HU-045 |
| P-02 | Proveedor de correo real (D4c). Sin él, la recuperación de contraseña y las invitaciones responden 503                                                                  | HU-004, HU-012, HU-022, HU-005     |
| P-03 | TLS en un proxy; `NODE_ENV=production` o `COOKIE_SECURE=true`; encabezados de seguridad (CSP, HSTS, `frame-ancestors`); IP real de cliente desde un proxy de confianza  | S-01, S-05, cookie `Secure`        |
| P-04 | Corregir S-01, S-02 y S-04                                                                                                                                              | Seguridad                          |
| P-05 | `event_scheduler = ON` en MariaDB para el `EVENT` diario de VENCIDO (migración 002). Sin él, la app lo recalcula igual en cada operación de cobranza                    | HU-044 y reportes de adeudo        |
| P-06 | Respaldos programados según la periodicidad sugerida (`MARIADB.md` § 6: diario, con retención 7 + 4 + 12)                                                               | HU-076                             |
| P-07 | Una sola instancia de la API mientras el límite de intentos viva en memoria (S-01)                                                                                      | HU-001 y HU-005                    |

## 11. Decisiones pendientes del responsable del producto

- **DP-01 · HU-045, criterio 5:** ¿la referencia del comprobante es obligatoria con transferencia o tarjeta? Está implementada y probada, pero **no está ratificada** en el Excel. Si se rechaza, basta con vaciar `METHODS_WITH_REFERENCE`; la columna puede quedarse como opcional.
- **DP-02 · HU-021:** ¿un jugador en baja temporal conserva su cupo? Hoy sí cuenta en la ocupación.
- **DP-03 · HU-032.4:** ¿se implementa la exportación o se descarta el criterio condicional?
- **DP-04 · HU-004, 012 y 022 / HU-005:** elegir el proveedor de correo y la fecha.
- **DP-05 · Cierre formal:** actualizar el «Estado» de las 49 HU en el Excel oficial.

## 12. Dictamen final

**Las HU de Jorge Luis Borrayo De Anda pueden cerrarse formalmente con condiciones:**

1. **48 de 49 cumplen sus criterios oficiales** con evidencia ejecutada hoy. HU-004, 012 y 022 quedan marcadas como «completas en desarrollo» hasta que exista un proveedor de correo.
2. **HU-021 no puede cerrarse** hasta que el responsable del producto decida (DP-02).
3. **HU-045 se cierra con sus criterios 1–4.** El criterio 5 debe ratificarse o descartarse (DP-01); no es un requisito oficial.
4. Antes de registrar el cierre, **corregir D-01** (prueba E2E dependiente de la fecha), para que la evidencia sea verde cualquier día.
5. Se recomienda corregir **S-01** antes de dar por cerrada HU-001.
6. El cierre debe registrarse en el Excel oficial (D-03). Hoy no consta.

**Charales no está listo para producción.** Faltan:

- S-01 (fuerza bruta en el login, confirmada);
- S-02 (consumo de recursos por Argon2id);
- S-04 (dependencias con vulnerabilidades altas y corrección disponible);
- P-01 a P-03 (migración de las bases existentes, proveedor de correo, TLS y encabezados);
- S-03 / PR #17, que debe integrarse con sus pruebas actualizadas.

El resto de la seguridad revisada (sesiones, cookies, RBAC, aislamiento horizontal, SQL, CSRF/CORS, XSS, transacciones financieras) es sólida y cuenta con pruebas automatizadas que pasaron hoy.

## Adenda 2026-11-02 — decisiones aprobadas y nuevo dictamen

El cuerpo del informe describe el estado auditado el 2026-11-01 y no se modificó. Esta adenda registra lo que cambió
después.

### Decisiones de producto aprobadas

| ID    | Decisión                                                                               | Efecto sobre el informe                                                 |
| ----- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| DP-01 | HU-045: se ratifica el criterio 5 (referencia obligatoria con transferencia y tarjeta) | Criterio oficial en el Excel; R22 deja de estar pendiente               |
| DP-02 | HU-021: un jugador en baja temporal conserva su cupo                                   | Es el comportamiento auditado; se documenta como R23. **D-02 resuelto** |
| DP-03 | HU-032: la exportación de asistencia se difiere como mejora futura                     | El criterio 4 condicional queda diferido; no es un defecto              |
| DP-04 | Correo transaccional con Resend                                                        | P-02 sigue abierto: falta configurar y probar el proveedor              |
| DP-05 | Cierre formal condicionado de las 49 HU                                                | Excel: «Terminado» (valor del catálogo del equipo). **D-03 resuelto**   |

### Cambios registrados

- **Excel oficial** (`Product_Backlog_Escuela_Futbol_Infantil.xlsx`):
  - se respaldó antes en `Product_Backlog_Escuela_Futbol_Infantil_respaldo-2026-11-02.xlsx` (SHA-256 `4d6ea395…`);
  - cambiaron exactamente 50 celdas: «Estado» de las 49 HU, de «Pendiente» a «Terminado», y los criterios de HU-045 con el 5;
  - gráfica, dibujos, tablas y validaciones intactos;
  - se usó «Terminado» porque la columna sólo admite los valores del catálogo (`Pendiente, En análisis, En desarrollo, En pruebas, Terminado, Bloqueado`).
- **D-01:** corregido en la PR #24 (sólo la expresión de la prueba).
  - `npm run e2e` → 19/19 el 2026-11-02.
  - Comparando la salida real de `dateRangeLabel` día por día durante 2026, la expresión anterior falla 12 de 365 días y la nueva ninguno.
- **Documentación:**
  - `USER_STORIES.md` transcribe el Excel; coincide en las 76 HU (criterios, estado y responsable);
  - `DOMAIN_RULES.md` (R22 ratificada, R23 nueva), `TRACEABILITY.md`, `ROADMAP.md`, `DEVELOPMENT.md`, `API.md`, `DATA_CONTRACT.md` y `MARIADB.md`;
  - los comentarios de `api/hu-045.test.ts` y de la migración 004 ya no dicen «pendiente».

### Estado de las 49 HU tras la adenda

| Estado                                               | HU                             |
| ---------------------------------------------------- | ------------------------------ |
| COMPLETA                                             | 43 (incluidas HU-021 y HU-045) |
| COMPLETA, condicionada a producción (correo, Resend) | HU-004, HU-012, HU-022         |
| COMPLETA, criterio 4 condicional diferido (DP-03)    | HU-032                         |
| COMPLETA\* (criterios cumplidos; S-01 abierto)       | HU-001                         |
| COMPLETA (D-01 corregido en la PR #24)               | HU-065                         |
| PARCIAL / PENDIENTE / NO VERIFICADA                  | 0                              |

**Observación sobre HU-021:** la decisión coincide con el código (`CategoryService.occupancy` cuenta las inscripciones
abiertas), pero **ninguna prueba fija explícitamente el caso de la baja temporal**. Las pruebas de ocupación usan
jugadores activos. Se recomienda agregar esa prueba de regresión.

### Nuevo dictamen

- **Las 49 HU quedan cerradas formalmente con condiciones**:
  - tres dependen del correo en producción;
  - una tiene un criterio condicional diferido;
  - HU-001 conserva el hallazgo S-01.
- La evidencia E2E es verde con la PR #24. **Hasta que esa PR se fusione, `main` sigue fallando la E2E el día 1 de cada mes.**
- **Producción sigue sin autorizarse:** S-01 a S-04 y P-01 a P-07 siguen abiertos, como en la § 12.

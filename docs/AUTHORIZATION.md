# Autorización — contrato por operación

Estado de `main` en `18178ba` (2026-10-07). Toda esta autorización corre en el navegador sobre `MockDb`: **no hay API**
todavía; cuando exista, debe repetir esta matriz (barrera 3).

## Tres barreras

| Barrera                    | Dónde                                  | Qué garantiza                                                                                 |
| -------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1. Rutas y menú            | `core/auth/guards.ts`, `layout/nav.ts` | Experiencia: no se muestran ni se abren pantallas sin permiso                                 |
| 2. **Dominio (servicios)** | `core/auth/authorization.service.ts`   | Cada operación pública verifica permiso **y** propiedad aunque se invoque directamente        |
| 3. API (futura)            | backend                                | La única barrera real: el navegador y `MockDb` son manipulables. **Debe repetir esta matriz** |

## Estrategia

- Un solo servicio, `AuthorizationService`, lee la identidad **sólo de la sesión** (`SessionStore`), nunca de un id
  enviado por quien llama. Ofrece:
  - `require(...permisos)`: al menos uno de los permisos (`modulo.accion`, filas de `permisos`);
  - `requireOffice()`: catálogos de oficina (selects) — cualquier permiso **del rol de seguridad** («cualquier permiso
    de oficina» en la matriz de abajo); un perfil solo no basta;
  - `assertPlayer(id, permisoOficina, { tutor, coach })`: permiso de oficina, **o** ser tutor del jugador
    (`tutor_jugador`), **o** su entrenador (categoría vigente), según lo permita la operación;
  - `assertCategory(id, permisoOficina)`: permiso de oficina o entrenador asignado (vigente) a la categoría;
  - `coachCategories()`, `coachParticipations()`, `tutorChildren()`: relaciones del usuario;
  - `assertCanGrantRole(roleId)` / `assertCanManageAccount(userId)`: **no escalada** — sólo se asigna o administra un
    rol cuyos permisos ya tiene quien actúa (una secretaria con `usuarios.*` no puede crear, editar ni desactivar a un
    administrador).
- Los rechazos lanzan `ForbiddenError` (mensaje genérico; no revela si el recurso existe).
- **Endpoints = métodos públicos `async`** de los servicios. Los métodos síncronos (`views`, `insertCharge`,
  `voidCharge`, `syncStatuses`, `participationViews`…) son composición interna: sólo se invocan después de una de estas
  verificaciones y no deben exponerse como endpoints. Excepción: `AttendanceService.history`,
  `NoticeService.forTutor/forCoach` reciben una identidad y por eso también verifican.
- No se puede vincular la **propia** cuenta a un perfil de tutor o entrenador (evita autoescalarse a ENTRENADOR).
- **Permisos de rol frente a permisos de perfil (sin escalada lateral).** La sesión guarda `permissions` (rol de
  seguridad + perfiles, para menús y áreas de perfil) y `officePermissions` (sólo el rol de seguridad). `grants()`
  (`session.store.ts`) es la regla única de rutas, menús y servicios: un permiso de módulo de perfil (`portal`,
  `panel_entrenador`) sale del perfil; cualquier otro módulo cuenta **sólo si lo da el rol de seguridad**. Los permisos
  de oficina que trae un perfil (ENTRENADOR → `asistencias.*`) valen únicamente dentro del alcance de ese perfil
  (`TrainingService.canRecord`). Así una persona puede ser SECRETARIA y ENTRENADORA a la vez, pero captura asistencia
  sólo en sus sesiones, nunca en todas; el perfil tampoco le da jugadores globales, catálogos de oficina (`requireOffice()`
  exige un rol de seguridad) ni permisos administrativos adicionales. Prueba: «SECRETARIA + linked ENTRENADOR profile». `assertCanGrantRole` también compara sólo contra el rol de seguridad.

## Matriz de roles (D12)

**Administrador administra el sistema; Secretaría administra la operación de la escuela**
([`MARIADB.md` § 4, D12](database/MARIADB.md)). Fuente: `DEFAULT_ROLE_PERMISSIONS` en `core/auth/permissions.ts`,
replicada en `db/mariadb/010_permisos_app.sql` (ADMINISTRADOR 56, SECRETARIA 45, ENTRENADOR 3, TUTOR 2).

| Rol           | Puede                                                                                                                                                                                                                                                                                                                                 | No puede                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Administrador | Todo lo de oficina: usuarios, roles y permisos, auditoría, cancelar pagos, descuentos y becas, capturar asistencia en cualquier sesión, más toda la operación                                                                                                                                                                         | Áreas de perfil (portal, panel) sin un perfil ligado                                                             |
| Secretaría    | Operación completa: jugadores, tutores (y sus cuentas), entrenadores (y sus cuentas), categorías, **temporadas** (incluida la actual), inscripciones, sedes, sesiones, competencias, partidos, cobranza (incluido **cancelar cargos sin pagos**), registrar pagos, uniformes, avisos, reportes; **consultar** asistencia y descuentos | `usuarios.*`, `roles.*`, `auditoria.consultar`, `pagos.cancelar`, `descuentos.crear`, `asistencias.crear/editar` |
| Entrenador    | Su panel: sus categorías, jugadores, horarios, sesiones, competencias y partidos; capturar y corregir asistencia y observaciones de **sus** sesiones (completarlas)                                                                                                                                                                   | Catálogos de oficina y cualquier dato fuera de sus asignaciones                                                  |
| Padre/Tutor   | Su portal: sus hijos (categoría, horarios, sedes, entrenadores, partidos, resultados, asistencia, estado de cuenta, uniformes) y su perfil de contacto                                                                                                                                                                                | Pedir uniformes, listados globales, datos de otras familias                                                      |

Cancelar un **cargo** (`cobranza.cancelar`) sólo procede si no tiene pagos aplicados (`BillingService.voidCharge`) y
exige motivo y queda en `auditoria`; revertir un **pago** (`pagos.cancelar`, HU-049) es exclusivo del Administrador.

## Pruebas

- `src/app/authorization.spec.ts`: expectativas **escritas a mano** (no derivadas de `auth.can`) para rutas y para
  servicios: tutor A → hijo A permitido; tutor A → hijo B denegado en portal, estado de cuenta, expediente,
  asistencia, uniformes y partidos; entrenador → categoría ajena, sesión ajena, asistencia ajena, plantel ajeno y
  partidos ajenos denegados; secretaría → registrar pago permitido, permisos/cancelación/escalada denegados;
  administrador → todo lo de oficina; sin sesión → todo denegado. Bloque «role matrix (D12)»: los 45 permisos exactos
  de Secretaría (allow/deny), temporadas, descuentos en consulta, cancelar cargo sin pagos (y rechazo con pagos),
  control total del Administrador, alcance del entrenador y del tutor, y la prueba de **escalada lateral**
  (SECRETARIA + perfil ENTRENADOR captura sólo en sus sesiones).
- `src/app/app.routes.spec.ts`: tabla de seguridad de las **50** rutas protegidas con las 5 cuentas de demostración
  (comprueba la coherencia guard ↔ permisos; las expectativas independientes están en `authorization.spec.ts`).

## Matriz por operación (generada del código)

| Servicio              | Operación                | Requiere                                                                                                                        |
| --------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| AuditService          | list                     | `auditoria.consultar`                                                                                                           |
| AuditService          | modules                  | `auditoria.consultar`                                                                                                           |
| CategoryService       | list                     | cualquier permiso de oficina                                                                                                    |
| CategoryService       | get                      | `categorias.consultar` o entrenador asignado a la categoría                                                                     |
| CategoryService       | save                     | `categorias.crear` (alta) / `categorias.editar` (edición)                                                                       |
| CategoryService       | setActive                | `categorias.editar`                                                                                                             |
| CategoryService       | members                  | `categorias.consultar` o entrenador asignado a la categoría                                                                     |
| CategoryService       | coaches                  | `categorias.consultar`                                                                                                          |
| CompetitionService    | list                     | `competencias.consultar` o `partidos.consultar`                                                                                 |
| CompetitionService    | get                      | `competencias.consultar`                                                                                                        |
| CompetitionService    | save                     | `competencias.crear` (alta) / `competencias.editar` (edición)                                                                   |
| CompetitionService    | participations           | `competencias.consultar` o `partidos.consultar`                                                                                 |
| CompetitionService    | register                 | `competencias.editar`                                                                                                           |
| CompetitionService    | setParticipationStatus   | `competencias.editar`                                                                                                           |
| CompetitionService    | roster                   | `competencias.consultar`                                                                                                        |
| CompetitionService    | eligiblePlayers          | `competencias.consultar`                                                                                                        |
| CompetitionService    | addToRoster              | `competencias.editar`                                                                                                           |
| CompetitionService    | removeFromRoster         | `competencias.editar`                                                                                                           |
| PlayerService         | search                   | `jugadores.consultar`                                                                                                           |
| PlayerService         | options                  | cualquier permiso de oficina                                                                                                    |
| PlayerService         | get                      | `jugadores.consultar`                                                                                                           |
| PlayerService         | create                   | `jugadores.crear`                                                                                                               |
| PlayerService         | update                   | `jugadores.editar`                                                                                                              |
| PlayerService         | changeStatus             | `jugadores.editar`                                                                                                              |
| PlayerService         | record                   | `jugadores.consultar`                                                                                                           |
| BillingService        | concepts                 | cualquier permiso de oficina                                                                                                    |
| BillingService        | saveConcept              | `cobranza.crear` (alta) / `cobranza.editar` (edición)                                                                           |
| BillingService        | setConceptActive         | `cobranza.editar`                                                                                                               |
| BillingService        | charges                  | `cobranza.consultar`                                                                                                            |
| BillingService        | monthlyCandidates        | `cobranza.crear`                                                                                                                |
| BillingService        | generateMonthlyFees      | `cobranza.crear`                                                                                                                |
| BillingService        | createCharge             | `cobranza.crear`                                                                                                                |
| BillingService        | cancelCharge             | `cobranza.cancelar`                                                                                                             |
| BillingService        | openCharges              | `pagos.crear` o `descuentos.crear`                                                                                              |
| BillingService        | payers                   | `pagos.crear`                                                                                                                   |
| BillingService        | registerPayment          | `pagos.crear`                                                                                                                   |
| BillingService        | cancelPayment            | `pagos.cancelar`                                                                                                                |
| BillingService        | receipts                 | `pagos.consultar`                                                                                                               |
| BillingService        | receipt                  | `pagos.consultar`                                                                                                               |
| BillingService        | receiptByFolio           | `pagos.consultar`                                                                                                               |
| BillingService        | statement                | `pagos.consultar` o tutor del jugador                                                                                           |
| BillingService        | debts                    | `cobranza.consultar`                                                                                                            |
| BillingService        | discounts                | `descuentos.consultar`                                                                                                          |
| BillingService        | addDiscount              | `descuentos.crear`                                                                                                              |
| CoachPanelService     | myCategories             | `panel_entrenador.consultar`                                                                                                    |
| CoachPanelService     | weeklySchedule           | `panel_entrenador.consultar`                                                                                                    |
| CoachPanelService     | sessions                 | `panel_entrenador.consultar`                                                                                                    |
| CoachPanelService     | myCompetitions           | `panel_entrenador.consultar`                                                                                                    |
| CoachPanelService     | myMatches                | `panel_entrenador.consultar`                                                                                                    |
| CoachPanelService     | competitionOptions       | `panel_entrenador.consultar`                                                                                                    |
| CoachPanelService     | categoryOptions          | `panel_entrenador.consultar`                                                                                                    |
| CoachPanelService     | notices                  | `panel_entrenador.consultar`                                                                                                    |
| CoachService          | list                     | cualquier permiso de oficina                                                                                                    |
| CoachService          | save                     | `entrenadores.crear` (alta) / `entrenadores.editar` (edición)                                                                   |
| CoachService          | setActive                | `entrenadores.editar`                                                                                                           |
| CoachService          | linkAccount              | `entrenadores.editar`                                                                                                           |
| CoachService          | unlinkAccount            | `entrenadores.editar`                                                                                                           |
| CoachService          | categoryAssignments      | `entrenadores.consultar`                                                                                                        |
| CoachService          | assignCategory           | `entrenadores.editar`                                                                                                           |
| CoachService          | endCategoryAssignment    | `entrenadores.editar`                                                                                                           |
| CoachService          | competitionAssignments   | `competencias.consultar`                                                                                                        |
| CoachService          | assignCompetition        | `competencias.editar`                                                                                                           |
| CoachService          | endCompetitionAssignment | `competencias.editar`                                                                                                           |
| EnrollmentService     | list                     | `inscripciones.consultar`                                                                                                       |
| EnrollmentService     | enroll                   | `inscripciones.crear`                                                                                                           |
| EnrollmentService     | setStatus                | `inscripciones.editar`                                                                                                          |
| PlayerCategoryService | current                  | `inscripciones.consultar` o `jugadores.consultar`                                                                               |
| PlayerCategoryService | eligibility              | `inscripciones.crear`                                                                                                           |
| PlayerCategoryService | assign                   | `inscripciones.crear`                                                                                                           |
| PlayerCategoryService | change                   | `inscripciones.editar`                                                                                                          |
| MatchService          | list                     | `partidos.consultar`                                                                                                            |
| MatchService          | schedule                 | `partidos.crear`                                                                                                                |
| MatchService          | reschedule               | `partidos.editar`                                                                                                               |
| MatchService          | cancel                   | `partidos.editar`                                                                                                               |
| MatchService          | recordResult             | `partidos.editar`                                                                                                               |
| MatchService          | opponents                | `partidos.consultar`                                                                                                            |
| MatchService          | saveOpponent             | `partidos.crear` (alta) / `partidos.editar` (edición)                                                                           |
| MatchService          | setOpponentActive        | `partidos.editar`                                                                                                               |
| NoticeService         | list                     | `avisos.consultar`                                                                                                              |
| NoticeService         | save                     | `avisos.crear` (alta) / `avisos.editar` (edición)                                                                               |
| NoticeService         | setPublished             | `avisos.editar`                                                                                                                 |
| PortalService         | overview                 | `portal.consultar`                                                                                                              |
| PortalService         | child                    | `portal.consultar`                                                                                                              |
| PortalService         | attendance               | `portal.consultar`                                                                                                              |
| PortalService         | noticeList               | `portal.consultar`                                                                                                              |
| PortalService         | profile                  | `portal.consultar`                                                                                                              |
| PortalService         | updateProfile            | `portal.editar`                                                                                                                 |
| PortalService         | childOptions             | `portal.consultar`                                                                                                              |
| ReportService         | dashboard                | `reportes.consultar`                                                                                                            |
| ReportService         | playersByCategory        | `reportes.consultar`                                                                                                            |
| ReportService         | income                   | `reportes.consultar`                                                                                                            |
| ReportService         | agenda                   | `reportes.consultar`                                                                                                            |
| SeasonService         | list                     | cualquier permiso de oficina                                                                                                    |
| SeasonService         | current                  | cualquier permiso de oficina                                                                                                    |
| SeasonService         | save                     | `temporadas.crear` (alta) / `temporadas.editar` (edición)                                                                       |
| AttendanceService     | record                   | alcance de sesión (oficina con `entrenamientos.consultar`, o entrenador de la sesión/categoría); escribir: `asistencias.editar` |
| AttendanceService     | report                   | `asistencias.consultar`                                                                                                         |
| ScheduleService       | list                     | cualquier permiso de oficina                                                                                                    |
| ScheduleService       | save                     | `categorias.editar`                                                                                                             |
| ScheduleService       | setActive                | `categorias.editar`                                                                                                             |
| TrainingService       | list                     | `entrenamientos.consultar`                                                                                                      |
| TrainingService       | get                      | alcance de sesión (oficina con `entrenamientos.consultar`, o entrenador de la sesión/categoría); escribir: `asistencias.editar` |
| TrainingService       | program                  | `entrenamientos.crear`                                                                                                          |
| TrainingService       | generateFromSchedules    | `entrenamientos.crear`                                                                                                          |
| TrainingService       | setStatus                | `entrenamientos.editar`                                                                                                         |
| TrainingService       | saveNotes                | alcance de sesión (oficina con `entrenamientos.consultar`, o entrenador de la sesión/categoría); escribir: `asistencias.editar` |
| TutorService          | list                     | `tutores.consultar` o `avisos.crear` o `avisos.editar`                                                                          |
| TutorService          | get                      | `tutores.consultar`                                                                                                             |
| TutorService          | save                     | `tutores.crear` (alta) / `tutores.editar` (edición)                                                                             |
| TutorService          | linkAccount              | `tutores.editar`                                                                                                                |
| TutorService          | unlinkAccount            | `tutores.editar`                                                                                                                |
| TutorService          | updateContact            | `tutores.editar`, o el propio tutor con `portal.editar` (sólo su `tutor_id`)                                                    |
| UniformService        | products                 | `uniformes.consultar`                                                                                                           |
| UniformService        | variants                 | `uniformes.consultar`                                                                                                           |
| UniformService        | saveProduct              | `uniformes.crear` (alta) / `uniformes.editar` (edición)                                                                         |
| UniformService        | setProductActive         | `uniformes.editar`                                                                                                              |
| UniformService        | saveVariant              | `uniformes.crear` (alta) / `uniformes.editar` (edición)                                                                         |
| UniformService        | setVariantActive         | `uniformes.editar`                                                                                                              |
| UniformService        | createOrder              | `uniformes.crear`                                                                                                               |
| UniformService        | orders                   | `uniformes.consultar`                                                                                                           |
| UniformService        | deliver                  | `uniformes.editar`                                                                                                              |
| UniformService        | cancelOrder              | `uniformes.editar`                                                                                                              |
| RoleService           | matrix                   | `roles.consultar`                                                                                                               |
| RoleService           | setPermission            | `roles.editar`                                                                                                                  |
| UserService           | list                     | `usuarios.consultar` o `auditoria.consultar`                                                                                    |
| UserService           | securityRoles            | `usuarios.consultar`                                                                                                            |
| UserService           | save                     | `usuarios.crear` (alta) / `usuarios.editar` (edición) + regla de no escalada                                                    |
| UserService           | setActive                | `usuarios.editar` (activar) / `usuarios.cancelar` (desactivar) + regla de no escalada                                           |
| UserService           | profileAccount           | `tutores.editar` o `entrenadores.editar`; nunca la propia cuenta                                                                |
| VenueService          | list                     | cualquier permiso de oficina                                                                                                    |
| VenueService          | save                     | `sedes.crear` (alta) / `sedes.editar` (edición)                                                                                 |
| VenueService          | setActive                | `sedes.editar`                                                                                                                  |

# Trazabilidad HU → código → pruebas

Estado al 2026-10-07, rama `jorgesucre/feat/backlog-mariadb`. Modelo: [`docs/database/MARIADB.md`](database/MARIADB.md).

- **Estado anterior:** lo que existía en `main` + PRs #1–#4 antes de esta rama. _Parcial_ = UI con `MockDb` de IDs de
  texto y modelo distinto del SQL; _No existía_ = sin servicio ni pantalla.
- **Estado final:** _Implementada_ = modelo + servicio + validaciones + autorización + persistencia en `MockDb` + UI +
  prueba. Todo corre contra `MockDb` (no hay backend); «pendiente de backend» marca lo que sólo la API puede cumplir.
- Pruebas: `CF` = `src/app/critical-flows.spec.ts`, `DR` = `src/app/domain-rules.spec.ts`, `AU` =
  `src/app/core/auth/auth.spec.ts`, `RT` = `src/app/app.routes.spec.ts`, `BR` = `features/billing/billing.rules.spec.ts`,
  `SH` = `shared/shared.spec.ts`. Todas las pruebas de flujo verifican además las restricciones del SQL
  (`core/data/mock-db.integrity.ts`).

| HU     | Estado anterior | Estado final                                                      | Código principal                                                                                  | Pruebas             |
| ------ | --------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------- |
| HU-001 | Parcial         | Implementada                                                      | `core/auth/auth.service.ts`, `features/auth/login.page.ts`                                        | AU, CF-1            |
| HU-002 | Parcial         | Implementada                                                      | `guards.ts` (expiración 8 h / 30 min inactivo), `/coach`                                          | AU, RT              |
| HU-003 | Parcial         | Implementada                                                      | `PortalService.assertChild`, menú «Mi familia»                                                    | AU, RT, CF-6        |
| HU-004 | Parcial         | Implementada                                                      | `features/users/user.service.ts`, `system.pages.ts#UsersPage`                                     | DR-A                |
| HU-005 | Parcial         | Implementada (correo simulado, pendiente de backend)              | `AuthService.changePassword/requestPasswordReset/resetPassword`, `password.pages.ts`              | AU                  |
| HU-006 | No existía      | Implementada                                                      | `role.service.ts`, `PermissionsPage`, `permissions.ts`                                            | DR-A, AU            |
| HU-007 | No existía      | Implementada                                                      | `core/services/audit.service.ts`, `AuditPage`                                                     | DR-A                |
| HU-008 | No existía      | Implementada                                                      | `core/services/player.service.ts#create`, `PlayerFormPage`                                        | CF-2                |
| HU-009 | No existía      | Implementada                                                      | `PlayerService.update`                                                                            | DR-B                |
| HU-010 | No existía      | Implementada                                                      | `PlayerService.changeStatus`, pestaña Estatus del expediente                                      | DR-B                |
| HU-011 | Parcial         | Implementada                                                      | `features/tutors/tutor.service.ts`, `tutors.page.ts`                                              | DR-B                |
| HU-012 | No existía      | Implementada (correo simulado)                                    | `TutorService.linkAccount`, `UserService.profileAccount`                                          | DR-B                |
| HU-013 | No existía      | Implementada                                                      | `PlayerService.record`, `PlayerRecordPage`                                                        | CF-2, RT            |
| HU-014 | No existía      | Implementada                                                      | `PlayerService.search`, `PlayersPage`, `Paginator`                                                | DR-B, SH            |
| HU-015 | No existía      | Implementada                                                      | `core/services/category.service.ts`, `CategoriesPage`                                             | DR-C                |
| HU-016 | No existía      | Implementada                                                      | `features/trainings/schedule.service.ts`, `CategoryDetailPage`                                    | DR-C                |
| HU-017 | No existía      | Implementada                                                      | `features/enrollments/player-category.service.ts#assign`                                          | CF-3, DR-C          |
| HU-018 | Parcial         | Implementada                                                      | `CategoryService.members`, `CategoryDetailPage`                                                   | DR-C                |
| HU-019 | No existía      | Implementada                                                      | `PlayerCategoryService.change`                                                                    | DR-C                |
| HU-020 | Parcial         | Implementada                                                      | `enrollment.service.ts`, `enrollments.page.ts`                                                    | CF-3, DR-C          |
| HU-021 | No existía      | Implementada                                                      | `PlayerCategoryService.eligibility`, ocupación en `CategoryView`                                  | DR-C                |
| HU-022 | Parcial         | Implementada                                                      | `features/coaches/coach.service.ts`, `CoachesPage`                                                | DR-D                |
| HU-023 | No existía      | Implementada                                                      | `CoachService.assignCategory`, `CoachCategoriesPage`                                              | DR-D                |
| HU-024 | No existía      | Implementada                                                      | `coach-panel.service.ts#myCategories`, `CoachHomePage`                                            | DR-D, RT            |
| HU-025 | No existía      | Implementada                                                      | `CoachPanelService.weeklySchedule` (traslapes)                                                    | DR-D                |
| HU-026 | Parcial         | Implementada                                                      | `CoachService.assignCompetition`, `AssignmentsPage`                                               | DR-D                |
| HU-027 | No existía      | Implementada                                                      | `CoachPanelService.myCompetitions`, `CoachCompetitionsPage`                                       | DR-D                |
| HU-028 | No existía      | Implementada                                                      | `training.service.ts`, `TrainingsPage`                                                            | DR-E                |
| HU-029 | No existía      | Implementada                                                      | `CoachPanelService.sessions`, `CoachSessionsPage`                                                 | RT                  |
| HU-030 | No existía      | Implementada                                                      | `attendance.service.ts#record`, `SessionPage`                                                     | DR-E                |
| HU-031 | No existía      | Implementada                                                      | `TrainingService.saveNotes`                                                                       | DR-E                |
| HU-032 | No existía      | Implementada (sin exportación; era opcional)                      | `AttendanceService.report`, `AttendanceReportPage`                                                | DR-E                |
| HU-033 | No existía      | Implementada                                                      | `AttendanceService.history` vía `PortalService.child`                                             | DR-J                |
| HU-034 | No existía      | Implementada                                                      | `core/services/competition.service.ts`, `CompetitionsPage`                                        | DR-F                |
| HU-035 | No existía      | Implementada                                                      | `CompetitionService.register`, `CompetitionDetailPage`                                            | DR-F                |
| HU-036 | No existía      | Implementada                                                      | `CompetitionService.addToRoster/removeFromRoster`                                                 | DR-F                |
| HU-037 | No existía      | Implementada                                                      | `features/matches/match.service.ts`, `MatchesPage`                                                | CF-5                |
| HU-038 | No existía      | Implementada                                                      | `CoachPanelService.myMatches`, `CoachCompetitionsPage`                                            | DR-D                |
| HU-039 | No existía      | Implementada                                                      | `PortalService.child` (vía plantel)                                                               | DR-J                |
| HU-040 | No existía      | Implementada                                                      | `MatchService.recordResult`                                                                       | CF-5, DR-F          |
| HU-041 | No existía      | Implementada                                                      | `CoachPanelService.myMatches` (orden configurable)                                                | RT                  |
| HU-042 | No existía      | Implementada                                                      | `PortalService.child().results`                                                                   | DR-J                |
| HU-043 | Parcial         | Implementada                                                      | `BillingService.saveConcept`, `ConceptsPage`                                                      | DR-G                |
| HU-044 | Parcial         | Implementada                                                      | `BillingService.generateMonthlyFees`, `billing.rules.ts`, `ChargesPage`                           | BR, DR-G            |
| HU-045 | No existía      | Implementada                                                      | `BillingService.registerPayment`, `PaymentPage`                                                   | CF-4, BR            |
| HU-046 | No existía      | Implementada                                                      | `BillingService.statement`, `StatementPage`                                                       | CF-4, DR-G          |
| HU-047 | No existía      | Implementada                                                      | `PortalService.child().statement`                                                                 | CF-6                |
| HU-048 | Parcial         | Implementada                                                      | `BillingService.receipts/receipt/receiptByFolio`, `ReceiptPage`                                   | RT                  |
| HU-049 | No existía      | Implementada                                                      | `BillingService.cancelPayment`                                                                    | CF-4, DR-G          |
| HU-050 | Parcial         | Implementada                                                      | `BillingService.debts`, `DebtsPage`                                                               | DR-G, BR            |
| HU-051 | No existía      | Implementada                                                      | `BillingService.addDiscount`, `DiscountsPage`                                                     | DR-G, BR            |
| HU-052 | Parcial         | Implementada                                                      | `UniformService` (catálogo), `UniformCatalogPage`                                                 | DR-H                |
| HU-053 | Parcial         | Implementada                                                      | `UniformService.createOrder`                                                                      | DR-H                |
| HU-054 | Parcial         | Implementada                                                      | `pedidos_uniforme.cargo_id`, `UniformService.syncPaid/cancelOrder`                                | DR-H                |
| HU-055 | Parcial         | Implementada                                                      | `UniformService.deliver`                                                                          | DR-H                |
| HU-056 | Parcial         | Implementada                                                      | `PortalService.child().uniforms`                                                                  | RT                  |
| HU-057 | No existía      | Implementada                                                      | `features/notices/notice.service.ts`, `NoticesPage`                                               | DR-I                |
| HU-058 | No existía      | Implementada                                                      | `aviso_destinatario` CATEGORIA (varias)                                                           | DR-I                |
| HU-059 | No existía      | Implementada                                                      | `NoticeService.forTutor`, `PortalNoticesPage`                                                     | DR-I                |
| HU-060 | No existía      | Implementada                                                      | `NoticeService.forCoach`, `CoachNoticesPage`                                                      | DR-I, DR-D          |
| HU-061 | No existía      | Implementada                                                      | `PortalService.overview`, `PortalHomePage`                                                        | CF-6, DR-J          |
| HU-062 | No existía      | Implementada                                                      | `PortalService.child` (horarios, sede, entrenadores)                                              | DR-J                |
| HU-063 | Parcial         | Implementada (ahora por plantel, no por categoría)                | `PortalService.child().competitions`                                                              | CF-6, DR-J          |
| HU-064 | No existía      | Implementada                                                      | `TutorService.updateContact`, `ProfilePage`                                                       | DR-J                |
| HU-065 | No existía      | Implementada                                                      | `ReportService.dashboard`, `DashboardPage`                                                        | DR-K                |
| HU-066 | No existía      | Implementada                                                      | `ReportService.playersByCategory`, `PlayersReportPage`                                            | DR-K                |
| HU-067 | Parcial         | Implementada                                                      | `ReportService.income`                                                                            | DR-K, BR            |
| HU-068 | Parcial         | Implementada                                                      | `ReportService.agenda`, `AgendaPage`                                                              | DR-K                |
| HU-069 | No existía      | Implementada                                                      | `features/venues/venue.service.ts`, `VenuesPage`                                                  | RT                  |
| HU-070 | Parcial         | Implementada                                                      | `SeasonService` (`es_actual` única y activa)                                                      | DR-C                |
| HU-071 | Parcial         | Implementada, **sin validación visual**                           | `src/styles.css` (tablas con scroll, captura de asistencia y portal en tarjetas, menú colapsable) | —                   |
| HU-072 | Parcial         | Parcial: lo del frontend hecho; pendiente de backend              | hash con sal en el mock, sesiones con token hasheado, guards + autorización en servicios          | AU, RT              |
| HU-073 | Parcial         | Implementada                                                      | `mock-db.integrity.ts`, `MockDb.transaction`, checks MariaDB 42/42                                | CF, DR (afterEach)  |
| HU-074 | Parcial         | Implementada (servicio + rutas; sin E2E de navegador)             | `critical-flows.spec.ts` (los 6 flujos)                                                           | CF                  |
| HU-075 | No existía      | Parcial: paginación, filtros y sin N+1; tiempo objetivo no medido | `shared/page.ts`, `Paginator`, `MARIADB.md` § 5                                                   | SH, DR-B            |
| HU-076 | No existía      | Implementada                                                      | `MARIADB.md` § 6 (procedimiento + evidencia de restauración)                                      | manual, documentada |

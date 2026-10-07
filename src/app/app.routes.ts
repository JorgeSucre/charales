import { Route, Routes } from '@angular/router';
import { guestOnly, requirePermission as can } from './core/auth/guards';
import { PermissionKey } from './core/auth/permissions';
import { Forbidden, Home } from './layout/home';
import { Shell } from './layout/shell';

const auth = () => import('./features/auth/password.pages');
const players = () => import('./features/players/players.pages');
const coaches = () => import('./features/coaches/coaches.pages');
const categories = () => import('./features/categories/categories.pages');
const trainings = () => import('./features/trainings/trainings.pages');
const competitions = () => import('./features/competitions/competitions.pages');
const billing = () => import('./features/billing/billing.pages');
const payments = () => import('./features/billing/payments.pages');
const uniforms = () => import('./features/uniforms/uniforms.pages');
const reports = () => import('./features/reports/reports.pages');
const system = () => import('./features/users/system.pages');
const coachPanel = () => import('./features/coach-panel/coach-panel.pages');
const portal = () => import('./features/parent-portal/portal.pages');

/** Leaf route protected by a permission (PermissionKey = a permisos row). */
function page(
  path: string,
  permission: PermissionKey,
  loadComponent: Route['loadComponent'],
): Route {
  return { path, canActivate: [can(permission)], loadComponent };
}

/**
 * Areas: public auth pages | /admin (office) | /sports (sporting office) | /coach (coach panel) | /portal (families).
 * Every leaf declares the permission it needs; app.routes.spec.ts keeps the security table in sync.
 */
export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestOnly],
    loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
  },
  { path: 'forgot-password', loadComponent: () => auth().then((m) => m.ForgotPasswordPage) },
  { path: 'reset-password', loadComponent: () => auth().then((m) => m.ResetPasswordPage) },
  {
    path: '',
    component: Shell,
    canActivate: [can()],
    children: [
      { path: '', component: Home },
      { path: 'forbidden', component: Forbidden },
      { path: 'account/password', loadComponent: () => auth().then((m) => m.ChangePasswordPage) },
      {
        path: 'admin',
        children: [
          { path: '', pathMatch: 'full', redirectTo: '/' },
          page('dashboard', 'reportes.consultar', () => reports().then((m) => m.DashboardPage)),
          page('players', 'jugadores.consultar', () => players().then((m) => m.PlayersPage)),
          page('players/new', 'jugadores.crear', () => players().then((m) => m.PlayerFormPage)),
          page('players/:id', 'jugadores.consultar', () =>
            players().then((m) => m.PlayerRecordPage),
          ),
          page('players/:id/edit', 'jugadores.editar', () =>
            players().then((m) => m.PlayerFormPage),
          ),
          page('tutors', 'tutores.consultar', () =>
            import('./features/tutors/tutors.page').then((m) => m.TutorsPage),
          ),
          page('coaches', 'entrenadores.consultar', () => coaches().then((m) => m.CoachesPage)),
          page('coaches/categories', 'entrenadores.consultar', () =>
            coaches().then((m) => m.CoachCategoriesPage),
          ),
          page('coaches/assignments', 'competencias.consultar', () =>
            coaches().then((m) => m.AssignmentsPage),
          ),
          page('seasons', 'temporadas.consultar', () =>
            import('./features/seasons/seasons.page').then((m) => m.SeasonsPage),
          ),
          page('enrollments', 'inscripciones.consultar', () =>
            import('./features/enrollments/enrollments.page').then((m) => m.EnrollmentsPage),
          ),
          page('billing/concepts', 'cobranza.consultar', () =>
            billing().then((m) => m.ConceptsPage),
          ),
          page('billing/charges', 'cobranza.consultar', () => billing().then((m) => m.ChargesPage)),
          page('billing/monthly', 'cobranza.crear', () => billing().then((m) => m.MonthlyFeesPage)),
          page('billing/discounts', 'descuentos.consultar', () =>
            billing().then((m) => m.DiscountsPage),
          ),
          page('billing/payments/new', 'pagos.crear', () => payments().then((m) => m.PaymentPage)),
          page('billing/receipts', 'pagos.consultar', () => payments().then((m) => m.ReceiptsPage)),
          page('billing/receipts/:id', 'pagos.consultar', () =>
            payments().then((m) => m.ReceiptPage),
          ),
          page('billing/statement', 'pagos.consultar', () =>
            payments().then((m) => m.StatementPage),
          ),
          page('billing/debts', 'cobranza.consultar', () => payments().then((m) => m.DebtsPage)),
          page('uniforms/catalog', 'uniformes.consultar', () =>
            uniforms().then((m) => m.UniformCatalogPage),
          ),
          page('uniforms/orders', 'uniformes.consultar', () =>
            uniforms().then((m) => m.UniformOrdersPage),
          ),
          page('notices', 'avisos.consultar', () =>
            import('./features/notices/notices.page').then((m) => m.NoticesPage),
          ),
          page('reports/players', 'reportes.consultar', () =>
            reports().then((m) => m.PlayersReportPage),
          ),
          page('reports/income', 'reportes.consultar', () =>
            reports().then((m) => m.IncomeReportPage),
          ),
          page('users', 'usuarios.consultar', () => system().then((m) => m.UsersPage)),
          page('permissions', 'roles.consultar', () => system().then((m) => m.PermissionsPage)),
          page('audit', 'auditoria.consultar', () => system().then((m) => m.AuditPage)),
        ],
      },
      {
        path: 'sports',
        children: [
          page('categories', 'categorias.consultar', () =>
            categories().then((m) => m.CategoriesPage),
          ),
          page('categories/:id', 'categorias.consultar', () =>
            categories().then((m) => m.CategoryDetailPage),
          ),
          page('venues', 'sedes.consultar', () =>
            import('./features/venues/venues.page').then((m) => m.VenuesPage),
          ),
          page('trainings', 'entrenamientos.consultar', () =>
            trainings().then((m) => m.TrainingsPage),
          ),
          page('trainings/:id', 'entrenamientos.consultar', () =>
            trainings().then((m) => m.SessionPage),
          ),
          page('attendance', 'asistencias.consultar', () =>
            trainings().then((m) => m.AttendanceReportPage),
          ),
          page('competitions', 'competencias.consultar', () =>
            competitions().then((m) => m.CompetitionsPage),
          ),
          page('competitions/:id', 'competencias.consultar', () =>
            competitions().then((m) => m.CompetitionDetailPage),
          ),
          page('matches', 'partidos.consultar', () =>
            import('./features/matches/matches.page').then((m) => m.MatchesPage),
          ),
          page('agenda', 'reportes.consultar', () => reports().then((m) => m.AgendaPage)),
        ],
      },
      {
        path: 'coach',
        children: [
          page('', 'panel_entrenador.consultar', () => coachPanel().then((m) => m.CoachHomePage)),
          page('sessions', 'panel_entrenador.consultar', () =>
            coachPanel().then((m) => m.CoachSessionsPage),
          ),
          page('sessions/:id', 'panel_entrenador.consultar', () =>
            trainings().then((m) => m.SessionPage),
          ),
          page('competitions', 'panel_entrenador.consultar', () =>
            coachPanel().then((m) => m.CoachCompetitionsPage),
          ),
          page('notices', 'panel_entrenador.consultar', () =>
            coachPanel().then((m) => m.CoachNoticesPage),
          ),
        ],
      },
      {
        path: 'portal',
        children: [
          page('', 'portal.consultar', () => portal().then((m) => m.PortalHomePage)),
          page('children/:id', 'portal.consultar', () => portal().then((m) => m.ChildPage)),
          page('notices', 'portal.consultar', () => portal().then((m) => m.PortalNoticesPage)),
          page('profile', 'portal.editar', () => portal().then((m) => m.ProfilePage)),
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];

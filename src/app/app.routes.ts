import { Routes } from '@angular/router';
import { guestOnly, requirePermission as can } from './core/auth/guards';
import { Forbidden, Home } from './layout/home';
import { Shell } from './layout/shell';

const auth = () => import('./features/auth/password.pages');
const billing = () => import('./features/billing/billing.pages');
const uniforms = () => import('./features/uniforms/uniforms.pages');
const coaches = () => import('./features/coaches/coaches.page');
const reports = () => import('./features/reports/reports.pages');

/**
 * Areas: public auth pages | /admin (office) | /sports (coaches + office) | /portal (tutors).
 * Every leaf route declares the permission it needs; see core/auth/permissions.ts.
 */
export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestOnly],
    loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
  },
  { path: 'forgot-password', loadComponent: () => auth().then((m) => m.ForgotPasswordPage) },
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
          {
            path: 'users',
            canActivate: [can('users.manage')],
            loadComponent: () => import('./features/users/users.page').then((m) => m.UsersPage),
          },
          {
            path: 'seasons',
            canActivate: [can('seasons.manage')],
            loadComponent: () =>
              import('./features/seasons/seasons.page').then((m) => m.SeasonsPage),
          },
          {
            path: 'tutors',
            canActivate: [can('tutors.manage')],
            loadComponent: () => import('./features/tutors/tutors.page').then((m) => m.TutorsPage),
          },
          {
            path: 'enrollments',
            canActivate: [can('enrollments.manage')],
            loadComponent: () =>
              import('./features/enrollments/enrollments.page').then((m) => m.EnrollmentsPage),
          },
          {
            path: 'coaches',
            canActivate: [can('coaches.manage')],
            loadComponent: () => coaches().then((m) => m.CoachesPage),
          },
          {
            path: 'coaches/assignments',
            canActivate: [can('coaches.manage')],
            loadComponent: () => coaches().then((m) => m.AssignmentsPage),
          },
          {
            path: 'billing/concepts',
            canActivate: [can('billing.manage')],
            loadComponent: () => billing().then((m) => m.ConceptsPage),
          },
          {
            path: 'billing/monthly',
            canActivate: [can('billing.manage')],
            loadComponent: () => billing().then((m) => m.MonthlyFeesPage),
          },
          {
            path: 'billing/receipts',
            canActivate: [can('billing.manage')],
            loadComponent: () => billing().then((m) => m.ReceiptsPage),
          },
          {
            path: 'billing/receipts/:id',
            canActivate: [can('billing.manage')],
            loadComponent: () => billing().then((m) => m.ReceiptPage),
          },
          {
            path: 'billing/debts',
            canActivate: [can('billing.manage')],
            loadComponent: () => billing().then((m) => m.DebtsPage),
          },
          {
            path: 'uniforms/catalog',
            canActivate: [can('uniforms.manage')],
            loadComponent: () => uniforms().then((m) => m.UniformCatalogPage),
          },
          {
            path: 'uniforms/orders',
            canActivate: [can('uniforms.manage')],
            loadComponent: () => uniforms().then((m) => m.UniformOrdersPage),
          },
          {
            path: 'reports/income',
            canActivate: [can('reports.view')],
            loadComponent: () => reports().then((m) => m.IncomeReportPage),
          },
        ],
      },
      {
        path: 'sports',
        children: [
          {
            path: 'categories',
            canActivate: [can('categories.view')],
            loadComponent: () =>
              import('./features/categories/category-players.page').then(
                (m) => m.CategoryPlayersPage,
              ),
          },
          {
            path: 'agenda',
            canActivate: [can('agenda.view')],
            loadComponent: () => reports().then((m) => m.AgendaPage),
          },
        ],
      },
      {
        path: 'portal',
        canActivate: [can('portal.view')],
        loadComponent: () =>
          import('./features/parent-portal/portal.page').then((m) => m.PortalPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];

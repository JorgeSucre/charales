import { Permission } from '../core/auth/permissions';

export interface NavItem {
  label: string;
  path: string;
  permission: Permission;
  section: 'Administración' | 'Cobranza' | 'Uniformes' | 'Deportivo' | 'Reportes' | 'Mi familia';
}

/** Single source for the menu and the home page. Items are filtered by permission. */
export const NAV_ITEMS: NavItem[] = [
  {
    section: 'Administración',
    label: 'Usuarios',
    path: '/admin/users',
    permission: 'users.manage',
  },
  {
    section: 'Administración',
    label: 'Temporadas',
    path: '/admin/seasons',
    permission: 'seasons.manage',
  },
  {
    section: 'Administración',
    label: 'Tutores',
    path: '/admin/tutors',
    permission: 'tutors.manage',
  },
  {
    section: 'Administración',
    label: 'Inscripciones',
    path: '/admin/enrollments',
    permission: 'enrollments.manage',
  },
  {
    section: 'Administración',
    label: 'Entrenadores',
    path: '/admin/coaches',
    permission: 'coaches.manage',
  },
  {
    section: 'Administración',
    label: 'Asignación a torneos',
    path: '/admin/coaches/assignments',
    permission: 'coaches.manage',
  },
  {
    section: 'Cobranza',
    label: 'Conceptos de cobro',
    path: '/admin/billing/concepts',
    permission: 'billing.manage',
  },
  {
    section: 'Cobranza',
    label: 'Mensualidades',
    path: '/admin/billing/monthly',
    permission: 'billing.manage',
  },
  {
    section: 'Cobranza',
    label: 'Recibos',
    path: '/admin/billing/receipts',
    permission: 'billing.manage',
  },
  {
    section: 'Cobranza',
    label: 'Adeudos',
    path: '/admin/billing/debts',
    permission: 'billing.manage',
  },
  {
    section: 'Uniformes',
    label: 'Catálogo',
    path: '/admin/uniforms/catalog',
    permission: 'uniforms.manage',
  },
  {
    section: 'Uniformes',
    label: 'Pedidos y entregas',
    path: '/admin/uniforms/orders',
    permission: 'uniforms.manage',
  },
  {
    section: 'Deportivo',
    label: 'Jugadores por categoría',
    path: '/sports/categories',
    permission: 'categories.view',
  },
  { section: 'Deportivo', label: 'Agenda', path: '/sports/agenda', permission: 'agenda.view' },
  {
    section: 'Reportes',
    label: 'Ingresos',
    path: '/admin/reports/income',
    permission: 'reports.view',
  },
  { section: 'Mi familia', label: 'Mis hijos', path: '/portal', permission: 'portal.view' },
];

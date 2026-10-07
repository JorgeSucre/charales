import { PermissionKey } from '../core/auth/permissions';

export type NavSection =
  | 'Inicio'
  | 'Personas'
  | 'Deportivo'
  | 'Administración'
  | 'Cobranza'
  | 'Uniformes'
  | 'Comunicación'
  | 'Reportes'
  | 'Sistema'
  | 'Mi panel'
  | 'Mi familia';

export interface NavItem {
  label: string;
  path: string;
  permission: PermissionKey;
  section: NavSection;
}

/**
 * Single source for the menu and the home page, derived from the domain (no "Equipos", "Evaluaciones" or
 * "Configuración": the MariaDB model has none). Items are filtered by the session's permissions.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    section: 'Inicio',
    label: 'Tablero',
    path: '/admin/dashboard',
    permission: 'reportes.consultar',
  },

  {
    section: 'Personas',
    label: 'Jugadores',
    path: '/admin/players',
    permission: 'jugadores.consultar',
  },
  { section: 'Personas', label: 'Tutores', path: '/admin/tutors', permission: 'tutores.consultar' },
  {
    section: 'Personas',
    label: 'Entrenadores',
    path: '/admin/coaches',
    permission: 'entrenadores.consultar',
  },

  {
    section: 'Deportivo',
    label: 'Temporadas',
    path: '/admin/seasons',
    permission: 'temporadas.consultar',
  },
  {
    section: 'Deportivo',
    label: 'Categorías',
    path: '/sports/categories',
    permission: 'categorias.consultar',
  },
  { section: 'Deportivo', label: 'Sedes', path: '/sports/venues', permission: 'sedes.consultar' },
  {
    section: 'Deportivo',
    label: 'Entrenadores por categoría',
    path: '/admin/coaches/categories',
    permission: 'entrenadores.consultar',
  },
  {
    section: 'Deportivo',
    label: 'Entrenamientos',
    path: '/sports/trainings',
    permission: 'entrenamientos.consultar',
  },
  {
    section: 'Deportivo',
    label: 'Asistencia',
    path: '/sports/attendance',
    permission: 'asistencias.consultar',
  },
  {
    section: 'Deportivo',
    label: 'Competencias',
    path: '/sports/competitions',
    permission: 'competencias.consultar',
  },
  {
    section: 'Deportivo',
    label: 'Entrenadores por competencia',
    path: '/admin/coaches/assignments',
    permission: 'competencias.consultar',
  },
  {
    section: 'Deportivo',
    label: 'Partidos',
    path: '/sports/matches',
    permission: 'partidos.consultar',
  },
  {
    section: 'Deportivo',
    label: 'Agenda',
    path: '/sports/agenda',
    permission: 'reportes.consultar',
  },

  {
    section: 'Administración',
    label: 'Inscripciones',
    path: '/admin/enrollments',
    permission: 'inscripciones.consultar',
  },

  {
    section: 'Cobranza',
    label: 'Conceptos',
    path: '/admin/billing/concepts',
    permission: 'cobranza.consultar',
  },
  {
    section: 'Cobranza',
    label: 'Cargos',
    path: '/admin/billing/charges',
    permission: 'cobranza.consultar',
  },
  {
    section: 'Cobranza',
    label: 'Generar mensualidades',
    path: '/admin/billing/monthly',
    permission: 'cobranza.crear',
  },
  {
    section: 'Cobranza',
    label: 'Registrar pago',
    path: '/admin/billing/payments/new',
    permission: 'pagos.crear',
  },
  {
    section: 'Cobranza',
    label: 'Pagos y recibos',
    path: '/admin/billing/receipts',
    permission: 'pagos.consultar',
  },
  {
    section: 'Cobranza',
    label: 'Estado de cuenta',
    path: '/admin/billing/statement',
    permission: 'pagos.consultar',
  },
  {
    section: 'Cobranza',
    label: 'Adeudos',
    path: '/admin/billing/debts',
    permission: 'cobranza.consultar',
  },
  {
    section: 'Cobranza',
    label: 'Descuentos y becas',
    path: '/admin/billing/discounts',
    permission: 'descuentos.consultar',
  },

  {
    section: 'Uniformes',
    label: 'Catálogo',
    path: '/admin/uniforms/catalog',
    permission: 'uniformes.consultar',
  },
  {
    section: 'Uniformes',
    label: 'Pedidos',
    path: '/admin/uniforms/orders',
    permission: 'uniformes.consultar',
  },

  {
    section: 'Comunicación',
    label: 'Avisos',
    path: '/admin/notices',
    permission: 'avisos.consultar',
  },

  {
    section: 'Reportes',
    label: 'Jugadores por categoría',
    path: '/admin/reports/players',
    permission: 'reportes.consultar',
  },
  {
    section: 'Reportes',
    label: 'Ingresos',
    path: '/admin/reports/income',
    permission: 'reportes.consultar',
  },

  { section: 'Sistema', label: 'Usuarios', path: '/admin/users', permission: 'usuarios.consultar' },
  {
    section: 'Sistema',
    label: 'Permisos',
    path: '/admin/permissions',
    permission: 'roles.consultar',
  },
  {
    section: 'Sistema',
    label: 'Auditoría',
    path: '/admin/audit',
    permission: 'auditoria.consultar',
  },

  {
    section: 'Mi panel',
    label: 'Mis categorías',
    path: '/coach',
    permission: 'panel_entrenador.consultar',
  },
  {
    section: 'Mi panel',
    label: 'Mis entrenamientos',
    path: '/coach/sessions',
    permission: 'panel_entrenador.consultar',
  },
  {
    section: 'Mi panel',
    label: 'Competencias y partidos',
    path: '/coach/competitions',
    permission: 'panel_entrenador.consultar',
  },
  {
    section: 'Mi panel',
    label: 'Avisos',
    path: '/coach/notices',
    permission: 'panel_entrenador.consultar',
  },

  { section: 'Mi familia', label: 'Mis hijos', path: '/portal', permission: 'portal.consultar' },
  {
    section: 'Mi familia',
    label: 'Avisos',
    path: '/portal/notices',
    permission: 'portal.consultar',
  },
  {
    section: 'Mi familia',
    label: 'Mi perfil',
    path: '/portal/profile',
    permission: 'portal.editar',
  },
];

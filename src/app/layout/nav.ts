import { PermissionKey } from '../core/auth/permissions';

export type NavSection =
  | 'Resumen'
  | 'Personas'
  | 'Gestión deportiva'
  | 'Competencias'
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

/** 24×24 stroke icon per section (SVG path data), drawn for the menu and the Tablero's quick tasks. Decorative. */
export const SECTION_ICONS: Record<NavSection, string> = {
  Resumen: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  Personas:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6',
  'Gestión deportiva':
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5l4 3-1.5 4.5h-5L8 10.5zM12 3v4.5M16 10.5 20.5 9M14.5 15l2.5 4M9.5 15 7 19M8 10.5 3.5 9',
  Competencias:
    'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M10 17h4',
  Administración: 'M9 3h6v3H9zM9 4.5H6v16h12v-16h-3M9 11h6M9 15h4',
  Cobranza: 'M3 6h18v12H3zM3 10h18M7 15h3',
  Uniformes: 'M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0z',
  Comunicación: 'M3 10v4h4l7 4V6l-7 4zM17 9a3 3 0 0 1 0 6M7 14l1 5h3l-1-4',
  Reportes: 'M4 4v16h16M8 16v-5M12 16V8M16 16v-3',
  Sistema: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3M12 15v2',
  'Mi panel': 'M5 4h14v16H5zM9 12l2 2 4-4',
  'Mi familia': 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
};

/** Interface icons of the shell (same 24×24 stroke style): hamburger, close and group chevron. */
export const UI_ICONS = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6 6 18',
  chevron: 'm6 9 6 6 6-6',
};

/** A frequent office task offered on the Tablero (a shortcut, never a second menu). */
export interface QuickTask {
  label: string;
  path: string;
  /** `nuevo=1` opens the page's create form at once (FormPanel pages). */
  query?: Record<string, string>;
  /** Every one is needed: the page's own permission and the one of the action. */
  permissions: PermissionKey[];
  icon: string;
}

/** The Tablero's quick tasks, in this order; only the ones the session may perform are shown. */
export const QUICK_TASKS: QuickTask[] = [
  {
    label: 'Registrar jugador',
    path: '/admin/players/new',
    permissions: ['jugadores.crear'],
    icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  },
  {
    label: 'Registrar tutor',
    path: '/admin/tutors',
    query: { nuevo: '1' },
    permissions: ['tutores.consultar', 'tutores.crear'],
    icon: SECTION_ICONS.Personas,
  },
  {
    label: 'Registrar entrenador',
    path: '/admin/coaches',
    query: { nuevo: '1' },
    permissions: ['entrenadores.consultar', 'entrenadores.crear'],
    icon: 'M3 5h18v14H3zM8.5 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5.5 16a3 3 0 0 1 6 0M14 9h4M14 13h4',
  },
  {
    label: 'Registrar pago',
    path: '/admin/billing/payments/new',
    permissions: ['pagos.crear'],
    icon: SECTION_ICONS.Cobranza,
  },
  {
    label: 'Consultar adeudos',
    path: '/admin/billing/debts',
    permissions: ['cobranza.consultar'],
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v6M12 16.5v.5',
  },
  {
    label: 'Programar entrenamiento',
    path: '/sports/trainings',
    query: { nuevo: '1' },
    permissions: ['entrenamientos.consultar', 'entrenamientos.crear'],
    icon: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 2.5M10 2h4M12 2v3',
  },
  {
    label: 'Programar partido',
    path: '/sports/matches',
    query: { nuevo: '1' },
    permissions: ['partidos.consultar', 'partidos.crear'],
    icon: SECTION_ICONS.Competencias,
  },
];

/**
 * Single source for the menu, derived from the domain (no "Equipos", "Evaluaciones" or
 * "Configuración": the MariaDB model has none). Items are filtered by the session's permissions.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    section: 'Resumen',
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
  {
    section: 'Personas',
    label: 'Tutores',
    path: '/admin/tutors',
    permission: 'tutores.consultar',
  },
  {
    section: 'Personas',
    label: 'Entrenadores',
    path: '/admin/coaches',
    permission: 'entrenadores.consultar',
  },

  {
    section: 'Gestión deportiva',
    label: 'Temporadas',
    path: '/admin/seasons',
    permission: 'temporadas.consultar',
  },
  {
    section: 'Gestión deportiva',
    label: 'Categorías',
    path: '/sports/categories',
    permission: 'categorias.consultar',
  },
  {
    section: 'Gestión deportiva',
    label: 'Sedes',
    path: '/sports/venues',
    permission: 'sedes.consultar',
  },
  {
    section: 'Gestión deportiva',
    label: 'Entrenadores por categoría',
    path: '/admin/coaches/categories',
    permission: 'entrenadores.consultar',
  },
  {
    section: 'Gestión deportiva',
    label: 'Entrenamientos',
    path: '/sports/trainings',
    permission: 'entrenamientos.consultar',
  },
  {
    section: 'Gestión deportiva',
    label: 'Asistencia',
    path: '/sports/attendance',
    permission: 'asistencias.consultar',
  },
  {
    section: 'Competencias',
    label: 'Competencias',
    path: '/sports/competitions',
    permission: 'competencias.consultar',
  },
  {
    section: 'Competencias',
    label: 'Entrenadores por competencia',
    path: '/admin/coaches/assignments',
    permission: 'competencias.consultar',
  },
  {
    section: 'Competencias',
    label: 'Partidos',
    path: '/sports/matches',
    permission: 'partidos.consultar',
  },
  {
    section: 'Gestión deportiva',
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

  {
    section: 'Sistema',
    label: 'Datos desde la API',
    path: '/admin/api',
    permission: 'jugadores.consultar',
  },
  {
    section: 'Sistema',
    label: 'Usuarios',
    path: '/admin/users',
    permission: 'usuarios.consultar',
  },
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

  {
    section: 'Mi familia',
    label: 'Mis hijos',
    path: '/portal',
    permission: 'portal.consultar',
  },
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

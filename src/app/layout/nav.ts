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
  /** One line for the home cards; describes what the page really does. */
  description: string;
  permission: PermissionKey;
  section: NavSection;
}

/** 24×24 stroke icon per section (SVG path data), drawn for the menu and the home cards. Decorative. */
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

/** Interface icons of the shell (same 24×24 stroke style): hamburger, close, group chevron and Inicio. */
export const UI_ICONS = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6 6 18',
  chevron: 'm6 9 6 6 6-6',
  home: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10',
};

/**
 * Inicio's quick-access cards: the everyday office tasks, in this order, each with its own icon in the SECTION_ICONS
 * style. Only paths of NAV_ITEMS (so only implemented modules), and only the ones the session can open.
 */
export const QUICK_ACCESS: Record<string, string> = {
  '/admin/players': 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  '/admin/tutors': SECTION_ICONS.Personas,
  '/admin/coaches':
    'M3 5h18v14H3zM8.5 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5.5 16a3 3 0 0 1 6 0M14 9h4M14 13h4',
  '/sports/categories': 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5',
  '/sports/venues':
    'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  '/admin/seasons': 'M4 5h16v15H4zM4 10h16M8 3v4M16 3v4',
  '/sports/trainings': 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 2.5M10 2h4M12 2v3',
  '/sports/attendance': 'M10 6h10M10 12h10M10 18h10M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  '/admin/billing/payments/new': SECTION_ICONS.Cobranza,
};

/**
 * Single source for the menu and the home page, derived from the domain (no "Equipos", "Evaluaciones" or
 * "Configuración": the MariaDB model has none). Items are filtered by the session's permissions.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    section: 'Resumen',
    label: 'Tablero',
    path: '/admin/dashboard',
    description: 'Indicadores de jugadores, cobranza y partidos.',
    permission: 'reportes.consultar',
  },

  {
    section: 'Personas',
    label: 'Jugadores',
    path: '/admin/players',
    description: 'Búsqueda, alta, edición y expediente de jugadores.',
    permission: 'jugadores.consultar',
  },
  {
    section: 'Personas',
    label: 'Tutores',
    path: '/admin/tutors',
    description: 'Tutores, su relación con cada jugador y cuenta del portal.',
    permission: 'tutores.consultar',
  },
  {
    section: 'Personas',
    label: 'Entrenadores',
    path: '/admin/coaches',
    description: 'Entrenadores, contacto, estatus y cuenta de acceso.',
    permission: 'entrenadores.consultar',
  },

  {
    section: 'Gestión deportiva',
    label: 'Temporadas',
    path: '/admin/seasons',
    description: 'Temporadas y cuál es la vigente.',
    permission: 'temporadas.consultar',
  },
  {
    section: 'Gestión deportiva',
    label: 'Categorías',
    path: '/sports/categories',
    description: 'Categorías por temporada, rango de edad, cupo y horarios.',
    permission: 'categorias.consultar',
  },
  {
    section: 'Gestión deportiva',
    label: 'Sedes',
    path: '/sports/venues',
    description: 'Sedes y campos para entrenamientos y partidos.',
    permission: 'sedes.consultar',
  },
  {
    section: 'Gestión deportiva',
    label: 'Entrenadores por categoría',
    path: '/admin/coaches/categories',
    description: 'Entrenadores asignados a cada categoría y su vigencia.',
    permission: 'entrenadores.consultar',
  },
  {
    section: 'Gestión deportiva',
    label: 'Entrenamientos',
    path: '/sports/trainings',
    description: 'Sesiones de entrenamiento programadas y su estado.',
    permission: 'entrenamientos.consultar',
  },
  {
    section: 'Gestión deportiva',
    label: 'Asistencia',
    path: '/sports/attendance',
    description: 'Asistencia por jugador, categoría y periodo.',
    permission: 'asistencias.consultar',
  },
  {
    section: 'Competencias',
    label: 'Competencias',
    path: '/sports/competitions',
    description: 'Torneos y ligas, categorías inscritas y planteles.',
    permission: 'competencias.consultar',
  },
  {
    section: 'Competencias',
    label: 'Entrenadores por competencia',
    path: '/admin/coaches/assignments',
    description: 'Entrenador de cada categoría en una competencia.',
    permission: 'competencias.consultar',
  },
  {
    section: 'Competencias',
    label: 'Partidos',
    path: '/sports/matches',
    description: 'Calendario, reprogramaciones y resultados de partidos.',
    permission: 'partidos.consultar',
  },
  {
    section: 'Gestión deportiva',
    label: 'Agenda',
    path: '/sports/agenda',
    description: 'Calendario de entrenamientos y partidos.',
    permission: 'reportes.consultar',
  },

  {
    section: 'Administración',
    label: 'Inscripciones',
    path: '/admin/enrollments',
    description: 'Inscripción anual de jugadores por temporada.',
    permission: 'inscripciones.consultar',
  },

  {
    section: 'Cobranza',
    label: 'Conceptos',
    path: '/admin/billing/concepts',
    description: 'Conceptos de cobro con su importe sugerido.',
    permission: 'cobranza.consultar',
  },
  {
    section: 'Cobranza',
    label: 'Cargos',
    path: '/admin/billing/charges',
    description: 'Cargos por jugador con pagado, saldo y estado.',
    permission: 'cobranza.consultar',
  },
  {
    section: 'Cobranza',
    label: 'Generar mensualidades',
    path: '/admin/billing/monthly',
    description: 'Mensualidades del periodo para jugadores activos.',
    permission: 'cobranza.crear',
  },
  {
    section: 'Cobranza',
    label: 'Registrar pago',
    path: '/admin/billing/payments/new',
    description: 'Pago total o parcial de cargos, con folio.',
    permission: 'pagos.crear',
  },
  {
    section: 'Cobranza',
    label: 'Pagos y recibos',
    path: '/admin/billing/receipts',
    description: 'Búsqueda de pagos, recibos y cancelaciones.',
    permission: 'pagos.consultar',
  },
  {
    section: 'Cobranza',
    label: 'Estado de cuenta',
    path: '/admin/billing/statement',
    description: 'Cargos, pagos y saldo de un jugador.',
    permission: 'pagos.consultar',
  },
  {
    section: 'Cobranza',
    label: 'Adeudos',
    path: '/admin/billing/debts',
    description: 'Jugadores con saldo vencido y su tutor.',
    permission: 'cobranza.consultar',
  },
  {
    section: 'Cobranza',
    label: 'Descuentos y becas',
    path: '/admin/billing/discounts',
    description: 'Descuentos y becas aplicados a cargos.',
    permission: 'descuentos.consultar',
  },

  {
    section: 'Uniformes',
    label: 'Catálogo',
    path: '/admin/uniforms/catalog',
    description: 'Prendas, tallas y precios de uniformes.',
    permission: 'uniformes.consultar',
  },
  {
    section: 'Uniformes',
    label: 'Pedidos',
    path: '/admin/uniforms/orders',
    description: 'Pedidos de uniforme, su cargo y entrega.',
    permission: 'uniformes.consultar',
  },

  {
    section: 'Comunicación',
    label: 'Avisos',
    path: '/admin/notices',
    description: 'Avisos generales o por categoría, con vigencia.',
    permission: 'avisos.consultar',
  },

  {
    section: 'Reportes',
    label: 'Jugadores por categoría',
    path: '/admin/reports/players',
    description: 'Jugadores por categoría con tutor y contacto.',
    permission: 'reportes.consultar',
  },
  {
    section: 'Reportes',
    label: 'Ingresos',
    path: '/admin/reports/income',
    description: 'Ingresos por periodo y concepto.',
    permission: 'reportes.consultar',
  },

  {
    section: 'Sistema',
    label: 'Datos desde la API',
    path: '/admin/api',
    description: 'Jugadores y categorías leídos por la API REST.',
    permission: 'jugadores.consultar',
  },
  {
    section: 'Sistema',
    label: 'Usuarios',
    path: '/admin/users',
    description: 'Cuentas del personal, roles y activación.',
    permission: 'usuarios.consultar',
  },
  {
    section: 'Sistema',
    label: 'Permisos',
    path: '/admin/permissions',
    description: 'Matriz de permisos por rol.',
    permission: 'roles.consultar',
  },
  {
    section: 'Sistema',
    label: 'Auditoría',
    path: '/admin/audit',
    description: 'Bitácora de acciones por usuario, módulo y fecha.',
    permission: 'auditoria.consultar',
  },

  {
    section: 'Mi panel',
    label: 'Mis categorías',
    path: '/coach',
    description: 'Mis categorías, sus jugadores y horario semanal.',
    permission: 'panel_entrenador.consultar',
  },
  {
    section: 'Mi panel',
    label: 'Mis entrenamientos',
    path: '/coach/sessions',
    description: 'Mis sesiones y pase de lista.',
    permission: 'panel_entrenador.consultar',
  },
  {
    section: 'Mi panel',
    label: 'Competencias y partidos',
    path: '/coach/competitions',
    description: 'Competencias, partidos y resultados de mis categorías.',
    permission: 'panel_entrenador.consultar',
  },
  {
    section: 'Mi panel',
    label: 'Avisos',
    path: '/coach/notices',
    description: 'Avisos vigentes para mis categorías.',
    permission: 'panel_entrenador.consultar',
  },

  {
    section: 'Mi familia',
    label: 'Mis hijos',
    path: '/portal',
    description: 'Categoría, próximo partido y saldo de cada hijo.',
    permission: 'portal.consultar',
  },
  {
    section: 'Mi familia',
    label: 'Avisos',
    path: '/portal/notices',
    description: 'Avisos vigentes para mi familia.',
    permission: 'portal.consultar',
  },
  {
    section: 'Mi familia',
    label: 'Mi perfil',
    path: '/portal/profile',
    description: 'Mis datos de contacto.',
    permission: 'portal.editar',
  },
];

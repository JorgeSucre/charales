/**
 * `npm run db:datos-personales`: inventory of the personal data in a database, for the retention policy
 * (docs/policies/POLITICA_CONSERVACION_DATOS.md). Read only — it runs in a READ ONLY transaction and never deletes,
 * anonymizes or changes anything — and prints counts, never a name, address or any other value.
 *
 * DATA_MAP classifies every table of the schema; api/datos-personales.test.ts fails when a migration adds a table or
 * removes a listed column without updating it, so new personal data can't appear unclassified.
 */
import type { Pool } from 'mariadb';
import { createPool } from './server.ts';

export type Category =
  | 'MENORES' // players: most of them are minors
  | 'TUTORES'
  | 'ENTRENADORES'
  | 'CUENTAS' // staff and portal accounts
  | 'CONTACTO_TERCEROS' // contact of rival teams and organizers
  | 'FINANCIEROS'
  | 'DEPORTIVOS' // attendance, rosters, histories
  | 'COMUNICACION' // notices and outgoing mail
  | 'AUDITORIA'
  | 'AUTENTICACION'
  | 'SIN_DATOS_PERSONALES';

/** table → its category and the columns that identify or describe a person (empty: only references by id). */
export const DATA_MAP: Record<string, { category: Category; columns: string[] }> = {
  jugadores: {
    category: 'MENORES',
    columns: [
      'identificador',
      'nombre',
      'apellido_paterno',
      'apellido_materno',
      'fecha_nacimiento',
      'sexo',
      'telefono',
      'email',
      'direccion',
      'estatus',
    ],
  },
  tutor_jugador: { category: 'MENORES', columns: ['parentesco'] },
  jugador_categoria: { category: 'MENORES', columns: ['motivo_excepcion'] },
  tutores: {
    category: 'TUTORES',
    columns: ['nombre', 'apellido_paterno', 'apellido_materno', 'telefono', 'email', 'direccion'],
  },
  entrenadores: {
    category: 'ENTRENADORES',
    columns: ['nombre', 'apellido_paterno', 'apellido_materno', 'telefono', 'email'],
  },
  entrenador_categoria: { category: 'ENTRENADORES', columns: [] },
  entrenador_competencia_categoria: { category: 'ENTRENADORES', columns: [] },
  usuarios: { category: 'CUENTAS', columns: ['nombre', 'apellido', 'email', 'password_hash'] },
  rivales: { category: 'CONTACTO_TERCEROS', columns: ['contacto'] },
  competencias: { category: 'CONTACTO_TERCEROS', columns: ['organizador', 'contacto'] },
  cargos: { category: 'FINANCIEROS', columns: ['monto_original', 'estado'] },
  pagos: {
    category: 'FINANCIEROS',
    columns: ['importe', 'forma_pago', 'referencia', 'motivo_cancelacion'],
  },
  pago_aplicacion: { category: 'FINANCIEROS', columns: ['importe_aplicado'] },
  descuentos: { category: 'FINANCIEROS', columns: ['motivo', 'monto_ajuste'] },
  inscripciones: { category: 'FINANCIEROS', columns: ['monto', 'estatus'] },
  pedidos_uniforme: { category: 'FINANCIEROS', columns: ['recibido_por'] },
  detalle_uniforme: { category: 'FINANCIEROS', columns: [] },
  asistencias: { category: 'DEPORTIVOS', columns: ['estado', 'observaciones'] },
  historial_estatus: {
    category: 'DEPORTIVOS',
    columns: ['estatus_anterior', 'estatus_nuevo', 'motivo'],
  },
  historial_categoria: { category: 'DEPORTIVOS', columns: ['motivo'] },
  jugador_competencia_categoria: { category: 'DEPORTIVOS', columns: [] },
  sesiones_entrenamiento: { category: 'DEPORTIVOS', columns: ['observaciones'] },
  avisos: { category: 'COMUNICACION', columns: ['titulo', 'mensaje'] },
  aviso_destinatario: { category: 'COMUNICACION', columns: [] },
  correo_saliente: { category: 'COMUNICACION', columns: ['destinatario'] },
  auditoria: {
    category: 'AUDITORIA',
    columns: ['descripcion', 'datos_anteriores', 'datos_nuevos', 'ip'],
  },
  sesiones: { category: 'AUTENTICACION', columns: ['ip', 'user_agent'] },
  tokens_recuperacion: { category: 'AUTENTICACION', columns: [] },
  dispositivo_confiable: { category: 'AUTENTICACION', columns: ['cuenta'] },
  limite_acceso: { category: 'AUTENTICACION', columns: ['clave'] },
  ...Object.fromEntries(
    [
      'categorias',
      'competencia_categoria',
      'conceptos_cobro',
      'correo_cupo',
      'horarios_entrenamiento',
      'partidos',
      'permisos',
      'productos_uniforme',
      'rol_permiso',
      'roles',
      'sedes',
      'temporadas',
      'turnos_argon2',
      'turnos_argon2_guarda',
      'variantes_uniforme',
      'version_datos',
    ].map((t) => [t, { category: 'SIN_DATOS_PERSONALES' as Category, columns: [] }]),
  ),
};

/** What a review of the policy needs to know: counts only. */
export const INDICATORS: Record<string, string> = {
  'jugadores menores de 18 años':
    'SELECT COUNT(*) AS n FROM jugadores WHERE fecha_nacimiento > CURDATE() - INTERVAL 18 YEAR',
  'jugadores en baja definitiva':
    "SELECT COUNT(*) AS n FROM jugadores WHERE estatus = 'BAJA_DEFINITIVA'",
  'jugadores en baja definitiva sin cambios en más de un año':
    "SELECT COUNT(*) AS n FROM jugadores WHERE estatus = 'BAJA_DEFINITIVA' AND actualizado_en < NOW() - INTERVAL 1 YEAR",
  'tutores sin ningún jugador ligado':
    'SELECT COUNT(*) AS n FROM tutores t WHERE NOT EXISTS (SELECT 1 FROM tutor_jugador tj WHERE tj.tutor_id = t.id)',
  'cuentas desactivadas': 'SELECT COUNT(*) AS n FROM usuarios WHERE NOT activo',
  'sesiones cerradas o vencidas (sin purga automática)':
    'SELECT COUNT(*) AS n FROM sesiones WHERE cerrada_en IS NOT NULL OR expira_en <= NOW()',
  'enlaces de acceso usados o vencidos (sin purga automática)':
    'SELECT COUNT(*) AS n FROM tokens_recuperacion WHERE usado_en IS NOT NULL OR expira_en <= NOW()',
  'registros de auditoría de más de un año (sin purga automática)':
    'SELECT COUNT(*) AS n FROM auditoria WHERE creado_en < NOW() - INTERVAL 1 YEAR',
  'correos cerrados aún con dirección (los anonimiza la retención de correo)':
    "SELECT COUNT(*) AS n FROM correo_saliente WHERE estado IN ('ENVIADO', 'FALLIDO') AND anonimizado_en IS NULL",
};

export interface Inventory {
  tables: { table: string; category: Category; rows: number }[];
  indicators: Record<string, number>;
}

/** The inventory, read inside one READ ONLY transaction (the database refuses any write in it). */
export async function personalDataInventory(db: Pool): Promise<Inventory> {
  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION READ ONLY');
    const tables: Inventory['tables'] = [];
    for (const [table, { category }] of Object.entries(DATA_MAP)) {
      if (category === 'SIN_DATOS_PERSONALES') continue;
      const [{ n }] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
      tables.push({ table, category, rows: Number(n) });
    }
    const indicators: Record<string, number> = {};
    for (const [label, sql] of Object.entries(INDICATORS))
      indicators[label] = Number((await conn.query(sql))[0].n);
    return { tables, indicators };
  } finally {
    await conn.query('ROLLBACK').catch(() => undefined);
    conn.release();
  }
}

if (import.meta.main) {
  const db = createPool(process.env);
  try {
    const { tables, indicators } = await personalDataInventory(db);
    console.log('Datos personales por categoría (filas):');
    for (const t of tables)
      console.log(`  ${t.category.padEnd(18)} ${t.table.padEnd(34)} ${t.rows}`);
    console.log('Indicadores para la política de conservación (sólo lectura, nada se borra):');
    for (const [label, n] of Object.entries(indicators))
      console.log(`  ${String(n).padStart(6)}  ${label}`);
  } finally {
    await db.end();
  }
}

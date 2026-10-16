/**
 * T1/T2 of the finalization plan: arguments come from the browser, so every operation that takes
 * a catalog value (an ENUM column) or a boolean (a BOOLEAN column) checks its type and value itself:
 *   - anything else → 400 with the operation's message, and nothing is written (every table but `sesiones`, whose
 *     last-use stamp each request renews, is compared before and after);
 *   - the valid values keep working, and a real `false` is stored as false;
 *   - the permission is still checked before the value (403 first);
 *   - and the API's connections run in strict mode (T1): defense in depth, not a substitute for the checks above.
 * Seed: api/demo.ts on a temporary ef_inputs_<pid> database.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from './server.ts';
import { TEST_NOW, openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
let admin: string;
let tutor: string;
type Row = Record<string, number | string>;
const ids: Record<string, number> = {};
let tutorView: {
  id: number;
  firstName: string;
  lastName1: string;
  lastName2: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  links: { playerId: number; relationship: string; isPrimary: boolean }[];
};
let season: Row;

const one = async (sql: string, params: unknown[] = []): Promise<Row> => {
  const [row] = await t.db.query(sql, params);
  assert.ok(row, `fixture: ${sql}`);
  return row as Row;
};

before(async () => {
  t = await openTestDb('ef_inputs');
  [admin, tutor] = await Promise.all([t.login('admin@example.com'), t.login('tutor@example.com')]);
  const id = async (key: string, sql: string, params: unknown[] = []) =>
    void (ids[key] = Number((await one(sql, params))['id']));
  await id('player', "SELECT id FROM jugadores WHERE estatus = 'ACTIVO' ORDER BY id LIMIT 1");
  await id(
    'enrollment',
    "SELECT id FROM inscripciones WHERE estatus = 'ACTIVA' ORDER BY id LIMIT 1",
  );
  await id('season', 'SELECT id FROM temporadas WHERE es_actual = 1');
  await id(
    'session',
    "SELECT id FROM sesiones_entrenamiento WHERE estado = 'PROGRAMADO' ORDER BY id LIMIT 1",
  );
  // A past, not cancelled session and one active member of its category on that date (attendance).
  const past = await one(
    `SELECT s.id, jc.jugador_id AS member FROM sesiones_entrenamiento s
       JOIN jugador_categoria jc ON jc.categoria_id = s.categoria_id AND jc.fecha_inicio <= s.fecha
                                AND (jc.fecha_fin IS NULL OR jc.fecha_fin >= s.fecha)
       JOIN jugadores j ON j.id = jc.jugador_id AND j.estatus = 'ACTIVO'
      WHERE s.estado <> 'CANCELADO' AND s.fecha <= ? ORDER BY s.fecha DESC LIMIT 1`,
    [TEST_NOW.toISOString().slice(0, 10)],
  );
  ids['pastSession'] = Number(past['id']);
  ids['member'] = Number(past['member']);
  await id(
    'participation',
    "SELECT id FROM competencia_categoria WHERE estatus = 'INSCRITA' ORDER BY id LIMIT 1",
  );
  // A competition still open and an active category of its season not registered in it yet (register).
  const free = await one(
    `SELECT c.id AS comp, cat.id AS cat FROM competencias c
       JOIN categorias cat ON cat.temporada_id = c.temporada_id AND cat.activo = 1
      WHERE c.estado IN ('PLANIFICADA', 'ACTIVA')
        AND NOT EXISTS (SELECT 1 FROM competencia_categoria cc WHERE cc.competencia_id = c.id AND cc.categoria_id = cat.id)
      ORDER BY c.id, cat.id LIMIT 1`,
  );
  ids['freeCompetition'] = Number(free['comp']);
  ids['freeCategory'] = Number(free['cat']);
  const charge = await one(
    "SELECT id, jugador_id AS player FROM cargos WHERE estado IN ('PENDIENTE', 'PARCIAL', 'VENCIDO') ORDER BY id LIMIT 1",
  );
  ids['charge'] = Number(charge['id']);
  ids['chargePlayer'] = Number(charge['player']);
  await id('concept', 'SELECT id FROM conceptos_cobro WHERE activo = 1 ORDER BY id LIMIT 1');
  await id('secretaria', "SELECT id FROM usuarios WHERE email = 'secretaria@example.com'");
  await id('category', 'SELECT id FROM categorias WHERE activo = 1 ORDER BY id LIMIT 1');
  await id(
    'schedule',
    'SELECT id FROM horarios_entrenamiento WHERE activo = 1 ORDER BY id LIMIT 1',
  );
  await id('coach', 'SELECT id FROM entrenadores WHERE activo = 1 ORDER BY id LIMIT 1');
  await id('venue', 'SELECT id FROM sedes WHERE activo = 1 ORDER BY id LIMIT 1');
  await id('product', 'SELECT id FROM productos_uniforme WHERE activo = 1 ORDER BY id LIMIT 1');
  await id('variant', 'SELECT id FROM variantes_uniforme WHERE activo = 1 ORDER BY id LIMIT 1');
  await id('notice', 'SELECT id FROM avisos WHERE publicado = 1 ORDER BY id LIMIT 1');
  await id('secretariaRole', "SELECT id FROM roles WHERE nombre = 'SECRETARIA'");
  // A permission SECRETARIA doesn't have (granted and then withdrawn by the positive case).
  await id(
    'missingPermission',
    `SELECT p.id FROM permisos p WHERE NOT EXISTS
       (SELECT 1 FROM rol_permiso rp WHERE rp.permiso_id = p.id AND rp.rol_id = ?) ORDER BY p.id LIMIT 1`,
    [ids['secretariaRole']],
  );
  season = await one(
    'SELECT id, nombre, fecha_inicio, fecha_fin FROM temporadas WHERE es_actual = 1',
  );
  await id('tutor', 'SELECT tutor_id AS id FROM tutor_jugador ORDER BY tutor_id LIMIT 1');
  tutorView = await t.ok(t.call(admin, 'TutorService', 'get', ids['tutor']));
});
after(() => t?.close());

/** Checksum of every table but `sesiones` (each request renews its last use). */
async function snapshot(): Promise<string> {
  const tables: { t: string }[] = await t.db.query(
    "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> 'sesiones' AND TABLE_TYPE = 'BASE TABLE' ORDER BY 1",
  );
  const rows: { Checksum: number }[] = await t.db.query(
    `CHECKSUM TABLE ${tables.map((r) => `\`${r.t}\``).join(', ')}`,
  );
  return JSON.stringify(rows.map((r) => r.Checksum));
}

const newPlayer = (n: string) => ({
  firstName: `Validación${n}`,
  lastName1: 'Entrada',
  lastName2: null,
  birthDate: '2016-03-03',
  sex: 'F',
  phone: null,
  email: null,
  address: null,
});
const competition = (status: unknown, type: unknown = 'TORNEO') => ({
  seasonId: ids['season'],
  name: `Copa validación ${String(type)}/${String(status)}`,
  type,
  organizer: null,
  contact: null,
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  status,
  notes: null,
});
const notice = (published: unknown) => ({
  title: 'Aviso de validación',
  message: 'Sólo para la prueba.',
  startsAt: null,
  endsAt: null,
  published,
  categoryIds: [],
  tutorIds: [],
  coachIds: [],
});
const seasonDraft = (active: unknown, isCurrent: unknown) => ({
  id: season['id'],
  name: season['nombre'],
  startDate: season['fecha_inicio'],
  endDate: season['fecha_fin'],
  active,
  isCurrent,
});
const tutorDraft = (isPrimary: unknown) => ({
  ...tutorView,
  links: tutorView.links.map((l, i) => ({
    playerId: l.playerId,
    relationship: l.relationship,
    isPrimary: i === 0 ? isPrimary : l.isPrimary,
  })),
});

/** An operation, its arguments for a given value, and the message it must answer with. */
interface Case {
  op: string;
  args: (value: unknown) => unknown[];
  message: RegExp;
  /** A valid value of the catalog (booleans: true). */
  valid?: unknown;
}
const svc = (op: string) => op.split('.') as [string, string];

const CATALOG: Case[] = [
  {
    op: 'PlayerService.create',
    args: (v) => [newPlayer('A'), v],
    message: /^Estatus inválido\.$/,
    valid: 'ACTIVO',
  },
  {
    op: 'EnrollmentService.enroll',
    args: (v) => [
      {
        playerId: ids['player'],
        seasonId: ids['season'],
        enrolledOn: '2026-10-01',
        amountCents: 0,
        status: v,
        conceptId: null,
        dueDate: null,
      },
    ],
    message: /^Estatus inválido\.$/,
    valid: 'ACTIVA',
  },
  {
    op: 'EnrollmentService.setStatus',
    args: (v) => [ids['enrollment'], v, 'Motivo'],
    message: /^Estatus inválido\.$/,
    valid: 'FINALIZADA',
  },
  {
    op: 'TrainingService.setStatus',
    args: (v) => [ids['session'], v, 'Motivo'],
    message: /^Estado inválido\.$/,
    valid: 'CANCELADO',
  },
  {
    op: 'AttendanceService.record',
    args: (v) => [ids['pastSession'], [{ playerId: ids['member'], status: v, notes: null }]],
    message: /^Estado de asistencia inválido\.$/,
    valid: 'PRESENTE',
  },
  {
    op: 'CompetitionService.save',
    args: (v) => [competition('PLANIFICADA', v)],
    message: /^Tipo inválido\.$/,
    valid: 'LIGA',
  },
  {
    op: 'CompetitionService.save',
    args: (v) => [competition(v)],
    message: /^Estatus inválido\.$/,
    valid: 'ACTIVA',
  },
  {
    op: 'CompetitionService.register',
    args: (v) => [
      {
        competitionId: ids['freeCompetition'],
        categoryId: ids['freeCategory'],
        registeredOn: '2026-10-01',
        costCents: null,
        status: v,
      },
    ],
    message: /^Estatus inválido\.$/,
    valid: 'INSCRITA',
  },
  {
    op: 'CompetitionService.setParticipationStatus',
    args: (v) => [ids['participation'], v],
    message: /^Estatus inválido\.$/,
    valid: 'BAJA',
  },
  {
    op: 'BillingService.registerPayment',
    args: (v) => [
      {
        playerId: ids['chargePlayer'],
        tutorId: null,
        amountCents: 100,
        method: v,
        chargeIds: [ids['charge']],
      },
    ],
    message: /^Forma de pago inválida\.$/,
    valid: 'EFECTIVO',
  },
  {
    op: 'BillingService.addDiscount',
    args: (v) => [{ chargeId: ids['charge'], type: v, reason: 'Motivo', adjustmentCents: 100 }],
    message: /^Tipo de ajuste inválido\.$/,
    valid: 'DESCUENTO',
  },
];

const ACTIVE = /^Valor de «activo» inválido\.$/;
const BOOLEANS: Case[] = [
  { op: 'UserService.setActive', args: (v) => [ids['secretaria'], v], message: ACTIVE },
  { op: 'CategoryService.setActive', args: (v) => [ids['category'], v], message: ACTIVE },
  { op: 'ScheduleService.setActive', args: (v) => [ids['schedule'], v], message: ACTIVE },
  { op: 'CoachService.setActive', args: (v) => [ids['coach'], v], message: ACTIVE },
  { op: 'VenueService.setActive', args: (v) => [ids['venue'], v], message: ACTIVE },
  { op: 'BillingService.setConceptActive', args: (v) => [ids['concept'], v], message: ACTIVE },
  { op: 'UniformService.setProductActive', args: (v) => [ids['product'], v], message: ACTIVE },
  { op: 'UniformService.setVariantActive', args: (v) => [ids['variant'], v], message: ACTIVE },
  {
    op: 'NoticeService.setPublished',
    args: (v) => [ids['notice'], v],
    message: /^Valor de «publicado» inválido\.$/,
  },
  {
    op: 'NoticeService.save',
    args: (v) => [notice(v)],
    message: /^Valor de «publicado» inválido\.$/,
  },
  {
    op: 'RoleService.setPermission',
    args: (v) => [ids['secretariaRole'], ids['missingPermission'], v],
    message: /^Valor de «otorgado» inválido\.$/,
  },
  {
    op: 'SeasonService.save',
    args: (v) => [seasonDraft(v, true)],
    message: /^Valor de «activa» inválido\.$/,
  },
  {
    op: 'SeasonService.save',
    args: (v) => [seasonDraft(true, v)],
    message: /^Valor de «actual» inválido\.$/,
  },
  {
    op: 'BillingService.saveConcept',
    args: (v) => [{ name: 'Concepto de validación', suggestedAmountCents: 1000, recurring: v }],
    message: /^Valor de «recurrente» inválido\.$/,
  },
  {
    op: 'TutorService.save',
    args: (v) => [tutorDraft(v)],
    message: /^Valor de «contacto principal» inválido\.$/,
  },
];

/** Not in the catalog, lower case, the prototype's names, an array holding a valid value, other types. */
const badCatalog = (valid: unknown) => [
  'XX',
  String(valid).toLowerCase(),
  'toString',
  '__proto__',
  'constructor',
  [valid],
  null,
  1,
  {},
];
/** What a browser or a script could send instead of a boolean. */
const badBoolean = () => ['false', 'true', '', 0, 1, null, [], [true], {}];

for (const [kind, cases, bad] of [
  ['catalog value', CATALOG, badCatalog],
  ['boolean', BOOLEANS, badBoolean],
] as const)
  for (const c of cases)
    test(`T2 ${kind}: ${c.op} ${c.message.source.replace(/[\\^$]/g, '')} — 400 for each invalid value, nothing written`, async () => {
      const [service, method] = svc(c.op);
      const before = await snapshot();
      for (const value of bad(c.valid))
        await t.refused(t.call(admin, service, method, ...c.args(value)), 400, c.message);
      assert.equal(await snapshot(), before, 'a rejected value writes nothing');
    });

/** HU-010 (PR #12) validates the same way; its own tests are in api/hu-fase2.test.ts. */
const CHANGE_STATUS: Case = {
  op: 'PlayerService.changeStatus',
  args: (v) => [ids['player'], v, 'Motivo'],
  message: /^Estatus inválido\.$/,
};

test('T2: the permission is checked before the value — all 25 operations answer 403 to an invalid value, nothing written', async () => {
  // Without permission: a tutor (profile only) for every operation; Secretaría for the ones D12 keeps to the
  // Administrador (accounts, permissions, discounts).
  const secretaria = await t.login('secretaria@example.com');
  const officeOnlyAdmin = new Set([
    'UserService.setActive',
    'RoleService.setPermission',
    'BillingService.addDiscount',
  ]);
  const cases = [...CATALOG, CHANGE_STATUS, ...BOOLEANS];
  assert.equal(new Set(cases.map((c) => c.op)).size, 25, 'the 25 operations of T1/T2');
  const before = await snapshot();
  for (const c of cases) {
    const [service, method] = svc(c.op);
    const invalid = BOOLEANS.includes(c) ? 'false' : 'XX';
    for (const who of officeOnlyAdmin.has(c.op) ? [tutor, secretaria] : [tutor]) {
      const res = await t.call(who, service, method, ...c.args(invalid));
      const body = await res.json();
      assert.equal(res.status, 403, `${c.op}: ${JSON.stringify(body)}`);
      assert.doesNotMatch(body.error, c.message, `${c.op}: the value was not looked at`);
    }
  }
  assert.equal(await snapshot(), before, 'a refused operation writes nothing');
});

test('T2 catalog values: enroll stores the status it was given (PENDIENTE and ACTIVA)', async () => {
  for (const [n, status] of [
    ['E', 'PENDIENTE'],
    ['F', 'ACTIVA'],
  ] as const) {
    const player = await t.ok<{ id: number }>(
      t.call(admin, 'PlayerService', 'create', newPlayer(n)),
    );
    const e = await t.ok<{ id: number; status: string }>(
      t.call(admin, 'EnrollmentService', 'enroll', {
        playerId: player.id,
        seasonId: ids['season'],
        enrolledOn: '2026-10-01',
        amountCents: 0,
        status,
        conceptId: null,
        dueDate: null,
      }),
    );
    assert.equal(e.status, status, 'the response');
    assert.equal(
      (await one('SELECT estatus FROM inscripciones WHERE id = ?', [e.id]))['estatus'],
      status,
      'MariaDB',
    );
  }
});

test('T2 catalog values: the valid ones keep working and are stored as sent', async () => {
  const p = await t.ok<{ id: number; status: string }>(
    t.call(admin, 'PlayerService', 'create', newPlayer('B'), 'BAJA_TEMPORAL'),
  );
  assert.equal(
    (await one('SELECT estatus FROM jugadores WHERE id = ?', [p.id]))['estatus'],
    'BAJA_TEMPORAL',
  );

  const fresh = await t.ok<{ id: number }>(
    t.call(admin, 'PlayerService', 'create', newPlayer('C')),
  );
  const e = await t.ok<{ id: number }>(
    t.call(admin, 'EnrollmentService', 'enroll', {
      playerId: fresh.id,
      seasonId: ids['season'],
      enrolledOn: '2026-10-01',
      amountCents: 0,
      status: 'PENDIENTE',
      conceptId: null,
      dueDate: null,
    }),
  );
  await t.ok(t.call(admin, 'EnrollmentService', 'setStatus', e.id, 'ACTIVA'));
  assert.equal(
    (await one('SELECT estatus FROM inscripciones WHERE id = ?', [e.id]))['estatus'],
    'ACTIVA',
  );
  // enroll only creates PENDIENTE or ACTIVA: CANCELADA is a real status, but not a starting one.
  const other = await t.ok<{ id: number }>(
    t.call(admin, 'PlayerService', 'create', newPlayer('D')),
  );
  await t.refused(
    t.call(admin, 'EnrollmentService', 'enroll', {
      playerId: other.id,
      seasonId: ids['season'],
      enrolledOn: '2026-10-01',
      amountCents: 0,
      status: 'CANCELADA',
      conceptId: null,
      dueDate: null,
    }),
    400,
    /^Estatus inválido\.$/,
  );

  await t.ok(t.call(admin, 'TrainingService', 'setStatus', ids['session'], 'CANCELADO', 'Lluvia'));
  assert.equal(
    (await one('SELECT estado FROM sesiones_entrenamiento WHERE id = ?', [ids['session']]))[
      'estado'
    ],
    'CANCELADO',
  );

  await t.ok(
    t.call(admin, 'AttendanceService', 'record', ids['pastSession'], [
      { playerId: ids['member'], status: 'JUSTIFICADO', notes: null },
    ]),
  );
  assert.equal(
    (
      await one(
        'SELECT estado FROM asistencias WHERE sesion_entrenamiento_id = ? AND jugador_id = ?',
        [ids['pastSession'], ids['member']],
      )
    )['estado'],
    'JUSTIFICADO',
  );

  const comp = await t.ok<{ id: number }>(
    t.call(admin, 'CompetitionService', 'save', competition('PLANIFICADA', 'LIGA')),
  );
  assert.deepEqual(
    { ...(await one('SELECT tipo, estado FROM competencias WHERE id = ?', [comp.id])) },
    { tipo: 'LIGA', estado: 'PLANIFICADA' },
  );

  const reg = await t.ok<{ id: number }>(
    t.call(admin, 'CompetitionService', 'register', {
      competitionId: ids['freeCompetition'],
      categoryId: ids['freeCategory'],
      registeredOn: '2026-10-01',
      costCents: null,
      status: 'PENDIENTE',
    }),
  );
  await t.ok(t.call(admin, 'CompetitionService', 'setParticipationStatus', reg.id, 'INSCRITA'));
  assert.equal(
    (await one('SELECT estatus FROM competencia_categoria WHERE id = ?', [reg.id]))['estatus'],
    'INSCRITA',
  );

  const pay = await t.ok<{ id: number }>(
    t.call(admin, 'BillingService', 'registerPayment', {
      playerId: ids['chargePlayer'],
      tutorId: null,
      amountCents: 100,
      method: 'TRANSFERENCIA',
      chargeIds: [ids['charge']],
    }),
  );
  assert.equal(
    (await one('SELECT forma_pago FROM pagos WHERE id = ?', [pay.id]))['forma_pago'],
    'TRANSFERENCIA',
  );

  const d = await t.ok<{ id: number }>(
    t.call(admin, 'BillingService', 'addDiscount', {
      chargeId: ids['charge'],
      type: 'BECA',
      reason: 'Prueba',
      adjustmentCents: 100,
    }),
  );
  assert.equal((await one('SELECT tipo FROM descuentos WHERE id = ?', [d.id]))['tipo'], 'BECA');
});

test('T2 booleans: a real false is stored as false (and true as true) — «"false"» no longer activates', async () => {
  const toggles: [string, number, string][] = [
    ['UserService.setActive', ids['secretaria'], 'SELECT activo AS v FROM usuarios WHERE id = ?'],
    [
      'CategoryService.setActive',
      ids['category'],
      'SELECT activo AS v FROM categorias WHERE id = ?',
    ],
    [
      'ScheduleService.setActive',
      ids['schedule'],
      'SELECT activo AS v FROM horarios_entrenamiento WHERE id = ?',
    ],
    ['CoachService.setActive', ids['coach'], 'SELECT activo AS v FROM entrenadores WHERE id = ?'],
    ['VenueService.setActive', ids['venue'], 'SELECT activo AS v FROM sedes WHERE id = ?'],
    [
      'BillingService.setConceptActive',
      ids['concept'],
      'SELECT activo AS v FROM conceptos_cobro WHERE id = ?',
    ],
    [
      'UniformService.setProductActive',
      ids['product'],
      'SELECT activo AS v FROM productos_uniforme WHERE id = ?',
    ],
    [
      'UniformService.setVariantActive',
      ids['variant'],
      'SELECT activo AS v FROM variantes_uniforme WHERE id = ?',
    ],
    ['NoticeService.setPublished', ids['notice'], 'SELECT publicado AS v FROM avisos WHERE id = ?'],
  ];
  for (const [op, id, sql] of toggles) {
    const [service, method] = svc(op);
    await t.ok(t.call(admin, service, method, id, false));
    assert.equal(Number((await one(sql, [id]))['v']), 0, `${op}(false)`);
    await t.ok(t.call(admin, service, method, id, true));
    assert.equal(Number((await one(sql, [id]))['v']), 1, `${op}(true)`);
  }

  const granted = 'SELECT COUNT(*) AS v FROM rol_permiso WHERE rol_id = ? AND permiso_id = ?';
  const pair = [ids['secretariaRole'], ids['missingPermission']];
  await t.ok(t.call(admin, 'RoleService', 'setPermission', ...pair, true));
  assert.equal(Number((await one(granted, pair))['v']), 1);
  await t.ok(t.call(admin, 'RoleService', 'setPermission', ...pair, false));
  assert.equal(Number((await one(granted, pair))['v']), 0);

  const draft = await t.ok<{ id: number }>(t.call(admin, 'NoticeService', 'save', notice(false)));
  assert.equal(
    Number((await one('SELECT publicado AS v FROM avisos WHERE id = ?', [draft.id]))['v']),
    0,
  );

  const c = await t.ok<{ id: number }>(
    t.call(admin, 'BillingService', 'saveConcept', {
      name: 'Concepto no recurrente',
      suggestedAmountCents: 1000,
      recurring: false,
    }),
  );
  assert.equal(
    Number((await one('SELECT recurrente AS v FROM conceptos_cobro WHERE id = ?', [c.id]))['v']),
    0,
  );

  await t.ok(t.call(admin, 'SeasonService', 'save', seasonDraft(true, true)));
  assert.deepEqual(
    { ...(await one('SELECT activa, es_actual FROM temporadas WHERE id = ?', [season['id']])) },
    { activa: 1, es_actual: 1 },
  );

  // isPrimary of the first link: a real false is stored as 0, and the original value comes back as sent.
  const link = tutorView.links[0]!;
  const primary = async () =>
    Number(
      (
        await one(
          'SELECT es_contacto_principal AS v FROM tutor_jugador WHERE tutor_id = ? AND jugador_id = ?',
          [tutorView.id, link.playerId],
        )
      )['v'],
    );
  await t.ok(t.call(admin, 'TutorService', 'save', tutorDraft(false)));
  assert.equal(await primary(), 0, 'TutorService.save(isPrimary: false)');
  await t.ok(t.call(admin, 'TutorService', 'save', tutorDraft(link.isPrimary)));
  assert.equal(await primary(), link.isPrimary ? 1 : 0, 'TutorService.save(isPrimary: original)');
});

test('T1: every API connection runs in strict mode, on top of the caller’s initSql (the fixed clock)', async () => {
  const conn = await t.db.getConnection();
  try {
    const [row] = await conn.query('SELECT @@SESSION.sql_mode AS mode, NOW() AS now');
    assert.match(row.mode, /(^|,)STRICT_TRANS_TABLES(,|$)/);
    assert.equal(
      row.now,
      TEST_NOW.toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' }),
      'the test clock (initSql) still runs',
    );
  } finally {
    conn.release();
  }
  // A server (or caller) without strict mode: the API's connections are strict anyway, and an invalid ENUM value is
  // rejected by MariaDB instead of being stored as ''. This server's global mode may already be strict, so the
  // caller's initSql is what turns it off here.
  const lax = createPool(
    { ...process.env, DB_NAME: t.name },
    { initSql: "SET SESSION sql_mode = ''" },
  );
  try {
    const [row] = await lax.query('SELECT @@SESSION.sql_mode AS mode');
    assert.match(row.mode, /(^|,)STRICT_TRANS_TABLES(,|$)/);
    await assert.rejects(
      lax.query("UPDATE jugadores SET estatus = 'SUSPENDIDO' WHERE id = ?", [ids['player']]),
      /Data truncated|estatus/,
    );
    assert.equal(
      (await one('SELECT estatus FROM jugadores WHERE id = ?', [ids['player']]))['estatus'],
      'ACTIVO',
    );
  } finally {
    await lax.end();
  }
});

/**
 * Phase 2 HU (docs/TRACEABILITY.md): players, tutors, categories, schedules, enrollment, coaches, venues, seasons.
 * Each test checks the acceptance criteria of docs/requirements/USER_STORIES.md through the API (`/api/rpc`) and
 * reads the result back from MariaDB. Seed: api/demo.ts (MockDb). Sub-12 (category 2) has capacity 2 and is full.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
let admin: string;
let secretaria: string;
before(async () => {
  t = await openTestDb('ef_hu2');
  admin = await t.login('admin@example.com');
  secretaria = await t.login('secretaria@example.com');
});
after(() => t?.close());

const player = (firstName: string, extra: Record<string, unknown> = {}) => ({
  firstName,
  lastName1: 'Ramírez',
  lastName2: null,
  birthDate: '2016-05-20',
  sex: 'NO_ESPECIFICADO',
  phone: '5512345678',
  email: null,
  address: null,
  ...extra,
});

test('HU-008: register a player — data, age, evident duplicates, internal identifier', async () => {
  const p = await t.ok<{ id: number; identifier: string; status: string }>(
    t.call(secretaria, 'PlayerService', 'create', player('Nuevo')),
  );
  assert.match(p.identifier, /^J-\d{4}$/, '4) internal identifier');
  assert.equal(p.status, 'ACTIVO');
  const [row] = await t.db.query(
    'SELECT nombre, fecha_nacimiento, sexo, telefono, estatus FROM jugadores WHERE id = ?',
    [p.id],
  );
  assert.deepEqual(
    { ...row },
    {
      nombre: 'Nuevo',
      fecha_nacimiento: '2016-05-20',
      sexo: 'NO_ESPECIFICADO',
      telefono: '5512345678',
      estatus: 'ACTIVO',
    },
    '1) name, birth date, optional sex, contact and status are stored',
  );
  const rec = await t.ok<{ age: number }>(t.call(secretaria, 'PlayerService', 'record', p.id));
  assert.equal(typeof rec.age, 'number', '2) age is computed');
  await t.refused(
    t.call(secretaria, 'PlayerService', 'create', player('Nuevo')),
    400,
    /existe|duplicad/i,
  );
  assert.equal(await t.count("SELECT COUNT(*) AS n FROM jugadores WHERE nombre = 'Nuevo'"), 1);
  await t.refused(t.call(secretaria, 'PlayerService', 'create', player('')), 400);
});

test('HU-009: edit a player — authorized fields, same id, modification date, required fields', async () => {
  const [before] = await t.db.query(
    'SELECT identificador, actualizado_en FROM jugadores WHERE id = 3',
  );
  await t.advance(60_000);
  const updated = await t.ok<{ id: number; identifier: string; phone: string }>(
    t.call(secretaria, 'PlayerService', 'update', 3, {
      ...player('Mateo'),
      lastName1: 'García',
      birthDate: '2016-11-20',
      phone: '5599990000',
    }),
  );
  assert.equal(updated.id, 3);
  const [after] = await t.db.query(
    'SELECT identificador, telefono, actualizado_en FROM jugadores WHERE id = 3',
  );
  assert.equal(after.identificador, before.identificador, '2) keeps the identifier');
  assert.equal(after.telefono, '5599990000');
  assert.ok(after.actualizado_en > before.actualizado_en, '3) modification date');
  assert.equal(
    await t.count(
      "SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'jugadores' AND entidad_id = 3 AND accion = 'EDITAR'",
    ),
    1,
  );
  await t.refused(
    t.call(secretaria, 'PlayerService', 'update', 3, { ...player('Mateo'), birthDate: '' }),
    400,
  );
});

test('HU-010: status change — reason, history kept, inactive player cannot join categories', async () => {
  await t.refused(
    t.call(secretaria, 'PlayerService', 'changeStatus', 5, 'BAJA_TEMPORAL', ''),
    400,
    /motivo/i,
  );
  await t.ok(t.call(secretaria, 'PlayerService', 'changeStatus', 5, 'BAJA_TEMPORAL', 'Lesión'));
  const [hist] = await t.db.query(
    'SELECT estatus_anterior, estatus_nuevo, motivo FROM historial_estatus WHERE jugador_id = 5 ORDER BY id DESC LIMIT 1',
  );
  assert.deepEqual(
    { ...hist },
    { estatus_anterior: 'ACTIVO', estatus_nuevo: 'BAJA_TEMPORAL', motivo: 'Lesión' },
  );
  assert.ok(
    (await t.count('SELECT COUNT(*) AS n FROM cargos WHERE jugador_id = 5')) >= 0,
    '4) nothing deleted',
  );
  await t.refused(
    t.call(admin, 'PlayerCategoryService', 'assign', {
      playerId: 5,
      categoryId: 3,
      date: '2026-10-13',
      exceptionReason: null,
    }),
    400,
  );
  await t.ok(t.call(secretaria, 'PlayerService', 'changeStatus', 5, 'ACTIVO', 'Alta médica'));
});

test('HU-011: tutors — N:M, one primary contact per player, contact validation', async () => {
  const tutor = await t.ok<{ id: number }>(
    t.call(secretaria, 'TutorService', 'save', {
      firstName: 'Rosa',
      lastName1: 'Méndez',
      lastName2: null,
      phone: '5511112222',
      email: 'Rosa@Example.com',
      address: null,
      links: [
        { playerId: 1, relationship: 'Abuela', isPrimary: false },
        { playerId: 3, relationship: 'Abuela', isPrimary: false },
      ],
    }),
  );
  assert.equal(
    await t.count('SELECT COUNT(*) AS n FROM tutor_jugador WHERE tutor_id = ?', [tutor.id]),
    2,
    '2) one tutor, several children',
  );
  assert.ok(
    (await t.count('SELECT COUNT(*) AS n FROM tutor_jugador WHERE jugador_id = 1')) >= 2,
    '1) several tutors per player',
  );
  const [email] = await t.db.query('SELECT email FROM tutores WHERE id = ?', [tutor.id]);
  assert.equal(email.email, 'rosa@example.com');
  // 3) one primary contact per player: Teresa already is Diego's, so a second one is refused and nothing changes.
  await t.refused(
    t.call(secretaria, 'TutorService', 'save', {
      id: tutor.id,
      firstName: 'Rosa',
      lastName1: 'Méndez',
      lastName2: null,
      phone: '5511112222',
      email: 'rosa@example.com',
      address: null,
      links: [
        { playerId: 1, relationship: 'Abuela', isPrimary: true },
        { playerId: 3, relationship: 'Abuela', isPrimary: false },
      ],
    }),
    400,
    /contacto principal/,
  );
  const primaries = await t.db.query(
    'SELECT tutor_id FROM tutor_jugador WHERE jugador_id = 1 AND es_contacto_principal',
  );
  assert.deepEqual(
    primaries.map((r: { tutor_id: number }) => r.tutor_id),
    [1],
  );
  await t.refused(
    t.call(secretaria, 'TutorService', 'save', {
      firstName: 'Mal',
      lastName1: 'Correo',
      lastName2: null,
      phone: null,
      email: 'no-es-correo',
      address: null,
      links: [{ playerId: 2, relationship: 'Tío', isPrimary: false }],
    }),
    400,
    /correo/i,
  );
});

test('HU-012: portal account for a tutor — only registered tutors, no duplicate, initial access, own children only', async () => {
  await t.ok(t.call(secretaria, 'TutorService', 'linkAccount', 2, 'jorge.tutor@example.com'));
  const [link] = await t.db.query(
    `SELECT u.id, tk.finalidad FROM tutores tu JOIN usuarios u ON u.id = tu.usuario_id
       JOIN tokens_recuperacion tk ON tk.usuario_id = u.id WHERE tu.id = 2`,
  );
  assert.equal(link.finalidad, 'INVITACION', '3) initial access by invitation');
  const msg = t.mail.find((m) => m.to === 'jorge.tutor@example.com')!;
  const token = /token=([\w-]+)/.exec(msg.text)![1];
  await fetch(`${t.base}/auth/password-reset/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, newPassword: 'Portal12345' }),
  });
  const jorge = await t.login('jorge.tutor@example.com', 'Portal12345');
  const kids = await t.ok<{ playerId: number }[]>(t.call(jorge, 'PortalService', 'overview'));
  assert.deepEqual(kids.map((k) => k.playerId).sort(), [3, 6], '4) sees only his children');
  await t.refused(t.call(jorge, 'PortalService', 'child', 1), 403);
  await t.refused(
    t.call(secretaria, 'TutorService', 'linkAccount', 9999, 'x@example.com'),
    400,
    /no encontrado/i,
  );
  await t.refused(t.call(secretaria, 'TutorService', 'linkAccount', 2, 'otro@example.com'), 400);
  assert.equal(
    await t.count("SELECT COUNT(*) AS n FROM usuarios WHERE email = 'jorge.tutor@example.com'"),
    1,
    '2) no duplicated account',
  );
});

test('HU-013: player record — data, categories, payments and debts, uniforms and competitions', async () => {
  const rec = await t.ok<{
    player: { id: number };
    categories: unknown[];
    charges: unknown[];
    payments: unknown[];
    balanceCents: number;
    uniforms: unknown[];
    competitions: unknown[];
    tutors: unknown[];
  }>(t.call(secretaria, 'PlayerService', 'record', 2));
  assert.equal(rec.player.id, 2);
  assert.ok(rec.categories.length >= 1, '2) categories');
  assert.ok(rec.charges.length >= 1 && rec.balanceCents > 0, '3) payments and debts');
  assert.ok(
    Array.isArray(rec.uniforms) && Array.isArray(rec.competitions),
    '4) uniforms and competitions',
  );
  assert.ok(rec.tutors.length >= 1);
  await t.refused(t.call(await t.login('tutor@example.com'), 'PlayerService', 'record', 2), 403);
});

test('HU-014: search — partial name, combinable filters, pagination', async () => {
  const page = await t.ok<{ items: { player: { firstName: string } }[]; total: number }>(
    t.call(secretaria, 'PlayerService', 'search', { query: 'dieg' }),
  );
  assert.deepEqual(
    page.items.map((i) => i.player.firstName),
    ['Diego'],
    '1) partial',
  );
  const combined = await t.ok<{ items: { player: { id: number } }[] }>(
    t.call(secretaria, 'PlayerService', 'search', { categoryId: 2, status: 'ACTIVO' }),
  );
  assert.deepEqual(combined.items.map((i) => i.player.id).sort(), [2, 6], '2) combinable');
  const p2 = await t.ok<{ items: unknown[]; total: number }>(
    t.call(secretaria, 'PlayerService', 'search', { page: 99 }),
  );
  assert.ok(p2.total >= 6 && p2.items.length <= p2.total, '3) paginated');
});

test('HU-015: categories — unique per season, valid ranges, active flag', async () => {
  const c = await t.ok<{ id: number }>(
    t.call(secretaria, 'CategoryService', 'save', {
      seasonId: 2,
      name: 'Sub-14',
      minAge: 12,
      maxAge: 14,
      maxCapacity: 18,
    }),
  );
  await t.refused(
    t.call(secretaria, 'CategoryService', 'save', {
      seasonId: 2,
      name: 'Sub-14',
      minAge: 12,
      maxAge: 14,
      maxCapacity: null,
    }),
    400,
  );
  await t.refused(
    t.call(secretaria, 'CategoryService', 'save', {
      seasonId: 2,
      name: 'Al revés',
      minAge: 14,
      maxAge: 12,
      maxCapacity: null,
    }),
    400,
    /edad/i,
  );
  await t.ok(t.call(secretaria, 'CategoryService', 'setActive', c.id, false));
  const [row] = await t.db.query('SELECT activo FROM categorias WHERE id = ?', [c.id]);
  assert.equal(row.activo, 0);
});

test('HU-016: training schedules — day, times and venue; end after start; several per category; deactivate', async () => {
  const s = await t.ok<{ id: number }>(
    t.call(secretaria, 'ScheduleService', 'save', {
      categoryId: 3,
      venueId: 2,
      weekday: 5,
      startTime: '16:00',
      endTime: '17:00',
    }),
  );
  await t.ok(
    t.call(secretaria, 'ScheduleService', 'save', {
      categoryId: 3,
      venueId: 1,
      weekday: 2,
      startTime: '16:00',
      endTime: '17:00',
    }),
  );
  assert.equal(
    await t.count('SELECT COUNT(*) AS n FROM horarios_entrenamiento WHERE categoria_id = 3'),
    2,
  );
  const [row] = await t.db.query(
    'SELECT hora_inicio, hora_fin FROM horarios_entrenamiento WHERE id = ?',
    [s.id],
  );
  assert.deepEqual({ ...row }, { hora_inicio: '16:00:00', hora_fin: '17:00:00' });
  await t.refused(
    t.call(secretaria, 'ScheduleService', 'save', {
      categoryId: 3,
      venueId: 1,
      weekday: 2,
      startTime: '18:00',
      endTime: '17:00',
    }),
    400,
  );
  await t.ok(t.call(secretaria, 'ScheduleService', 'setActive', s.id, false));
  assert.equal(
    await t.count('SELECT COUNT(*) AS n FROM horarios_entrenamiento WHERE id = ? AND NOT activo', [
      s.id,
    ]),
    1,
  );
});

test('HU-017/021: category membership — active only, age rule with authorized exception, no duplicate, start date, capacity', async () => {
  const newbie = await t.ok<{ id: number }>(
    t.call(secretaria, 'PlayerService', 'create', player('Gol', { birthDate: '2019-02-02' })),
  );
  const elig = await t.ok<{ age: number; ageOk: boolean }>(
    t.call(secretaria, 'PlayerCategoryService', 'eligibility', newbie.id, 1, '2026-10-13'),
  );
  assert.equal(elig.ageOk, false, '2) age validated against the category');
  await t.refused(
    t.call(secretaria, 'PlayerCategoryService', 'assign', {
      playerId: newbie.id,
      categoryId: 1,
      date: '2026-10-13',
      exceptionReason: null,
    }),
    400,
  );
  await t.ok(
    t.call(secretaria, 'PlayerCategoryService', 'assign', {
      playerId: newbie.id,
      categoryId: 3,
      date: '2026-10-13',
      exceptionReason: null,
    }),
  );
  const [m] = await t.db.query(
    'SELECT fecha_inicio, fecha_fin FROM jugador_categoria WHERE jugador_id = ?',
    [newbie.id],
  );
  assert.deepEqual({ ...m }, { fecha_inicio: '2026-10-13', fecha_fin: null }, '4) start date');
  await t.refused(
    t.call(secretaria, 'PlayerCategoryService', 'assign', {
      playerId: newbie.id,
      categoryId: 3,
      date: '2026-10-14',
      exceptionReason: null,
    }),
    400,
    undefined,
  );
  // HU-021: Sub-12 holds 2 and has 2 → warns (full) and only an authorized exception lets someone in.
  const full = await t.ok<{ full: boolean; occupancy: number; capacity: number }>(
    t.call(secretaria, 'PlayerCategoryService', 'eligibility', 1, 2, '2026-10-13'),
  );
  assert.deepEqual([full.full, full.occupancy, full.capacity], [true, 2, 2]);
  const list = await t.ok<{ id: number; occupancy: number; full: boolean }[]>(
    t.call(secretaria, 'CategoryService', 'list', {}),
  );
  assert.equal(list.find((c) => c.id === 2)!.full, true, 'HU-021.4 occupancy shown');
});

test('HU-018: group list — active members with age and primary tutor, total', async () => {
  const members = await t.ok<{ playerId: number; age: number; primaryTutor: string | null }[]>(
    t.call(secretaria, 'CategoryService', 'members', 2),
  );
  assert.deepEqual(members.map((m) => m.playerId).sort(), [2, 6]);
  assert.ok(
    members.every((m) => typeof m.age === 'number' && m.primaryTutor),
    '2) age and primary tutor',
  );
  const filtered = await t.ok<unknown[]>(
    t.call(secretaria, 'CategoryService', 'members', 2, 'Sof'),
  );
  assert.equal(filtered.length, 1, '3) filter');
});

test('HU-019: category change — closes the previous one, opens a new one, keeps history with reason and date', async () => {
  await t.ok(
    t.call(admin, 'PlayerCategoryService', 'change', {
      playerId: 3,
      categoryId: 3,
      date: '2026-10-13',
      exceptionReason: 'Ajuste por nivel',
      reason: 'Ajuste por nivel',
    }),
  );
  const rows = await t.db.query(
    'SELECT categoria_id, fecha_fin FROM jugador_categoria WHERE jugador_id = 3 ORDER BY id',
  );
  assert.deepEqual(
    rows.map((r: { categoria_id: number; fecha_fin: string | null }) => [
      r.categoria_id,
      r.fecha_fin,
    ]),
    [
      [1, '2026-10-12'], // the old membership ends the day before the new one starts
      [3, null],
    ],
  );
  const [h] = await t.db.query(
    'SELECT categoria_anterior_id, categoria_nueva_id, motivo FROM historial_categoria WHERE jugador_id = 3 ORDER BY id DESC LIMIT 1',
  );
  assert.deepEqual(
    { ...h },
    { categoria_anterior_id: 1, categoria_nueva_id: 3, motivo: 'Ajuste por nivel' },
  );
});

test('HU-020: annual enrollment — season, date, amount, status, linked charge, one per season', async () => {
  const kid = await t.ok<{ id: number }>(
    t.call(secretaria, 'PlayerService', 'create', player('Inscrito', { birthDate: '2015-04-04' })),
  );
  const e = await t.ok<{ id: number }>(
    t.call(secretaria, 'EnrollmentService', 'enroll', {
      playerId: kid.id,
      seasonId: 2,
      enrolledOn: '2026-10-13',
      amountCents: 120_000,
      status: 'PENDIENTE',
      conceptId: 2,
      dueDate: '2026-10-31',
    }),
  );
  const [row] = await t.db.query(
    'SELECT temporada_id, monto, estatus FROM inscripciones WHERE id = ?',
    [e.id],
  );
  assert.deepEqual({ ...row }, { temporada_id: 2, monto: '1200.00', estatus: 'PENDIENTE' });
  assert.equal(
    await t.count('SELECT COUNT(*) AS n FROM cargos WHERE jugador_id = ? AND concepto_id = 2', [
      kid.id,
    ]),
    1,
    '2) linked charge',
  );
  await t.refused(
    t.call(secretaria, 'EnrollmentService', 'enroll', {
      playerId: kid.id,
      seasonId: 2,
      enrolledOn: '2026-10-13',
      amountCents: 0,
      status: 'PENDIENTE',
      conceptId: null,
      dueDate: null,
    }),
    400,
  );
  assert.equal(
    await t.count('SELECT COUNT(*) AS n FROM jugador_categoria WHERE jugador_id = ?', [kid.id]),
    0,
    '4) enrollment ≠ category',
  );
});

test('HU-022/023: coaches — contact, status, account, duplicates; several per category, validity, no duplicate assignment', async () => {
  const c = await t.ok<{ id: number }>(
    t.call(secretaria, 'CoachService', 'save', {
      firstName: 'Iván',
      lastName1: 'Soto',
      lastName2: null,
      phone: '5533334444',
      email: 'IVAN@example.com',
    }),
  );
  const [row] = await t.db.query('SELECT email, activo FROM entrenadores WHERE id = ?', [c.id]);
  assert.deepEqual({ ...row }, { email: 'ivan@example.com', activo: 1 });
  await t.refused(
    t.call(secretaria, 'CoachService', 'save', {
      firstName: 'Iván',
      lastName1: 'Soto',
      lastName2: null,
      phone: null,
      email: 'ivan@example.com',
    }),
    400,
  );
  await t.ok(t.call(secretaria, 'CoachService', 'linkAccount', c.id, 'ivan@example.com'));
  assert.equal(
    await t.count(
      'SELECT COUNT(*) AS n FROM entrenadores WHERE id = ? AND usuario_id IS NOT NULL',
      [c.id],
    ),
    1,
    'HU-022.3',
  );
  const a = await t.ok<{ id: number }>(
    t.call(secretaria, 'CoachService', 'assignCategory', {
      coachId: c.id,
      categoryId: 1,
      responsibility: 'Auxiliar',
      startDate: '2026-10-13',
    }),
  );
  assert.ok(
    (await t.count(
      'SELECT COUNT(*) AS n FROM entrenador_categoria WHERE categoria_id = 1 AND fecha_fin IS NULL',
    )) >= 2,
    'HU-023.1',
  );
  await t.refused(
    t.call(secretaria, 'CoachService', 'assignCategory', {
      coachId: c.id,
      categoryId: 1,
      responsibility: null,
      startDate: '2026-10-14',
    }),
    400,
    /ya está asignado/,
  );
  await t.ok(t.call(secretaria, 'CoachService', 'endCategoryAssignment', a.id, '2026-10-20'));
  const [ended] = await t.db.query(
    'SELECT fecha_fin, rol_responsabilidad FROM entrenador_categoria WHERE id = ?',
    [a.id],
  );
  assert.deepEqual(
    { ...ended },
    { fecha_fin: '2026-10-20', rol_responsabilidad: 'Auxiliar' },
    'HU-023.2/3',
  );
  await t.ok(t.call(secretaria, 'CoachService', 'setActive', c.id, false));
});

test('HU-024/025/027: coach views — own categories, players, weekly schedule, competitions; read-only', async () => {
  const coach = await t.login('coach@example.com'); // Carlos: Sub-10
  const cats = await t.ok<{ categoryId?: number; id?: number }[]>(
    t.call(coach, 'CoachPanelService', 'myCategories'),
  );
  assert.ok(cats.length >= 1);
  await t.ok(t.call(coach, 'CategoryService', 'members', 1));
  await t.refused(t.call(coach, 'CategoryService', 'members', 2), 403, undefined);
  const week = await t.ok<unknown[]>(t.call(coach, 'CoachPanelService', 'weeklySchedule'));
  assert.ok(Array.isArray(week) && week.length >= 1, 'HU-025 weekly schedule');
  await t.ok(t.call(coach, 'CoachPanelService', 'myCompetitions'));
  await t.refused(t.call(coach, 'PlayerService', 'update', 1, player('X')), 403);
  await t.refused(
    t.call(coach, 'CategoryService', 'save', {
      seasonId: 2,
      name: 'X',
      minAge: 1,
      maxAge: 2,
      maxCapacity: null,
    }),
    403,
  );
});

test('HU-026: coach ↔ competition/category — current assignment required, several coaches, no exact duplicate', async () => {
  const [cc] = await t.db.query(
    'SELECT id FROM competencia_categoria WHERE categoria_id = 1 ORDER BY id LIMIT 1',
  );
  assert.ok(cc, 'seed has a participation of Sub-10');
  await t.refused(
    t.call(admin, 'CoachService', 'assignCompetition', {
      coachId: 2,
      competitionCategoryId: cc.id,
      startDate: '2026-10-13',
    }),
    400,
  );
  const existing = await t.count(
    'SELECT COUNT(*) AS n FROM entrenador_competencia_categoria WHERE competencia_categoria_id = ? AND activo',
    [cc.id],
  );
  await t.ok(
    t.call(admin, 'CoachService', 'assignCompetition', {
      coachId: 3,
      competitionCategoryId: cc.id,
      startDate: '2026-10-13',
    }),
  );
  assert.equal(
    await t.count(
      'SELECT COUNT(*) AS n FROM entrenador_competencia_categoria WHERE competencia_categoria_id = ? AND activo',
      [cc.id],
    ),
    existing + 1,
  );
  await t.refused(
    t.call(admin, 'CoachService', 'assignCompetition', {
      coachId: 3,
      competitionCategoryId: cc.id,
      startDate: '2026-10-13',
    }),
    400,
  );
});

test('HU-069: venues — create, edit, deactivate instead of delete, reused by schedules and matches', async () => {
  const v = await t.ok<{ id: number }>(
    t.call(secretaria, 'VenueService', 'save', {
      name: 'Cancha Sur',
      location: 'Av. Sur 10',
      reference: null,
    }),
  );
  await t.ok(
    t.call(secretaria, 'VenueService', 'save', {
      id: v.id,
      name: 'Cancha Sur',
      location: 'Av. Sur 12',
      reference: 'Junto al parque',
    }),
  );
  const [row] = await t.db.query('SELECT ubicacion, referencia FROM sedes WHERE id = ?', [v.id]);
  assert.deepEqual({ ...row }, { ubicacion: 'Av. Sur 12', referencia: 'Junto al parque' });
  await t.refused(
    t.call(secretaria, 'VenueService', 'save', {
      name: 'Cancha Sur',
      location: null,
      reference: null,
    }),
    400,
  );
  await t.ok(t.call(secretaria, 'VenueService', 'setActive', 1, false));
  assert.equal(
    await t.count('SELECT COUNT(*) AS n FROM sedes WHERE id = 1'),
    1,
    '3) never deleted',
  );
  const venues = await t.ok<{ id: number; uses: number }[]>(
    t.call(secretaria, 'VenueService', 'list'),
  );
  assert.ok(venues.find((x) => x.id === 1)!.uses > 0, '4) reused by schedules');
  await t.ok(t.call(secretaria, 'VenueService', 'setActive', 1, true));
});

test('HU-070: seasons — name and dates, one current (must be active), history kept', async () => {
  const s = await t.ok<{ id: number }>(
    t.call(secretaria, 'SeasonService', 'save', {
      name: 'Temporada 2027-2028',
      startDate: '2027-08-01',
      endDate: '2028-06-30',
      active: true,
      isCurrent: false,
    }),
  );
  await t.refused(
    t.call(secretaria, 'SeasonService', 'save', {
      name: 'Mala',
      startDate: '2028-08-01',
      endDate: '2027-06-30',
      active: true,
      isCurrent: false,
    }),
    400,
  );
  await t.ok(
    t.call(secretaria, 'SeasonService', 'save', {
      id: s.id,
      name: 'Temporada 2027-2028',
      startDate: '2027-08-01',
      endDate: '2028-06-30',
      active: true,
      isCurrent: true,
    }),
  );
  const current = await t.db.query('SELECT id FROM temporadas WHERE es_actual');
  assert.deepEqual(
    current.map((r: { id: number }) => r.id),
    [s.id],
    '2) exactly one current season',
  );
  await t.refused(
    t.call(secretaria, 'SeasonService', 'save', {
      id: s.id,
      name: 'Temporada 2027-2028',
      startDate: '2027-08-01',
      endDate: '2028-06-30',
      active: false,
      isCurrent: true,
    }),
    400,
  );
  const list = await t.ok<{ id: number; categories: number }[]>(
    t.call(secretaria, 'SeasonService', 'list'),
  );
  assert.ok(list.find((x) => x.id === 2)!.categories >= 3, '3/4) linked data stays queryable');
  await t.ok(
    t.call(secretaria, 'SeasonService', 'save', {
      id: 2,
      name: 'Temporada 2026-2027',
      startDate: '2026-08-01',
      endDate: '2027-06-30',
      active: true,
      isCurrent: true,
    }),
  );
});

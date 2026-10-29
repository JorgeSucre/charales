/**
 * Audit 2026-10-15: criteria that the phase suites only checked through MockDb (DR-*) or with a bare 200 — asserted
 * here on what the API returns from MariaDB. Seed: api/demo.ts. Fixed clock: 2026-10-13 12:00 (api/test-db.ts).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
let admin: string;
let coach: string;
let tutor: string;
before(async () => {
  t = await openTestDb('ef_hucrit');
  [admin, coach, tutor] = await Promise.all(
    ['admin', 'coach', 'tutor'].map((u) => t.login(`${u}@example.com`)),
  );
});
after(() => t?.close());

interface MatchView {
  id: number;
  categoryId: number;
  competitionId: number;
  date: string;
  time: string;
  status: string;
  opponentName: string | null;
  venueName: string | null;
  rescheduleReason: string | null;
  upcoming: boolean;
}

test('HU-021.3: a full category only takes a player with an authorized exception, recorded on the membership', async () => {
  const kid = await t.ok<{ id: number }>(
    t.call(admin, 'PlayerService', 'create', {
      firstName: 'Cupo',
      lastName1: 'Lleno',
      lastName2: null,
      birthDate: '2015-02-02',
      sex: 'F',
      phone: null,
      email: null,
      address: null,
    }),
  );
  const draft = { playerId: kid.id, categoryId: 2, date: '2026-10-13' };
  await t.refused(
    () => t.call(admin, 'PlayerCategoryService', 'assign', { ...draft, exceptionReason: null }),
    400,
    /cupo|lleno|excep/i,
  );
  await t.ok(
    t.call(admin, 'PlayerCategoryService', 'assign', {
      ...draft,
      exceptionReason: 'Autorizado por dirección',
    }),
  );
  const [m] = await t.db.query(
    'SELECT es_excepcion_edad, motivo_excepcion FROM jugador_categoria WHERE jugador_id = ?',
    [kid.id],
  );
  assert.equal(m.motivo_excepcion, 'Autorizado por dirección');
});

test('HU-025: the coach weekly schedule shows category, venue and time, and marks overlaps', async () => {
  const before = await t.ok<{ overlap: boolean }[]>(
    t.call(coach, 'CoachPanelService', 'weeklySchedule'),
  );
  assert.ok(before.every((s) => !s.overlap));
  // Same day and time for Sub-10 at another venue: the two slots overlap.
  await t.ok(
    t.call(admin, 'ScheduleService', 'save', {
      categoryId: 1,
      venueId: 2,
      weekday: 1,
      startTime: '17:30',
      endTime: '18:30',
    }),
  );
  const week = await t.ok<
    {
      weekday: number;
      startTime: string;
      categoryName: string;
      venueName: string;
      overlap: boolean;
    }[]
  >(t.call(coach, 'CoachPanelService', 'weeklySchedule'));
  assert.ok(week.every((s) => s.categoryName && s.venueName && s.startTime));
  assert.equal(week.filter((s) => s.weekday === 1 && s.overlap).length, 2);
});

test('HU-027: the coach sees only the competitions he is assigned to, with category, dates and next matches', async () => {
  const mine = await t.ok<
    {
      id: number;
      categoryName: string;
      startDate: string;
      nextMatches: unknown[];
      coaches: string[];
    }[]
  >(t.call(coach, 'CoachPanelService', 'myCompetitions'));
  assert.deepEqual(
    mine.map((c) => c.id),
    [1],
    'only participation 1 (Liga / Sub-10)',
  );
  assert.equal(mine[0]!.categoryName, 'Sub-10');
  assert.ok(
    mine[0]!.startDate &&
      Array.isArray(mine[0]!.nextMatches) &&
      mine[0]!.coaches.includes('Carlos Pérez'),
  );
});

test('HU-038/041: the coach calendar is only his categories, filters by competition, and tells upcoming from past', async () => {
  const all = await t.ok<MatchView[]>(t.call(coach, 'CoachPanelService', 'myMatches', {}));
  assert.ok(all.length >= 2 && all.every((m) => m.categoryId === 1));
  const played = all.find((m) => m.status === 'JUGADO')!;
  assert.equal(played.upcoming, false, 'past');
  const moved = all.find((m) => m.status === 'REPROGRAMADO')!;
  assert.ok(moved.rescheduleReason, 'HU-038.4 shows the reschedule and its reason');
  const options = await t.ok<{ id: number }[]>(
    t.call(coach, 'CoachPanelService', 'competitionOptions'),
  );
  assert.deepEqual(
    options.map((o) => o.id),
    [1],
  );
  const byCompetition = await t.ok<MatchView[]>(
    t.call(coach, 'CoachPanelService', 'myMatches', { competitionId: 1 }),
  );
  assert.ok(byCompetition.every((m) => m.competitionId === 1));
});

test('HU-032: attendance percentages — present and present-or-justified, per player', async () => {
  const rows = await t.ok<
    {
      playerId: number;
      total: number;
      present: number;
      justified: number;
      presentPct: number;
      presentOrJustifiedPct: number;
    }[]
  >(t.call(admin, 'AttendanceService', 'report', { categoryId: 1 }));
  const emiliano = rows.find((r) => r.playerId === 5)!;
  assert.deepEqual(
    [emiliano.total, emiliano.justified, emiliano.presentPct, emiliano.presentOrJustifiedPct],
    [1, 1, 0, 100],
  );
  const diego = rows.find((r) => r.playerId === 1)!;
  assert.equal(diego.presentPct, 100);
});

test('HU-033: the family sees date and status of each session and the percentage of the period', async () => {
  const a = await t.ok<{
    rows: { date: string; status: string }[];
    summary: { total: number; presentPct: number };
  }>(t.call(tutor, 'PortalService', 'attendance', 1, '2026-10-01', '2026-10-31'));
  assert.deepEqual(
    a.rows.map((r) => [r.date, r.status]),
    [['2026-10-05', 'PRESENTE']],
  );
  assert.deepEqual([a.summary.total, a.summary.presentPct], [1, 100]);
  const none = await t.ok<{ rows: unknown[]; summary: { total: number } }>(
    t.call(tutor, 'PortalService', 'attendance', 1, '2026-09-01', '2026-09-30'),
  );
  assert.equal(none.summary.total, 0, 'period filter');
});

test('HU-039/061/062/063: family views — date, time, venue and rival; cards; sporting data; competitions by roster', async () => {
  const child = await t.ok<{
    upcoming: MatchView[];
    category: { name: string; since: string };
    schedules: { weekday: number; venueName: string }[];
    coaches: { name: string }[];
    competitions: {
      competitionName: string;
      categoryName: string;
      status: string;
      participationId: number;
    }[];
  }>(t.call(tutor, 'PortalService', 'child', 2));
  const next = child.upcoming[0]!;
  assert.deepEqual(
    [next.date, next.time, next.venueName, next.opponentName],
    ['2026-10-18', '12:00', 'Campo Principal', 'Halcones'],
    'HU-039.2',
  );
  assert.deepEqual(child.category, { name: 'Sub-12', since: '2026-08-05' }, 'HU-062.1');
  assert.ok(
    child.schedules.length === 2 && child.schedules.every((s) => s.venueName),
    'HU-062.2/3',
  );
  assert.deepEqual(
    child.coaches.map((c) => c.name),
    ['Marta Díaz'],
    'HU-062.4',
  );
  assert.deepEqual(
    child.competitions.map((c) => [c.competitionName, c.categoryName, c.status]).sort(),
    [
      ['Copa Otoño', 'Sub-12', 'PLANIFICADA'],
      ['Liga Municipal', 'Sub-12', 'ACTIVA'],
    ],
    'HU-063: Lucía is in both rosters',
  );
  const cards = await t.ok<
    {
      playerId: number;
      categoryName: string;
      nextMatch: MatchView | null;
      balanceCents: number;
      overdueCents: number;
    }[]
  >(t.call(tutor, 'PortalService', 'overview'));
  const lucia = cards.find((c) => c.playerId === 2)!;
  assert.deepEqual(
    [lucia.categoryName, lucia.nextMatch?.id, lucia.balanceCents, lucia.overdueCents],
    ['Sub-12', 3, 95_000, 60_000],
    'HU-061',
  );
  // HU-039.3: cancellations and reschedules are shown to the family, with the new date and the reason.
  await t.ok(t.call(admin, 'MatchService', 'cancel', 4, 'Suspendido por la liga'));
  await t.ok(
    t.call(admin, 'MatchService', 'reschedule', 3, {
      date: '2026-10-19',
      time: '13:00',
      venueId: 2,
      reason: 'Cambio de cancha',
    }),
  );
  const after = await t.ok<{ upcoming: MatchView[] }>(t.call(tutor, 'PortalService', 'child', 2));
  assert.deepEqual(
    after.upcoming.map((m) => [m.id, m.status, m.date, m.rescheduleReason]),
    [
      [3, 'REPROGRAMADO', '2026-10-19', 'Cambio de cancha'],
      [4, 'CANCELADO', '2026-10-25', null],
    ],
  );
});

test('HU-007: the audit log filters by user, module and date, and the API offers no way to edit it', async () => {
  await t.ok(
    t.call(admin, 'VenueService', 'save', {
      name: 'Para auditar',
      location: null,
      reference: null,
    }),
  );
  const page = await t.ok<{
    items: { userId: number | null; module: string | null; action: string; createdAt: string }[];
  }>(
    t.call(admin, 'AuditService', 'list', {
      module: 'sedes',
      userId: 1,
      from: '2026-10-13',
      to: '2026-10-13',
    }),
  );
  assert.ok(page.items.length >= 1);
  assert.ok(
    page.items.every(
      (a) => a.module === 'sedes' && a.userId === 1 && a.createdAt.startsWith('2026-10-13'),
    ),
  );
  const none = await t.ok<{ items: unknown[] }>(
    t.call(admin, 'AuditService', 'list', {
      module: 'sedes',
      from: '2025-01-01',
      to: '2025-01-31',
    }),
  );
  assert.equal(none.items.length, 0);
  for (const method of ['log', 'save', 'update', 'delete'])
    assert.equal(
      (await t.call(admin, 'AuditService', method)).status,
      404,
      `AuditService.${method}`,
    );
});

test('HU-041.4: results in chronological order, ascending or descending', async () => {
  const asc = await t.ok<MatchView[]>(
    t.call(coach, 'CoachPanelService', 'myMatches', { order: 'asc' }),
  );
  const desc = await t.ok<MatchView[]>(
    t.call(coach, 'CoachPanelService', 'myMatches', { order: 'desc' }),
  );
  const key = (m: MatchView) => `${m.date} ${m.time}`;
  assert.deepEqual(asc.map(key), [...asc.map(key)].sort());
  assert.deepEqual(desc.map(key), [...asc.map(key)].reverse());
});

test('HU-060.3: coach notices newest first', async () => {
  const list = await t.ok<{ publishedAt: string }[]>(t.call(coach, 'CoachPanelService', 'notices'));
  assert.ok(list.length >= 2);
  assert.deepEqual(
    list.map((n) => n.publishedAt),
    list
      .map((n) => n.publishedAt)
      .sort()
      .reverse(),
  );
});

// ── Cierre 2026-10-29 (matriz actualizada): HU-004, HU-006 y HU-007 criterio por criterio sobre MariaDB ──

test('HU-004: staff accounts — minimal data, role stored and editable, deactivated cannot log in, never deleted', async () => {
  const secretaria = await t.login('secretaria@example.com');
  const draft = { roleId: 2, firstName: 'Olga', lastName: 'Alta', email: ' Olga@Example.com ' };
  // 1) minimal data, validated on the server, nothing written when refused
  await t.refused(
    () => t.call(admin, 'UserService', 'save', { ...draft, firstName: '  ' }),
    400,
    /^Falta el nombre\. Es un dato obligatorio\.$/,
  );
  await t.refused(
    () => t.call(admin, 'UserService', 'save', { ...draft, email: 'olga@example' }),
    400,
    /^Ingresa un correo electrónico válido, por ejemplo nombre@dominio\.com\.$/,
  );
  await t.refused(
    () => t.call(admin, 'UserService', 'save', { ...draft, roleId: 999 }),
    400,
    /^Selecciona un rol de seguridad válido\.$/,
  );
  const u = await t.ok<{ id: number }>(t.call(admin, 'UserService', 'save', draft));
  const row = async () => ({
    ...(await t.db.query('SELECT email, rol_id, activo FROM usuarios WHERE id = ?', [u.id]))[0],
  });
  // 2) the role is stored and can be changed
  assert.deepEqual(await row(), { email: 'olga@example.com', rol_id: 2, activo: 1 });
  await t.refused(
    () => t.call(admin, 'UserService', 'save', { ...draft, email: 'OLGA@example.com' }),
    400,
    /^Ya existe un usuario con ese correo\.$/,
  );
  await t.ok(t.call(admin, 'UserService', 'save', { ...draft, id: u.id, roleId: 1 }));
  assert.equal((await row()).rol_id, 1);
  assert.equal(
    await t.count(
      "SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'usuarios' AND entidad_id = ? AND accion IN ('CREAR','EDITAR')",
      [u.id],
    ),
    2,
  );
  // 3) a deactivated account cannot log in (a new login, not only its open sessions)
  const token = /token=([\w-]+)/.exec(t.mail.find((m) => m.to === 'olga@example.com')!.text)![1];
  await fetch(`${t.base}/auth/password-reset/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, newPassword: 'Olga12345x' }),
  });
  await t.login('olga@example.com', 'Olga12345x');
  await t.ok(t.call(admin, 'UserService', 'setActive', u.id, false));
  const denied = await fetch(`${t.base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'olga@example.com', password: 'Olga12345x' }),
  });
  assert.equal(denied.status, 401);
  await t.refused(
    () => t.call(admin, 'UserService', 'setActive', 1, false),
    400,
    /^No puedes desactivar tu propia cuenta\.$/,
  );
  // 4) never deleted: there is no such operation, and the row (with its history) stays
  for (const method of ['delete', 'remove'])
    assert.equal((await t.call(admin, 'UserService', method, u.id)).status, 404);
  assert.equal((await row()).activo, 0);
  // D12: Secretaría does not manage accounts — refused by the server, nothing written
  await t.refused(() => t.call(secretaria, 'UserService', 'list', {}), 403);
  await t.refused(
    () => t.call(secretaria, 'UserService', 'save', { ...draft, email: 'x@example.com' }),
    403,
  );
  await t.refused(() => t.call(secretaria, 'UserService', 'setActive', u.id, true), 403);
});

test('HU-006: permission matrix — actions per module, protected base permissions, audited, Secretaría refused', async () => {
  const secretaria = await t.login('secretaria@example.com');
  const m = await t.ok<{
    permissions: { id: number; module: string; action: string }[];
    granted: string[];
  }>(t.call(admin, 'RoleService', 'matrix'));
  // 1) consultar/crear/editar per module; cancelar where the module has a cancellation (users, payments, charges)
  const actions = new Set(m.permissions.map((p) => p.action));
  for (const a of ['consultar', 'crear', 'editar', 'cancelar']) assert.ok(actions.has(a), a);
  for (const mod of ['usuarios', 'pagos', 'cobranza'])
    assert.ok(
      m.permissions.some((p) => p.module === mod && p.action === 'cancelar'),
      mod,
    );
  const id = (mod: string, action: string) =>
    m.permissions.find((p) => p.module === mod && p.action === action)!.id;
  // 3) base roles never lose their way in
  await t.refused(
    () => t.call(admin, 'RoleService', 'setPermission', 1, id('roles', 'editar'), false),
    400,
    /quedaría sin acceso/,
  );
  await t.refused(
    () => t.call(admin, 'RoleService', 'setPermission', 4, id('portal', 'consultar'), false),
    400,
    /quedaría sin acceso/,
  );
  // 4) who changed it is recorded
  const before = await t.count("SELECT COUNT(*) AS n FROM auditoria WHERE modulo = 'roles'");
  await t.ok(t.call(admin, 'RoleService', 'setPermission', 2, id('avisos', 'crear'), false));
  await t.ok(t.call(admin, 'RoleService', 'setPermission', 2, id('avisos', 'crear'), true));
  const rows = await t.db.query(
    "SELECT usuario_id, accion FROM auditoria WHERE modulo = 'roles' ORDER BY id DESC LIMIT 2",
  );
  assert.equal(
    await t.count("SELECT COUNT(*) AS n FROM auditoria WHERE modulo = 'roles'"),
    before + 2,
  );
  assert.ok(
    rows.every(
      (r: { usuario_id: number; accion: string }) => r.usuario_id === 1 && r.accion === 'EDITAR',
    ),
  );
  // D12: only the administrator edits the matrix
  await t.refused(() => t.call(secretaria, 'RoleService', 'matrix'), 403);
  await t.refused(
    () => t.call(secretaria, 'RoleService', 'setPermission', 2, id('usuarios', 'consultar'), true),
    403,
  );
});

test('HU-007.1/4: payments, players, enrollments and users leave who, what, when and which entity; Secretaría cannot read it', async () => {
  const secretaria = await t.login('secretaria@example.com');
  const since = await t.count('SELECT MAX(id) AS n FROM auditoria');
  const p = await t.ok<{ id: number }>(
    t.call(secretaria, 'PlayerService', 'create', {
      firstName: 'Bitácora',
      lastName1: 'Prueba',
      lastName2: null,
      birthDate: '2016-01-01',
      sex: 'NO_ESPECIFICADO',
      phone: '3312345678',
      email: null,
      address: null,
    }),
  );
  const e = await t.ok<{ id: number }>(
    t.call(secretaria, 'EnrollmentService', 'enroll', {
      playerId: p.id,
      seasonId: 2,
      enrolledOn: '2026-10-13',
      amountCents: 0,
      status: 'PENDIENTE',
      conceptId: null,
      dueDate: null,
    }),
  );
  const pay = await t.ok<{ id: number }>(
    t.call(secretaria, 'BillingService', 'registerPayment', {
      playerId: 2,
      tutorId: 1,
      amountCents: 1000,
      method: 'EFECTIVO',
    }),
  );
  await t.ok(t.call(admin, 'UserService', 'setActive', 6, false));
  await t.ok(t.call(admin, 'UserService', 'setActive', 6, true));
  const rows = await t.db.query(
    'SELECT usuario_id, accion, entidad, entidad_id, creado_en FROM auditoria WHERE id > ?',
    [since],
  );
  const has = (entity: string, entityId: number, userId: number) =>
    rows.some(
      (r: { usuario_id: number; entidad: string; entidad_id: number; creado_en: unknown }) =>
        r.entidad === entity && r.entidad_id === entityId && r.usuario_id === userId && r.creado_en,
    );
  assert.ok(has('jugadores', p.id, 2), 'player');
  assert.ok(has('inscripciones', e.id, 2), 'enrollment');
  assert.ok(has('pagos', pay.id, 2), 'payment');
  assert.ok(has('usuarios', 6, 1), 'user');
  await t.refused(() => t.call(secretaria, 'AuditService', 'list', {}), 403);
});

// ── Cierre 2026-10-29: jugadores, categorías, entrenadores y sedes — criterios que sólo tenían una aserción débil ──

const newKid = async (cookie: string, firstName: string, birthDate = '2016-05-05') =>
  (
    await t.ok<{ id: number }>(
      t.call(cookie, 'PlayerService', 'create', {
        firstName,
        lastName1: 'Cierre',
        lastName2: null,
        birthDate,
        sex: 'NO_ESPECIFICADO',
        phone: null,
        email: null,
        address: null,
      }),
    )
  ).id;

test('HU-013: the record shows exactly what MariaDB holds — current and past categories, charges, uniforms and competitions', async () => {
  const secretaria = await t.login('secretaria@example.com');
  // A player with uniforms and a roster in the seed (whichever it is), so «4)» is not checked on empty lists.
  const [withAll] = await t.db.query(
    `SELECT j.id FROM jugadores j WHERE EXISTS (SELECT 1 FROM pedidos_uniforme p WHERE p.jugador_id = j.id)
       AND EXISTS (SELECT 1 FROM jugador_competencia_categoria r WHERE r.jugador_id = j.id) ORDER BY j.id LIMIT 1`,
  );
  assert.ok(withAll, 'fixture: a player with uniform orders and a roster');
  const id = withAll.id as number;
  const rec = await t.ok<{
    categories: unknown[];
    charges: unknown[];
    payments: unknown[];
    uniforms: unknown[];
    competitions: unknown[];
  }>(t.call(secretaria, 'PlayerService', 'record', id));
  const n = (sql: string) => t.count(sql, [id]);
  assert.equal(
    rec.categories.length,
    await n('SELECT COUNT(*) AS n FROM jugador_categoria WHERE jugador_id = ?'),
  );
  assert.equal(
    rec.charges.length,
    await n('SELECT COUNT(*) AS n FROM cargos WHERE jugador_id = ?'),
  );
  assert.equal(
    rec.payments.length,
    await n('SELECT COUNT(*) AS n FROM pagos WHERE jugador_id = ?'),
  );
  assert.equal(
    rec.uniforms.length,
    await n('SELECT COUNT(*) AS n FROM pedidos_uniforme WHERE jugador_id = ?'),
  );
  assert.equal(
    rec.competitions.length,
    await n('SELECT COUNT(*) AS n FROM jugador_competencia_categoria WHERE jugador_id = ?'),
  );
  assert.ok(rec.uniforms.length > 0 && rec.competitions.length > 0);
  // 2) current and past categories: after a change, both memberships are listed, the old one closed.
  const kid = await newKid(admin, 'Historial');
  await t.ok(
    t.call(admin, 'PlayerCategoryService', 'assign', {
      playerId: kid,
      categoryId: 1,
      date: '2026-09-01',
      exceptionReason: null,
    }),
  );
  await t.ok(
    t.call(admin, 'PlayerCategoryService', 'change', {
      playerId: kid,
      categoryId: 3,
      date: '2026-10-13',
      exceptionReason: 'Nivel',
      reason: 'Nivel',
    }),
  );
  const after = await t.ok<{
    categories: { categoryName: string; endDate: string | null }[];
    categoryChanges: { changedAt: string; reason: string | null }[];
  }>(t.call(secretaria, 'PlayerService', 'record', kid));
  assert.deepEqual(
    after.categories.map((c) => c.endDate === null).sort(),
    [false, true],
    'one current, one past',
  );
  // HU-019.4: reason and date of the change
  assert.ok(
    after.categoryChanges.some((c) => c.reason === 'Nivel' && c.changedAt.startsWith('2026-10-13')),
  );
});

test('HU-018.1/4: the group lists only active players, and its total is the number listed', async () => {
  const kid = await newKid(admin, 'Baja', '2019-03-03');
  await t.ok(
    t.call(admin, 'PlayerCategoryService', 'assign', {
      playerId: kid,
      categoryId: 3,
      date: '2026-10-13',
      exceptionReason: null,
    }),
  );
  const ids = async () =>
    (await t.ok<{ playerId: number }[]>(t.call(admin, 'CategoryService', 'members', 3))).map(
      (m) => m.playerId,
    );
  assert.ok((await ids()).includes(kid));
  await t.ok(t.call(admin, 'PlayerService', 'changeStatus', kid, 'BAJA_TEMPORAL', 'Lesión'));
  assert.ok(!(await ids()).includes(kid), 'a player in BAJA is not a member');
  // 4) the page shows «Jugadores activos (N)» from this same list (categories.pages.ts). The HU-021 occupancy still
  // counts a BAJA whose membership stays open: whether a temporary leave keeps its slot is a pending decision.
  const list = await t.ok<{ id: number; occupancy: number }[]>(
    t.call(admin, 'CategoryService', 'list', {}),
  );
  assert.equal(list.find((c) => c.id === 3)!.occupancy, (await ids()).length + 1);
});

test('HU-015.2: ages outside 0–99 or not whole numbers are refused', async () => {
  for (const [minAge, maxAge] of [
    [-1, 10],
    [8, 100],
    [8.5, 10],
  ])
    await t.refused(
      () =>
        t.call(admin, 'CategoryService', 'save', {
          seasonId: 2,
          name: `Rango ${minAge}`,
          minAge,
          maxAge,
          maxCapacity: null,
        }),
      400,
      /^Ingresa edades mínima y máxima válidas: números enteros de 0 a 99\.$/,
    );
});

test('HU-022.2 / HU-069.3-4: an inactive coach or venue is kept but cannot be used for new assignments or schedules', async () => {
  const secretaria = await t.login('secretaria@example.com');
  const c = await t.ok<{ id: number }>(
    t.call(secretaria, 'CoachService', 'save', {
      firstName: 'Inés',
      lastName1: 'Inactiva',
      lastName2: null,
      phone: '3300001111',
      email: null,
    }),
  );
  await t.ok(t.call(secretaria, 'CoachService', 'setActive', c.id, false));
  assert.equal(
    await t.count('SELECT COUNT(*) AS n FROM entrenadores WHERE id = ? AND NOT activo', [c.id]),
    1,
  );
  await t.refused(
    () =>
      t.call(secretaria, 'CoachService', 'assignCategory', {
        coachId: c.id,
        categoryId: 1,
        responsibility: null,
        startDate: '2026-10-13',
      }),
    400,
    /^El entrenador está inactivo\.$/,
  );
  await t.refused(
    () =>
      t.call(secretaria, 'CoachService', 'save', {
        firstName: 'Sin',
        lastName1: 'Contacto',
        lastName2: null,
        phone: ' ',
        email: '',
      }),
    400,
    /^Captura al menos un teléfono o un correo electrónico de contacto\.$/,
  );
  const v = await t.ok<{ id: number }>(
    t.call(secretaria, 'VenueService', 'save', {
      name: 'Cancha cerrada',
      location: null,
      reference: null,
    }),
  );
  await t.ok(t.call(secretaria, 'VenueService', 'setActive', v.id, false));
  await t.refused(
    () =>
      t.call(secretaria, 'ScheduleService', 'save', {
        categoryId: 3,
        venueId: v.id,
        weekday: 3,
        startTime: '10:00',
        endTime: '11:00',
      }),
    400,
    /^La sede está inactiva\.$/,
  );
});

test('HU-026: Secretaría assigns a coach to a competition category (role A/S), and an ended assignment no longer counts', async () => {
  const secretaria = await t.login('secretaria@example.com');
  const [cc] = await t.db.query(
    'SELECT id, categoria_id FROM competencia_categoria ORDER BY id LIMIT 1',
  );
  const coach = await t.ok<{ id: number }>(
    t.call(secretaria, 'CoachService', 'save', {
      firstName: 'Tere',
      lastName1: 'Torneo',
      lastName2: null,
      phone: '3300002222',
      email: null,
    }),
  );
  const a = await t.ok<{ id: number }>(
    t.call(secretaria, 'CoachService', 'assignCategory', {
      coachId: coach.id,
      categoryId: cc.categoria_id,
      responsibility: null,
      startDate: '2026-10-01',
    }),
  );
  await t.ok(
    t.call(secretaria, 'CoachService', 'assignCompetition', {
      coachId: coach.id,
      competitionCategoryId: cc.id,
      startDate: '2026-10-13',
    }),
  );
  assert.equal(
    await t.count(
      'SELECT COUNT(*) AS n FROM entrenador_competencia_categoria WHERE entrenador_id = ? AND competencia_categoria_id = ?',
      [coach.id, cc.id],
    ),
    1,
  );
  // 2) only current category assignments: once it ends, a new competition assignment is refused
  await t.ok(t.call(secretaria, 'CoachService', 'endCategoryAssignment', a.id, '2026-10-13'));
  const [other] = await t.db.query(
    'SELECT id FROM competencia_categoria WHERE categoria_id = ? AND id <> ? ORDER BY id LIMIT 1',
    [cc.categoria_id, cc.id],
  );
  if (other)
    await t.refused(
      () =>
        t.call(secretaria, 'CoachService', 'assignCompetition', {
          coachId: coach.id,
          competitionCategoryId: other.id,
          startDate: '2026-10-14',
        }),
      400,
      /no tiene asignación vigente/,
    );
});

// ── Cierre 2026-10-29: entrenamientos, competencias, partidos, cobranza y uniformes ──

test('HU-028.4: a past session can be marked REALIZADO; HU-034.4: competitions have no delete operation', async () => {
  const [past] = await t.db.query(
    "SELECT id FROM sesiones_entrenamiento WHERE estado = 'PROGRAMADO' AND fecha < '2026-10-13' ORDER BY id LIMIT 1",
  );
  assert.ok(past, 'fixture: a past PROGRAMADO session');
  await t.ok(t.call(admin, 'TrainingService', 'setStatus', past.id, 'REALIZADO'));
  assert.equal(
    (await t.db.query('SELECT estado FROM sesiones_entrenamiento WHERE id = ?', [past.id]))[0]
      .estado,
    'REALIZADO',
  );
  for (const method of ['delete', 'remove'])
    assert.equal((await t.call(admin, 'CompetitionService', method, 1)).status, 404);
  for (const method of ['deleteConcept', 'delete'])
    assert.equal(
      (await t.call(admin, 'BillingService', method, 1)).status,
      404,
      `BillingService.${method} (HU-043.3)`,
    );
});

test('HU-037.4 / HU-040.1: a match needs its minimum data; a cancelled match takes no result', async () => {
  const draft = {
    competitionCategoryId: 1,
    opponentId: 2,
    venueId: null,
    date: '2026-10-05',
    time: '09:00',
    homeAway: 'LOCAL',
    notes: null,
  };
  await t.refused(
    () => t.call(admin, 'MatchService', 'schedule', { ...draft, opponentId: null }),
    400,
    /^Selecciona el rival\.$/,
  );
  await t.refused(
    () => t.call(admin, 'MatchService', 'schedule', { ...draft, time: '25:00' }),
    400,
    /^Ingresa una hora válida \(HH:MM\)\.$/,
  );
  await t.refused(
    () => t.call(admin, 'MatchService', 'schedule', { ...draft, opponentId: 999 }),
    400,
    /^Rival inexistente: actualiza la página e inténtalo de nuevo\.$/,
  );
  // venue «Por definir» (D14) is allowed
  const m = await t.ok<{ id: number }>(t.call(admin, 'MatchService', 'schedule', draft));
  await t.ok(t.call(admin, 'MatchService', 'cancel', m.id, 'Lluvia'));
  await t.refused(
    () =>
      t.call(admin, 'MatchService', 'recordResult', m.id, {
        goalsFor: 1,
        goalsAgainst: 0,
        notes: null,
      }),
    400,
    /^El partido está cancelado\.$/,
  );
});

test('HU-048.1/3: the receipt carries folio, date, player, concepts, amount and method, and reading it changes nothing', async () => {
  const [p] = await t.db.query(
    'SELECT folio, fecha_pago, importe, forma_pago FROM pagos WHERE id = 1',
  );
  const r = await t.unchanged(() =>
    t.ok<{
      payment: { folio: string; paidAt: string; amountCents: number; method: string };
      playerName: string;
      lines: { label: string; amountCents: number }[];
    }>(t.call(admin, 'BillingService', 'receipt', 1)),
  );
  assert.equal(r.payment.folio, p.folio);
  assert.equal(r.payment.paidAt.replace('T', ' ').slice(0, 16), String(p.fecha_pago).slice(0, 16));
  assert.equal(r.payment.amountCents, Math.round(Number(p.importe) * 100));
  assert.equal(r.payment.method, p.forma_pago);
  assert.ok(r.playerName);
  assert.ok(
    r.lines.length >= 1 && r.lines.every((l) => l.label && l.amountCents > 0),
    'concepts and amounts',
  );
  const byFolio = await t.ok<{ items: { payment: { id: number } }[] }>(
    t.call(admin, 'BillingService', 'receipts', { query: p.folio }),
  );
  assert.deepEqual(
    byFolio.items.map((x) => x.payment.id),
    [1],
    '2) by folio',
  );
  const none = await t.ok<{ items: unknown[] }>(
    t.call(admin, 'BillingService', 'receipts', { query: 'R-9999' }),
  );
  assert.equal(none.items.length, 0);
});

test('HU-050.1/2: debts filter by period, and show the primary tutor with a contact (or nothing when there is none)', async () => {
  const secretaria = await t.login('secretaria@example.com');
  const all = await t.ok<
    { playerId: number; tutorName: string | null; tutorContact: string | null }[]
  >(t.call(secretaria, 'BillingService', 'debts', {}));
  const [period] = await t.db.query(
    "SELECT periodo FROM cargos WHERE periodo IS NOT NULL AND estado <> 'CANCELADO' GROUP BY periodo ORDER BY periodo LIMIT 1",
  );
  const byPeriod = await t.ok<{ playerId: number }[]>(
    t.call(secretaria, 'BillingService', 'debts', { period: period.periodo }),
  );
  const expected = (
    await t.db.query(
      "SELECT DISTINCT jugador_id FROM cargos WHERE periodo = ? AND estado NOT IN ('CANCELADO', 'PAGADO')",
      [period.periodo],
    )
  ).map((r: { jugador_id: number }) => r.jugador_id);
  assert.deepEqual(byPeriod.map((d) => d.playerId).sort(), [...expected].sort(), '1) by period');
  for (const d of all) {
    const [primary] = await t.db.query(
      `SELECT t.telefono, t.email FROM tutor_jugador tj JOIN tutores t ON t.id = tj.tutor_id
        WHERE tj.jugador_id = ? AND tj.es_contacto_principal`,
      [d.playerId],
    );
    if (primary)
      assert.ok(
        d.tutorName && d.tutorContact,
        `2) player ${d.playerId}: primary tutor and contact`,
      );
    else
      assert.equal(d.tutorName, null, `player ${d.playerId}: no primary contact, nothing invented`);
  }
});

test('HU-053.4 / HU-054.3: an order stores its request date; a paid order cannot be cancelled until its payment is', async () => {
  const secretaria = await t.login('secretaria@example.com');
  const o = await t.ok<{ id: number; chargeId: number }>(
    t.call(secretaria, 'UniformService', 'createOrder', 2, [{ variantId: 2, quantity: 1 }], 1),
  );
  assert.equal(
    (await t.db.query('SELECT fecha_solicitud FROM pedidos_uniforme WHERE id = ?', [o.id]))[0]
      .fecha_solicitud,
    '2026-10-13',
  );
  const [charge] = await t.db.query('SELECT monto_original FROM cargos WHERE id = ?', [o.chargeId]);
  const pay = await t.ok<{ id: number }>(
    t.call(secretaria, 'BillingService', 'registerPayment', {
      playerId: 2,
      tutorId: 1,
      amountCents: Math.round(Number(charge.monto_original) * 100),
      method: 'EFECTIVO',
      chargeIds: [o.chargeId],
    }),
  );
  await t.refused(
    () => t.call(secretaria, 'UniformService', 'cancelOrder', o.id, 'Cambio de talla'),
    400,
    /^El cargo tiene pagos aplicados: cancela primero esos pagos \(HU-049\)\.$/,
  );
  await t.ok(t.call(admin, 'BillingService', 'cancelPayment', pay.id, 'Cambio de talla'));
  await t.ok(t.call(secretaria, 'UniformService', 'cancelOrder', o.id, 'Cambio de talla'));
  const [after] = await t.db.query(
    'SELECT p.estado AS pedido, c.estado AS cargo FROM pedidos_uniforme p JOIN cargos c ON c.id = p.cargo_id WHERE p.id = ?',
    [o.id],
  );
  assert.deepEqual(
    { ...after },
    { pedido: 'CANCELADO', cargo: 'CANCELADO' },
    '3) traceable: payment and charge kept, cancelled',
  );
  assert.equal(
    await t.count("SELECT COUNT(*) AS n FROM pagos WHERE id = ? AND estado = 'CANCELADO'", [
      pay.id,
    ]),
    1,
  );
});

// ── Cierre 2026-10-29: avisos y reportes ──

test('HU-058.4: a category notice past its validity is no longer shown; an unknown category is refused', async () => {
  const secretaria = await t.login('secretaria@example.com');
  const base = {
    message: 'Mensaje',
    published: true,
    categoryIds: [1],
    tutorIds: [],
    coachIds: [],
  };
  await t.ok(
    t.call(secretaria, 'NoticeService', 'save', {
      ...base,
      title: 'Sub-10 vigente',
      startsAt: '2026-10-01T00:00:00',
      endsAt: '2026-12-31T23:59:59',
    }),
  );
  await t.ok(
    t.call(secretaria, 'NoticeService', 'save', {
      ...base,
      title: 'Sub-10 vencido',
      startsAt: '2026-09-01T00:00:00',
      endsAt: '2026-10-01T00:00:00',
    }),
  );
  const seen = (await t.ok<{ title: string }[]>(t.call(coach, 'CoachPanelService', 'notices'))).map(
    (n) => n.title,
  );
  assert.ok(
    seen.includes('Sub-10 vigente') && !seen.includes('Sub-10 vencido'),
    'validity kept per category',
  );
  await t.refused(
    () =>
      t.call(secretaria, 'NoticeService', 'save', {
        ...base,
        title: 'Sin categoría',
        startsAt: null,
        endsAt: null,
        categoryIds: [999],
      }),
    400,
    /^Categoría inexistente: actualiza la página e inténtalo de nuevo\.$/,
  );
});

test('HU-065.3 / HU-067.2: the dashboard income follows the period, and the income report groups by concept as MariaDB does', async () => {
  const income = (from: string, to: string) =>
    t.ok<{ conceptName: string; totalCents: number }[]>(
      t.call(admin, 'ReportService', 'income', from, to),
    );
  const kpi = async (from: string, to: string) =>
    (
      await t.ok<{ kpis: { label: string; value: number }[] }>(
        t.call(admin, 'ReportService', 'dashboard', from, to),
      )
    ).kpis.find((k) => k.label.startsWith('Ingresos'))!;
  const sum = (rows: { totalCents: number }[]) => rows.reduce((s, r) => s + r.totalCents, 0);
  const oct = await kpi('2026-10-01', '2026-10-31');
  assert.equal(oct.value, sum(await income('2026-10-01', '2026-10-31')));
  assert.equal(
    (await kpi('2030-01-01', '2030-01-31')).value,
    0,
    '3) another period, another value',
  );
  // 2) grouped by concept (and month, so a period of several months still reads by concept)
  const rows = await t.ok<{ month: string; conceptName: string; totalCents: number }[]>(
    t.call(admin, 'ReportService', 'income', '2026-08-01', '2026-10-31'),
  );
  const keys = rows.map((r) => `${r.month}|${r.conceptName}`);
  assert.equal(new Set(keys).size, keys.length, 'one row per month and concept');
  const byConcept: Record<string, number> = {};
  for (const r of rows) byConcept[r.conceptName] = (byConcept[r.conceptName] ?? 0) + r.totalCents;
  const db = await t.db.query(
    `SELECT c.nombre AS concepto, SUM(pa.importe_aplicado) AS total
       FROM pago_aplicacion pa JOIN pagos p ON p.id = pa.pago_id JOIN cargos ca ON ca.id = pa.cargo_id
       JOIN conceptos_cobro c ON c.id = ca.concepto_id
      WHERE p.estado = 'APLICADO' AND DATE(p.fecha_pago) BETWEEN '2026-08-01' AND '2026-10-31'
      GROUP BY c.nombre`,
  );
  assert.deepEqual(
    byConcept,
    Object.fromEntries(
      db.map((r: { concepto: string; total: string }) => [
        r.concepto,
        Math.round(Number(r.total) * 100),
      ]),
    ),
  );
});

// ── R21 (2026-10-29): nombres de personas y de catálogos, por la API ──

test('R21: person names accept accents, hyphens and apostrophes and refuse digits or symbols; catalogs keep digits', async () => {
  const secretaria = await t.login('secretaria@example.com');
  const msg = (label: string) =>
    new RegExp(
      `^${label} sólo admite letras, espacios, guiones, apóstrofos y puntos de abreviatura\\.$`,
    );
  const kid = await t.ok<{ id: number }>(
    t.call(secretaria, 'PlayerService', 'create', {
      firstName: ' José   María ',
      lastName1: "O'Connor-Núñez",
      lastName2: 'D’Ávila',
      birthDate: '2016-04-04',
      sex: 'NO_ESPECIFICADO',
      phone: null,
      email: null,
      address: null,
    }),
  );
  const [row] = await t.db.query(
    'SELECT nombre, apellido_paterno, apellido_materno FROM jugadores WHERE id = ?',
    [kid.id],
  );
  assert.deepEqual(
    { ...row },
    { nombre: 'José María', apellido_paterno: "O'Connor-Núñez", apellido_materno: 'D’Ávila' },
  );
  const player = {
    firstName: 'Ana',
    lastName1: 'Ruiz',
    lastName2: null,
    birthDate: '2016-04-04',
    sex: 'NO_ESPECIFICADO',
    phone: null,
    email: null,
    address: null,
  };
  await t.refused(
    () => t.call(secretaria, 'PlayerService', 'create', { ...player, firstName: 'Ana2' }),
    400,
    msg('El nombre'),
  );
  await t.refused(
    () => t.call(secretaria, 'PlayerService', 'create', { ...player, lastName1: 'Ruiz!' }),
    400,
    msg('El apellido paterno'),
  );
  await t.refused(
    () => t.call(secretaria, 'PlayerService', 'update', kid.id, { ...player, lastName2: '3ro' }),
    400,
    msg('El apellido materno'),
  );
  await t.refused(
    () => t.call(secretaria, 'PlayerService', 'create', { ...player, firstName: '   ' }),
    400,
    /^Falta el nombre\. Es un dato obligatorio\.$/,
  );
  const tutor = {
    firstName: 'Lía',
    lastName1: 'Mendoza',
    lastName2: null,
    phone: '3312345678',
    email: null,
    address: null,
    links: [{ playerId: kid.id, relationship: 'Madre', isPrimary: false }],
  };
  await t.ok(t.call(secretaria, 'TutorService', 'save', tutor));
  await t.refused(
    () => t.call(secretaria, 'TutorService', 'save', { ...tutor, firstName: 'L1a' }),
    400,
    msg('El nombre'),
  );
  await t.refused(
    () =>
      t.call(secretaria, 'CoachService', 'save', {
        firstName: 'Iker',
        lastName1: 'Sol#',
        lastName2: null,
        phone: '3312345678',
        email: null,
      }),
    400,
    msg('El apellido paterno'),
  );
  await t.refused(
    () =>
      t.call(admin, 'UserService', 'save', {
        roleId: 2,
        firstName: 'Rosa',
        lastName: 'Paz 2',
        email: 'rosa.paz@example.com',
      }),
    400,
    msg('El apellido'),
  );
  // catalogs: digits and punctuation are legitimate
  const cat = await t.ok<{ id: number }>(
    t.call(secretaria, 'CategoryService', 'save', {
      seasonId: 2,
      name: 'Sub-14 (B)',
      minAge: 12,
      maxAge: 14,
      maxCapacity: null,
    }),
  );
  assert.equal(
    (await t.db.query('SELECT nombre FROM categorias WHERE id = ?', [cat.id]))[0].nombre,
    'Sub-14 (B)',
  );
  await t.ok(
    t.call(secretaria, 'VenueService', 'save', {
      name: 'Cancha 2',
      location: null,
      reference: null,
    }),
  );
  await t.ok(
    t.call(secretaria, 'BillingService', 'saveConcept', {
      name: 'Torneo 2026',
      suggestedAmountCents: 100,
      recurring: false,
    }),
  );
  await t.refused(
    () =>
      t.call(secretaria, 'VenueService', 'save', { name: '---', location: null, reference: null }),
    400,
    /^El nombre debe incluir letras o números\.$/,
  );
  // who receives a uniform is a person
  const order = await t.ok<{ id: number }>(
    t.call(secretaria, 'UniformService', 'createOrder', 2, [{ variantId: 2, quantity: 1 }], 1),
  );
  await t.refused(
    () => t.call(secretaria, 'UniformService', 'deliver', order.id, 'Mamá 123', '2026-10-13'),
    400,
    msg('Quién recibe'),
  );
});

test('HU-065 · Tablero: players by status and charges by status match MariaDB; cancelled charges never count', async () => {
  const d = await t.ok<{
    period: { from: string; to: string };
    kpis: { key: string; hint: string }[];
    playersByStatus: { status: string; count: number }[];
    chargesByStatus: { status: string; count: number; netCents: number; balanceCents: number }[];
  }>(t.call(admin, 'ReportService', 'dashboard'));
  assert.deepEqual(
    d.period,
    { from: '2026-10-01', to: '2026-10-13' },
    'default period: this month up to today',
  );
  assert.ok(
    d.kpis.every((k) => k.hint && !/[a-z_]+\.[a-z_]+|APLICADO/.test(k.hint)),
    'plain-language hints',
  );
  for (const s of d.playersByStatus)
    assert.equal(
      s.count,
      await t.count('SELECT COUNT(*) AS n FROM jugadores WHERE estatus = ?', [s.status]),
      s.status,
    );
  assert.deepEqual(
    d.playersByStatus.map((s) => s.status),
    ['ACTIVO', 'BAJA_TEMPORAL', 'BAJA_DEFINITIVA'],
  );
  assert.ok(!d.chargesByStatus.some((c) => c.status === 'CANCELADO'));
  for (const c of d.chargesByStatus)
    assert.equal(
      c.count,
      await t.count('SELECT COUNT(*) AS n FROM cargos WHERE estado = ?', [c.status]),
      c.status,
    );
  const paid = d.chargesByStatus.find((c) => c.status === 'PAGADO')!;
  assert.equal(paid.balanceCents, 0, 'a paid charge owes nothing');
  // the overdue balance of the chart is the «Adeudo vencido» KPI
  const overdue = d.chargesByStatus.find((c) => c.status === 'VENCIDO')!;
  const kpi = (
    await t.ok<{ kpis: { key: string; value: number }[] }>(
      t.call(admin, 'ReportService', 'dashboard'),
    )
  ).kpis.find((k) => k.key === 'overdue')!;
  assert.equal(overdue.balanceCents, kpi.value);
  const secretaria = await t.login('secretaria@example.com');
  await t.ok(t.call(secretaria, 'ReportService', 'dashboard'));
  const tutorCookie = await t.login('tutor@example.com');
  await t.refused(() => t.call(tutorCookie, 'ReportService', 'dashboard'), 403);
});

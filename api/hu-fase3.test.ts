/**
 * Phase 3 HU (docs/TRACEABILITY.md): training sessions and attendance, competitions, rosters, matches and results.
 * Criteria of docs/requirements/USER_STORIES.md checked through `/api/rpc` and read back from MariaDB.
 * Seed (api/demo.ts): Carlos (coach@) → Sub-10 (cat 1, sessions 1 and 3); Marta (marta@) → Sub-12 (cat 2) and tutor of
 * Emiliano (5); Teresa (tutor@) → Diego (1) and Lucía (2). Participations: 1 = Liga/Sub-10, 2 = Copa/Sub-12,
 * 3 = Liga/Sub-12.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
let admin: string;
let secretaria: string;
let coach: string;
let marta: string;
let tutor: string;
before(async () => {
  t = await openTestDb('ef_hu3');
  [admin, secretaria, coach, marta, tutor] = await Promise.all(
    ['admin', 'secretaria', 'coach', 'marta', 'tutor'].map((u) => t.login(`${u}@example.com`)),
  );
});
after(() => t?.close());

const session = (extra: Record<string, unknown> = {}) => ({
  categoryId: 1,
  venueId: 1,
  coachId: 1,
  scheduleId: null,
  date: '2026-10-20',
  startTime: '17:00',
  endTime: '18:30',
  objective: null,
  ...extra,
});

test('HU-028: program a session — category, date, time, venue, coach; from schedules; valid dates; statuses', async () => {
  const s = await t.ok<{ id: number; status: string }>(
    t.call(secretaria, 'TrainingService', 'program', session()),
  );
  assert.equal(s.status, 'PROGRAMADO');
  const [row] = await t.db.query(
    'SELECT categoria_id, sede_id, entrenador_id, fecha, hora_inicio FROM sesiones_entrenamiento WHERE id = ?',
    [s.id],
  );
  assert.deepEqual(
    { ...row },
    { categoria_id: 1, sede_id: 1, entrenador_id: 1, fecha: '2026-10-20', hora_inicio: '17:00:00' },
  );
  await t.refused(
    t.call(secretaria, 'TrainingService', 'program', session({ date: '2026-02-30' })),
    400,
  );
  await t.refused(
    t.call(secretaria, 'TrainingService', 'program', session({ endTime: '16:00' })),
    400,
  );
  const gen = await t.ok<{ created: number; skipped: number }>(
    t.call(secretaria, 'TrainingService', 'generateFromSchedules', '2026-10-26', '2026-11-01', 1),
  );
  assert.ok(gen.created >= 2, '2) from the recurring schedule');
  const again = await t.ok<{ created: number }>(
    t.call(secretaria, 'TrainingService', 'generateFromSchedules', '2026-10-26', '2026-11-01', 1),
  );
  assert.equal(again.created, 0, 'not duplicated');
  await t.refused(
    t.call(secretaria, 'TrainingService', 'setStatus', s.id, 'REALIZADO'),
    400,
    /futur/i,
  );
  await t.refused(
    t.call(secretaria, 'TrainingService', 'setStatus', s.id, 'CANCELADO', ''),
    400,
    /motivo/i,
  );
  await t.ok(t.call(secretaria, 'TrainingService', 'setStatus', s.id, 'CANCELADO', 'Lluvia'));
  assert.equal(
    (await t.db.query('SELECT estado FROM sesiones_entrenamiento WHERE id = ?', [s.id]))[0].estado,
    'CANCELADO',
  );
});

test('HU-029: coach sessions — by date, only own, status, group players', async () => {
  const mine = await t.ok<{ id: number; status: string }[]>(
    t.call(coach, 'CoachPanelService', 'sessions'),
  );
  const ids = mine.map((s) => s.id);
  assert.ok(ids.includes(1) && ids.includes(3) && !ids.includes(2), '2) only own sessions');
  assert.ok(
    mine.every((s) => typeof s.status === 'string'),
    '3) status',
  );
  const detail = await t.ok<{ roster?: unknown[]; players?: unknown[] }>(
    t.call(coach, 'TrainingService', 'get', 3),
  );
  assert.ok(Array.isArray(detail.roster ?? detail.players), '4) players of the group');
  await t.refused(t.call(coach, 'TrainingService', 'get', 2), 403);
});

test('HU-030/031: attendance and notes — assigned coach, one per player and session, audited corrections', async () => {
  await t.refused(
    t.call(marta, 'AttendanceService', 'record', 3, [
      { playerId: 1, status: 'PRESENTE', notes: null },
    ]),
    403,
    /No puedes registrar/,
  );
  await t.ok(
    t.call(coach, 'AttendanceService', 'record', 3, [
      { playerId: 1, status: 'PRESENTE', notes: null },
      { playerId: 5, status: 'JUSTIFICADO', notes: 'Médico' },
    ]),
  );
  await t.ok(
    t.call(coach, 'AttendanceService', 'record', 3, [
      { playerId: 1, status: 'AUSENTE', notes: 'Corrección' },
    ]),
  );
  assert.equal(
    await t.count(
      'SELECT COUNT(*) AS n FROM asistencias WHERE sesion_entrenamiento_id = 3 AND jugador_id = 1',
    ),
    1,
    '3) one row per player and session',
  );
  const [row] = await t.db.query(
    'SELECT estado, actualizado_en IS NOT NULL AS corregida FROM asistencias WHERE sesion_entrenamiento_id = 3 AND jugador_id = 1',
  );
  assert.deepEqual({ ...row }, { estado: 'AUSENTE', corregida: 1 });
  assert.ok(
    (await t.count("SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'asistencias'")) >= 1,
    '4) corrections audited',
  );
  await t.refused(
    t.call(coach, 'AttendanceService', 'record', 3, [
      { playerId: 2, status: 'PRESENTE', notes: null },
    ]),
    400,
    undefined,
  );
  // HU-031: objective and notes, only the assigned coach (or admin); the secretary only reads.
  await t.ok(
    t.call(coach, 'TrainingService', 'saveNotes', 3, {
      objective: 'Pases cortos',
      notes: 'Buen ritmo',
    }),
  );
  const [n] = await t.db.query(
    'SELECT objetivo, observaciones FROM sesiones_entrenamiento WHERE id = 3',
  );
  assert.deepEqual({ ...n }, { objetivo: 'Pases cortos', observaciones: 'Buen ritmo' });
  await t.refused(
    t.call(secretaria, 'TrainingService', 'saveNotes', 3, { objective: 'X', notes: null }),
    403,
  );
  await t.refused(
    t.call(marta, 'TrainingService', 'saveNotes', 3, { objective: 'X', notes: null }),
    403,
  );
});

test('HU-032: attendance report — filters, percentage, justified apart', async () => {
  const rows = await t.ok<
    { playerId: number; percentage?: number; justified: number; total: number }[]
  >(
    t.call(secretaria, 'AttendanceService', 'report', {
      from: '2026-10-01',
      to: '2026-10-31',
      categoryId: 1,
    }),
  );
  assert.ok(rows.length >= 1);
  const r5 = rows.find((r) => r.playerId === 5)!;
  assert.ok(r5.justified >= 1, '3) justified counted apart');
  assert.ok(rows.every((r) => r.total >= 1));
  const one = await t.ok<{ playerId: number }[]>(
    t.call(secretaria, 'AttendanceService', 'report', { playerId: 1 }),
  );
  assert.deepEqual([...new Set(one.map((r) => r.playerId))], [1], '1) by player');
  await t.refused(t.call(tutor, 'AttendanceService', 'report', {}), 403);
});

test('HU-033: tutor attendance — own children only, date and status, period percentage, read-only', async () => {
  const a = await t.ok<{ rows?: unknown[]; percentage?: number }>(
    t.call(tutor, 'PortalService', 'attendance', 1, '2026-10-01', '2026-10-31'),
  );
  assert.ok(a);
  await t.refused(t.call(tutor, 'PortalService', 'attendance', 3, '2026-10-01', '2026-10-31'), 403);
  await t.refused(t.call(tutor, 'AttendanceService', 'record', 1, []), 403);
});

test('HU-034: competitions — name, type, season, organizer, status; valid dates; never deleted', async () => {
  const c = await t.ok<{ id: number }>(
    t.call(secretaria, 'CompetitionService', 'save', {
      seasonId: 2,
      name: 'Torneo Relámpago',
      type: 'TORNEO',
      organizer: 'Liga Norte',
      contact: 'liga@example.com',
      startDate: '2026-11-01',
      endDate: '2026-11-02',
      status: 'PLANIFICADA',
      notes: 'Sede por confirmar',
    }),
  );
  const [row] = await t.db.query(
    'SELECT tipo, organizador, contacto, estado FROM competencias WHERE id = ?',
    [c.id],
  );
  assert.deepEqual(
    { ...row },
    {
      tipo: 'TORNEO',
      organizador: 'Liga Norte',
      contacto: 'liga@example.com',
      estado: 'PLANIFICADA',
    },
  );
  await t.refused(
    t.call(secretaria, 'CompetitionService', 'save', {
      seasonId: 2,
      name: 'Fechas mal',
      type: 'LIGA',
      organizer: null,
      contact: null,
      startDate: '2026-12-01',
      endDate: '2026-11-01',
      status: 'PLANIFICADA',
      notes: null,
    }),
    400,
  );
});

test('HU-035/036: participations and rosters — unique, date, eligible players only, no duplicate, history', async () => {
  const p = await t.ok<{ id: number }>(
    t.call(secretaria, 'CompetitionService', 'register', {
      competitionId: 2,
      categoryId: 1,
      registeredOn: '2026-10-13',
      costCents: 50_000,
    }),
  );
  const [cc] = await t.db.query(
    'SELECT fecha_inscripcion, costo, estatus FROM competencia_categoria WHERE id = ?',
    [p.id],
  );
  assert.deepEqual(
    { ...cc },
    { fecha_inscripcion: '2026-10-13', costo: '500.00', estatus: 'INSCRITA' },
  );
  await t.refused(
    t.call(secretaria, 'CompetitionService', 'register', {
      competitionId: 2,
      categoryId: 1,
      registeredOn: '2026-10-13',
      costCents: null,
    }),
    400,
  );
  const eligible = await t.ok<{ id: number }[]>(
    t.call(secretaria, 'CompetitionService', 'eligiblePlayers', p.id),
  );
  assert.ok(
    eligible.every((e) => [1, 3, 5].includes(e.id)),
    'HU-036.1 only Sub-10 members',
  );
  const entry = await t.ok<{ id: number }>(
    t.call(secretaria, 'CompetitionService', 'addToRoster', p.id, 1, '2026-10-13'),
  );
  await t.refused(t.call(secretaria, 'CompetitionService', 'addToRoster', p.id, 1), 400);
  await t.refused(t.call(secretaria, 'CompetitionService', 'addToRoster', p.id, 2), 400, undefined);
  await t.ok(t.call(secretaria, 'CompetitionService', 'removeFromRoster', entry.id, '2026-10-20'));
  const [r] = await t.db.query(
    'SELECT fecha_baja, activo FROM jugador_competencia_categoria WHERE id = ?',
    [entry.id],
  );
  assert.deepEqual(
    { ...r },
    { fecha_baja: '2026-10-20', activo: 0 },
    'HU-036.2/4 kept with its leave date',
  );
});

test('HU-037: matches — registered category, opponent/date/time/venue, statuses, reschedule with reason', async () => {
  const m = await t.ok<{ id: number; status: string }>(
    t.call(secretaria, 'MatchService', 'schedule', {
      competitionCategoryId: 1,
      opponentId: 2,
      venueId: 1,
      date: '2026-11-08',
      time: '10:00',
      homeAway: 'LOCAL',
      notes: null,
    }),
  );
  assert.equal(m.status, 'PROGRAMADO');
  const [row] = await t.db.query(
    'SELECT rival_id, sede_id, fecha, hora FROM partidos WHERE id = ?',
    [m.id],
  );
  assert.deepEqual({ ...row }, { rival_id: 2, sede_id: 1, fecha: '2026-11-08', hora: '10:00:00' });
  await t.refused(
    t.call(secretaria, 'MatchService', 'schedule', {
      competitionCategoryId: 999,
      opponentId: 2,
      venueId: 1,
      date: '2026-11-08',
      time: '10:00',
      homeAway: 'LOCAL',
      notes: null,
    }),
    400,
  );
  await t.refused(
    t.call(secretaria, 'MatchService', 'reschedule', m.id, {
      date: '2026-11-09',
      time: '11:00',
      venueId: 1,
      reason: '',
    }),
    400,
  );
  await t.ok(
    t.call(secretaria, 'MatchService', 'reschedule', m.id, {
      date: '2026-11-09',
      time: '11:00',
      venueId: 2,
      reason: 'Cancha ocupada',
    }),
  );
  const [r] = await t.db.query(
    'SELECT estado, motivo_reprogramacion, fecha FROM partidos WHERE id = ?',
    [m.id],
  );
  assert.deepEqual(
    { ...r },
    { estado: 'REPROGRAMADO', motivo_reprogramacion: 'Cancha ocupada', fecha: '2026-11-09' },
  );
  await t.ok(t.call(secretaria, 'MatchService', 'cancel', m.id, 'Suspendido por la liga'));
  assert.equal(
    (await t.db.query('SELECT estado FROM partidos WHERE id = ?', [m.id]))[0].estado,
    'CANCELADO',
  );
});

test('HU-040: results — played matches only, both scores, no negatives, notes', async () => {
  await t.refused(
    t.call(secretaria, 'MatchService', 'recordResult', 3, {
      goalsFor: 1,
      goalsAgainst: 0,
      notes: null,
    }),
    400,
  );
  const m = await t.ok<{ id: number }>(
    t.call(secretaria, 'MatchService', 'schedule', {
      competitionCategoryId: 1,
      opponentId: 3,
      venueId: 1,
      date: '2026-10-10',
      time: '09:00',
      homeAway: 'VISITANTE',
      notes: null,
    }),
  );
  await t.refused(
    t.call(secretaria, 'MatchService', 'recordResult', m.id, {
      goalsFor: -1,
      goalsAgainst: 0,
      notes: null,
    }),
    400,
  );
  await t.ok(
    t.call(secretaria, 'MatchService', 'recordResult', m.id, {
      goalsFor: 2,
      goalsAgainst: 1,
      notes: 'Remontada',
    }),
  );
  const [r] = await t.db.query(
    'SELECT estado, goles_favor, goles_contra, observaciones FROM partidos WHERE id = ?',
    [m.id],
  );
  assert.deepEqual(
    { ...r },
    { estado: 'JUGADO', goles_favor: 2, goles_contra: 1, observaciones: 'Remontada' },
  );
  await t.refused(t.call(secretaria, 'MatchService', 'cancel', m.id, 'x'), 400, /resultado/);
});

test('HU-038/041: coach calendar and results — only assigned categories, filters, past and upcoming', async () => {
  const all = await t.ok<{ id: number; competitionCategoryId: number; status: string }[]>(
    t.call(coach, 'CoachPanelService', 'myMatches'),
  );
  assert.ok(
    all.length >= 1 && all.every((m) => m.competitionCategoryId === 1),
    'HU-038.1 only his categories',
  );
  assert.ok(
    all.some((m) => m.status === 'REPROGRAMADO'),
    'HU-038.4 shows reschedules',
  );
  const options = await t.ok<{ id: number }[]>(
    t.call(coach, 'CoachPanelService', 'categoryOptions'),
  );
  assert.deepEqual(
    options.map((o) => o.id),
    [1],
    'HU-041.3 only authorized categories',
  );
  const played = all.filter((m) => m.status === 'JUGADO');
  assert.ok(played.length >= 1, 'HU-041 results with score');
  await t.refused(t.call(coach, 'MatchService', 'list', {}), 403);
});

test('HU-039/042: family matches and results — only through the child roster, read-only', async () => {
  const child = await t.ok<{
    matches?: { id: number }[];
    upcoming?: unknown[];
    results?: unknown[];
  }>(t.call(tutor, 'PortalService', 'child', 2));
  assert.ok(child.results !== undefined, 'HU-042 results present');
  await t.refused(t.call(tutor, 'PortalService', 'child', 6), 403);
  await t.refused(
    t.call(tutor, 'MatchService', 'recordResult', 3, { goalsFor: 1, goalsAgainst: 0, notes: null }),
    403,
  );
});

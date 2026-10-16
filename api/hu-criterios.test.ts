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

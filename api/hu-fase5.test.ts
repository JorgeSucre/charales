/**
 * Phase 5 HU (docs/TRACEABILITY.md): notices with audience targeting, and the family and coach portals. Each user
 * must reach only what the relations allow; checked through `/api/rpc` on MariaDB.
 * Seed (api/demo.ts): notices 1 (general, current), 2 (Sub-10, current), 3 (general, expired), 4 (draft).
 * Teresa (tutor@) → Diego (Sub-10) and Lucía (Sub-12); Carlos (coach@) → Sub-10; Marta (marta@) → coach of Sub-12 and
 * tutor of Emiliano (Sub-10).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
let secretaria: string;
let tutor: string;
let coach: string;
let marta: string;
before(async () => {
  t = await openTestDb('ef_hu5');
  [secretaria, tutor, coach, marta] = await Promise.all(
    ['secretaria', 'tutor', 'coach', 'marta'].map((u) => t.login(`${u}@example.com`)),
  );
});
after(() => t?.close());

const notice = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  message: `Mensaje de ${title}`,
  startsAt: '2026-10-01T00:00:00',
  endsAt: '2026-12-31T23:59:59',
  published: true,
  categoryIds: [],
  tutorIds: [],
  coachIds: [],
  ...extra,
});
const titles = (list: { title: string }[]) => list.map((n) => n.title);

test('HU-057: publish — title, message, publication and validity; all or selected audiences; unpublish; ordered by date', async () => {
  const n = await t.ok<{ id: number }>(
    t.call(secretaria, 'NoticeService', 'save', notice('Junta de padres')),
  );
  const [row] = await t.db.query(
    'SELECT titulo, mensaje, fecha_inicio, fecha_fin, publicado, creado_por FROM avisos WHERE id = ?',
    [n.id],
  );
  assert.equal(row.titulo, 'Junta de padres');
  assert.equal(row.fecha_fin, '2026-12-31 23:59:59');
  assert.equal(row.publicado, 1);
  assert.ok(row.creado_por, 'author recorded');
  assert.equal(
    await t.count(
      "SELECT COUNT(*) AS n FROM aviso_destinatario WHERE aviso_id = ? AND tipo_audiencia = 'GENERAL'",
      [n.id],
    ),
    1,
    '2) no selection = all',
  );
  await t.refused(
    () => t.call(secretaria, 'NoticeService', 'save', notice('')),
    400,
    /^Falta el título\. Es un dato obligatorio\.$/,
  );
  await t.refused(
    () =>
      t.call(
        secretaria,
        'NoticeService',
        'save',
        notice('Fechas', { startsAt: '2026-12-01T00:00:00', endsAt: '2026-11-01T00:00:00' }),
      ),
    400,
    /^La vigencia termina antes de empezar\.$/,
  );
  await t.ok(t.call(secretaria, 'NoticeService', 'setPublished', n.id, false));
  assert.ok(
    !titles(await t.ok(t.call(tutor, 'PortalService', 'noticeList'))).includes('Junta de padres'),
    '3) unpublished is hidden',
  );
  await t.ok(t.call(secretaria, 'NoticeService', 'setPublished', n.id, true));
  const list = await t.ok<{ publishedAt: string }[]>(t.call(secretaria, 'NoticeService', 'list'));
  const dates = list.map((x) => x.publishedAt);
  assert.deepEqual(dates, [...dates].sort().reverse(), '4) ordered by date, newest first');
  await t.refused(
    () => t.call(tutor, 'NoticeService', 'save', notice('X')),
    403,
    /^No tienes permiso para realizar esta acción\.$/,
  );
});

test('HU-058: category notice — several categories; only related tutors and coaches see it; validity kept', async () => {
  const n = await t.ok<{ id: number }>(
    t.call(
      secretaria,
      'NoticeService',
      'save',
      notice('Sólo Sub-12 y Sub-8', { categoryIds: [2, 3] }),
    ),
  );
  assert.equal(
    await t.count(
      "SELECT COUNT(*) AS n FROM aviso_destinatario WHERE aviso_id = ? AND tipo_audiencia = 'CATEGORIA'",
      [n.id],
    ),
    2,
    '3) several categories',
  );
  assert.ok(
    titles(await t.ok(t.call(tutor, 'PortalService', 'noticeList'))).includes(
      'Sólo Sub-12 y Sub-8',
    ),
    'Teresa: Lucía is in Sub-12',
  );
  assert.ok(
    titles(await t.ok(t.call(marta, 'CoachPanelService', 'notices'))).includes(
      'Sólo Sub-12 y Sub-8',
    ),
    'Marta coaches Sub-12',
  );
  assert.ok(
    !titles(await t.ok(t.call(coach, 'CoachPanelService', 'notices'))).includes(
      'Sólo Sub-12 y Sub-8',
    ),
    '2) Carlos (Sub-10) does not',
  );
  assert.ok(
    !titles(await t.ok(t.call(marta, 'PortalService', 'noticeList'))).includes(
      'Sólo Sub-12 y Sub-8',
    ),
    'as the tutor of a Sub-10 child, Marta does not see it in the family portal',
  );
});

test('HU-059: family notices — only current ones, general + their children categories, newest first, read-only', async () => {
  const list = await t.ok<{ title: string; publishedAt: string }[]>(
    t.call(tutor, 'PortalService', 'noticeList'),
  );
  const names = titles(list);
  assert.ok(
    names.includes('Bienvenidos a la temporada 2026-2027') &&
      names.includes('Sub-10: entrenamiento del sábado en Unidad Norte'),
  );
  assert.ok(
    !names.includes('Fotos de equipo (vencido)') && !names.includes('Borrador: posada'),
    '1) only current and published',
  );
  const dates = list.map((x) => x.publishedAt);
  assert.deepEqual(dates, [...dates].sort().reverse(), '3) newest first');
  await t.refused(
    () => t.call(tutor, 'NoticeService', 'setPublished', 1, false),
    403,
    /^No tienes permiso para realizar esta acción\.$/,
  );
});

test('HU-060: coach notices — current, general + assigned categories, ordered, read-only', async () => {
  const names = titles(await t.ok(t.call(coach, 'CoachPanelService', 'notices')));
  assert.ok(names.includes('Sub-10: entrenamiento del sábado en Unidad Norte'));
  assert.ok(!names.includes('Fotos de equipo (vencido)'));
  await t.refused(
    () => t.call(coach, 'NoticeService', 'list'),
    403,
    /^No tienes permiso para realizar esta acción\.$/,
  );
});

test('HU-061: family home — one card per child with category, next match, balance and recent notices', async () => {
  const cards = await t.ok<
    { playerId: number; categoryName: string | null; nextMatch: unknown; balanceCents: number }[]
  >(t.call(tutor, 'PortalService', 'overview'));
  assert.deepEqual(cards.map((c) => c.playerId).sort(), [1, 2], '1) one card per own child');
  assert.ok(
    cards.every((c) => c.categoryName && typeof c.balanceCents === 'number' && 'nextMatch' in c),
    '2-4',
  );
  assert.ok(cards.find((c) => c.playerId === 2)!.balanceCents > 0);
  assert.ok(
    (await t.ok<unknown[]>(t.call(tutor, 'PortalService', 'noticeList'))).length >= 1,
    '5) recent notices',
  );
});

test('HU-062/063: child sporting data and competitions — category, schedule, venue, coaches; roster-based', async () => {
  const child = await t.ok<{
    category?: unknown;
    schedules?: { venueName: string }[];
    coaches?: unknown[];
    competitions?: { competitionName?: string }[];
  }>(t.call(tutor, 'PortalService', 'child', 1));
  assert.ok(
    child.schedules && child.schedules.length >= 1 && child.schedules.every((s) => s.venueName),
    'HU-062.2/3',
  );
  assert.ok(child.coaches && child.coaches.length >= 1, 'HU-062.4');
  assert.ok(
    child.competitions && child.competitions.length >= 1,
    'HU-063.1 Diego is in the Liga roster',
  );
  const lucia = await t.ok<{ competitions: { competitionName: string }[] }>(
    t.call(tutor, 'PortalService', 'child', 2),
  );
  assert.ok(lucia.competitions.length >= 1);
  await t.refused(
    () => t.call(tutor, 'PortalService', 'child', 5),
    403,
    /^No tienes acceso a la información de este jugador\.$/,
  );
});

test('HU-064: tutor profile — contact only, format validated, change recorded, player identity untouched', async () => {
  const before = await t.ok<{ firstName: string }>(t.call(tutor, 'PortalService', 'profile'));
  await t.ok(
    t.call(tutor, 'PortalService', 'updateProfile', {
      phone: '5544443333',
      email: 'teresa.nueva@example.com',
      address: 'Calle 1',
    }),
  );
  const [row] = await t.db.query(
    'SELECT nombre, telefono, email, direccion FROM tutores WHERE id = 1',
  );
  assert.deepEqual(
    { ...row },
    {
      nombre: before.firstName,
      telefono: '5544443333',
      email: 'teresa.nueva@example.com',
      direccion: 'Calle 1',
    },
  );
  await t.refused(
    () =>
      t.call(tutor, 'PortalService', 'updateProfile', { phone: null, email: 'mal', address: null }),
    400,
    /^Ingresa un correo electrónico válido, por ejemplo nombre@dominio\.com\.$/,
  );
  assert.ok(
    (await t.count(
      "SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'tutores' AND entidad_id = 1",
    )) >= 1,
    '4) recorded',
  );
  await t.refused(
    () => t.call(tutor, 'PlayerService', 'update', 1, {}),
    403,
    /^No tienes permiso para realizar esta acción\.$/,
  );
  await t.refused(
    () => t.call(tutor, 'TutorService', 'save', { id: 1 }),
    403,
    /^No tienes permiso para realizar esta acción\.$/,
  );
});

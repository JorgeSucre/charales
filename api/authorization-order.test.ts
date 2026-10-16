/**
 * T9 — authorization before existence. Contract: docs/AUTHORIZATION.md («los rechazos lanzan ForbiddenError: mensaje
 * genérico; no revela si el recurso existe») and AGENTS.md (every operation starts with its AuthorizationService
 * check). For one caller without access, an EXISTING and a MISSING id must give the same observable answer — status,
 * message, and no writes (t.refused checks all three) — so the answer can't be used to probe which ids exist.
 *
 *   - no session: 401 for both;
 *   - a session without the permission (tutor on office operations, Secretaría on Administrador-only ones): 403;
 *   - a session with a profile but outside its scope (tutor on another family's child, coach on a category or a
 *     session that isn't his): 403;
 *   - with the permission, the id's existence is legitimately visible (control).
 *
 * Training sessions (TrainingService.get/saveNotes, AttendanceService.record) used to look the session up BEFORE the
 * caller's scope check, so a missing id answered 400 «Sesión no encontrado.» where an existing one answered 403 (plan
 * B-2). They now go through TrainingService.sessionFor: the same 403 for both, and «no encontrado» only for a caller
 * who may read every session (entrenamientos.consultar) — see the control test.
 * Seed: api/demo.ts on a temporary ef_authz_<pid> database.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
let admin: string;
let secretaria: string;
let tutor: string;
let coach: string;
const MISSING = 999_999;
const ids: Record<string, number> = {};

before(async () => {
  t = await openTestDb('ef_authz');
  [admin, secretaria, tutor, coach] = await Promise.all(
    ['admin', 'secretaria', 'tutor', 'coach'].map((u) => t.login(`${u}@example.com`)),
  );
  const one = async (key: string, sql: string) => {
    const [row] = await t.db.query(sql);
    assert.ok(row, `fixture ${key}: ${sql}`);
    ids[key] = Number((row as { id: number }).id);
  };
  // Someone else's child for tutor@ (Teresa → players 1 and 2).
  await one(
    'otherChild',
    `SELECT id FROM jugadores WHERE id NOT IN
       (SELECT tj.jugador_id FROM tutor_jugador tj JOIN tutores tu ON tu.id = tj.tutor_id
          JOIN usuarios u ON u.id = tu.usuario_id WHERE u.email = 'tutor@example.com') ORDER BY id LIMIT 1`,
  );
  // coach@'s coach row, and a category and a training session that are not his.
  await one(
    'coach',
    `SELECT e.id FROM entrenadores e JOIN usuarios u ON u.id = e.usuario_id WHERE u.email = 'coach@example.com'`,
  );
  await one(
    'otherCategory',
    `SELECT id FROM categorias WHERE id NOT IN (SELECT categoria_id FROM entrenador_categoria
       WHERE entrenador_id = ${ids['coach']} AND fecha_fin IS NULL) ORDER BY id LIMIT 1`,
  );
  await one(
    'otherSession',
    `SELECT id FROM sesiones_entrenamiento
      WHERE (entrenador_id IS NULL OR entrenador_id <> ${ids['coach']})
        AND categoria_id NOT IN (SELECT categoria_id FROM entrenador_categoria
                                  WHERE entrenador_id = ${ids['coach']} AND fecha_fin IS NULL)
      ORDER BY id LIMIT 1`,
  );
  for (const [key, table] of [
    ['player', 'jugadores'],
    ['tutor', 'tutores'],
    ['category', 'categorias'],
    ['session', 'sesiones_entrenamiento'],
    ['payment', 'pagos'],
    ['enrollment', 'inscripciones'],
    ['competition', 'competencias'],
    ['participation', 'competencia_categoria'],
    ['match', 'partidos'],
    ['order', 'pedidos_uniforme'],
    ['coachRow', 'entrenadores'],
    ['venue', 'sedes'],
  ] as const)
    await one(key, `SELECT id FROM ${table} ORDER BY id LIMIT 1`);
  await one('adminUser', "SELECT id FROM usuarios WHERE email = 'admin@example.com'");
  await one('role', "SELECT id FROM roles WHERE nombre = 'SECRETARIA'");
  await one('permission', 'SELECT id FROM permisos ORDER BY id LIMIT 1');
});
after(() => t?.close());

/** An operation whose first argument is the id under test; `rest` are the other arguments. */
type Op = [service: string, method: string, rest: unknown[]];
const NO_PERMISSION = /^No tienes permiso para esta operación\.$/;
const PLAYER = /^No tienes acceso a la información de este jugador\.$/;

/** Same caller, existing vs missing id: the same status and message, and nothing written, for both. */
async function sameAnswer(
  cookie: string | null,
  [service, method, rest]: Op,
  existing: number,
  status: 401 | 403,
  message: RegExp,
) {
  for (const id of [existing, MISSING])
    await t.refused(() => t.call(cookie, service, method, id, ...rest), status, message);
}

test('T9 no session: an existing and a missing id both answer 401, nothing written', async () => {
  const noSession = /^Sesión no iniciada o expirada\.$/;
  for (const [op, key] of [
    [['PlayerService', 'record', []], 'player'],
    [['BillingService', 'statement', []], 'player'],
    [['CategoryService', 'members', []], 'category'],
    [['TrainingService', 'get', []], 'session'],
    [['AttendanceService', 'record', [[]]], 'session'],
    [['BillingService', 'cancelPayment', ['x']], 'payment'],
  ] as [Op, string][])
    await sameAnswer(null, op, ids[key]!, 401, noSession);
});

test('T9 a session without the permission: office operations answer the same 403 for existing and missing ids', async () => {
  // The tutor (portal profile only) on office operations; each checks its permission before reading the id.
  for (const [op, key] of [
    [['PlayerService', 'get', []], 'player'],
    [['PlayerService', 'update', [{}]], 'player'],
    [['PlayerService', 'changeStatus', ['BAJA_TEMPORAL', 'x']], 'player'],
    [['TutorService', 'get', []], 'tutor'],
    [['CategoryService', 'setActive', [false]], 'category'],
    [['TrainingService', 'setStatus', ['CANCELADO', 'x']], 'session'],
    [['BillingService', 'receipt', []], 'payment'],
    [['BillingService', 'cancelPayment', ['x']], 'payment'],
    [['EnrollmentService', 'setStatus', ['CANCELADA', 'x']], 'enrollment'],
    [['CompetitionService', 'get', []], 'competition'],
    [['CompetitionService', 'roster', []], 'participation'],
    [['MatchService', 'cancel', ['x']], 'match'],
    [['UniformService', 'deliver', ['x']], 'order'],
    [['CoachService', 'setActive', [false]], 'coachRow'],
    [['VenueService', 'setActive', [false]], 'venue'],
    [['UserService', 'setActive', [false]], 'adminUser'],
  ] as [Op, string][])
    await sameAnswer(tutor, op, ids[key]!, 403, NO_PERMISSION);
  // Secretaría has office access but not these Administrador-only permissions (D12).
  for (const [op, key] of [
    [['BillingService', 'cancelPayment', ['x']], 'payment'],
    [['UserService', 'setActive', [false]], 'adminUser'],
    [['RoleService', 'setPermission', [ids['permission'], false]], 'role'],
  ] as [Op, string][])
    await sameAnswer(secretaria, op, ids[key]!, 403, NO_PERMISSION);
});

test('T9 a profile outside its scope: another family’s child, a category that isn’t the coach’s — same 403', async () => {
  for (const op of [
    ['PlayerService', 'record', []],
    ['BillingService', 'statement', []],
    ['PortalService', 'child', []],
    ['PortalService', 'attendance', []],
  ] as Op[])
    await sameAnswer(tutor, op, ids['otherChild']!, 403, PLAYER);
  for (const op of [
    ['CategoryService', 'members', []],
    ['CategoryService', 'get', []],
  ] as Op[])
    await sameAnswer(
      coach,
      op,
      ids['otherCategory']!,
      403,
      /^No tienes acceso a esta categoría\.$/,
    );
});

// B-2: the three session operations check the scope before telling whether the session exists.
const SESSION_OPS: [Op, RegExp][] = [
  [['TrainingService', 'get', []], /^No tienes acceso a esta sesión\.$/],
  [['AttendanceService', 'record', [[]]], /^No puedes registrar asistencia de esta sesión\.$/],
  [
    ['TrainingService', 'saveNotes', [{ objective: null, notes: null }]],
    /^Sólo el entrenador asignado o un administrador pueden editar la sesión\.$/,
  ],
];
for (const [who, label] of [
  ['tutor', 'a tutor'],
  ['coach', 'a coach not assigned to it'],
] as const)
  for (const [op, message] of SESSION_OPS)
    test(`T9 training sessions, ${label}: ${op[0]}.${op[1]} answers the same 403 for an existing and a missing session`, async () => {
      await sameAnswer(who === 'tutor' ? tutor : coach, op, ids['otherSession']!, 403, message);
    });

test('T9 control: with the permission, existence is legitimately visible (200 vs 400 not found)', async () => {
  await t.ok(t.call(admin, 'PlayerService', 'get', ids['player']));
  await t.refused(
    () => t.call(admin, 'PlayerService', 'get', MISSING),
    400,
    /^Jugador no encontrad[oa]\.$/,
  );
  // The three session operations (B-2), authorized: an existing session works, a missing one keeps the 400.
  const notFound = /^Sesión no encontrad[oa]\.$/;
  await t.ok(t.call(admin, 'TrainingService', 'get', ids['session']));
  await t.refused(() => t.call(admin, 'TrainingService', 'get', MISSING), 400, notFound);
  const notes = { objective: 'Control T9', notes: null };
  await t.ok(t.call(admin, 'TrainingService', 'saveNotes', ids['session'], notes));
  await t.refused(
    () => t.call(admin, 'TrainingService', 'saveNotes', MISSING, notes),
    400,
    notFound,
  );
  const [past] = await t.db.query(
    "SELECT id FROM sesiones_entrenamiento WHERE estado <> 'CANCELADO' AND fecha <= '2026-10-13' ORDER BY fecha DESC LIMIT 1",
  );
  assert.ok(past, 'fixture: a past session to record attendance on');
  await t.ok(t.call(admin, 'AttendanceService', 'record', Number(past.id), []));
  await t.refused(() => t.call(admin, 'AttendanceService', 'record', MISSING, []), 400, notFound);
  // A coach keeps reading his own sessions (in scope), while a missing id answers him the scope's 403.
  const [own] = await t.db.query(
    `SELECT id FROM sesiones_entrenamiento WHERE entrenador_id = ${ids['coach']} ORDER BY id LIMIT 1`,
  );
  assert.ok(own, 'fixture: a session led by coach@');
  await t.ok(t.call(coach, 'TrainingService', 'get', Number(own.id)));
});

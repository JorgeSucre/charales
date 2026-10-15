/**
 * The API runs on the school's clock (America/Mexico_City, MARIADB.md § 1) whatever the machine's time zone: the
 * domain services (today(), nowDateTime()) and the auth endpoints (localDateTime) must agree. Each case runs the domain
 * in a child process with another TZ at an instant where the school's date or hour differs from the machine's.
 * The child imports a real entry point (server.ts, setup.ts…) and nothing else first: its `import.meta.main` is false,
 * so no server starts and no database is opened. The services then run on the MockDb seed (api/domain).
 * Needs `npm run api:build` (api:test runs it).
 */
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDateTime } from './auth.ts';

const CHILD = `
import { mock } from 'node:test';
mock.timers.enable({ apis: ['Date'], now: new Date(process.env.NOW) });
await import(process.env.ENTRY);
// Read right after the entry point and before anything else is imported: the zone IT left in place.
const zoneAfterEntry = new Intl.DateTimeFormat().resolvedOptions().timeZone;
const localDateTime = () => new Date().toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' });
const d = await (await import('./api/rpc.ts')).domain;
const seed = d.seedTables();
const key = (id) => { const p = seed.permissions.find((x) => x.id === id); return p.module + '.' + p.action; };
const perms = seed.rolePermissions.filter((r) => r.roleId === 1).map((r) => key(r.permissionId));
const user = { userId: 1, sessionId: 1, email: 'admin@example.com', displayName: 'Admin', roles: ['ADMINISTRADOR'],
  permissions: perms, officePermissions: perms, tutorId: null, coachId: null, isStaff: true,
  expiresAt: '2099-01-01T00:00:00', lastUsedAt: '2026-01-01T00:00:00' };
const run = async (tables, service, method, ...args) => {
  try { return await d.runDomain({ tables, user, service, method, args }); } catch (e) { return { error: e.message }; }
};
const school = localDateTime().slice(0, 10);
const invite = await run(structuredClone(seed), 'UserService', 'save',
  { roleId: 2, firstName: 'Ana', lastName: '', email: 'ana.tz@example.com' });
const charge = await run(structuredClone(seed), 'BillingService', 'createCharge',
  { playerId: 1, conceptId: 3, amountCents: 10000, dueDate: school, reference: null });
const tomorrow = new Date(Date.parse(school + 'T12:00:00Z') + 86_400_000).toISOString().slice(0, 10);
const tables = structuredClone(seed);
tables.trainingSessions.push({ ...tables.trainingSessions[0], id: 999, date: tomorrow });
const attendance = await run(tables, 'AttendanceService', 'record', 999, []);
const token = invite.tables.resetTokens.at(-1);
console.log(JSON.stringify({
  zoneAfterEntry,
  token: { createdAt: token.createdAt, expiresAt: token.expiresAt },
  charge: charge.error ?? { chargedOn: charge.result.chargedOn, status: charge.result.status },
  attendance: attendance.error ?? 'registrada',
}));
`;

function runIn(tz: string, now: string, entry = './api/server.ts') {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', CHILD], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, TZ: tz, NOW: now, ENTRY: entry },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').at(-1)!);
}

const cases = [
  // School: 2026-10-12 21:00 · machine (UTC+14): 2026-10-13 17:00 — the machine is already «tomorrow».
  { tz: 'Pacific/Kiritimati', now: '2026-10-13T03:00:00Z' },
  // School: 2026-10-13 01:00 · machine (UTC−10): 2026-10-12 21:00 — the machine is still «yesterday».
  { tz: 'Pacific/Honolulu', now: '2026-10-13T07:00:00Z' },
  { tz: 'UTC', now: '2026-10-13T03:00:00Z' },
];

const entries = ['./api/server.ts', './api/setup.ts', './api/create-admin.ts', './api/demo.ts'];
const runs = [
  ...cases.map((c) => ({ ...c, entry: entries[0]! })),
  // The other entry points (db:setup, db:admin, db:mariadb:demo), each on its own.
  ...entries.slice(1).map((entry) => ({ ...cases[0]!, entry })),
];

for (const { tz, now, entry } of runs)
  test(`school time zone with TZ=${tz} via ${entry}: invitations, charges and attendance use America/Mexico_City`, () => {
    const ms = Date.parse(now);
    const school = localDateTime(ms);
    const r = runIn(tz, now, entry);
    // The entry point alone pins the process clock, before any domain code is loaded.
    assert.equal(r.zoneAfterEntry, 'America/Mexico_City');
    // HU-004/012/022: the invitation is stamped on the school's clock and lasts exactly 24 h on it.
    assert.equal(r.token.createdAt, school.replace(' ', 'T'));
    assert.equal(r.token.expiresAt, localDateTime(ms + 24 * 3_600_000).replace(' ', 'T'));
    // HU-044: charged on the school's date; due today (school) is not VENCIDO yet.
    assert.deepEqual(r.charge, { chargedOn: school.slice(0, 10), status: 'PENDIENTE' });
    // HU-030: a session dated the school's tomorrow is still in the future.
    assert.equal(r.attendance, 'No se registra asistencia de una sesión futura.');
  });

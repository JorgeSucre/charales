/**
 * Authentication (HU-001/002): the server side of the mock `AuthService`. Same rules: one message for unknown,
 * inactive and wrong password; `sesiones` stores only the token hash; 8 h lifetime and 30 min idle timeout;
 * LOGIN/LOGOUT and failed attempts go to `auditoria`. The token travels only in an HttpOnly cookie (MARIADB.md § 8.3).
 */
import { argon2, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Pool } from 'mariadb';
import type { Ctx, Reply } from './server.ts';

/** Session policy (HU-002), same values as the mock AuthService. */
export const SESSION_HOURS = 8;
export const IDLE_MINUTES = 30;
export const COOKIE = 'charales_sid';
const SCHOOL_TZ = 'America/Mexico_City';

const INVALID = 'Correo o contraseña incorrectos.';
const NO_SESSION = 'Sesión no iniciada o expirada.';
const NO_ROLE = 'Tu cuenta no tiene un rol o perfil activo. Contacta a la escuela.';
const FORBIDDEN = 'No tienes permiso para esta operación.';

// ---------------------------------------------------------------- passwords (argon2id, PHC string)

const argon2Async = promisify(argon2);
/** OWASP minimum for argon2id: 19 MiB, 2 passes, 1 lane. */
const ARGON = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 };
const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await argon2Async('argon2id', { message: password, nonce: salt, ...ARGON });
  return `$argon2id$v=19$m=${ARGON.memory},t=${ARGON.passes},p=${ARGON.parallelism}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/.exec(stored);
  if (!m) return false;
  const expected = Buffer.from(m[5]!, 'base64');
  const actual = await argon2Async('argon2id', {
    message: password,
    nonce: Buffer.from(m[4]!, 'base64'),
    memory: Number(m[1]),
    passes: Number(m[2]),
    parallelism: Number(m[3]),
    tagLength: expected.length,
  });
  return timingSafeEqual(actual, expected);
}

/** Verified against when the e-mail doesn't exist, so response time doesn't reveal which accounts exist. */
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

// ---------------------------------------------------------------- attempt limiting (MARIADB.md § 8.3)

const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60_000;
// ponytail: in-memory per process; move to a shared store if the API ever runs as several instances.
const failures = new Map<string, number[]>();

function recentFailures(key: string): number[] {
  const since = Date.now() - FAILURE_WINDOW_MS;
  const list = (failures.get(key) ?? []).filter((t) => t > since);
  failures.set(key, list);
  return list;
}

// ---------------------------------------------------------------- dates (school wall clock, MARIADB.md § 1)

/** 'YYYY-MM-DD HH:MM:SS' in the school's time zone: what MariaDB stores (no offset). */
function localDateTime(ms = Date.now()): string {
  return new Date(ms).toLocaleString('sv-SE', { timeZone: SCHOOL_TZ });
}
const toJson = (dt: string) => dt.replace(' ', 'T');

// ---------------------------------------------------------------- endpoints

interface UserRow {
  id: number;
  rol_id: number | null;
  nombre: string | null;
  apellido: string | null;
  email: string;
  password_hash: string;
  activo: number;
}

export async function login(ctx: Ctx, db: Pool): Promise<Reply> {
  const { email, password } = (ctx.body ?? {}) as { email?: unknown; password?: unknown };
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password)
    return { status: 400, body: { error: 'Correo y contraseña son obligatorios.' } };
  if (email.length > 150 || password.length > 200) return { status: 401, body: { error: INVALID } };

  const key = `${ctx.ip}|${email.trim().toLowerCase()}`;
  if (recentFailures(key).length >= MAX_FAILURES)
    return { status: 429, body: { error: 'Demasiados intentos. Intenta de nuevo más tarde.' } };

  const [row]: UserRow[] = await db.query(
    'SELECT id, rol_id, nombre, apellido, email, password_hash, activo FROM usuarios WHERE email = ?',
    [email.trim()],
  );
  const passwordOk = await verifyPassword(password, row?.password_hash ?? (await DUMMY_HASH));
  if (!row || !passwordOk || !row.activo) {
    // A correct password on a disabled account isn't a guess: only wrong passwords count toward the limit.
    if (!passwordOk) recentFailures(key).push(Date.now());
    await audit(
      db,
      row?.id ?? null,
      'OTRO',
      'usuarios',
      row?.id ?? null,
      'Intento de acceso fallido',
      ctx.ip,
    );
    return { status: 401, body: { error: INVALID } };
  }
  failures.delete(key);

  const access = await accessOf(db, row);
  if (!access.roles.length) return { status: 403, body: { error: NO_ROLE } };

  const token = randomBytes(32).toString('base64url');
  const now = localDateTime();
  const expiresAt = localDateTime(Date.now() + SESSION_HOURS * 3_600_000);
  const { insertId } = await db.query(
    `INSERT INTO sesiones (usuario_id, token_hash, inicio_en, expira_en, ultimo_uso_en, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [row.id, sha256(token), now, expiresAt, now, ctx.ip, ctx.userAgent],
  );
  await audit(
    db,
    row.id,
    'LOGIN',
    'sesiones',
    insertId,
    `Inicio de sesión (${access.roles.join(', ')})`,
    ctx.ip,
  );
  return {
    status: 200,
    body: {
      ...access,
      userId: row.id,
      sessionId: insertId,
      email: row.email,
      expiresAt: toJson(expiresAt),
      lastUsedAt: toJson(now),
    },
    cookie: sessionCookie(token, SESSION_HOURS * 3600, ctx.secureCookie),
  };
}

/** HU-002: valid session → the same AuthUser the login returned; touches `ultimo_uso_en`. */
export async function session(ctx: Ctx, db: Pool): Promise<Reply> {
  const s = await currentSession(ctx, db);
  if (!s)
    return {
      status: 401,
      body: { error: NO_SESSION },
      cookie: ctx.token ? clearCookie(ctx.secureCookie) : undefined,
    };
  const now = localDateTime();
  await db.query('UPDATE sesiones SET ultimo_uso_en = ? WHERE id = ?', [now, s.sessionId]);
  return {
    status: 200,
    body: {
      ...(await accessOf(db, s.user)),
      userId: s.user.id,
      sessionId: s.sessionId,
      email: s.user.email,
      expiresAt: toJson(s.expiresAt),
      lastUsedAt: toJson(now),
    },
  };
}

/**
 * Barrier 3 of AUTHORIZATION.md for office operations, like the mock's `requireOffice()` / `require(permission)`:
 * an open session (401) whose SEGURIDAD role grants `permission`, or any permission when none is given (403).
 * A profile (TUTOR/ENTRENADOR) never grants office-wide access (D12). Returns the refusal, or null to proceed.
 */
export async function requireOffice(
  ctx: Ctx,
  db: Pool,
  permission?: string,
): Promise<Reply | null> {
  const s = await currentSession(ctx, db);
  if (!s) return { status: 401, body: { error: NO_SESSION } };
  await db.query('UPDATE sesiones SET ultimo_uso_en = ? WHERE id = ?', [
    localDateTime(),
    s.sessionId,
  ]);
  const { officePermissions } = await accessOf(db, s.user);
  const allowed = permission
    ? officePermissions.includes(permission)
    : officePermissions.length > 0;
  return allowed ? null : { status: 403, body: { error: FORBIDDEN } };
}

/** Idempotent: always clears the cookie; closes and audits the session if there was a valid one. */
export async function logout(ctx: Ctx, db: Pool): Promise<Reply> {
  const s = await currentSession(ctx, db);
  if (s) {
    await db.query('UPDATE sesiones SET cerrada_en = ? WHERE id = ?', [
      localDateTime(),
      s.sessionId,
    ]);
    await audit(db, s.user.id, 'LOGOUT', 'sesiones', s.sessionId, 'Cierre de sesión', ctx.ip);
  }
  return { status: 204, cookie: clearCookie(ctx.secureCookie) };
}

/**
 * The open session behind the cookie, or null. An expired or idle session, or one whose account was deactivated,
 * is closed here (audited as «Sesión expirada»), like the mock's checkSession.
 */
async function currentSession(
  ctx: Ctx,
  db: Pool,
): Promise<{ sessionId: number; expiresAt: string; user: UserRow } | null> {
  if (!ctx.token) return null;
  const [row]: (UserRow & { sesion_id: number; expira_en: string; ultimo_uso_en: string })[] =
    await db.query(
      `SELECT s.id AS sesion_id, s.expira_en, s.ultimo_uso_en,
            u.id, u.rol_id, u.nombre, u.apellido, u.email, u.password_hash, u.activo
       FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = ? AND s.cerrada_en IS NULL`,
      [sha256(ctx.token)],
    );
  if (!row) return null;
  const now = localDateTime();
  const idleSince = localDateTime(Date.now() - IDLE_MINUTES * 60_000);
  if (!row.activo || now >= row.expira_en || row.ultimo_uso_en <= idleSince) {
    await db.query('UPDATE sesiones SET cerrada_en = ? WHERE id = ?', [now, row.sesion_id]);
    await audit(db, row.id, 'LOGOUT', 'sesiones', row.sesion_id, 'Sesión expirada', ctx.ip);
    return null;
  }
  return { sessionId: row.sesion_id, expiresAt: row.expira_en, user: row };
}

/**
 * Roles = SEGURIDAD role of the account + TUTOR / ENTRENADOR from linked profiles (MARIADB.md § 3).
 * `officePermissions` only from the SEGURIDAD role (D12, no lateral escalation). Same shape as `AuthUser`.
 * Recomputed on every request: see docs/API.md «Decisiones» on HU-006.2.
 */
async function accessOf(db: Pool, user: UserRow) {
  const profiles: { kind: 'T' | 'E'; id: number; nombre: string; ap: string; am: string | null }[] =
    await db.query(
      `SELECT 'E' AS kind, id, nombre, apellido_paterno AS ap, apellido_materno AS am
       FROM entrenadores WHERE usuario_id = ? AND activo
     UNION ALL
     SELECT 'T', id, nombre, apellido_paterno, apellido_materno FROM tutores WHERE usuario_id = ?`,
      [user.id, user.id],
    );
  const coach = profiles.find((p) => p.kind === 'E');
  const tutor = profiles.find((p) => p.kind === 'T');
  const profileRoles = [tutor && 'TUTOR', coach && 'ENTRENADOR'].filter((r): r is string => !!r);
  const roles: { id: number; nombre: string; tipo: string }[] = await db.query(
    `SELECT id, nombre, tipo FROM roles
      WHERE activo AND ((tipo = 'SEGURIDAD' AND id = ?) OR (tipo = 'PERFIL' AND nombre IN (?)))
      ORDER BY tipo = 'PERFIL', nombre = 'ENTRENADOR'`,
    [user.rol_id, profileRoles.length ? profileRoles : ['']],
  );
  const grants: { rol_id: number; k: string }[] = roles.length
    ? await db.query(
        `SELECT rp.rol_id, CONCAT(p.modulo, '.', p.accion) AS k
           FROM rol_permiso rp JOIN permisos p ON p.id = rp.permiso_id
          WHERE rp.rol_id IN (?) ORDER BY p.id`,
        [roles.map((r) => r.id)],
      )
    : [];
  const security = roles.find((r) => r.tipo === 'SEGURIDAD');
  const profile = coach ?? tutor;
  return {
    roles: roles.map((r) => r.nombre),
    permissions: [...new Set(grants.map((g) => g.k))],
    officePermissions: grants.filter((g) => g.rol_id === security?.id).map((g) => g.k),
    tutorId: tutor?.id ?? null,
    coachId: coach?.id ?? null,
    isStaff: !!security,
    displayName: security
      ? `${user.nombre} ${user.apellido ?? ''}`.trim()
      : profile
        ? [profile.nombre, profile.ap, profile.am].filter(Boolean).join(' ')
        : user.email,
  };
}

// ---------------------------------------------------------------- helpers

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}
const clearCookie = (secure: boolean) => sessionCookie('', 0, secure);

function audit(
  db: Pool,
  userId: number | null,
  action: 'LOGIN' | 'LOGOUT' | 'OTRO',
  entity: string,
  entityId: number | null,
  description: string,
  ip: string,
) {
  return db.query(
    `INSERT INTO auditoria (usuario_id, accion, modulo, entidad, entidad_id, descripcion, ip, creado_en)
     VALUES (?, ?, 'auth', ?, ?, ?, ?, ?)`,
    [userId, action, entity, entityId, description, ip.slice(0, 45), localDateTime()],
  );
}

/** `node api/auth.ts <password>` prints an argon2id hash (used for db/mariadb/020_dev_seed.sql). */
if (import.meta.main) console.log(await hashPassword(process.argv[2] ?? ''));

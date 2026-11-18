/**
 * Authentication (HU-001/002): the server side of the mock `AuthService`. Same rules: one message for unknown,
 * inactive and wrong password; `sesiones` stores only the token hash; 8 h lifetime and 30 min idle timeout;
 * LOGIN/LOGOUT and failed attempts go to `auditoria`. The token travels only in an HttpOnly cookie (MARIADB.md § 8.3).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolConnection } from 'mariadb';
import type { Ctx, Reply } from './server.ts';
import { deviceCookieName, issueDevice } from './device-trust.ts';
import { reserveLogin, settleLogin, type Reservation } from './login-limit.ts';
import { transaction } from './password.ts';
import {
  hashPassword,
  isLegacyPasswordHash,
  ScryptCapacityError,
  verifyPassword,
} from './passwords.ts';
export { hashPassword, verifyPassword } from './passwords.ts';

/** Session policy (HU-002), same values as the mock AuthService. */
export const SESSION_HOURS = 8;
export const IDLE_MINUTES = 30;
export const COOKIE = 'charales_sid';
const SCHOOL_TZ = 'America/Mexico_City';
// The domain services running in this process (api/domain: today(), nowDateTime()) read the process clock: pin it to
// the school's zone, so invitations, due dates and attendance never follow the machine's TZ (api/timezone.test.ts).
process.env.TZ = SCHOOL_TZ;

const INVALID = 'Correo o contraseña incorrectos.';
const LOGIN_TOO_MANY =
  'Demasiados intentos. Intenta de nuevo más tarde o recupera tu contraseña con «¿Olvidaste tu contraseña?».';
const LOGIN_UNAVAILABLE =
  'El inicio de sesión no está disponible. Intenta de nuevo en unos minutos.';
export const NO_SESSION = 'Tu sesión no está iniciada o ya expiró. Inicia sesión de nuevo.';
const NO_ROLE = 'Tu cuenta no tiene un rol o perfil activo. Contacta a la escuela.';
const FORBIDDEN = 'No tienes permiso para realizar esta acción.';

// ---------------------------------------------------------------- versioned scrypt password hashes (api/passwords.ts)

/** Verifications reached after the shared login limiter admitted an attempt. */
let verifications = 0;
export const passwordVerifications = () => verifications;
const countedVerifyPassword = async (password: string, stored: string) => {
  verifications++;
  return verifyPassword(password, stored);
};

// ---------------------------------------------------------------- dates (school wall clock, MARIADB.md § 1)

/** 'YYYY-MM-DD HH:MM:SS' in the school's time zone: what MariaDB stores (no offset). */
export function localDateTime(ms = Date.now()): string {
  return new Date(ms).toLocaleString('sv-SE', { timeZone: SCHOOL_TZ });
}
const toJson = (dt: string) => dt.replace(' ', 'T');

// ---------------------------------------------------------------- endpoints

export interface UserRow {
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

  // S-01: the attempt is reserved (shared, in MariaDB) before the password hash is checked.
  // If the limiter can't be reached the login is refused: it never runs unlimited.
  const deviceSecret = ctx.cookie(deviceCookieName(email));
  let reservation: Reservation | null;
  try {
    reservation = await reserveLogin(ctx.limiterDb, ctx.ip, email, deviceSecret);
  } catch (e) {
    console.error('Límite de intentos no disponible:', (e as Error).message);
    return { status: 503, body: { error: LOGIN_UNAVAILABLE } };
  }
  if (!reservation) return { status: 429, body: { error: LOGIN_TOO_MANY } };

  const [row]: UserRow[] = await db.query(
    'SELECT id, rol_id, nombre, apellido, email, password_hash, activo FROM usuarios WHERE email = ?',
    [email.trim()],
  );
  // Unknown accounts use verifyPassword's dummy scrypt branch, with no account-dependent response.
  const legacyHash = isLegacyPasswordHash(row?.password_hash);
  let passwordOk: boolean;
  try {
    // Unknown accounts and legacy/malformed hashes each execute the same dummy scrypt work in verifyPassword.
    passwordOk = await countedVerifyPassword(password, row?.password_hash ?? '');
  } catch (error) {
    console.error(
      error instanceof ScryptCapacityError
        ? 'Capacidad de scrypt agotada durante el login.'
        : 'Falló una operación scrypt durante el login.',
    );
    await settleLogin(ctx.limiterDb, reservation, 'not-verified');
    return { status: 503, body: { error: LOGIN_UNAVAILABLE } };
  }
  // A right password on a disabled account costs its attempt like a wrong one: giving it back would reveal, through the
  // counters, that the password was right (audit IND-11).
  if (!row || !passwordOk || !row.activo) {
    await settleLogin(ctx.limiterDb, reservation, 'failed');
    await audit(
      db,
      row?.id ?? null,
      'OTRO',
      'usuarios',
      row?.id ?? null,
      legacyHash ? 'Intento de acceso con hash heredado' : 'Intento de acceso fallido',
      ctx.ip,
    );
    return { status: 401, body: { error: INVALID } };
  }

  const access = await accessOf(db, row);
  if (!access.roles.length) {
    await settleLogin(ctx.limiterDb, reservation, 'right-password');
    return { status: 403, body: { error: NO_ROLE } };
  }

  // Against the account as it is NOW, under its lock: what was verified may have stopped being true while scrypt ran. A
  // password change or recovery takes the same lock and closes sessions and browsers, so either it sees this session, or
  // this login sees the change and is refused (audit IND-02).
  const token = randomBytes(32).toString('base64url');
  const now = localDateTime();
  const expiresAt = localDateTime(Date.now() + SESSION_HOURS * 3_600_000);
  // Its own short lock wait: nothing in the API holds this row long, and a stuck one must not take the general pool.
  let created: { insertId: number; device: string } | null;
  try {
    created = await transaction(db, async (tx) => {
      const [current]: { password_hash: string; activo: number; email: string }[] = await tx.query(
        'SELECT password_hash, activo, email FROM usuarios WHERE id = ? FOR UPDATE WAIT 2',
        [row.id],
      );
      if (
        !current?.activo ||
        current.password_hash !== row.password_hash ||
        current.email !== row.email
      )
        return null;
      const device = await issueDevice(tx, row.id, email, deviceSecret, ctx.secureCookie);
      const { insertId } = await tx.query(
        `INSERT INTO sesiones (usuario_id, token_hash, inicio_en, expira_en, ultimo_uso_en, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [row.id, sha256(token), now, expiresAt, now, ctx.ip, ctx.userAgent],
      );
      return { insertId, device };
    });
  } catch (e) {
    console.error('No se pudo abrir la sesión:', (e as Error).message);
    await settleLogin(ctx.limiterDb, reservation, 'not-verified');
    return { status: 503, body: { error: LOGIN_UNAVAILABLE } };
  }
  if (!created) {
    await settleLogin(ctx.limiterDb, reservation, 'failed');
    return { status: 401, body: { error: INVALID } };
  }
  await settleLogin(ctx.limiterDb, reservation, 'success');
  const { insertId, device } = created;
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
    cookie: [sessionCookie(token, SESSION_HOURS * 3600, ctx.secureCookie), device],
  };
}

/** HU-002: valid session → the same AuthUser the login returned; touches `ultimo_uso_en`. */
export async function session(ctx: Ctx, db: Pool): Promise<Reply> {
  const user = await sessionUser(ctx, db);
  if (!user)
    return {
      status: 401,
      body: { error: NO_SESSION },
      cookie: ctx.token ? clearCookie(ctx.secureCookie) : undefined,
    };
  return { status: 200, body: user };
}

/** The AuthUser of the cookie's open session (touching `ultimo_uso_en`), or null. Also used by the domain bridge. */
export async function sessionUser(ctx: Ctx, db: Pool) {
  const s = await currentSession(ctx, db);
  if (!s) return null;
  const now = localDateTime();
  await db.query('UPDATE sesiones SET ultimo_uso_en = ? WHERE id = ?', [now, s.sessionId]);
  return {
    ...(await accessOf(db, s.user)),
    userId: s.user.id,
    sessionId: s.sessionId,
    email: s.user.email,
    expiresAt: toJson(s.expiresAt),
    lastUsedAt: toJson(now),
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
export async function currentSession(
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

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}
export const clearCookie = (secure: boolean) => sessionCookie('', 0, secure);

/** `db` may be a pooled connection inside a transaction (HU-005). */
export function audit(
  db: Pool | PoolConnection,
  userId: number | null,
  action: 'LOGIN' | 'LOGOUT' | 'EDITAR' | 'OTRO',
  entity: string,
  entityId: number | null,
  description: string,
  ip: string,
  module = 'auth',
) {
  return db.query(
    `INSERT INTO auditoria (usuario_id, accion, modulo, entidad, entidad_id, descripcion, ip, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, action, module, entity, entityId, description, ip.slice(0, 45), localDateTime()],
  );
}

/** `node api/auth.ts <password>` prints a versioned scrypt hash for the local development seed. */
if (import.meta.main) console.log(await hashPassword(process.argv[2] ?? ''));

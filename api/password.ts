/**
 * HU-005 (owner: Borrayo) — password change and recovery. Decisions D2–D8 of the M0 record (docs/API.md):
 * - change (authenticated) and recovery (token) are separate operations (D8);
 * - a change closes the user's OTHER sessions and keeps the current one (D2);
 * - recovery tokens: single use, 60 min, only their SHA-256 is stored; a new request revokes the account's earlier
 *   unused RECOVERY ones through `usado_en` (D3a, D3b, D3d); a pending invitation (`finalidad = 'INVITACION'`,
 *   migration 001, D3e) is never revoked by a recovery request. Both kinds are confirmed here;
 * - the request answers the same whether the account exists or not, with an attempt limit (D7);
 * - without a mail transport it answers 503 before reading anything (D4b); the console transport is dev-only (D4a).
 */
import { randomBytes } from 'node:crypto';
import type { Pool, PoolConnection } from 'mariadb';
import {
  BUSY,
  NO_SESSION,
  audit,
  clearCookie,
  currentSession,
  hashPassword,
  localDateTime,
  sha256,
  verifyPassword,
} from './auth.ts';
import { issueDevice, revokeDevices } from './device-trust.ts';
import {
  clearPasswordChange,
  releasePasswordChange,
  reservePasswordChange,
  reserveResetRequest,
} from './login-limit.ts';
import {
  RESET_TOKEN_MINUTES,
  accessMailText,
  deliverMail,
  enqueueMail,
  type Mailer,
} from './mail.ts';
import type { Ctx, Reply } from './server.ts';

const INVALID_LINK = 'El enlace no es válido o ya expiró.';
const WRONG_CURRENT = 'La contraseña actual no es correcta.';
const TOO_MANY = 'Demasiados intentos. Intenta de nuevo más tarde.';
const RESET_SUBJECT = 'Recupera tu contraseña';
const UNAVAILABLE = 'La recuperación de contraseña no está disponible.';
const CHANGE_UNAVAILABLE = 'No se pudo cambiar la contraseña. Intenta de nuevo en unos minutos.';

export { RESET_TOKEN_MINUTES, mailerFromEnv, withAppUrl } from './mail.ts';
export type { Mailer } from './mail.ts';

/** What guessers try first, among those that meet the length and letter-and-digit rules (F5-16). */
const COMMON_PASSWORDS = new Set(
  'password1 password12 password123 contraseña1 contrasena1 contrasena123 qwerty123 qwerty1234 abc12345 abcd1234 a1234567 12345678a 1234567a admin123 admin1234 administrador1 charales1 charales123 futbol123 futbol1234 mexico123 mexico1234 test1234 prueba123 usuario1 usuario123 hola1234 iloveyou1 letmein1 welcome1 bienvenido1'.split(
    ' ',
  ),
);

/** HU-005.2 — same policy as the frontend (`core/auth/password.ts` → passwordProblem). */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (password.length > 200) return 'La contraseña es demasiado larga.';
  if (!/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password))
    return 'La contraseña debe incluir letras y números.';
  if (COMMON_PASSWORDS.has(password.toLowerCase()))
    return 'Esa contraseña es demasiado común. Elige otra.';
  return null;
}

/** POST /auth/password { currentPassword, newPassword } — HU-005.1: requires the session and the current password. */
export async function changePassword(ctx: Ctx, db: Pool): Promise<Reply> {
  const s = await currentSession(ctx, db);
  if (!s) return { status: 401, body: { error: NO_SESSION } };
  const { currentPassword, newPassword } = (ctx.body ?? {}) as Record<string, unknown>;
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword)
    return { status: 400, body: { error: 'La contraseña actual y la nueva son obligatorias.' } };

  // S-02: what needs no Argon2id is checked first (the client knows both passwords: nothing is revealed).
  if (currentPassword === newPassword)
    return { status: 400, body: { error: 'La nueva contraseña debe ser distinta a la actual.' } };
  const problem = passwordProblem(newPassword);
  if (problem) return { status: 400, body: { error: problem } };

  // C1: reserve the attempt BEFORE the (slow) verification, shared by every process, so parallel requests can't all
  // pass the check first. A correct current password gives the reservation back. If it can't be reserved, nothing runs.
  let reserved: boolean;
  try {
    reserved = await reservePasswordChange(ctx.limiterDb, s.user.id);
  } catch (e) {
    console.error('Límite de intentos no disponible:', (e as Error).message);
    return { status: 503, body: { error: CHANGE_UNAVAILABLE } };
  }
  if (!reserved) return { status: 429, body: { error: TOO_MANY } };
  // 400, not 401: a typo in the current password must not look like an expired session to the client.
  if (currentPassword.length > 200) return { status: 400, body: { error: WRONG_CURRENT } };
  // S-02: verification and new hash in ONE slot of the Argon2id gate (no release in between). None in time: 503 and
  // the C1 reservation is given back — nothing was checked.
  const turn = await ctx.argon2.run(async () =>
    (await verifyPassword(currentPassword, s.user.password_hash))
      ? hashPassword(newPassword)
      : null,
  );
  if (turn.busy) {
    await releasePasswordChange(ctx.limiterDb, s.user.id);
    return { status: 503, body: { error: BUSY } };
  }
  if (turn.value === null) return { status: 400, body: { error: WRONG_CURRENT } };
  await releasePasswordChange(ctx.limiterDb, s.user.id);
  const hash = turn.value;
  const outcome = await transaction(db, async (tx) => {
    // R1: lock order usuarios → sesiones (same as recovery). Re-check under the lock what was read before: the
    // session is still open and the password is still the one just verified (no concurrent change or reset).
    const [user]: { password_hash: string }[] = await tx.query(
      'SELECT password_hash FROM usuarios WHERE id = ? FOR UPDATE',
      [s.user.id],
    );
    const [session]: { cerrada_en: string | null }[] = await tx.query(
      'SELECT cerrada_en FROM sesiones WHERE id = ? FOR UPDATE',
      [s.sessionId],
    );
    if (!session || session.cerrada_en !== null) return 'session-closed';
    if (user?.password_hash !== s.user.password_hash) return 'password-changed';
    const now = localDateTime(); // after the locks: a request that waited stamps the time it actually applied
    await tx.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [hash, s.user.id]);
    await revokeDevices(tx, s.user.id); // whoever knew the old password may have trusted a browser
    await tx.query(
      'UPDATE sesiones SET cerrada_en = ? WHERE usuario_id = ? AND cerrada_en IS NULL AND id <> ?',
      [now, s.user.id, s.sessionId],
    );
    await tx.query('UPDATE sesiones SET ultimo_uso_en = ? WHERE id = ?', [now, s.sessionId]);
    await audit(
      tx,
      s.user.id,
      'EDITAR',
      'usuarios',
      s.user.id,
      'Cambio de contraseña',
      ctx.ip,
      'usuarios',
    );
    return 'changed';
  });
  if (outcome === 'session-closed') return { status: 401, body: { error: NO_SESSION } };
  // Not a guess (the password was right when read), so it doesn't count toward the limit.
  if (outcome === 'password-changed') return { status: 400, body: { error: WRONG_CURRENT } };
  await clearPasswordChange(ctx.limiterDb, s.user.id);
  const device = await issueDevice(ctx.limiterDb, s.user.id, s.user.email, null, ctx.secureCookie);
  return { status: 204, ...(device ? { cookie: device } : {}) };
}

/** POST /auth/password-reset/request { email } — always 204 (or 503 / 429), whatever the account (HU-001.2, D7). */
export async function requestPasswordReset(ctx: Ctx, db: Pool): Promise<Reply> {
  if (!ctx.mailer) return { status: 503, body: { error: UNAVAILABLE } };
  const { email } = (ctx.body ?? {}) as Record<string, unknown>;
  if (typeof email !== 'string' || !email.trim() || email.length > 150)
    return { status: 400, body: { error: 'El correo es obligatorio.' } };

  const normalized = email.trim().toLowerCase();
  try {
    const verdict = await reserveResetRequest(ctx.limiterDb, ctx.ip, normalized);
    if (verdict === 'refused') return { status: 429, body: { error: TOO_MANY } };
    if (verdict === 'quiet') return { status: 204 };
  } catch (e) {
    console.error('Límite de intentos no disponible:', (e as Error).message);
    return { status: 503, body: { error: UNAVAILABLE } };
  }

  // After the answer: nothing an account changes (a lookup, a transaction, the provider) can show in its timing, so the
  // answer says nothing about whether it exists (S-06). The limits above were already applied either way.
  const mailer = ctx.mailer;
  const work = issueRecovery(db, mailer, normalized)
    .catch(() => console.error('No se pudo emitir el token de recuperación.'))
    .finally(() => recoveries.delete(work));
  recoveries.add(work);
  return { status: 204 };
}

/** Recovery work still running after its answer, at most what the limits admitted. */
const recoveries = new Set<Promise<void>>();
/** Test seam: resolves when what was requested so far has been done. */
export const recoveriesSettled = () => Promise.all(recoveries);

async function issueRecovery(db: Pool, mailer: Mailer, normalized: string): Promise<void> {
  const [user]: { id: number; email: string }[] = await db.query(
    'SELECT id, email FROM usuarios WHERE email = ? AND activo',
    [normalized],
  );
  if (!user) return;
  const token = randomBytes(32).toString('base64url');
  const mailId = await transaction(db, async (tx) => {
    // R2: lock the account row first (order usuarios → tokens_recuperacion, as in confirm), so concurrent
    // requests for one account run one after the other instead of deadlocking on the token index gap.
    const [locked]: { id: number }[] = await tx.query(
      'SELECT id FROM usuarios WHERE id = ? AND activo FOR UPDATE',
      [user.id],
    );
    if (!locked) return null;
    const now = localDateTime();
    // D3b/D3d: revoke the earlier live recovery tokens, keeping the rows; invitations are another purpose (D3e).
    await tx.query(
      `UPDATE tokens_recuperacion SET usado_en = ?
        WHERE usuario_id = ? AND finalidad = 'RECUPERACION' AND usado_en IS NULL AND expira_en > ?`,
      [now, user.id, now],
    );
    await tx.query(
      `INSERT INTO tokens_recuperacion (usuario_id, finalidad, token_hash, creado_en, expira_en)
       VALUES (?, 'RECUPERACION', ?, ?, ?)`,
      [user.id, sha256(token), now, localDateTime(Date.now() + RESET_TOKEN_MINUTES * 60_000)],
    );
    return enqueueMail(tx, user.email, RESET_SUBJECT, sha256(token));
  });
  // deliverMail never throws; a failure stays in correo_saliente for the worker.
  if (mailId !== null)
    await deliverMail(
      db,
      mailer,
      mailId,
      user.email,
      RESET_SUBJECT,
      accessMailText('RECUPERACION', token),
    );
}

/** POST /auth/password-reset/confirm { token, newPassword } — HU-005.3: single use; closes every session (D8). */
export async function confirmPasswordReset(ctx: Ctx, db: Pool): Promise<Reply> {
  const { token, newPassword } = (ctx.body ?? {}) as Record<string, unknown>;
  if (typeof newPassword !== 'string')
    return { status: 400, body: { error: 'La nueva contraseña es obligatoria.' } };
  const problem = passwordProblem(newPassword);
  if (problem) return { status: 400, body: { error: problem } };
  if (typeof token !== 'string' || !token || token.length > 200)
    return { status: 400, body: { error: INVALID_LINK } };

  // Find the account outside the transaction: with MariaDB's snapshot isolation (innodb_snapshot_isolation, on by
  // default since 11.6) a plain read inside it would fix a snapshot, and the locking reads below would then fail
  // with «Record has changed since last read» if a concurrent confirmation committed first.
  // S-02: an unknown, used or expired token is refused HERE, before any Argon2id. This read only spares the work;
  // the transaction below checks the token again under its lock, so two confirmations can't both use it.
  const [ref]: { usuario_id: number; expira_en: string; usado_en: string | null }[] =
    await db.query(
      'SELECT usuario_id, expira_en, usado_en FROM tokens_recuperacion WHERE token_hash = ?',
      [sha256(token)],
    );
  if (!ref || ref.usado_en || ref.expira_en <= localDateTime())
    return { status: 400, body: { error: INVALID_LINK } };
  const turn = await ctx.argon2.run(() => hashPassword(newPassword));
  if (turn.busy) return { status: 503, body: { error: BUSY } }; // the token is untouched
  const hash = turn.value;
  const done = await transaction(db, async (tx) => {
    // Lock order usuarios → tokens_recuperacion → sesiones, the same as change and request (R1/R2); only locking
    // reads in here, and the token is re-checked under the lock.
    const [owner]: { id: number; email: string; activo: number }[] = await tx.query(
      'SELECT id, email, activo FROM usuarios WHERE id = ? FOR UPDATE',
      [ref.usuario_id],
    );
    const [row]: { id: number; usuario_id: number; expira_en: string; usado_en: string | null }[] =
      await tx.query(
        'SELECT id, usuario_id, expira_en, usado_en FROM tokens_recuperacion WHERE token_hash = ? FOR UPDATE',
        [sha256(token)],
      );
    const now = localDateTime();
    if (!row || row.usado_en || row.expira_en <= now || !owner?.activo) return false;
    await tx.query('UPDATE tokens_recuperacion SET usado_en = ? WHERE id = ?', [now, row.id]);
    await tx.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [hash, row.usuario_id]);
    await revokeDevices(tx, row.usuario_id);
    await tx.query(
      'UPDATE sesiones SET cerrada_en = ? WHERE usuario_id = ? AND cerrada_en IS NULL',
      [now, row.usuario_id],
    );
    await audit(
      tx,
      row.usuario_id,
      'EDITAR',
      'usuarios',
      row.usuario_id,
      'Restablecimiento de contraseña',
      ctx.ip,
      'usuarios',
    );
    return owner ?? false;
  });
  if (done === false) return { status: 400, body: { error: INVALID_LINK } };
  // The link proved the account: this browser is trusted from now on, so an attack can't keep this person out.
  const device = await issueDevice(ctx.limiterDb, done.id, done.email, null, ctx.secureCookie);
  return { status: 204, cookie: [clearCookie(ctx.secureCookie), ...(device ? [device] : [])] };
}

/**
 * Runs `work` in one transaction: commit on return, rollback on throw. `isolation` applies to this transaction only
 * (the login limiter uses READ COMMITTED: no gap locks on the counters it doesn't find).
 */
export async function transaction<T>(
  db: Pool,
  work: (tx: PoolConnection) => Promise<T>,
  isolation?: 'READ COMMITTED',
): Promise<T> {
  const tx = await db.getConnection();
  try {
    if (isolation) await tx.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`);
    await tx.beginTransaction();
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (e) {
    try {
      await tx.rollback();
    } catch (rollbackError) {
      // Keep the original error; only report that the rollback failed too (no query parameters: logParam false).
      console.error('Falló el rollback de la transacción:', (rollbackError as Error).message);
    }
    throw e;
  } finally {
    await tx.release().catch(() => undefined);
  }
}

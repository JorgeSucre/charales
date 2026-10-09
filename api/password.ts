/**
 * HU-005 (owner: Borrayo) — password change and recovery. Decisions D2–D8 of the M0 record (docs/API.md):
 * - change (authenticated) and recovery (token) are separate operations (D8);
 * - a change closes the user's OTHER sessions and keeps the current one (D2);
 * - recovery tokens: single use, 60 min, only their SHA-256 is stored; a new request revokes the account's earlier
 *   unused ones through `usado_en` (D3a, D3b, D3d). The API issues ONLY recovery tokens: `tokens_recuperacion` has
 *   no purpose column, so invitations stay out of the API until one is added (D3e);
 * - the request answers the same whether the account exists or not, with an attempt limit (D7);
 * - without a mail transport it answers 503 before reading anything (D4b); the console transport is dev-only (D4a).
 */
import { randomBytes } from 'node:crypto';
import type { Pool, PoolConnection } from 'mariadb';
import {
  MAX_FAILURES,
  NO_SESSION,
  audit,
  clearCookie,
  currentSession,
  hashPassword,
  localDateTime,
  recentFailures,
  sha256,
  verifyPassword,
} from './auth.ts';
import type { Ctx, Reply } from './server.ts';

export const RESET_TOKEN_MINUTES = 60;
/** Recovery requests per e-mail and IP in the attempt window (counted whether the account exists or not). */
const MAX_RESET_REQUESTS = 5;

const INVALID_LINK = 'El enlace no es válido o ya expiró.';
const WRONG_CURRENT = 'La contraseña actual no es correcta.';
const TOO_MANY = 'Demasiados intentos. Intenta de nuevo más tarde.';
const UNAVAILABLE = 'La recuperación de contraseña no está disponible.';

/** Sends one e-mail. Never receives a password; the recovery link (raw token) only goes through here. */
export type Mailer = (to: string, subject: string, text: string) => Promise<void> | void;

/**
 * Dev-only transport (D4a): prints the e-mail to the API console. Enabled only with MAIL_CONSOLE=true and never with
 * NODE_ENV=production; null otherwise, which makes recovery answer 503 (D4b). No real provider yet (D4c).
 */
export function mailerFromEnv(env: Record<string, string | undefined>): Mailer | null {
  if (env['NODE_ENV'] === 'production' || env['MAIL_CONSOLE'] !== 'true') return null;
  return (to, subject, text) =>
    console.info(`[correo de desarrollo] para ${to}: ${subject}\n${text}`);
}

/** HU-005.2 — same policy as the frontend (`core/auth/password.ts` → passwordProblem). */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (password.length > 200) return 'La contraseña es demasiado larga.';
  if (!/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password))
    return 'La contraseña debe incluir letras y números.';
  return null;
}

/** POST /auth/password { currentPassword, newPassword } — HU-005.1: requires the session and the current password. */
export async function changePassword(ctx: Ctx, db: Pool): Promise<Reply> {
  const s = await currentSession(ctx, db);
  if (!s) return { status: 401, body: { error: NO_SESSION } };
  const { currentPassword, newPassword } = (ctx.body ?? {}) as Record<string, unknown>;
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword)
    return { status: 400, body: { error: 'La contraseña actual y la nueva son obligatorias.' } };

  const key = `password|${s.user.id}`;
  if (recentFailures(key).length >= MAX_FAILURES) return { status: 429, body: { error: TOO_MANY } };
  // 400, not 401: a typo in the current password must not look like an expired session to the client.
  if (
    currentPassword.length > 200 ||
    !(await verifyPassword(currentPassword, s.user.password_hash))
  ) {
    recentFailures(key).push(Date.now());
    return { status: 400, body: { error: WRONG_CURRENT } };
  }
  if (currentPassword === newPassword)
    return { status: 400, body: { error: 'La nueva contraseña debe ser distinta a la actual.' } };
  const problem = passwordProblem(newPassword);
  if (problem) return { status: 400, body: { error: problem } };

  const hash = await hashPassword(newPassword);
  const now = localDateTime();
  await transaction(db, async (tx) => {
    await tx.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [hash, s.user.id]);
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
  });
  recentFailures(key).length = 0;
  return { status: 204 };
}

/** POST /auth/password-reset/request { email } — always 204 (or 503 / 429), whatever the account (HU-001.2, D7). */
export async function requestPasswordReset(ctx: Ctx, db: Pool): Promise<Reply> {
  if (!ctx.mailer) return { status: 503, body: { error: UNAVAILABLE } };
  const { email } = (ctx.body ?? {}) as Record<string, unknown>;
  if (typeof email !== 'string' || !email.trim() || email.length > 150)
    return { status: 400, body: { error: 'El correo es obligatorio.' } };

  const normalized = email.trim().toLowerCase();
  const attempts = recentFailures(`reset|${ctx.ip}|${normalized}`);
  if (attempts.length >= MAX_RESET_REQUESTS) return { status: 429, body: { error: TOO_MANY } };
  attempts.push(Date.now());

  const [user]: { id: number; email: string }[] = await db.query(
    'SELECT id, email FROM usuarios WHERE email = ? AND activo',
    [normalized],
  );
  if (user) {
    const token = randomBytes(32).toString('base64url');
    const now = localDateTime();
    await transaction(db, async (tx) => {
      // D3b/D3d: revoke the earlier live tokens (all recovery tokens in M1, D3e), keeping the rows.
      await tx.query(
        `UPDATE tokens_recuperacion SET usado_en = ?
          WHERE usuario_id = ? AND usado_en IS NULL AND expira_en > ?`,
        [now, user.id, now],
      );
      await tx.query(
        'INSERT INTO tokens_recuperacion (usuario_id, token_hash, creado_en, expira_en) VALUES (?, ?, ?, ?)',
        [user.id, sha256(token), now, localDateTime(Date.now() + RESET_TOKEN_MINUTES * 60_000)],
      );
    });
    try {
      await ctx.mailer(
        user.email,
        'Recupera tu contraseña',
        `Abre este enlace para definir tu contraseña (válido ${RESET_TOKEN_MINUTES} min): /reset-password?token=${token}`,
      );
    } catch {
      // Same answer either way: a delivery failure must not reveal that the account exists.
      console.error('No se pudo enviar el correo de recuperación.');
    }
  }
  return { status: 204 };
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

  const hash = await hashPassword(newPassword);
  const now = localDateTime();
  const done = await transaction(db, async (tx) => {
    const [row]: { id: number; usuario_id: number; expira_en: string; usado_en: string | null }[] =
      await tx.query(
        'SELECT id, usuario_id, expira_en, usado_en FROM tokens_recuperacion WHERE token_hash = ? FOR UPDATE',
        [sha256(token)],
      );
    if (!row || row.usado_en || row.expira_en <= now) return false;
    await tx.query('UPDATE tokens_recuperacion SET usado_en = ? WHERE id = ?', [now, row.id]);
    await tx.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [hash, row.usuario_id]);
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
    return true;
  });
  return done
    ? { status: 204, cookie: clearCookie(ctx.secureCookie) }
    : { status: 400, body: { error: INVALID_LINK } };
}

/** Runs `work` in one transaction: commit on return, rollback on throw. */
async function transaction<T>(db: Pool, work: (tx: PoolConnection) => Promise<T>): Promise<T> {
  const tx = await db.getConnection();
  try {
    await tx.beginTransaction();
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (e) {
    await tx.rollback();
    throw e;
  } finally {
    await tx.release();
  }
}

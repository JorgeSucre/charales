/**
 * Trusted browsers (the legitimate owner under a distributed attack). A browser that logged into an account keeps a random
 * secret in an HttpOnly cookie; MariaDB keeps only its SHA-256, bound to that account. Presenting it spares the login the
 * attempt limits, so an attacker can't lock the owner out from wherever the owner already logs in, on any network.
 *
 * It is not a shortcut to an account:
 * - the password is always verified; the secret only says «this attempt doesn't spend the shared limits»;
 * - every attempt reserves one of DEVICE_MAX_FAILURES on the row, atomically, before Argon2id. A success rotates the secret
 *   and starts over; 5 wrong passwords in a row and it trusts nothing. A stolen cookie is worth at most 5 guesses;
 * - bound to one account, so it is worth nothing for another;
 * - 90 days, renewed only by a successful login, which also replaces the secret (an older copy stops working);
 * - a password change or recovery revokes them all (the transaction of those endpoints), at most 10 per user.
 * Cookie: `Path=/auth`, HttpOnly, SameSite=Strict, Secure in production; one per account, for shared computers. Its name
 * comes from the e-mail as typed (lowercase, trimmed): a variant of the e-mail just finds no cookie and takes the normal path.
 */
import { randomBytes } from 'node:crypto';
import type { Pool, PoolConnection } from 'mariadb';
import { localDateTime, sha256 } from './auth.ts';

export const DEVICE_COOKIE_PREFIX = 'charales_disp_';
export const DEVICE_DAYS = 90;
export const DEVICE_MAX_FAILURES = 5;
const DEVICE_MAX_PER_USER = 10;

const accountHash = (email: string) => sha256(`CUENTA|${email.trim().toLowerCase()}`);
export const deviceCookieName = (email: string) =>
  `${DEVICE_COOKIE_PREFIX}${accountHash(email).slice(0, 16)}`;
const wellFormed = (secret: string) => /^[\w-]{43}$/.test(secret);

/** Takes one attempt on the row; true if this browser is trusted for this account right now. Atomic: one statement. */
export async function reserveDevice(db: Pool, secret: string, email: string): Promise<boolean> {
  if (!wellFormed(secret)) return false;
  const { affectedRows } = await db.query(
    `UPDATE dispositivo_confiable SET fallos = fallos + 1
      WHERE clave = ? AND cuenta = ? AND fallos < ? AND vence_en > ?`,
    [sha256(secret), accountHash(email), DEVICE_MAX_FAILURES, localDateTime()],
  );
  return affectedRows === 1;
}

/** Gives back an attempt that verified nothing or wasn't a guess (503, disabled account). */
export async function releaseDevice(db: Pool, secret: string): Promise<void> {
  await db.query(
    'UPDATE dispositivo_confiable SET fallos = GREATEST(CAST(fallos AS SIGNED) - 1, 0) WHERE clave = ?',
    [sha256(secret)],
  );
}

/**
 * After a success: a new secret for this browser, replacing the one it presented. Returns its cookie, or null if it couldn't
 * be stored: the login still succeeds, the browser just isn't trusted next time.
 */
export async function issueDevice(
  db: Pool,
  userId: number,
  email: string,
  previous: string | null,
  secure: boolean,
): Promise<string | null> {
  try {
    if (previous && wellFormed(previous))
      await db.query('DELETE FROM dispositivo_confiable WHERE clave = ? AND usuario_id = ?', [
        sha256(previous),
        userId,
      ]);
    const secret = randomBytes(32).toString('base64url');
    const now = Date.now();
    await db.query(
      `INSERT INTO dispositivo_confiable (clave, cuenta, usuario_id, fallos, creado_en, vence_en)
       VALUES (?, ?, ?, 0, ?, ?)`,
      [
        sha256(secret),
        accountHash(email),
        userId,
        localDateTime(now),
        localDateTime(now + DEVICE_DAYS * 86_400_000),
      ],
    );
    const old: { clave: string }[] = await db.query(
      `SELECT clave FROM dispositivo_confiable WHERE usuario_id = ?
        ORDER BY creado_en DESC, clave LIMIT 100 OFFSET ${DEVICE_MAX_PER_USER}`,
      [userId],
    );
    if (old.length)
      await db.query('DELETE FROM dispositivo_confiable WHERE clave IN (?)', [
        old.map((r) => r.clave),
      ]);
    const attributes = `HttpOnly; SameSite=Strict; Path=/auth; Max-Age=${DEVICE_DAYS * 86_400}`;
    return `${deviceCookieName(email)}=${secret}; ${attributes}${secure ? '; Secure' : ''}`;
  } catch (e) {
    console.error('No se pudo registrar el navegador:', (e as Error).message);
    return null;
  }
}

/** Every browser of the account stops being trusted. In the transaction of a password change or recovery. */
export function revokeDevices(tx: Pool | PoolConnection, userId: number) {
  return tx.query('DELETE FROM dispositivo_confiable WHERE usuario_id = ?', [userId]);
}

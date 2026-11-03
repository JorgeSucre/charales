/**
 * Login attempt limits (S-01), shared through MariaDB (migration 005, `limite_acceso`), so they survive a restart and
 * hold across several API instances. An attempt is RESERVED before the password is verified, in one transaction
 * that locks the counters (FOR UPDATE): N simultaneous requests can never all pass the check while the first ones are
 * still running Argon2id. A correct password gives the reservation back (see `settleLogin`).
 *
 * Three counters per attempt, each a fixed 15-minute window started by its first attempt:
 * - CUENTA_IP (e-mail + client IP): 5 — the policy the login always had (one person mistyping on one device);
 * - CUENTA (e-mail, any IP): 20 — so rotating IPs can't multiply the guesses against one account. Higher than 5 so
 *   that locking somebody else out needs 20 attempts from at least 4 addresses, and it lasts one window, never longer;
 * - IP (client IP, any e-mail): 50 — caps the Argon2id work one address can trigger by trying many e-mails, with room
 *   for a school office behind one NAT.
 * No progressive back-off: on CUENTA it would turn the attacker's guesses into a longer lockout of the real user.
 * Unknown e-mails are counted exactly like existing ones (no enumeration). Keys are SHA-256 hashes, never the e-mail
 * or the IP; expired rows are purged on each attempt.
 */
import type { Pool } from 'mariadb';
import { localDateTime, sha256 } from './auth.ts';
import { transaction } from './password.ts';

export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_LIMITS = { CUENTA_IP: 5, CUENTA: 20, IP: 50 } as const;
type Scope = keyof typeof LOGIN_LIMITS;

/** The counters one attempt reserved; `settleLogin` gives them back when the password was right. */
export interface Reservation {
  keys: { key: string; scope: Scope }[];
}

const RETRYABLE = new Set([1213, 1205, 1020]); // deadlock, lock wait timeout, «Record has changed since last read»

export function loginKeys(ip: string, email: string): Reservation['keys'] {
  const account = email.trim().toLowerCase();
  return (
    [
      { key: sha256(`CUENTA_IP|${ip}|${account}`), scope: 'CUENTA_IP' },
      { key: sha256(`CUENTA|${account}`), scope: 'CUENTA' },
      { key: sha256(`IP|${ip}`), scope: 'IP' },
    ] as const
  )
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key)); // one lock order for every request: no deadlock between two logins
}

/**
 * Reserves one attempt on every counter, or none if any is at its limit (→ null: answer 429 without verifying).
 * Throws if MariaDB fails: the caller must refuse the login (503), never verify without a reservation.
 */
export async function reserveLogin(
  db: Pool,
  ip: string,
  email: string,
): Promise<Reservation | null> {
  const keys = loginKeys(ip, email);
  const now = Date.now();
  const expired = localDateTime(now - LOGIN_WINDOW_MS);
  // Housekeeping only: if it fails the reservation below still decides (and fails closed if MariaDB is down).
  await db
    .query('DELETE FROM limite_acceso WHERE ventana_inicio <= ? LIMIT 100', [expired])
    .catch((e: Error) => console.error('No se pudieron purgar los intentos vencidos:', e.message));
  for (let attempt = 1; ; attempt++) {
    try {
      return await transaction(db, async (tx) => {
        const start = localDateTime(now);
        await tx.query(
          `INSERT INTO limite_acceso (clave, ambito, intentos, ventana_inicio) VALUES ${keys.map(() => '(?, ?, 0, ?)').join(', ')}
           ON DUPLICATE KEY UPDATE clave = clave`,
          keys.flatMap((k) => [k.key, k.scope, start]),
        );
        const rows: { clave: string; intentos: number; ventana_inicio: string }[] = await tx.query(
          'SELECT clave, intentos, ventana_inicio FROM limite_acceso WHERE clave IN (?) ORDER BY clave FOR UPDATE',
          [keys.map((k) => k.key)],
        );
        const current = keys.map((k) => {
          const row = rows.find((r) => r.clave === k.key)!;
          const fresh = row.ventana_inicio <= expired; // the window ended: this attempt opens a new one
          return { ...k, used: fresh ? 0 : row.intentos, fresh };
        });
        if (current.some((c) => c.used >= LOGIN_LIMITS[c.scope])) return null;
        for (const c of current)
          await tx.query(
            'UPDATE limite_acceso SET intentos = ?, ventana_inicio = IF(?, ?, ventana_inicio) WHERE clave = ?',
            [c.used + 1, c.fresh, start, c.key],
          );
        return { keys };
      });
    } catch (e) {
      if (RETRYABLE.has((e as { errno?: number }).errno ?? 0) && attempt < 5) continue;
      throw e;
    }
  }
}

/**
 * After the password check. `failed`: the reservation stays (it was a guess). A right password gives it back: a login
 * that succeeds also clears the e-mail's counters (the owner is in; CUENTA_IP did that before S-01 too), while the IP
 * only gets its one attempt back, so logging into one's own account can't reset an address that is guessing others.
 * A right password on a disabled account is not a guess either: everything gets its attempt back, nothing is cleared.
 * A failure here only leaves the counters one higher (the safe side), so it is logged and the login goes on.
 */
export async function settleLogin(
  db: Pool,
  reservation: Reservation,
  outcome: 'failed' | 'success' | 'right-password',
): Promise<void> {
  if (outcome === 'failed') return;
  try {
    await transaction(db, async (tx) => {
      for (const { key, scope } of reservation.keys)
        await tx.query(
          outcome === 'success' && scope !== 'IP'
            ? 'UPDATE limite_acceso SET intentos = 0 WHERE clave = ?'
            : 'UPDATE limite_acceso SET intentos = GREATEST(CAST(intentos AS SIGNED) - 1, 0) WHERE clave = ?',
          [key],
        );
    });
  } catch (e) {
    console.error('No se pudo devolver la reserva del límite de intentos:', (e as Error).message);
  }
}

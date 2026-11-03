/**
 * Login attempt limits (S-01), shared through MariaDB (migration 005, `limite_acceso`), so they survive a restart and
 * hold across several API instances. An attempt is RESERVED before the password is verified, in one transaction
 * that locks the counters (FOR UPDATE): N simultaneous requests can never all pass the check while the first ones are
 * still running Argon2id. A correct password gives the reservation back (see `settleLogin`).
 *
 * Two counters per attempt, each a fixed 15-minute window started by its first attempt:
 * - CUENTA_IP (account + client IP): 5 — one person mistyping on one device, and the brake on guessing one account
 *   from one address;
 * - IP (client IP, any account): 50 — caps the Argon2id work one address can trigger, with room for a school office
 *   behind one NAT.
 * There is deliberately NO counter per account alone (audit H-2): it let anyone who knows an e-mail lock its owner out
 * from a few addresses, for as long as they kept trying. A distributed guess is limited by the addresses it uses
 * (5 per account and 50 in total per address and window); see docs/API.md for the residual risk.
 *
 * The account is identified the way MariaDB compares `usuarios.email` (utf8mb4_unicode_ci), not by JavaScript:
 * accents, full-width letters, zero-width characters and trailing spaces that find the same account share its counter
 * (audit H-1). Unknown e-mails are counted exactly like existing ones (no enumeration).
 *
 * A refused attempt writes nothing (audit M-1): the counters are read with FOR UPDATE and written only when the attempt
 * fits, and a refusal is also remembered by this process for a few seconds so a flood doesn't reach MariaDB. The
 * limiter can run on its own small pool (`createApp` option `limiterDb`), so a flood can't take the connections of the
 * rest of the API. Keys are SHA-256 hashes, never the e-mail or the IP; expired rows are purged after an admitted
 * attempt.
 */
import type { Pool } from 'mariadb';
import { localDateTime, sha256 } from './auth.ts';
import { transaction } from './password.ts';

export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_LIMITS = { CUENTA_IP: 5, IP: 50 } as const;
type Scope = keyof typeof LOGIN_LIMITS;
/** Collation of `usuarios.email`; api/login-limit.test.ts fails if the schema changes it. */
export const EMAIL_COLLATION = 'utf8mb4_unicode_ci';
/** How long a refusal is answered from memory before MariaDB is asked again. Only ever refuses, never admits. */
const REFUSAL_CACHE_MS = 10_000;
const REFUSAL_CACHE_MAX = 10_000;

/** The counters one attempt reserved, IP first (the lock order); `settleLogin` gives them back if the password was right. */
export interface Reservation {
  keys: { key: string; scope: Scope }[];
}

// deadlock, lock wait timeout, «Record has changed since last read», duplicate key (two first attempts at once)
const RETRYABLE = new Set([1213, 1205, 1020, 1062]);

/**
 * The account as MariaDB compares it: the collation weight of the trimmed e-mail (the string the login looks up), minus
 * trailing space weights, because a PAD SPACE collation ignores trailing spaces when comparing but WEIGHT_STRING keeps
 * them. Two e-mails that `usuarios.email = ?` treats as equal get the same identity, and only those.
 */
export async function accountIdentity(db: Pool, email: string): Promise<string> {
  const [row]: { w: string }[] = await db.query(
    `SELECT HEX(WEIGHT_STRING(CONVERT(? USING utf8mb4) COLLATE ${EMAIL_COLLATION})) AS w`,
    [email.trim()],
  );
  let w = row!.w;
  const SPACE = '0209'; // weight of U+0020 in utf8mb4_unicode_ci; weights are 2-byte units
  while (w.length >= 4 && w.endsWith(SPACE) && w.length % 4 === 0) w = w.slice(0, -4);
  return w;
}

export async function loginKeys(db: Pool, ip: string, email: string): Promise<Reservation['keys']> {
  return [
    { key: sha256(`IP|${ip}`), scope: 'IP' },
    { key: sha256(`CUENTA_IP|${ip}|${await accountIdentity(db, email)}`), scope: 'CUENTA_IP' },
  ];
}

/** Keys known to be at their limit, until when (this process only; a stale entry can only refuse, for seconds). */
const refused = new Map<string, number>();
function refusedNow(key: string): boolean {
  const until = refused.get(key);
  if (until === undefined) return false;
  if (until > Date.now()) return true;
  refused.delete(key);
  return false;
}
function remember(key: string): void {
  if (refused.size >= REFUSAL_CACHE_MAX) refused.delete(refused.keys().next().value!);
  refused.set(key, Date.now() + REFUSAL_CACHE_MS);
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
  const ipKey = sha256(`IP|${ip}`);
  if (refusedNow(ipKey)) return null; // an address at its limit doesn't even reach MariaDB
  const keys = await loginKeys(db, ip, email);
  if (keys.some((k) => refusedNow(k.key))) return null;
  for (let attempt = 1; ; attempt++) {
    const now = Date.now(); // per attempt: a retry after a lock wait judges the window at its own time
    const expired = localDateTime(now - LOGIN_WINDOW_MS);
    const start = localDateTime(now);
    try {
      const outcome = await transaction(
        db,
        async (tx) => {
          // Lock the counters that exist, IP first: every request of one address takes that row first, so they queue
          // there and never deadlock. READ COMMITTED: a missing row takes no gap lock (two first attempts at once
          // collide on the INSERT below instead, 1062, and the loser retries with the row in place).
          const current: { key: string; scope: Scope; used: number; exists: boolean }[] = [];
          for (const k of keys) {
            const [row]: { intentos: number; ventana_inicio: string }[] = await tx.query(
              'SELECT intentos, ventana_inicio FROM limite_acceso WHERE clave = ? FOR UPDATE',
              [k.key],
            );
            const used = row && row.ventana_inicio > expired ? row.intentos : 0;
            if (used >= LOGIN_LIMITS[k.scope]) return { refusedBy: k.key }; // nothing written
            current.push({ ...k, used, exists: !!row });
          }
          for (const c of current)
            if (c.exists)
              await tx.query(
                'UPDATE limite_acceso SET intentos = ?, ventana_inicio = IF(?, ventana_inicio, ?) WHERE clave = ?',
                [c.used + 1, c.used > 0, start, c.key],
              );
            else
              await tx.query(
                'INSERT INTO limite_acceso (clave, ambito, intentos, ventana_inicio) VALUES (?, ?, 1, ?)',
                [c.key, c.scope, start],
              );
          return { refusedBy: null };
        },
        'READ COMMITTED',
      );
      if (outcome.refusedBy) {
        remember(outcome.refusedBy);
        return null;
      }
      // Housekeeping after an admitted attempt only (a refusal writes nothing): if it fails, nothing is at stake.
      await transaction(
        db,
        (tx) =>
          tx.query('DELETE FROM limite_acceso WHERE ventana_inicio <= ? LIMIT 100', [expired]),
        'READ COMMITTED',
      ).catch((e: Error) =>
        console.error('No se pudieron purgar los intentos vencidos:', e.message),
      );
      return { keys };
    } catch (e) {
      if (RETRYABLE.has((e as { errno?: number }).errno ?? 0) && attempt < 5) continue;
      throw e;
    }
  }
}

/**
 * After the password check. `failed`: the reservation stays (it was a guess). A right password gives it back: a login
 * that succeeds also clears the account's counter for that address (the owner is in), while the address only gets its
 * one attempt back, so logging into one's own account can't reset an address that is guessing others. A right password
 * on a disabled account is not a guess either: both get their attempt back, nothing is cleared.
 * `not-verified` (S-02: no Argon2id turn, the password was never checked) gives the attempt back the same way.
 * A failure here only leaves the counters one higher (the safe side), so it is logged and the login goes on.
 */
export async function settleLogin(
  db: Pool,
  reservation: Reservation,
  outcome: 'failed' | 'success' | 'right-password' | 'not-verified',
): Promise<void> {
  if (outcome === 'failed') return;
  try {
    await transaction(db, async (tx) => {
      for (const { key, scope } of reservation.keys)
        await tx.query(
          outcome === 'success' && scope === 'CUENTA_IP'
            ? 'UPDATE limite_acceso SET intentos = 0 WHERE clave = ?'
            : 'UPDATE limite_acceso SET intentos = GREATEST(CAST(intentos AS SIGNED) - 1, 0) WHERE clave = ?',
          [key],
        );
    });
  } catch (e) {
    console.error('No se pudo devolver la reserva del límite de intentos:', (e as Error).message);
  }
}

/** Test seam: forget the refusals remembered by this process. */
export function forgetRefusals(): void {
  refused.clear();
}

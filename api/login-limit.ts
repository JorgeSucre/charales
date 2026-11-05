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
/**
 * Attempt limits shared through MariaDB (S-01, migrations 005 and 007, `limite_acceso`), so they survive a restart and
 * hold across several API instances. An attempt is RESERVED before the slow or sensitive work, in one transaction that
 * locks the counters (FOR UPDATE): N simultaneous requests can never all pass the check. A correct password gives the
 * reservation back (see `settleLogin`).
 *
 * The login has three counters, each a fixed 15-minute window started by its first attempt. "Network" is an IPv4 address
 * or the /64 of an IPv6 one (api/client-ip.ts): one customer usually holds a whole /64, so counting addresses would be no
 * limit at all (R-1).
 * - CUENTA_IP (account + network): 5 — one person mistyping on one device, and the brake on guessing from one network;
 * - IP (network, any account): 50 — caps the Argon2id work one network can trigger, with room for an office behind NAT;
 * - CUENTA (account, every network): 20 — the brake on guessing one account from many networks (R-1). It only applies to
 *   networks the account has not logged in from: a network with a recent success never counts on it and is never
 *   refused by it. So an attacker can't lock the owner out from where they usually log in (audit H-2), which is what
 *   a plain counter per account allowed. The price: during an attack the owner on a NEW network gets 429 until the
 *   window ends or they recover the password by e-mail, which proves the account and marks that network as known.
 *
 * The account is identified the way MariaDB compares `usuarios.email` (utf8mb4_unicode_ci), not by JavaScript:
 * accents, full-width letters, zero-width characters and trailing spaces that find the same account share its counters
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
import { limitBucket } from './client-ip.ts';
import { transaction } from './password.ts';

export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_LIMITS = { CUENTA_IP: 5, IP: 50, CUENTA: 20 } as const;
/** Password recovery requests per window: a network, and an account from every network (e-mail bombing, F5-07). */
export const RESET_LIMITS = { RECUP_IP: 20, RECUP_CUENTA: 5 } as const;
/** Wrong current passwords per account and window (HU-005). */
export const CHANGE_LIMIT = 5;
/** A network stops being «known» for an account after this long without a successful login from it. */
const ORIGIN_TTL_MS = 90 * 24 * 3_600_000;
type Scope = keyof typeof LOGIN_LIMITS | keyof typeof RESET_LIMITS | 'CAMBIO';
/** Collation of `usuarios.email`; api/login-limit.test.ts fails if the schema changes it. */
export const EMAIL_COLLATION = 'utf8mb4_unicode_ci';
/** How long a refusal is answered from memory before MariaDB is asked again. Only ever refuses, never admits. */
const REFUSAL_CACHE_MS = 10_000;
const REFUSAL_CACHE_MAX = 10_000;

/** The counters one attempt reserved, in lock order; `settleLogin` gives them back if the password was right. */
export interface Reservation {
  keys: { key: string; scope: Scope }[];
  /** This account from this network: recorded by a successful login. */
  origin: string;
}
/**
 * One counter of a reservation. `guarded`: every request that can touch this row already holds a lock taken earlier in
 * the same order (the account+network row, under its network's row), so a missing row can't be raced.
 */
interface Counter {
  key: string;
  scope: Scope;
  limit: number;
  guarded?: boolean;
}

// Transient MariaDB errors of the reservation: deadlock, lock wait timeout, «Record has changed since last read».
const TRANSIENT = new Set([1213, 1205, 1020]);
/** Retries: at most 6 attempts within 1.5 s, waiting a random 0..10·2^n ms (at most 200 ms) between them. */
const MAX_ATTEMPTS = 6;
const RETRY_BUDGET_MS = 1500;
const BACKOFF_BASE_MS = 10;
const BACKOFF_CAP_MS = 200;
/** Another request inserted a missing row first (1062 on THAT insert): retry with the row in place. */
class RowRace extends Error {}
/** A counter at its limit: thrown inside the transaction so it rolls back (nothing of a refusal is committed). */
class AtLimit extends Error {
  readonly key: string;
  constructor(key: string) {
    super('Límite de intentos alcanzado.');
    this.key = key;
  }
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

const originKey = (bucket: string, identity: string) => sha256(`ORIGEN|${bucket}|${identity}`);

/** The keys of an attempt: network, account+network, account. (The lock order is in `reserveLogin`.) */
export async function loginKeys(db: Pool, ip: string, email: string): Promise<Reservation['keys']> {
  const bucket = limitBucket(ip);
  const identity = await accountIdentity(db, email);
  return [
    { key: sha256(`IP|${bucket}`), scope: 'IP' },
    { key: sha256(`CUENTA_IP|${bucket}|${identity}`), scope: 'CUENTA_IP' },
    { key: sha256(`CUENTA|${identity}`), scope: 'CUENTA' },
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
  const bucket = limitBucket(ip);
  const ipKey = sha256(`IP|${bucket}`);
  if (refusedNow(ipKey)) return null; // a network at its limit doesn't even reach MariaDB
  const identity = await accountIdentity(db, email);
  const accountKey = sha256(`CUENTA|${identity}`);
  const pairKey = sha256(`CUENTA_IP|${bucket}|${identity}`);
  if (refusedNow(pairKey)) return null;
  const origin = originKey(bucket, identity);
  const known = await isKnownOrigin(db, origin);
  if (!known && refusedNow(accountKey)) return null;
  // ONE lock order for every request: network, then account, then account+network (the inversion that deadlocked:
  // docs/API.md, S-01). Every request of one network queues on its row; every request of one account on the next.
  const counters: Counter[] = [
    { key: ipKey, scope: 'IP', limit: LOGIN_LIMITS.IP },
    ...(known ? [] : [{ key: accountKey, scope: 'CUENTA' as const, limit: LOGIN_LIMITS.CUENTA }]),
    { key: pairKey, scope: 'CUENTA_IP', limit: LOGIN_LIMITS.CUENTA_IP, guarded: true },
  ];
  const refusedBy = await reserveCounters(db, counters);
  if (refusedBy) {
    if (refusedBy === accountKey)
      console.warn(
        `Límite por cuenta alcanzado (ataque distribuido posible): ${accountKey.slice(0, 12)}`,
      );
    remember(refusedBy);
    return null;
  }
  return { keys: counters.map(({ key, scope }) => ({ key, scope })), origin };
}

async function isKnownOrigin(db: Pool, origin: string): Promise<boolean> {
  const rows: unknown[] = await db.query(
    'SELECT 1 FROM origen_conocido WHERE clave = ? AND visto_en > ?',
    [origin, localDateTime(Date.now() - ORIGIN_TTL_MS)],
  );
  return rows.length > 0;
}

async function rememberOrigin(db: Pool, origin: string): Promise<void> {
  const now = localDateTime();
  await db.query(
    'INSERT INTO origen_conocido (clave, visto_en) VALUES (?, ?) ON DUPLICATE KEY UPDATE visto_en = ?',
    [origin, now, now],
  );
}

/** Whoever completed a recovery proved the account: their network is known from now on, so an attack can't stop them. */
export async function markOriginKnown(db: Pool, ip: string, email: string): Promise<void> {
  try {
    await rememberOrigin(db, originKey(limitBucket(ip), await accountIdentity(db, email)));
  } catch (e) {
    console.error('No se pudo registrar el origen:', (e as Error).message);
  }
}

/**
 * The reservation itself: one attempt on every counter, in the given order, or nothing. Returns null when reserved, or
 * the key of the counter at its limit. Throws if MariaDB fails.
 */
async function reserveCounters(db: Pool, counters: readonly Counter[]): Promise<string | null> {
  // performance.now(): a real clock even where tests mock Date.
  const deadline = performance.now() + RETRY_BUDGET_MS;
  for (let attempt = 1; ; attempt++) {
    const now = Date.now(); // per attempt: a retry judges the window at its own time
    const expired = localDateTime(now - LOGIN_WINDOW_MS);
    const start = localDateTime(now);
    try {
      await transaction(
        db,
        async (tx) => {
          // Each row is locked — or, if it doesn't exist yet, inserted (with 0 attempts) — before the next is even
          // read, so no request can hold a later row while waiting for an earlier one. READ COMMITTED: a missing row
          // takes no gap lock; two requests that both miss a row collide on its INSERT (1062), and the loser retries
          // with the row in place.
          const read = async (key: string) =>
            (
              (await tx.query(
                'SELECT intentos, ventana_inicio FROM limite_acceso WHERE clave = ? FOR UPDATE',
                [key],
              )) as { intentos: number; ventana_inicio: string }[]
            )[0];
          const used = (row?: { intentos: number; ventana_inicio: string }) =>
            row && row.ventana_inicio > expired ? Number(row.intentos) : 0;
          const rows: ({ intentos: number; ventana_inicio: string } | undefined)[] = [];
          for (const c of counters) {
            let row = await read(c.key);
            if (!row && !c.guarded) {
              try {
                await tx.query(
                  'INSERT INTO limite_acceso (clave, ambito, intentos, ventana_inicio) VALUES (?, ?, 0, ?)',
                  [c.key, c.scope, start],
                );
              } catch (e) {
                if ((e as { errno?: number }).errno === 1062) throw new RowRace();
                throw e;
              }
              row = { intentos: 0, ventana_inicio: start };
            }
            rows.push(row);
          }
          // At a limit: roll back, so not even a row this request had to insert stays (M-1).
          counters.forEach((c, i) => {
            if (used(rows[i]) >= c.limit) throw new AtLimit(c.key);
          });
          const bump =
            'UPDATE limite_acceso SET intentos = ?, ventana_inicio = IF(?, ventana_inicio, ?) WHERE clave = ?';
          for (const [i, c] of counters.entries()) {
            const n = used(rows[i]);
            if (rows[i]) await tx.query(bump, [n + 1, n > 0, start, c.key]);
            else
              await tx.query(
                'INSERT INTO limite_acceso (clave, ambito, intentos, ventana_inicio) VALUES (?, ?, 1, ?)',
                [c.key, c.scope, start],
              );
          }
        },
        'READ COMMITTED',
      );
    } catch (e) {
      if (e instanceof AtLimit) return e.key;
      const transient = e instanceof RowRace || TRANSIENT.has((e as { errno?: number }).errno ?? 0);
      // full jitter: a random wait up to 10·2^(attempt-1) ms, capped, so racing requests don't retry in lockstep
      const delay = Math.random() * Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
      if (transient && attempt < MAX_ATTEMPTS && performance.now() + delay < deadline) {
        await sleep(delay);
        continue;
      }
      throw e instanceof RowRace ? new Error('Reserva de intentos: una fila sigue en disputa.') : e;
    }
    // Housekeeping after an admitted attempt only (a refusal writes nothing). SKIP LOCKED: the purge never waits for
    // a row another request holds, so it can't take part in a deadlock. If it fails, nothing is at stake.
    await transaction(
      db,
      async (tx) => {
        const rows: { clave: string }[] = await tx.query(
          'SELECT clave FROM limite_acceso WHERE ventana_inicio <= ? LIMIT 100 FOR UPDATE SKIP LOCKED',
          [expired],
        );
        if (rows.length)
          await tx.query('DELETE FROM limite_acceso WHERE clave IN (?)', [
            rows.map((r) => r.clave),
          ]);
        const origins: { clave: string }[] = await tx.query(
          'SELECT clave FROM origen_conocido WHERE visto_en <= ? LIMIT 100 FOR UPDATE SKIP LOCKED',
          [localDateTime(now - ORIGIN_TTL_MS)],
        );
        if (origins.length)
          await tx.query('DELETE FROM origen_conocido WHERE clave IN (?)', [
            origins.map((r) => r.clave),
          ]);
      },
      'READ COMMITTED',
    ).catch((e: Error) => console.error('No se pudieron purgar los intentos vencidos:', e.message));
    return null;
  }
}

/**
 * One password recovery request of `email` from `ip`, or false when a limit refuses it (→ 429). Counted whether the
 * account exists or not, so the answer reveals nothing. Nothing accumulates in memory or in the table per refusal.
 */
export async function reserveResetRequest(db: Pool, ip: string, email: string): Promise<boolean> {
  const ipKey = sha256(`RECUP_IP|${limitBucket(ip)}`);
  if (refusedNow(ipKey)) return false;
  const accountKey = sha256(`RECUP_CUENTA|${await accountIdentity(db, email)}`);
  if (refusedNow(accountKey)) return false;
  const refusedBy = await reserveCounters(db, [
    { key: ipKey, scope: 'RECUP_IP', limit: RESET_LIMITS.RECUP_IP },
    { key: accountKey, scope: 'RECUP_CUENTA', limit: RESET_LIMITS.RECUP_CUENTA },
  ]);
  if (refusedBy) remember(refusedBy);
  return !refusedBy;
}

const changeKey = (userId: number) => sha256(`CAMBIO|${userId}`);

/** One attempt at changing the password of `userId` (C1), or false at the limit: shared by every API process. */
export async function reservePasswordChange(db: Pool, userId: number): Promise<boolean> {
  const key = changeKey(userId);
  return !(await reserveCounters(db, [{ key, scope: 'CAMBIO', limit: CHANGE_LIMIT }]));
}

/** Gives one reserved attempt back (the password was right, or nothing was checked). */
export async function releasePasswordChange(db: Pool, userId: number): Promise<void> {
  await db.query(
    'UPDATE limite_acceso SET intentos = GREATEST(CAST(intentos AS SIGNED) - 1, 0) WHERE clave = ?',
    [changeKey(userId)],
  );
}

/** After a change: the counter starts over. */
export async function clearPasswordChange(db: Pool, userId: number): Promise<void> {
  await db.query('UPDATE limite_acceso SET intentos = 0 WHERE clave = ?', [changeKey(userId)]);
}

/**
 * After the password check. `failed`: the reservation stays (it was a guess). A right password gives it back: a login
 * that succeeds also clears the account's counter for that address (the owner is in), while the address only gets its
 * one attempt back, so logging into one's own account can't reset an address that is guessing others. The account-wide
 * counter only gets its one attempt back too: the owner logging in doesn't reset an attack from elsewhere, and their
 * network becomes known. A right password on a disabled account is not a guess either: its attempts go back, nothing is
 * cleared.
 * `not-verified` (S-02: no Argon2id turn, the password was never checked) gives the attempt back the same way.
 * A failure here only leaves the counters one higher (the safe side), so it is logged and the login goes on.
 */
export async function settleLogin(
  db: Pool,
  reservation: Reservation,
  outcome: 'failed' | 'success' | 'right-password' | 'not-verified',
): Promise<void> {
  if (outcome === 'failed') return;
  if (outcome === 'success')
    await rememberOrigin(db, reservation.origin).catch((e: Error) =>
      console.error('No se pudo registrar el origen:', e.message),
    );
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

/**
 * Attempt limits shared through MariaDB (S-01, migrations 005, 007 and 008, `limite_acceso`), so they survive a restart and
 * hold across several API instances. An attempt is RESERVED before the slow or sensitive work, in one transaction that
 * locks the counters (FOR UPDATE): N simultaneous requests can never all pass the check. A correct password gives the
 * reservation back (see `settleLogin`).
 *
 * The login has four counters. "Network" is an IPv4 address or the /64 of an IPv6 one, and "wide network" its /24 or /48
 * (api/client-ip.ts): one customer usually holds a whole /64, so counting addresses would be no limit at all (R-1).
 * - CUENTA_IP (account + network): 5 in a fixed 15-minute window — one person mistyping on one device, and the brake on
 *   guessing from one network;
 * - IP (network, any account): 50 in a fixed 15-minute window — caps the Argon2id work one network can trigger, with room
 *   for an office behind NAT;
 * - CUENTA (account, every network): a budget of 10 that recovers 1 every 30 minutes — the brake on guessing one account
 *   from many networks. At most 58 guesses the first day and 48 a day after that, however many addresses the attacker has.
 *   It refills on its own, so it never locks an account for good. A right password gives its attempt back;
 * - CUENTA_RED (account + wide network): a budget of 8 that recovers 1 every 6 hours, 4 a day — so one origin can't keep
 *   CUENTA empty by retaking each attempt as it comes back (audit IND-03): that takes about 12 allocations. Someone mistyping
 *   on a new browser can still try again when the 15 minutes of CUENTA_IP are over; the price is that whoever shares a /24
 *   or a /48 with an account's owner can use up that account's share there (audit IND2-05), never a whole network at once.
 *
 * A browser the account already logged in from skips them all (api/device-trust.ts): it has its own, stricter limit. So an
 * attacker can't lock the owner out from where they log in (audit H-2). What is left: during a sustained attack from several
 * networks, the owner on a NEW browser gets 429 even with the right password, because verifying it there would let anyone
 * try passwords without limit. Their ways in: a recovery link (which also trusts that browser), or one an operator
 * generates (`npm run db:access-link`).
 *
 * The account is identified the way MariaDB compares `usuarios.email` (utf8mb4_unicode_ci), not by JavaScript:
 * accents, full-width letters, zero-width characters and trailing spaces that find the same account share its counters
 * (audit H-1). Unknown e-mails are counted exactly like existing ones (no enumeration).
 *
 * A refused attempt writes nothing (audit M-1): the counters are read with FOR UPDATE and written only when the attempt
 * fits, and a refusal is also remembered by this process for a few seconds so a flood doesn't reach MariaDB. The
 * limiter can run on its own small pool (`createApp` option `limiterDb`), so a flood can't take the connections of the
 * rest of the API. Keys are SHA-256 hashes, never the e-mail or the IP (pseudonyms, not anonymity: a dictionary of e-mails
 * reverses them). Expired rows are purged after an admitted attempt.
 */
import type { Pool } from 'mariadb';
import { localDateTime, sha256 } from './auth.ts';
import { limitBucket, wideBucket } from './client-ip.ts';
import { releaseDevice, reserveDevice } from './device-trust.ts';
import { transaction } from './password.ts';

export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_LIMITS = { CUENTA_IP: 5, IP: 50, CUENTA: 10, CUENTA_RED: 8 } as const;
/** The account-wide budget recovers one attempt this often. 48 guesses a day sustained; see the header. */
export const ACCOUNT_REFILL_MS = 30 * 60_000;
/** One wide network's share of an account: 4 attempts a day once spent. */
export const WIDE_NETWORK_REFILL_MS = 6 * 3_600_000;
/** Password recovery budgets: a network, and an account from every network (e-mail bombing: 29 e-mails the first day). */
export const RESET_LIMITS = { RECUP_IP: 20, RECUP_CUENTA: 5 } as const;
export const RESET_IP_REFILL_MS = 15 * 60_000;
export const RESET_ACCOUNT_REFILL_MS = 60 * 60_000;
/** A row of a refilling counter is back to zero after this long, so it can go. */
const IDLE_MS: Record<string, number> = {
  CUENTA: LOGIN_LIMITS.CUENTA * ACCOUNT_REFILL_MS,
  CUENTA_RED: LOGIN_LIMITS.CUENTA_RED * WIDE_NETWORK_REFILL_MS,
  RECUP_IP: RESET_LIMITS.RECUP_IP * RESET_IP_REFILL_MS,
  RECUP_CUENTA: RESET_LIMITS.RECUP_CUENTA * RESET_ACCOUNT_REFILL_MS,
};
/** Wrong current passwords per account and window (HU-005). */
export const CHANGE_LIMIT = 5;
type Scope = keyof typeof LOGIN_LIMITS | keyof typeof RESET_LIMITS | 'CAMBIO';
/** Collation of `usuarios.email`; api/login-limit.test.ts fails if the schema changes it. */
export const EMAIL_COLLATION = 'utf8mb4_unicode_ci';
/** How long a refusal is answered from memory before MariaDB is asked again. Only ever refuses, never admits. */
const REFUSAL_CACHE_MS = 10_000;
const REFUSAL_CACHE_MAX = 10_000;

/** The counters one attempt reserved, in lock order; `settleLogin` gives them back if the password was right. */
export interface Reservation {
  keys: { key: string; scope: Scope }[];
  /** Reserved on this trusted browser instead of the counters (`keys` is empty). */
  device?: string;
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
  /** Recovers one attempt per this time instead of a fixed window. */
  refillMs?: number;
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
 * Reserves one attempt, or refuses it (→ null: answer 429 without verifying). A trusted browser (`deviceSecret`) reserves on
 * its own row; anything else on every counter, or none if one is at its limit.
 * Throws if MariaDB fails: the caller must refuse the login (503), never verify without a reservation.
 */
export async function reserveLogin(
  db: Pool,
  ip: string,
  email: string,
  deviceSecret: string | null = null,
): Promise<Reservation | null> {
  const bucket = limitBucket(ip);
  const ipKey = sha256(`IP|${bucket}`);
  // A cookie has to be looked up, even for a network at its limit: that is the point of it. A bad one is remembered by its
  // own hash, so repeating it costs nothing and it can never refuse a good one. Inventing new ones costs one lookup by
  // primary key each: no cut per network here, it would let anyone there switch off every valid browser (audit IND2-06).
  // The proxy's rate limit is what bounds that flood (deploy/nginx/charales.conf).
  if (deviceSecret && !refusedNow(sha256(`DISP_MALO|${deviceSecret}`))) {
    if (await reserveDevice(db, deviceSecret, email)) return { keys: [], device: deviceSecret };
    remember(sha256(`DISP_MALO|${deviceSecret}`));
  }
  if (refusedNow(ipKey)) return null; // a network at its limit doesn't even reach MariaDB
  const identity = await accountIdentity(db, email);
  const accountKey = sha256(`CUENTA|${identity}`);
  const pairKey = sha256(`CUENTA_IP|${bucket}|${identity}`);
  const wideKey = sha256(`CUENTA_RED|${wideBucket(ip)}|${identity}`);
  if (refusedNow(pairKey) || refusedNow(wideKey) || refusedNow(accountKey)) return null;
  // ONE lock order for every request: network, then account, then account+network (the inversion that deadlocked:
  // docs/API.md, S-01). Every request of one network queues on its row; every request of one account on the next.
  const counters: Counter[] = [
    { key: ipKey, scope: 'IP', limit: LOGIN_LIMITS.IP },
    {
      key: accountKey,
      scope: 'CUENTA',
      limit: LOGIN_LIMITS.CUENTA,
      refillMs: ACCOUNT_REFILL_MS,
    },
    {
      key: wideKey,
      scope: 'CUENTA_RED',
      limit: LOGIN_LIMITS.CUENTA_RED,
      refillMs: WIDE_NETWORK_REFILL_MS,
    },
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
  return { keys: counters.map(({ key, scope }) => ({ key, scope })) };
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
          /** What a counter holds now, and when its current period started. */
          const state = (c: Counter, row?: { intentos: number; ventana_inicio: string }) => {
            if (!row) return { used: 0, since: start };
            if (c.refillMs) {
              const from = new Date(row.ventana_inicio.replace(' ', 'T')).getTime();
              const refilled = Math.max(0, Math.floor((now - from) / c.refillMs));
              const used = Math.max(0, Number(row.intentos) - refilled);
              return { used, since: used ? localDateTime(from + refilled * c.refillMs) : start };
            }
            return row.ventana_inicio > expired
              ? { used: Number(row.intentos), since: row.ventana_inicio }
              : { used: 0, since: start };
          };
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
            if (state(c, rows[i]).used >= c.limit) throw new AtLimit(c.key);
          });
          for (const [i, c] of counters.entries()) {
            const { used, since } = state(c, rows[i]);
            if (rows[i])
              await tx.query(
                'UPDATE limite_acceso SET intentos = ?, ventana_inicio = ? WHERE clave = ?',
                [used + 1, used ? since : start, c.key],
              );
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
        // A fixed window is over at `expired`; a refilling counter only when it is whole again, or purging would give
        // an attacker its budget back.
        const refilling = Object.entries(IDLE_MS);
        const rows: { clave: string }[] = await tx.query(
          `SELECT clave FROM limite_acceso
            WHERE ventana_inicio <= ?
              AND (ambito NOT IN (?) ${refilling.map(() => 'OR (ambito = ? AND ventana_inicio <= ?)').join(' ')})
            LIMIT 100 FOR UPDATE SKIP LOCKED`,
          [
            expired,
            refilling.map(([scope]) => scope),
            ...refilling.flatMap(([scope, ms]) => [scope, localDateTime(now - ms)]),
          ],
        );
        if (rows.length)
          await tx.query('DELETE FROM limite_acceso WHERE clave IN (?)', [
            rows.map((r) => r.clave),
          ]);
        const devices: { clave: string }[] = await tx.query(
          'SELECT clave FROM dispositivo_confiable WHERE vence_en <= ? LIMIT 100 FOR UPDATE SKIP LOCKED',
          [start],
        );
        if (devices.length)
          await tx.query('DELETE FROM dispositivo_confiable WHERE clave IN (?)', [
            devices.map((r) => r.clave),
          ]);
      },
      'READ COMMITTED',
    ).catch((e: Error) => console.error('No se pudieron purgar los intentos vencidos:', e.message));
    return null;
  }
}

/**
 * One password recovery request of `email` from `ip`, counted whether the account exists or not, so the answer reveals
 * nothing. `refused`: its network is out of requests (→ 429). `quiet`: the account is, so nothing is sent, but the answer
 * stays the normal one: an attacker's requests can't show its owner a refusal, and the last e-mail they got still works
 * (no new request has revoked it). Nothing accumulates in memory or in the table per refusal.
 */
export async function reserveResetRequest(
  db: Pool,
  ip: string,
  email: string,
): Promise<'ok' | 'quiet' | 'refused'> {
  const ipKey = sha256(`RECUP_IP|${limitBucket(ip)}`); // per network: a /24 would let one person block a whole office (IND3-03)
  if (refusedNow(ipKey)) return 'refused';
  const accountKey = sha256(`RECUP_CUENTA|${await accountIdentity(db, email)}`);
  if (refusedNow(accountKey)) return 'quiet';
  const refusedBy = await reserveCounters(db, [
    {
      key: ipKey,
      scope: 'RECUP_IP',
      limit: RESET_LIMITS.RECUP_IP,
      refillMs: RESET_IP_REFILL_MS,
    },
    {
      key: accountKey,
      scope: 'RECUP_CUENTA',
      limit: RESET_LIMITS.RECUP_CUENTA,
      refillMs: RESET_ACCOUNT_REFILL_MS,
    },
  ]);
  if (!refusedBy) return 'ok';
  remember(refusedBy);
  return refusedBy === ipKey ? 'refused' : 'quiet';
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
 * that succeeds also clears the account's counters for that network (the owner is in), while the address only gets its
 * one attempt back, so logging into one's own account can't reset an address that is guessing others. The account-wide
 * counter only gets its one attempt back too: the owner logging in doesn't reset an attack from elsewhere. A right password
 * on an account without a role is not a guess either: its attempts go back, nothing is cleared. On a disabled account it
 * costs its attempt: giving it back would reveal, through the counters, that it was right (audit IND-11).
 * `not-verified` (S-02: no Argon2id turn, the password was never checked) gives the attempt back the same way.
 * A failure here only leaves the counters one higher (the safe side), so it is logged and the login goes on.
 */
export async function settleLogin(
  db: Pool,
  reservation: Reservation,
  outcome: 'failed' | 'success' | 'right-password' | 'not-verified',
): Promise<void> {
  if (outcome === 'failed') return;
  if (reservation.device) {
    // A success replaces the row altogether (issueDevice).
    if (outcome !== 'success')
      await releaseDevice(db, reservation.device).catch((e: Error) =>
        console.error('No se pudo devolver el intento del navegador:', e.message),
      );
    return;
  }
  try {
    await transaction(db, async (tx) => {
      for (const { key, scope } of reservation.keys)
        await tx.query(
          outcome === 'success' && (scope === 'CUENTA_IP' || scope === 'CUENTA_RED')
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

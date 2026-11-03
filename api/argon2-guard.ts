/**
 * S-02 · Argon2id turns shared by every API instance (migration 006). One Argon2id operation takes ~19 MiB
 * (m=19456 KiB) and one libuv thread for tens of milliseconds; without a cap, simultaneous logins, password changes
 * and recoveries could exhaust the memory or the CPU of the server. Each request runs its Argon2id work holding a TURN:
 * - A turn is a row of `turnos_argon2`. Taking one is atomic across instances: one transaction locks the single
 *   `turnos_argon2_guarda` row, frees the expired turns, counts the live ones and adds its own only below
 *   ARGON2_MAX_CONCURRENT. So the total is bounded for the whole deployment, not per process.
 * - A turn expires after 30 s on MariaDB's clock (one clock for every instance). A crashed process frees its turns that
 *   way; a normal one deletes its turn as soon as the work ends, also on an exception.
 * - No turn free: the request waits at most ARGON2_WAIT_MS, asking again every ~50 ms, then answers 503 without running
 *   Argon2id. At most 32 requests per process wait at once; the rest get 503 right away, so there is no unbounded queue.
 * - MariaDB unreachable or migration 006 missing: the caller answers 503 — Argon2id never runs without a turn.
 */
import type { Pool } from 'mariadb';
import { transaction } from './password.ts';

export interface Argon2Limits {
  /** Simultaneous Argon2id operations for the whole deployment (all instances). */
  limit: number;
  /** How long a request may wait for a turn before answering 503. */
  waitMs: number;
}
/**
 * 3 turns ≈ 57 MiB of Argon2id memory in all. Node runs Argon2id on the libuv pool (4 threads by default, shared with
 * file and DNS work), so a single instance gains nothing beyond 4 and 3 keeps one thread free. Raise it only with the
 * memory of the deployment in hand: docs/API.md, «Argon2id (S-02)».
 */
export const ARGON2_DEFAULTS: Argon2Limits = { limit: 3, waitMs: 2000 };
const LEASE_SECONDS = 30;
const MAX_WAITERS = 32;
const POLL_MS = 50;
const RETRYABLE = new Set([1213, 1205, 1020]); // deadlock, lock wait timeout, «Record has changed since last read»

/** ARGON2_MAX_CONCURRENT / ARGON2_WAIT_MS, or the defaults. An invalid value stops the API from starting. */
export function argon2LimitsFrom(env: Record<string, string | undefined>): Argon2Limits {
  const read = (name: string, fallback: number, min: number, max: number) => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max)
      throw new Error(`${name}: «${raw}» no es un entero entre ${min} y ${max}.`);
    return n;
  };
  return {
    limit: read('ARGON2_MAX_CONCURRENT', ARGON2_DEFAULTS.limit, 1, 64),
    waitMs: read('ARGON2_WAIT_MS', ARGON2_DEFAULTS.waitMs, 0, 10_000),
  };
}

let waiting = 0;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One turn, or null if all are taken. Throws if MariaDB fails or migration 006 is missing. */
async function take(db: Pool, limit: number): Promise<number | null> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await transaction(
        db,
        async (tx) => {
          const guard = await tx.query(
            'SELECT id FROM turnos_argon2_guarda WHERE id = 1 FOR UPDATE',
          );
          if (!guard.length)
            throw new Error('Falta la fila de turnos_argon2_guarda (migración 006).');
          await tx.query('DELETE FROM turnos_argon2 WHERE vence_en <= NOW(3)');
          const [{ n }]: { n: number | bigint }[] = await tx.query(
            'SELECT COUNT(*) AS n FROM turnos_argon2',
          );
          if (Number(n) >= limit) return null;
          const { insertId } = await tx.query(
            'INSERT INTO turnos_argon2 (vence_en) VALUES (NOW(3) + INTERVAL ? SECOND)',
            [LEASE_SECONDS],
          );
          return Number(insertId);
        },
        'READ COMMITTED',
      );
    } catch (e) {
      if (RETRYABLE.has((e as { errno?: number }).errno ?? 0) && attempt < 5) continue;
      throw e;
    }
  }
}

/** No turn free in time, or MariaDB couldn't give one: the caller answers 503 and nothing ran. */
export type Busy = { busy: true };

/**
 * Runs `work` (its Argon2id operations) holding a turn and frees the turn afterwards, also if `work` throws.
 * `{ busy: true }` if no turn came within `waitMs` or MariaDB failed while giving one (fail closed: logged, nothing
 * runs). An error of `work` itself propagates (the request answers the generic 500), with the turn freed.
 */
export async function withArgon2Turn<T>(
  db: Pool,
  limits: Argon2Limits,
  work: () => Promise<T>,
): Promise<{ busy: false; value: T } | Busy> {
  let id: number | null;
  try {
    id = await take(db, limits.limit);
    if (id === null) {
      if (waiting >= MAX_WAITERS) return { busy: true };
      waiting++;
      try {
        // performance.now(): a real clock even where tests mock Date.
        const deadline = performance.now() + limits.waitMs;
        while (id === null && performance.now() < deadline) {
          await sleep(POLL_MS / 2 + Math.random() * POLL_MS);
          id = await take(db, limits.limit);
        }
      } finally {
        waiting--;
      }
      if (id === null) return { busy: true };
    }
  } catch (e) {
    console.error('Turnos de Argon2id no disponibles:', (e as Error).message);
    return { busy: true };
  }
  try {
    return { busy: false, value: await work() };
  } finally {
    await db
      .query('DELETE FROM turnos_argon2 WHERE id = ?', [id])
      .catch((e: Error) => console.error('No se pudo liberar el turno de Argon2id:', e.message));
  }
}

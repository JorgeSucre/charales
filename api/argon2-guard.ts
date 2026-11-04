/**
 * S-02 · a per-process gate for Argon2id. One operation takes ~19 MiB (m=19456 KiB) and one libuv thread for tens of
 * milliseconds; without a cap, simultaneous logins, password changes and recoveries could exhaust the memory or the CPU
 * of the server. Every Argon2id operation of a request runs inside `gate.run(...)`:
 * - at most `limit` run at once in THIS process (ARGON2_MAX_CONCURRENT, default 3);
 * - up to 32 more wait, each at most `waitMs` (ARGON2_WAIT_MS, default 2000); a freed slot goes to the oldest waiter;
 * - the rest, or a wait that times out, get `{ busy: true }` (the route answers 503) and run nothing;
 * - a slot is freed in `finally`, also when the work throws, and freeing twice is harmless.
 * The cap is PER PROCESS, not for the deployment: N API processes allow up to N × limit operations at once
 * (docs/API.md, «Argon2id»). Charales runs one process (`node api/server.ts`, no cluster). Nothing here uses MariaDB.
 * (Migration 006 created tables for an earlier, distributed version; they are unused.)
 */

export interface Argon2Limits {
  /** Simultaneous Argon2id operations in this process. */
  limit: number;
  /** How long a request may wait for a slot before answering 503. */
  waitMs: number;
}
/**
 * 3 slots ≈ 57 MiB of Argon2id memory per process. Node runs Argon2id on the libuv pool (4 threads by default, shared
 * with file and DNS work), so one process gains nothing beyond 4 and 3 keeps one thread free. Size it with the memory of
 * the server in hand: docs/API.md, «Argon2id (S-02)».
 */
export const ARGON2_DEFAULTS: Argon2Limits = { limit: 3, waitMs: 2000 };
export const MAX_WAITERS = 32;

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

/** No slot within the wait, or the queue was full: the caller answers 503 and nothing ran. */
export type Busy = { busy: true };

export interface Argon2Gate {
  /** A slot (its release function, safe to call twice), or null if none came in time. */
  acquire(): Promise<(() => void) | null>;
  /** Runs `work` holding a slot, freed afterwards even if `work` throws (that error propagates). */
  run<T>(work: () => Promise<T>): Promise<{ busy: false; value: T } | Busy>;
  /** Slots in use and requests waiting, for tests and diagnostics. */
  stats(): { active: number; waiting: number };
}

export function argon2Gate({ limit, waitMs }: Argon2Limits): Argon2Gate {
  let active = 0;
  const queue: (() => void)[] = [];
  const slot = () => {
    let freed = false;
    return () => {
      if (freed) return;
      freed = true;
      const next = queue.shift();
      if (next)
        next(); // hand the slot over: `active` stays the same
      else active--;
    };
  };
  const gate: Argon2Gate = {
    async acquire() {
      if (active < limit) {
        active++;
        return slot();
      }
      if (queue.length >= MAX_WAITERS) return null;
      const admitted = await new Promise<boolean>((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          resolve(true);
        };
        const timer = setTimeout(() => {
          queue.splice(queue.indexOf(wake), 1);
          resolve(false);
        }, waitMs);
        queue.push(wake);
      });
      return admitted ? slot() : null;
    },
    async run(work) {
      const release = await gate.acquire();
      if (!release) return { busy: true };
      try {
        return { busy: false, value: await work() };
      } finally {
        release();
      }
    },
    stats: () => ({ active, waiting: queue.length }),
  };
  return gate;
}

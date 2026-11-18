/** Bounded per-session request concurrency gate used by the domain RPC bridge. */
export interface GateLimits {
  limit: number;
  waitMs: number;
  maxWaiters?: number;
}

export const MAX_WAITERS = 32;
export type Busy = { busy: true };
export interface ConcurrencyGate {
  acquire(): Promise<(() => void) | null>;
  run<T>(work: () => Promise<T>): Promise<{ busy: false; value: T } | Busy>;
  stats(): { active: number; waiting: number };
}

export function concurrencyGate({
  limit,
  waitMs,
  maxWaiters = MAX_WAITERS,
}: GateLimits): ConcurrencyGate {
  let active = 0;
  const queue: (() => void)[] = [];
  const slot = () => {
    let freed = false;
    return () => {
      if (freed) return;
      freed = true;
      const next = queue.shift();
      if (next) next();
      else active--;
    };
  };
  const gate: ConcurrencyGate = {
    async acquire() {
      if (active < limit) {
        active++;
        return slot();
      }
      if (queue.length >= maxWaiters) return null;
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
    async run<T>(work: () => Promise<T>) {
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

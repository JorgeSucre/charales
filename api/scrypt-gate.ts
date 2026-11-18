/** One process-wide admission gate for every native scrypt operation. */
import { concurrencyGate } from './concurrency-gate.ts';

function boundedInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${name} must be between ${min} and ${max}.`);
  return value;
}

export const SCRYPT_GATE_LIMITS = Object.freeze({
  maxConcurrent: boundedInteger('SCRYPT_MAX_CONCURRENT', 2, 1, 16),
  maxWaiters: boundedInteger('SCRYPT_MAX_WAITERS', 32, 0, 256),
  waitMs: boundedInteger('SCRYPT_WAIT_MS', 5_000, 1, 30_000),
});

const gate = concurrencyGate({
  limit: SCRYPT_GATE_LIMITS.maxConcurrent,
  maxWaiters: SCRYPT_GATE_LIMITS.maxWaiters,
  waitMs: SCRYPT_GATE_LIMITS.waitMs,
});

export class ScryptCapacityError extends Error {
  constructor() {
    super('Scrypt capacity is exhausted.');
    this.name = 'ScryptCapacityError';
  }
}

export class ScryptOperationError extends Error {
  constructor() {
    super('Scrypt operation failed.');
    this.name = 'ScryptOperationError';
  }
}

/** Metrics are deliberately local and contain no user or credential information. */
export const scryptGateStats = () => gate.stats();

export async function withScryptCapacity<T>(work: () => Promise<T>): Promise<T> {
  const result = await gate.run(work);
  if (result.busy) throw new ScryptCapacityError();
  return result.value;
}

/** Maps native KDF failures to a non-sensitive operational error while preserving capacity refusals. */
export async function runScryptOperation<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await withScryptCapacity(work);
  } catch (error) {
    if (error instanceof ScryptCapacityError || error instanceof ScryptOperationError) throw error;
    throw new ScryptOperationError();
  }
}

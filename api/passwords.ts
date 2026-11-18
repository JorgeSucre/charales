/** Password hashing for the API. Stored values use a versioned, self describing scrypt format. */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { ScryptCapacityError, ScryptOperationError, runScryptOperation } from './scrypt-gate.ts';

export { ScryptCapacityError, ScryptOperationError, scryptGateStats } from './scrypt-gate.ts';

export interface ScryptParameters {
  N: number;
  r: number;
  p: number;
  keyLength: number;
  maxmem: number;
}

function parameterFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} is outside the supported range.`);
  return value;
}

/** Defaults use a 32 MiB working set; maxmem includes implementation overhead. */
export const SCRYPT_PARAMETERS: Readonly<ScryptParameters> = Object.freeze({
  N: parameterFromEnv('SCRYPT_N', 1 << 15),
  r: parameterFromEnv('SCRYPT_R', 8),
  p: parameterFromEnv('SCRYPT_P', 1),
  keyLength: parameterFromEnv('SCRYPT_KEY_LENGTH', 64),
  maxmem: parameterFromEnv('SCRYPT_MAXMEM_MB', 64) * 1024 * 1024,
});
const DUMMY_SALT = randomBytes(16);
const FORMAT =
  /^\$scrypt\$v=1\$N=(\d+),r=(\d+),p=(\d+),l=(\d+)\$([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number; maxmem: number },
) {
  return runScryptOperation(
    () =>
      new Promise<Buffer>((resolve, reject) =>
        scryptCallback(password, salt, keyLength, options, (error, key) =>
          error ? reject(error) : resolve(key as Buffer),
        ),
      ),
  );
}

/** Argon2 PHC values are recognized internally, but are never verified by this implementation. */
export function isLegacyPasswordHash(stored: unknown): boolean {
  return typeof stored === 'string' && /^\$argon2(?:id|i|d)\$/.test(stored);
}

function validateParameters(params: ScryptParameters): void {
  if (
    !Number.isSafeInteger(params.N) ||
    params.N < 1 << 14 ||
    params.N > 1 << 16 ||
    (params.N & (params.N - 1)) !== 0 ||
    !Number.isSafeInteger(params.r) ||
    params.r < 1 ||
    params.r > 8 ||
    !Number.isSafeInteger(params.p) ||
    params.p < 1 ||
    params.p > 2 ||
    !Number.isSafeInteger(params.keyLength) ||
    params.keyLength < 32 ||
    params.keyLength > 64 ||
    !Number.isSafeInteger(params.maxmem)
  )
    throw new Error('Invalid scrypt parameters.');
  const required = 128 * params.N * params.r + 128 * params.r * params.p + 1024;
  if (
    !Number.isSafeInteger(required) ||
    params.maxmem < required ||
    params.maxmem > 128 * 1024 * 1024
  )
    throw new Error('Invalid scrypt memory limit.');
}

validateParameters(SCRYPT_PARAMETERS);

export async function hashPassword(
  password: string,
  params: ScryptParameters = SCRYPT_PARAMETERS,
): Promise<string> {
  if (typeof password !== 'string' || password.length === 0 || password.length > 200)
    throw new Error('Invalid password input.');
  validateParameters(params);
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, params.keyLength, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: params.maxmem,
  })) as Buffer;
  return `$scrypt$v=1$N=${params.N},r=${params.r},p=${params.p},l=${params.keyLength}$${salt.toString('base64url')}.${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof password !== 'string' || typeof stored !== 'string' || password.length > 200)
    return false;
  const match = FORMAT.exec(stored);
  if (!match) {
    try {
      const actual = await scrypt(password, DUMMY_SALT, SCRYPT_PARAMETERS.keyLength, {
        N: SCRYPT_PARAMETERS.N,
        r: SCRYPT_PARAMETERS.r,
        p: SCRYPT_PARAMETERS.p,
        maxmem: SCRYPT_PARAMETERS.maxmem,
      });
      timingSafeEqual(actual, Buffer.alloc(actual.length));
    } catch (error) {
      if (error instanceof ScryptCapacityError || error instanceof ScryptOperationError)
        throw error;
      throw new ScryptOperationError();
    }
    return false;
  }
  const [, n, r, p, length, saltText, keyText] = match;
  const params: ScryptParameters = {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    keyLength: Number(length),
    maxmem: 128 * 1024 * 1024,
  };
  try {
    validateParameters(params);
    const salt = Buffer.from(saltText!, 'base64url');
    const expected = Buffer.from(keyText!, 'base64url');
    if (
      salt.length !== 16 ||
      expected.length !== params.keyLength ||
      salt.toString('base64url') !== saltText ||
      expected.toString('base64url') !== keyText
    )
      return false;
    const actual = (await scrypt(password, salt, params.keyLength, {
      N: params.N,
      r: params.r,
      p: params.p,
      maxmem: params.maxmem,
    })) as Buffer;
    return timingSafeEqual(actual, expected);
  } catch (error) {
    if (error instanceof ScryptCapacityError || error instanceof ScryptOperationError) throw error;
    return false;
  }
}

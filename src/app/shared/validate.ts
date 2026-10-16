/**
 * Server-side style validation used by the services (the API will repeat it). Forms validate for UX;
 * services validate because they are the trust boundary while MockDb stands in for the backend.
 */

export const PHONE_PATTERN = /^\+?\d{10,13}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed text or error; enforces the column's VARCHAR length. */
export function required(value: string | null | undefined, label: string, max = 255): string {
  const text = (value ?? '').trim();
  if (!text) throw new Error(`${label} es obligatorio.`);
  if (text.length > max) throw new Error(`${label} admite máximo ${max} caracteres.`);
  return text;
}

/** Trimmed text or null (empty → NULL, as the column allows). */
export function optional(
  value: string | null | undefined,
  label: string,
  max = 255,
): string | null {
  const text = (value ?? '').trim();
  if (text.length > max) throw new Error(`${label} admite máximo ${max} caracteres.`);
  return text || null;
}

export function optionalEmail(value: string | null | undefined): string | null {
  const email = optional(value, 'El correo', 150)?.toLowerCase() ?? null;
  if (email && !EMAIL_PATTERN.test(email)) throw new Error('Correo inválido.');
  return email;
}

export function optionalPhone(value: string | null | undefined): string | null {
  const phone = optional(value, 'El teléfono', 30)?.replace(/[\s-]/g, '') ?? null;
  if (phone && !PHONE_PATTERN.test(phone)) throw new Error('Teléfono inválido (10 a 13 dígitos).');
  return phone;
}

/**
 * A value of a fixed catalog (an ENUM column): a string that is exactly one of `allowed` — a list or a `*_LABELS` map.
 * Arguments come from the browser: `LABELS[x]` would accept 'toString', and `Object.hasOwn` alone turns ['ACTIVO']
 * into 'ACTIVO'.
 */
export function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[] | Record<T, string>,
  message: string,
): T {
  const ok =
    typeof value === 'string' &&
    (Array.isArray(allowed) ? allowed.includes(value as T) : Object.hasOwn(allowed, value));
  if (!ok) throw new Error(message);
  return value as T;
}

/** A real boolean (BOOLEAN column): 'false', 0 or null would otherwise be stored as their truthiness. */
export function flag(value: unknown, message: string): boolean {
  if (typeof value !== 'boolean') throw new Error(message);
  return value;
}

/** Same name ignoring case, accents and extra spaces — for "evident duplicates" (HU-008, HU-022). */
export function sameName(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  return norm(a) === norm(b);
}

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

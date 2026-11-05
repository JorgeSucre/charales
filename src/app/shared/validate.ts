/**
 * Server-side style validation used by the services (the API will repeat it). Forms validate for UX;
 * services validate because they are the trust boundary while MockDb stands in for the backend.
 */

/** A normalized phone: optional leading «+» and 10 to 15 digits (15 = E.164 maximum, for international numbers). */
export const PHONE_PATTERN = /^\+?\d{10,15}$/;
/** Separators accepted while typing a phone and dropped before validating and storing: spaces, dashes, dots, (). */
const PHONE_SEPARATORS = /[\s.()-]/g;
export const PHONE_MESSAGE =
  'Ingresa un número de teléfono válido: de 10 a 15 dígitos, con «+» opcional al inicio.';
export const EMAIL_MESSAGE =
  'Ingresa un correo electrónico válido, por ejemplo nombre@dominio.com.';
/** R11: tutors and coaches need at least one way to be reached. */
export const CONTACT_REQUIRED_MESSAGE =
  'Captura al menos un teléfono o un correo electrónico de contacto.';

/** «El nombre» → «Falta el nombre. Es un dato obligatorio.» (works for any gender: «Falta la talla…»). */
export function requiredMessage(label: string): string {
  return `Falta ${label.charAt(0).toLowerCase()}${label.slice(1)}. Es un dato obligatorio.`;
}

export function tooLongMessage(label: string, max: number): string {
  return `${label} admite como máximo ${max} caracteres.`;
}

/** A reference that doesn't exist (an id from the browser, or a row deleted meanwhile). Any gender: «Sesión inexistente». */
export function notFoundMessage(what: string): string {
  return `${what} inexistente: actualiza la página e inténtalo de nuevo.`;
}

export const DATE_MESSAGE = 'Ingresa una fecha válida.';
export const TIMES_MESSAGE = 'Ingresa horas de inicio y fin válidas (HH:MM).';
export const MONEY_MESSAGE = 'Ingresa un importe válido, por ejemplo 150 o 150.50.';
/** Shown when the failure has no message meant for the user (never a stack trace or SQL). */
export const UNEXPECTED_MESSAGE =
  'Ocurrió un error inesperado. Inténtalo de nuevo; si continúa, avisa al administrador.';
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A person's name or surname (R21): words of Unicode letters — any language, accents and combining marks — joined by
 * one space, hyphen or apostrophe, or by an abbreviation dot («Ma. José», «J. R.»). No digits or other symbols.
 */
export const PERSON_NAME_PATTERN = /^[\p{L}\p{M}]+(?:(?:[ '’-]|\. ?)[\p{L}\p{M}]+)*\.?$/u;
export const PERSON_NAME_HINT =
  'sólo admite letras, espacios, guiones, apóstrofos y puntos de abreviatura';
/** Catalog names (R21) may use digits and punctuation («Sub-10», «Cancha 2»), but need a letter or digit. */
const CATALOG_NAME_PATTERN = /^(?=.*[\p{L}\p{N}])[^\p{Cc}\p{Cf}]+$/u;
/** Spaces typed between words collapse to one; nothing else in the name changes. */
const tidy = (text: string) => text.replace(/\s+/g, ' ');

/** Trimmed text or error; enforces the column's VARCHAR length. */
export function required(value: string | null | undefined, label: string, max = 255): string {
  const text = (value ?? '').trim();
  if (!text) throw new Error(requiredMessage(label));
  if (text.length > max) throw new Error(tooLongMessage(label, max));
  return text;
}

/** Trimmed text or null (empty → NULL, as the column allows). */
export function optional(
  value: string | null | undefined,
  label: string,
  max = 255,
): string | null {
  const text = (value ?? '').trim();
  if (text.length > max) throw new Error(tooLongMessage(label, max));
  return text || null;
}

/** Required person name (R21): «El apellido paterno sólo admite letras, …» when it has digits or symbols. */
export function personName(value: string | null | undefined, label: string, max = 100): string {
  const text = tidy(required(value, label, max));
  if (!PERSON_NAME_PATTERN.test(text)) throw new Error(`${label} ${PERSON_NAME_HINT}.`);
  return text;
}

/** Optional person name (e.g. the second surname): empty → null, otherwise the same rule. */
export function optionalPersonName(
  value: string | null | undefined,
  label: string,
  max = 100,
): string | null {
  const text = optional(value, label, max);
  return text === null ? null : personName(text, label, max);
}

/** Required catalog name (R21): any text with at least one letter or digit, no control characters. */
export function catalogName(value: string | null | undefined, label: string, max = 100): string {
  const text = tidy(required(value, label, max));
  if (!CATALOG_NAME_PATTERN.test(text)) throw new Error(`${label} debe incluir letras o números.`);
  return text;
}

export function optionalEmail(value: string | null | undefined): string | null {
  const email = optional(value, 'El correo', 150)?.toLowerCase() ?? null;
  if (email && !EMAIL_PATTERN.test(email)) throw new Error(EMAIL_MESSAGE);
  return email;
}

export function optionalPhone(value: string | null | undefined): string | null {
  const phone = optional(value, 'El teléfono', 30)?.replace(PHONE_SEPARATORS, '') ?? null;
  if (phone !== null && !PHONE_PATTERN.test(phone)) throw new Error(PHONE_MESSAGE);
  return phone;
}

/**
 * Form validator with exactly the rule of optionalPhone (same normalization), so a form never rejects what the API
 * accepts or the other way round. Typed structurally: this file is also bundled into the API, without Angular.
 */
export function phoneValidator(control: { value: unknown }): { phone: true } | null {
  const text = typeof control.value === 'string' ? control.value.trim() : '';
  return !text || PHONE_PATTERN.test(text.replace(PHONE_SEPARATORS, '')) ? null : { phone: true };
}

/** Form validator with the rule of optionalEmail (trimmed, EMAIL_PATTERN); Angular's Validators.email differs. */
export function emailValidator(control: { value: unknown }): { email: true } | null {
  const text = typeof control.value === 'string' ? control.value.trim() : '';
  return !text || EMAIL_PATTERN.test(text) ? null : { email: true };
}

/** Form validator with the rule of personName (empty is left to Validators.required). */
export function personNameValidator(control: { value: unknown }): { personName: true } | null {
  const text = typeof control.value === 'string' ? tidy(control.value.trim()) : '';
  return !text || PERSON_NAME_PATTERN.test(text) ? null : { personName: true };
}

/** Form validator with the rule of catalogName (empty is left to Validators.required). */
export function catalogNameValidator(control: { value: unknown }): { catalogName: true } | null {
  const text = typeof control.value === 'string' ? tidy(control.value.trim()) : '';
  return !text || CATALOG_NAME_PATTERN.test(text) ? null : { catalogName: true };
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

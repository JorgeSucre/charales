import { DateTime, ISODate, Time } from '../core/models';

/**
 * Calendar helpers. Conventions (see docs/database/DATA_CONTRACT.md § 1):
 * - DATE     → ISODate 'YYYY-MM-DD' (calendar day, no zone; never toISOString(), which is UTC).
 * - TIME     → Time 'HH:MM'.
 * - DATETIME → DateTime 'YYYY-MM-DDTHH:MM:SS', the school's local time (America/Mexico_City) without offset,
 *              exactly what a MariaDB DATETIME holds.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** Today's date in the user's local time zone. */
export function today(now = new Date()): ISODate {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function nowDateTime(now = new Date()): DateTime {
  return `${today(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/** DATETIME a number of minutes from now (session/token expiry). */
export function dateTimeIn(minutes: number, now = new Date()): DateTime {
  return nowDateTime(new Date(now.getTime() + minutes * 60_000));
}

/** Calendar day of a DATETIME. */
export function dateOf(value: DateTime): ISODate {
  return value.slice(0, 10);
}

export function isISODate(value: string): value is ISODate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function isTime(value: string): value is Time {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Whole years between birthDate and `on` (both DATE). */
export function ageOn(birthDate: ISODate, on: ISODate): number {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [y, m, d] = on.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export function addDays(date: ISODate, days: number): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  return today(new Date(y, m - 1, d + days));
}

/** ISO weekday, as horarios_entrenamiento.dia_semana: 1 = Monday … 7 = Sunday. */
export function weekday(date: ISODate): number {
  const [y, m, d] = date.split('-').map(Number);
  return ((new Date(y, m - 1, d).getDay() + 6) % 7) + 1;
}

export const WEEKDAYS = [
  '',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
];

/** Time ranges [start, end) overlap. Works on 'HH:MM' strings because they sort lexicographically. */
export function overlaps(a: { start: Time; end: Time }, b: { start: Time; end: Time }): boolean {
  return a.start < b.end && b.start < a.end;
}

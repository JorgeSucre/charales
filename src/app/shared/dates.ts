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

/** A dated assignment (entrenador_categoria, entrenador_competencia_categoria) is current: active and not ended. */
export function isCurrentAssignment(
  r: { active: boolean; endDate: ISODate | null },
  on: ISODate = today(),
): boolean {
  return r.active && (!r.endDate || r.endDate >= on);
}

/** 'YYYY-MM-DDTHH:MM[:SS]' (e.g. from <input type="datetime-local">) → DATETIME 'YYYY-MM-DDTHH:MM:SS'. Throws if invalid. */
export function normalizeDateTime(value: string): DateTime {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?$/.exec(value.trim());
  if (!m || !isISODate(m[1]) || !isTime(m[2])) throw new Error('Ingresa una fecha y hora válidas.');
  return `${m[1]}T${m[2]}${m[3] ?? ':00'}`;
}

/**
 * Month calendar grid (HU-068): full weeks Monday→Sunday covering the month 'YYYY-MM'.
 * Days outside the month are included so every row has 7 cells.
 */
export function monthGrid(month: string): ISODate[][] {
  const first = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const last = today(new Date(y, m, 0));
  let day = addDays(first, 1 - weekday(first));
  const weeks: ISODate[][] = [];
  while (day <= last) {
    const week: ISODate[] = [];
    for (let i = 0; i < 7; i++, day = addDays(day, 1)) week.push(day);
    weeks.push(week);
  }
  return weeks;
}

/** 'YYYY-MM' shifted by n months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  return today(new Date(y, m - 1 + n, 1)).slice(0, 7);
}

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/**
 * An inclusive DATE range in natural Spanish: «del 1 al 21 de octubre de 2026», «del 15 de septiembre al 21 de
 * octubre de 2026», «del 15 de diciembre de 2025 al 21 de enero de 2026», «el 21 de octubre de 2026» (one day).
 * Reads the 'YYYY-MM-DD' parts directly (no Date parsing, so no UTC shift). Null when a bound is missing or invalid,
 * or the range is reversed: the caller shows a neutral text instead of inventing dates.
 */
export function dateRangeLabel(
  from: string | null | undefined,
  to: string | null | undefined,
): string | null {
  if (!from || !to || !isISODate(from) || !isISODate(to) || from > to) return null;
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const day = (d: number, m: number) => `${d} de ${MONTHS[m - 1]}`;
  if (from === to) return `el ${day(td, tm)} de ${ty}`;
  if (fy !== ty) return `del ${day(fd, fm)} de ${fy} al ${day(td, tm)} de ${ty}`;
  if (fm !== tm) return `del ${day(fd, fm)} al ${day(td, tm)} de ${ty}`;
  return `del ${fd} al ${day(td, tm)} de ${ty}`;
}

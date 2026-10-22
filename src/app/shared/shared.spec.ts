import {
  addDays,
  ageOn,
  dateRangeLabel,
  dateTimeIn,
  isISODate,
  isTime,
  overlaps,
  today,
  weekday,
} from './dates';
import { parseMoney, sumCents, toDecimal } from './money';
import { matches, paginate } from './page';
import { centsFromInput } from './ui';
import { flag, oneOf, optionalEmail, optionalPhone, sameName } from './validate';

describe('money (DECIMAL(12,2) ↔ integer cents)', () => {
  it('never does float arithmetic: 0.10 + 0.20 is exactly 0.30', () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the problem being avoided
    expect(toDecimal(sumCents([parseMoney('0.10'), parseMoney('0.20')]))).toBe('0.30');
  });

  it('parses API decimals and form values, and serializes back', () => {
    expect(parseMoney('1234.5')).toBe(123450);
    expect(parseMoney('1,200.00')).toBe(120000);
    expect(parseMoney(600)).toBe(60000);
    expect(toDecimal(123450)).toBe('1234.50');
    expect(toDecimal(-5)).toBe('-0.05');
    expect(centsFromInput(35.1)).toBe(3510);
    expect(centsFromInput(0.1 + 0.2)).toBe(30);
    expect(() => parseMoney('12.345')).toThrow();
    expect(() => parseMoney('abc')).toThrow();
    expect(() => sumCents([1, 0.5])).toThrow();
  });
});

describe('dates (DATE / TIME / DATETIME as strings)', () => {
  it('uses the local calendar, not UTC', () => {
    expect(today(new Date(2026, 9, 7, 23, 59))).toBe('2026-10-07');
    expect(dateTimeIn(90, new Date(2026, 9, 7, 23, 0))).toBe('2026-10-08T00:30:00');
  });

  it('validates DATE and TIME and computes age, weekday and overlaps', () => {
    expect(isISODate('2026-02-29')).toBe(false);
    expect(isISODate('2028-02-29')).toBe(true);
    expect(isTime('24:00')).toBe(false);
    expect(ageOn('2016-03-12', '2026-03-11')).toBe(9);
    expect(ageOn('2016-03-12', '2026-03-12')).toBe(10);
    expect(weekday('2026-10-05')).toBe(1); // Monday
    expect(weekday('2026-10-11')).toBe(7); // Sunday
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(overlaps({ start: '17:00', end: '18:30' }, { start: '18:00', end: '19:00' })).toBe(true);
    expect(overlaps({ start: '17:00', end: '18:00' }, { start: '18:00', end: '19:00' })).toBe(
      false,
    );
  });
});

describe('dateRangeLabel (inclusive DATE range in Spanish)', () => {
  it('same month, different months, different years and a single day', () => {
    expect(dateRangeLabel('2026-10-01', '2026-10-21')).toBe('del 1 al 21 de octubre de 2026');
    expect(dateRangeLabel('2026-09-15', '2026-10-21')).toBe(
      'del 15 de septiembre al 21 de octubre de 2026',
    );
    expect(dateRangeLabel('2025-12-15', '2026-01-21')).toBe(
      'del 15 de diciembre de 2025 al 21 de enero de 2026',
    );
    expect(dateRangeLabel('2026-10-21', '2026-10-21')).toBe('el 21 de octubre de 2026');
  });

  it('first of the month stays the first: no UTC shift whatever the time zone', () => {
    expect(dateRangeLabel('2026-01-01', '2026-01-31')).toBe('del 1 al 31 de enero de 2026');
  });

  it('missing, malformed, impossible or reversed ranges give null', () => {
    expect(dateRangeLabel('', '2026-10-21')).toBeNull();
    expect(dateRangeLabel('2026-10-01', undefined)).toBeNull();
    expect(dateRangeLabel('2026-10-01', '21/10/2026')).toBeNull();
    expect(dateRangeLabel('2026-02-30', '2026-03-01')).toBeNull();
    expect(dateRangeLabel('2026-10-21', '2026-10-01')).toBeNull();
  });
});

describe('search, pagination and validation helpers', () => {
  it('paginates and searches ignoring accents/case (HU-014)', () => {
    const page = paginate([1, 2, 3, 4, 5], 2, 2);
    expect(page).toEqual({ items: [3, 4], total: 5, page: 2, pageSize: 2 });
    expect(paginate([1], 9, 2).page).toBe(1);
    expect(matches('Lucía Hernández', 'hernan')).toBe(true);
    expect(matches('Lucía Hernández', 'LUCIA')).toBe(true);
  });

  it('normalizes contact data and detects evident duplicates', () => {
    expect(optionalEmail(' Ana@Example.COM ')).toBe('ana@example.com');
    expect(optionalEmail('')).toBeNull();
    expect(() => optionalEmail('no-es-correo')).toThrow();
    expect(optionalPhone('55 1234-5678')).toBe('5512345678');
    expect(() => optionalPhone('123')).toThrow();
    expect(sameName('José  Pérez', 'jose perez')).toBe(true);
  });

  it('accepts only exact catalog values and real booleans (arguments come from the browser)', () => {
    const labels = { ACTIVO: 'Activo', BAJA: 'Baja' };
    expect(oneOf('ACTIVO', labels, 'Estatus inválido.')).toBe('ACTIVO');
    expect(oneOf('BECA', ['DESCUENTO', 'BECA'], 'Tipo inválido.')).toBe('BECA');
    for (const bad of ['XX', 'activo', 'toString', '__proto__', ['ACTIVO'], null, 1, {}])
      expect(() => oneOf(bad, labels, 'Estatus inválido.')).toThrow('Estatus inválido.');
    expect(() => oneOf(['BECA'], ['DESCUENTO', 'BECA'], 'Tipo inválido.')).toThrow(
      'Tipo inválido.',
    );
    expect(flag(true, 'x')).toBe(true);
    expect(flag(false, 'x')).toBe(false);
    for (const bad of ['false', 'true', '', 0, 1, null, undefined, [], {}])
      expect(() => flag(bad, 'Valor inválido.')).toThrow('Valor inválido.');
  });
});

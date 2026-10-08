import { addDays, ageOn, dateTimeIn, isISODate, isTime, overlaps, today, weekday } from './dates';
import { parseMoney, sumCents, toDecimal } from './money';
import { matches, paginate } from './page';
import { centsFromInput } from './ui';
import { optionalEmail, optionalPhone, sameName } from './validate';

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
});

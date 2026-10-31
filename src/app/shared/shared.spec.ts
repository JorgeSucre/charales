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
import { focusFirstInvalid } from './focus';
import { parseMoney, sumCents, toDecimal } from './money';
import { matches, paginate } from './page';
import { centsFromInput } from './ui';
import {
  EMAIL_MESSAGE,
  PHONE_MESSAGE,
  emailValidator,
  flag,
  oneOf,
  optionalEmail,
  optionalPhone,
  catalogName,
  catalogNameValidator,
  optionalPersonName,
  personName,
  personNameValidator,
  phoneValidator,
  sameName,
} from './validate';

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

  it('phones: national and international formats, separators dropped, same rule in forms and services', () => {
    const valid: [string, string][] = [
      ['33 1234 5678', '3312345678'],
      ['(33) 1234-5678', '3312345678'],
      ['33.1234.5678', '3312345678'],
      ['+52 (33) 1234-5678', '+523312345678'],
      ['+1 (555) 123-4567', '+15551234567'],
      ['+44 20 7946 0958', '+442079460958'],
      ['+123 456 789 012 345', '+123456789012345'], // 15 digits, the E.164 maximum
    ];
    for (const [input, stored] of valid) {
      expect(optionalPhone(input)).toBe(stored);
      expect(phoneValidator({ value: input })).toBeNull();
    }
    const invalid = [
      '123',
      '1234 5678 9',
      '+1234567890123456',
      '33+1234-5678',
      'tel 3312345678',
      '()',
      '+',
    ];
    for (const input of invalid) {
      expect(() => optionalPhone(input)).toThrow(PHONE_MESSAGE);
      expect(phoneValidator({ value: input })).toEqual({ phone: true });
    }
    for (const empty of ['', '   ', null, undefined]) {
      expect(optionalPhone(empty)).toBeNull();
      expect(phoneValidator({ value: empty })).toBeNull();
    }
  });

  it('person names (R21): Unicode letters, spaces, hyphens, apostrophes and abbreviation dots — same rule in forms', () => {
    const valid: [string, string][] = [
      ['José María', 'José María'],
      ['  Núñez-Ávila  ', 'Núñez-Ávila'],
      ["O'Brien", "O'Brien"],
      ['D’Angelo', 'D’Angelo'],
      ['Ma. Luisa', 'Ma. Luisa'],
      ['J. R. R.', 'J. R. R.'],
      ['Zoë', 'Zoë'],
      ['Nguyễn', 'Nguyễn'],
      ['李小龍', '李小龍'],
      ['Ana   Sofía', 'Ana Sofía'], // inner runs of spaces collapse
      ['Ñandú', 'Ñandú'],
    ];
    for (const [input, stored] of valid) {
      expect(personName(input, 'El nombre')).toBe(stored);
      expect(personNameValidator({ value: input })).toBeNull();
    }
    const invalid = [
      'Juan2',
      'Ana!',
      'R2-D2',
      '@lex',
      'Pedro_Paz',
      'Luis--Mar',
      "'Ana",
      'Ana-',
      '.',
      '#',
      'Ana (mamá)',
    ];
    for (const input of invalid) {
      expect(() => personName(input, 'El nombre')).toThrow(
        'El nombre sólo admite letras, espacios, guiones, apóstrofos y puntos de abreviatura.',
      );
      expect(personNameValidator({ value: input })).toEqual({ personName: true });
    }
    expect(() => personName('   ', 'El nombre')).toThrow(
      'Falta el nombre. Es un dato obligatorio.',
    );
    expect(optionalPersonName('  ', 'El apellido materno')).toBeNull();
    expect(() => optionalPersonName('López 3', 'El apellido materno')).toThrow(
      'El apellido materno sólo admite',
    );
    expect(personNameValidator({ value: '' })).toBeNull(); // emptiness is Validators.required's job
  });

  it('catalog names (R21): digits and punctuation allowed, but at least one letter or digit', () => {
    for (const name of [
      'Sub-10',
      'Cancha 2',
      'Copa Otoño 2026',
      'Temporada 2026-2027',
      'Playera #10',
      'Liga U-12 (varonil)',
      'Ñ',
      '2026',
    ])
      expect(catalogName(name, 'El nombre')).toBe(name);
    expect(catalogName('  Cancha   Sur ', 'El nombre')).toBe('Cancha Sur');
    for (const name of ['---', '#!', '\u0007'])
      expect(() => catalogName(name, 'El nombre')).toThrow(
        'El nombre debe incluir letras o números.',
      );
    expect(catalogNameValidator({ value: 'Sub-10' })).toBeNull();
    expect(catalogNameValidator({ value: '***' })).toEqual({ catalogName: true });
  });

  it('e-mails: optional when empty, trimmed, and the form accepts exactly what the service accepts', () => {
    for (const input of [' ana@example.com ', 'a.b+c@escuela.mx']) {
      expect(optionalEmail(input)).not.toBeNull();
      expect(emailValidator({ value: input })).toBeNull();
    }
    for (const input of ['ana@example', 'ana example@x.com', 'ana@', '@x.com']) {
      expect(() => optionalEmail(input)).toThrow(EMAIL_MESSAGE);
      expect(emailValidator({ value: input })).toEqual({ email: true });
    }
    expect(optionalEmail('   ')).toBeNull();
    expect(emailValidator({ value: '   ' })).toBeNull();
  });

  it('accepts only exact catalog values and real booleans (arguments come from the browser)', () => {
    const labels = { ACTIVO: 'Activo', BAJA: 'Baja' };
    expect(oneOf('ACTIVO', labels, 'Selecciona un estatus válido.')).toBe('ACTIVO');
    expect(oneOf('BECA', ['DESCUENTO', 'BECA'], 'Selecciona un tipo de competencia válido.')).toBe(
      'BECA',
    );
    for (const bad of ['XX', 'activo', 'toString', '__proto__', ['ACTIVO'], null, 1, {}])
      expect(() => oneOf(bad, labels, 'Selecciona un estatus válido.')).toThrow(
        'Selecciona un estatus válido.',
      );
    expect(() =>
      oneOf(['BECA'], ['DESCUENTO', 'BECA'], 'Selecciona un tipo de competencia válido.'),
    ).toThrow('Selecciona un tipo de competencia válido.');
    expect(flag(true, 'x')).toBe(true);
    expect(flag(false, 'x')).toBe(false);
    for (const bad of ['false', 'true', '', 0, 1, null, undefined, [], {}])
      expect(() => flag(bad, 'Valor inválido.')).toThrow('Valor inválido.');
  });
});

describe('focusFirstInvalid (after a rejected submit)', () => {
  let form: HTMLFormElement;
  const field = (name: string) => form.querySelector<HTMLElement>(`[name=${name}]`)!;
  function render(html: string): void {
    form = document.createElement('form');
    form.innerHTML = html;
    document.body.append(form);
  }
  afterEach(() => form.remove());

  it('focuses the first invalid field in document order and returns it', () => {
    render(`<input name="ok" class="ng-valid" />
      <select name="a" class="ng-invalid"></select>
      <input name="b" class="ng-invalid" />`);
    expect(focusFirstInvalid(form)).toBe(field('a'));
    expect(document.activeElement).toBe(field('a'));
  });

  it('a valid form leaves the focus where it is', () => {
    render(`<input name="a" class="ng-valid" />`);
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    expect(focusFirstInvalid(form)).toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('skips disabled, hidden, undisplayed and inert fields', () => {
    render(`<input name="disabled" class="ng-invalid" disabled />
      <fieldset disabled><input name="inDisabledSet" class="ng-invalid" /></fieldset>
      <input name="typeHidden" type="hidden" class="ng-invalid" />
      <div hidden><input name="inHidden" class="ng-invalid" /></div>
      <div style="display: none"><input name="undisplayed" class="ng-invalid" /></div>
      <input name="invisible" style="visibility: hidden" class="ng-invalid" />
      <div inert><input name="inert" class="ng-invalid" /></div>
      <textarea name="target" class="ng-invalid"></textarea>`);
    expect(focusFirstInvalid(form)).toBe(field('target'));
  });

  it('nothing focusable: returns null', () => {
    render(`<div hidden><input name="a" class="ng-invalid" /></div>`);
    expect(focusFirstInvalid(form)).toBeNull();
  });
});

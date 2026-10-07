import { Cents } from '../core/models';

/**
 * Money helpers. MariaDB stores DECIMAL(12,2); the API serializes it as a decimal string ("1234.50");
 * the domain works in integer cents so sums never hit float error (0.1 + 0.2). Convert only at the edges.
 */

const DECIMAL = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

/** "1234.5" | "1234.50" | 1234.5 → 123450. Throws on anything that isn't a ≤2-decimal amount. */
export function parseMoney(value: string | number): Cents {
  const text = typeof value === 'number' ? String(value) : value.trim().replace(/,/g, '');
  const m = DECIMAL.exec(text);
  if (!m) throw new Error(`Importe inválido: ${value}`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error(`Importe inválido: ${value}`);
  return m[1] ? -cents : cents;
}

/** 123450 → "1234.50" (DECIMAL(12,2) wire format). */
export function toDecimal(cents: Cents): string {
  assertCents(cents);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function assertCents(cents: number): asserts cents is Cents {
  if (!Number.isSafeInteger(cents))
    throw new Error('El importe debe expresarse en centavos enteros.');
}

export function sumCents(values: Cents[]): Cents {
  return values.reduce((sum, v) => {
    assertCents(v);
    return sum + v;
  }, 0);
}

/** DECIMAL(12,2) upper bound: 9,999,999,999.99. */
export const MAX_CENTS: Cents = 999_999_999_999;

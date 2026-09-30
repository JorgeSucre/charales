import { Pipe, PipeTransform } from '@angular/core';

const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

/** Formats integer cents as MXN. */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(cents: number | null | undefined): string {
    return cents == null ? '' : MXN.format(cents / 100);
  }
}

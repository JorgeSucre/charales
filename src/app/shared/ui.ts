import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Page } from './page';
import { Submission } from './submission';
import { parseMoney } from './money';
import { Cents } from '../core/models';

/** Result message of a Submission (success or the service's error). */
@Component({
  selector: 'app-submission-alert',
  template: `
    @if (submission().result(); as r) {
      <p class="alert" [class.ok]="r.ok" [class.error]="!r.ok" role="status">{{ r.text }}</p>
    }
  `,
})
export class SubmissionAlert {
  readonly submission = input.required<Submission>();
}

/** Previous/next pager for Page<T> results (HU-014.3, HU-075.1). */
@Component({
  selector: 'app-paginator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (page(); as p) {
      <nav class="pager" aria-label="Paginación">
        <button
          type="button"
          class="secondary"
          [disabled]="p.page <= 1"
          (click)="go.emit(p.page - 1)"
        >
          Anterior
        </button>
        <span>Página {{ p.page }} de {{ pages(p) }} · {{ p.total }} resultado(s)</span>
        <button
          type="button"
          class="secondary"
          [disabled]="p.page >= pages(p)"
          (click)="go.emit(p.page + 1)"
        >
          Siguiente
        </button>
      </nav>
    }
  `,
})
export class Paginator {
  readonly page = input.required<Page<unknown> | undefined>();
  readonly go = output<number>();

  pages(p: Page<unknown>): number {
    return Math.max(1, Math.ceil(p.total / p.pageSize));
  }
}

/** Amount typed in a MXN form field → integer cents, converted through its 2-decimal string (no float math). */
export function centsFromInput(value: number | string | null): Cents {
  if (value === null || value === '') return 0;
  return parseMoney(typeof value === 'number' ? value.toFixed(2) : value);
}

/** Select value ('' or a numeric string) → Id | null. */
export function idOrNull(value: string | number | null | undefined): number | null {
  return value === '' || value === null || value === undefined ? null : Number(value);
}

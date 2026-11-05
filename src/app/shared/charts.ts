import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Chart colours (styles.css `--chart-*`), one meaning everywhere (docs/DEVELOPMENT.md § 5.3): brand = main series,
 * ok = done / active, warn = pending, warnSoft = partly done, danger = overdue / definitive leave, neutral = secondary.
 */
export type ChartTone = 'brand' | 'ok' | 'warn' | 'warnSoft' | 'danger' | 'neutral';

export interface ChartLink {
  path: string;
  query?: Record<string, string>;
}

export interface DonutSegment {
  label: string;
  value: number;
  tone: ChartTone;
  link?: ChartLink;
}

export interface Bar {
  label: string;
  value: number;
  /** Scale of this row; defaults to the largest value of the chart. */
  max?: number;
  /** What the row says in words (value with its unit, capacity…); the bar is only a picture of it. */
  text: string;
  tone: ChartTone;
  link?: ChartLink;
}

const percent = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);

/**
 * Proportions of a whole (e.g. players by status). The legend always prints label, value and percentage, so colour is
 * never the only cue; the SVG carries the same summary as its accessible name. With a zero total it says so.
 */
@Component({
  selector: 'app-donut',
  imports: [RouterLink],
  template: `
    @if (total()) {
      <div class="donut">
        <svg viewBox="0 0 42 42" role="img" [attr.aria-label]="summary()">
          <circle class="donut-track" cx="21" cy="21" r="15.915" />
          @for (s of arcs(); track s.label) {
            <circle
              [class]="'donut-arc chart-' + s.tone"
              cx="21"
              cy="21"
              r="15.915"
              [attr.stroke-dasharray]="s.dash"
              [attr.stroke-dashoffset]="s.offset"
            />
          }
          <text x="21" y="20" class="donut-total">{{ total() }}</text>
          <text x="21" y="26" class="donut-unit">{{ unit() }}</text>
        </svg>
        <ul class="chart-legend">
          @for (s of segments(); track s.label) {
            <li>
              <span [class]="'swatch chart-' + s.tone" aria-hidden="true"></span>
              @if (s.link) {
                <a [routerLink]="s.link.path" [queryParams]="s.link.query">{{ s.label }}</a>
              } @else {
                <span>{{ s.label }}</span>
              }
              <span
                >: <strong>{{ s.value }}</strong
                ><span class="muted"> ({{ pct(s.value) }} %)</span></span
              >
            </li>
          }
        </ul>
      </div>
    } @else {
      <p class="muted chart-empty">{{ empty() }}</p>
    }
  `,
})
export class DonutChart {
  readonly segments = input.required<DonutSegment[]>();
  /** Word for the total in the centre («jugadores»). */
  readonly unit = input('');
  readonly empty = input('Sin datos para mostrar.');
  protected total = computed(() => this.segments().reduce((s, x) => s + x.value, 0));
  /** Circumference 100 (r = 15.915): each arc is its percentage; the offset starts at 12 o'clock. */
  protected arcs = computed(() => {
    let done = 0;
    return this.segments()
      .filter((s) => s.value > 0)
      .map((s) => {
        const share = (s.value / this.total()) * 100;
        const arc = { ...s, dash: `${share} ${100 - share}`, offset: 25 - done };
        done += share;
        return arc;
      });
  });
  protected summary = computed(
    () =>
      `${this.total()} ${this.unit()}: ` +
      this.segments()
        .map((s) => `${s.label} ${s.value} (${this.pct(s.value)} %)`)
        .join(', '),
  );

  protected pct(value: number): number {
    return percent(value, this.total());
  }
}

/**
 * Horizontal bars to compare quantities (income per month, occupancy, charges by status). A list: each row is
 * readable as text (label + `text`), the bar is decorative. An empty list or an all-zero chart says so.
 */
@Component({
  selector: 'app-bars',
  imports: [RouterLink],
  template: `
    @if (rows().length && hasData()) {
      <ul class="bars" [attr.aria-label]="label()">
        @for (r of rows(); track r.label) {
          <li>
            <span class="bar-label">
              @if (r.link) {
                <a [routerLink]="r.link.path" [queryParams]="r.link.query">{{ r.label }}</a>
              } @else {
                {{ r.label }}
              }
            </span>
            <span class="bar-track" aria-hidden="true">
              <span [class]="'bar-fill chart-' + r.tone" [style.width.%]="width(r)"></span>
            </span>
            <span class="bar-text"><span class="sr-only">: </span>{{ r.text }}</span>
          </li>
        }
      </ul>
    } @else {
      <p class="muted chart-empty">{{ empty() }}</p>
    }
  `,
})
export class BarChart {
  readonly rows = input.required<Bar[]>();
  /** Accessible name of the list («Ingresos por mes»). */
  readonly label = input.required<string>();
  readonly empty = input('Sin datos para mostrar.');
  /** false: show the rows even when every value is 0 (e.g. categories with nobody yet). */
  readonly hideZeros = input(true);
  private largest = computed(() => Math.max(0, ...this.rows().map((r) => r.value)));
  protected hasData = computed(() => !this.hideZeros() || this.largest() > 0);

  /** Share of its own scale, capped at 100 % (over capacity stays full; the text says the real figure). */
  protected width(r: Bar): number {
    const max = r.max ?? this.largest();
    if (max <= 0) return r.value > 0 ? 100 : 0;
    return Math.min(100, (r.value / max) * 100);
  }
}

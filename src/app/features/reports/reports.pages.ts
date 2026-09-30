import { Component, computed, inject, resource, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { today } from '../../shared/dates';
import { ReportService } from './report.service';

/** HU-067 */
@Component({
  selector: 'app-income-report-page',
  imports: [FormsModule, LoadState, MoneyPipe],
  template: `
    <h1>Ingresos por periodo y concepto</h1>
    <div class="filters">
      <label
        >Desde <input type="date" [ngModel]="from()" (ngModelChange)="from.set($event)"
      /></label>
      <label>Hasta <input type="date" [ngModel]="to()" (ngModelChange)="to.set($event)" /></label>
    </div>
    <app-load-state
      [res]="income"
      [empty]="!income.value()?.length"
      emptyText="Sin ingresos en el periodo."
    >
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mes</th>
              <th>Concepto</th>
              <th class="num">Total</th>
            </tr>
          </thead>
          <tbody>
            @for (r of income.value() ?? []; track r.month + r.conceptName) {
              <tr>
                <td>{{ r.month }}</td>
                <td>{{ r.conceptName }}</td>
                <td class="num">{{ r.totalCents | money }}</td>
              </tr>
            }
          </tbody>
          <tfoot>
            <tr>
              <th colspan="2">Total</th>
              <th class="num">{{ total() | money }}</th>
            </tr>
          </tfoot>
        </table>
      </div>
    </app-load-state>
  `,
})
export class IncomeReportPage {
  private service = inject(ReportService);
  protected from = signal(`${today().slice(0, 4)}-01-01`);
  protected to = signal(today());
  protected income = resource({
    params: () => ({ from: this.from(), to: this.to() }),
    loader: ({ params }) => this.service.income(params.from, params.to),
  });
  protected total = computed(() =>
    (this.income.value() ?? []).reduce((sum, r) => sum + r.totalCents, 0),
  );
}

/** HU-068: global agenda of trainings and matches, filterable. */
@Component({
  selector: 'app-agenda-page',
  imports: [FormsModule, LoadState, DatePipe],
  template: `
    <h1>Agenda</h1>
    <div class="filters">
      <label
        >Tipo
        <select [ngModel]="kind()" (ngModelChange)="kind.set($event)">
          <option value="">Todos</option>
          <option value="training">Entrenamientos</option>
          <option value="match">Partidos</option>
        </select>
      </label>
      <label
        >Categoría
        <select [ngModel]="category()" (ngModelChange)="category.set($event)">
          <option value="">Todas</option>
          @for (c of categories(); track c[0]) {
            <option [value]="c[0]">{{ c[1] }}</option>
          }
        </select>
      </label>
    </div>
    <app-load-state [res]="agenda" [empty]="!filtered().length" emptyText="Sin eventos.">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fecha y hora</th>
              <th>Tipo</th>
              <th>Categoría</th>
              <th>Detalle</th>
              <th>Entrenador</th>
              <th>Sede</th>
            </tr>
          </thead>
          <tbody>
            @for (e of filtered(); track $index) {
              <tr>
                <td>{{ e.startsAt | date: 'EEE d MMM, HH:mm' }}</td>
                <td>{{ e.kind === 'match' ? 'Partido' : 'Entrenamiento' }}</td>
                <td>{{ e.categoryName }}</td>
                <td>{{ e.detail }}</td>
                <td>{{ e.coachName }}</td>
                <td>{{ e.venueName }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </app-load-state>
  `,
})
export class AgendaPage {
  private service = inject(ReportService);
  protected agenda = resource({ loader: () => this.service.agenda() });
  protected kind = signal('');
  protected category = signal('');
  protected categories = computed(() => [
    ...new Map((this.agenda.value() ?? []).map((e) => [e.categoryId, e.categoryName])),
  ]);
  protected filtered = computed(() =>
    (this.agenda.value() ?? []).filter(
      (e) =>
        (!this.kind() || e.kind === this.kind()) &&
        (!this.category() || e.categoryId === this.category()),
    ),
  );
}

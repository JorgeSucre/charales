import { Component, inject, resource, signal } from '@angular/core';
import { LoadState } from '../../shared/load-state';
import { CategoryService } from '../../core/services/category.service';

/** HU-018 */
@Component({
  selector: 'app-category-players-page',
  imports: [LoadState],
  template: `
    <h1>Jugadores por categoría</h1>
    <label
      >Categoría
      <select #sel (change)="categoryId.set(sel.value)">
        <option value="">Selecciona…</option>
        @for (c of categories.value() ?? []; track c.id) {
          <option [value]="c.id">{{ c.name }} ({{ c.birthYearFrom }}–{{ c.birthYearTo }})</option>
        }
      </select>
    </label>
    @if (categoryId()) {
      <app-load-state
        [res]="players"
        [empty]="!players.value()?.length"
        emptyText="Sin jugadores inscritos en esta categoría."
      >
        <p class="muted">{{ players.value()?.length }} jugador(es)</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Fecha de nacimiento</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              @for (p of players.value() ?? []; track p.id) {
                <tr>
                  <td>{{ p.fullName }}</td>
                  <td>{{ p.birthDate }}</td>
                  <td>
                    <span class="tag" [class.off]="!p.active">{{
                      p.active ? 'Activo' : 'Inactivo'
                    }}</span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </app-load-state>
    }
  `,
})
export class CategoryPlayersPage {
  private service = inject(CategoryService);
  protected categories = resource({ loader: () => this.service.list() });
  protected categoryId = signal('');
  protected players = resource({
    params: () => this.categoryId() || undefined,
    loader: ({ params }) => this.service.players(params),
  });
}

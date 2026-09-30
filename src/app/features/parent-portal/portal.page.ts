import { Component, inject, resource } from '@angular/core';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { PortalService } from './portal.service';

/** HU-056 (uniforms) and HU-063 (competitions) for the logged-in tutor's children only. */
@Component({
  selector: 'app-portal-page',
  imports: [LoadState, MoneyPipe],
  template: `
    <h1>Mis hijos</h1>
    <app-load-state
      [res]="children"
      [empty]="!children.value()?.length"
      emptyText="No hay jugadores vinculados a tu cuenta."
    >
      <ul class="chips">
        @for (c of children.value() ?? []; track c.id) {
          <li>{{ c.fullName }}</li>
        }
      </ul>
    </app-load-state>

    <h2>Torneos y ligas</h2>
    <app-load-state
      [res]="competitions"
      [empty]="!competitions.value()?.length"
      emptyText="Sin torneos asignados."
    >
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Jugador</th>
              <th>Categoría</th>
              <th>Competencia</th>
              <th>Tipo</th>
            </tr>
          </thead>
          <tbody>
            @for (c of competitions.value() ?? []; track $index) {
              <tr>
                <td>{{ c.playerName }}</td>
                <td>{{ c.categoryName }}</td>
                <td>{{ c.competitionName }}</td>
                <td>{{ c.kind === 'league' ? 'Liga' : 'Torneo' }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </app-load-state>

    <h2>Uniformes solicitados</h2>
    <app-load-state
      [res]="orders"
      [empty]="!orders.value()?.length"
      emptyText="Sin pedidos de uniforme."
    >
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Jugador</th>
              <th>Artículos</th>
              <th class="num">Total</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            @for (o of orders.value() ?? []; track o.id) {
              <tr>
                <td>{{ o.createdAt }}</td>
                <td>{{ o.playerName }}</td>
                <td>{{ o.items.join(', ') }}</td>
                <td class="num">{{ o.totalCents | money }}</td>
                <td>{{ o.status === 'delivered' ? 'Entregado' : 'Pendiente' }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </app-load-state>
  `,
})
export class PortalPage {
  private service = inject(PortalService);
  protected children = resource({ loader: () => this.service.children() });
  protected competitions = resource({ loader: () => this.service.competitions() });
  protected orders = resource({ loader: () => this.service.uniformOrders() });
}

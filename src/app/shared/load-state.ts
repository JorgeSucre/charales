import { Component, ResourceRef, input } from '@angular/core';

/** Loading / error / empty wrapper for a resource(). Projects its content only when there is data. */
@Component({
  selector: 'app-load-state',
  template: `
    @if (res().error()) {
      <p class="alert error" role="alert">
        No se pudo cargar la información.
        <button type="button" class="link" (click)="res().reload()">Reintentar</button>
      </p>
    } @else if (res().isLoading() && !res().hasValue()) {
      <p class="muted" role="status">Cargando…</p>
    } @else if (empty()) {
      <p class="muted">{{ emptyText() }}</p>
    } @else {
      <ng-content />
    }
  `,
})
export class LoadState {
  readonly res = input.required<ResourceRef<unknown>>();
  readonly empty = input(false);
  readonly emptyText = input('No hay registros.');
}

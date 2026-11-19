import {
  ChangeDetectionStrategy,
  Component,
  ResourceRef,
  TemplateRef,
  computed,
  contentChild,
  input,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

/**
 * Loading / error / empty wrapper for a resource(). The content goes in an <ng-template> so it is only evaluated
 * when there is data: resource.value() throws while the resource is in error, and projected content would otherwise
 * still be evaluated by the parent.
 *
 *   <app-load-state [res]="rows"><ng-template> …rows.value()… </ng-template></app-load-state>
 *
 * Empty is detected for arrays and Page<T>; pass [empty] for anything else.
 */
@Component({
  selector: 'app-load-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  template: `
    @if (res().error()) {
      <p class="alert error" role="alert">
        <span>No se pudo cargar la información: {{ message() }}</span>
        <button type="button" class="secondary sm" (click)="res().reload()">Reintentar</button>
      </p>
    } @else if (!res().hasValue()) {
      <div class="load-skeleton" role="status" aria-label="Cargando">
        <div class="skeleton-line head" aria-hidden="true"></div>
        <div class="skeleton-line" aria-hidden="true"></div>
        <div class="skeleton-line short" aria-hidden="true"></div>
        <span class="sr-only">Cargando…</span>
      </div>
    } @else if (isEmpty()) {
      <p class="muted empty">{{ emptyText() }}</p>
      <div class="empty-action"><ng-content select="[empty-action]" /></div>
    } @else {
      <ng-container [ngTemplateOutlet]="content()" />
    }
  `,
})
export class LoadState {
  readonly res = input.required<ResourceRef<unknown>>();
  readonly empty = input<boolean | undefined>(undefined);
  readonly emptyText = input('No hay registros.');
  protected content = contentChild.required(TemplateRef);

  protected message = computed(() => {
    const e = this.res().error();
    return e instanceof Error ? e.message : 'error desconocido';
  });

  protected isEmpty = computed(() => {
    const explicit = this.empty();
    if (explicit !== undefined) return explicit;
    const v = this.res().value() as unknown;
    if (Array.isArray(v)) return v.length === 0;
    if (v && typeof v === 'object' && 'items' in v && Array.isArray(v.items))
      return v.items.length === 0;
    return v == null;
  });
}

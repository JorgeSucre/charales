import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';

export interface PromptOptions {
  title: string;
  message?: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  confirmText?: string;
  cancelText?: string;
  required?: boolean;
  tone?: 'primary' | 'danger';
  maxLength?: number;
}

let nextPromptId = 0;

/**
 * Accessible text-input modal built on native <dialog> to replace browser window.prompt().
 * Captures and restores focus automatically, validates required text inline, and closes on
 * Escape or backdrop click (with a JSDOM-compatible fallback when showModal() is absent).
 */
@Component({
  selector: 'app-prompt-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialog
      class="prompt-dialog"
      aria-modal="true"
      [attr.aria-labelledby]="titleId"
      [attr.aria-describedby]="opts().message ? descId : null"
      (cancel)="onCancel($event)"
      (click)="onBackdropClick($event)"
      (keydown.escape)="onEscape($event)"
    >
      <form class="dialog-card" (submit)="onSubmit($event)" novalidate>
        <div class="dialog-head">
          <h2 [id]="titleId">{{ opts().title }}</h2>
          <button
            type="button"
            class="dialog-close"
            (click)="dismiss()"
            aria-label="Cerrar diálogo"
          >
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        @if (opts().message; as msg) {
          <p class="dialog-desc" [id]="descId">{{ msg }}</p>
        }

        <label>
          {{ opts().label }}
          <input
            #input
            type="text"
            [value]="value()"
            (input)="onInput($event)"
            [placeholder]="opts().placeholder ?? ''"
            [attr.maxlength]="opts().maxLength ?? null"
            [attr.aria-invalid]="error() ? 'true' : null"
            [attr.aria-describedby]="error() ? errId : null"
            autocomplete="off"
          />
        </label>
        @if (error(); as err) {
          <small class="field-error" role="alert" [id]="errId">{{ err }}</small>
        }

        <div class="dialog-actions">
          <button type="button" class="secondary" (click)="dismiss()">
            {{ opts().cancelText ?? 'Cancelar' }}
          </button>
          <button type="submit" [class.danger]="opts().tone === 'danger'">
            {{ opts().confirmText ?? 'Confirmar' }}
          </button>
        </div>
      </form>
    </dialog>
  `,
})
export class PromptDialog implements OnDestroy {
  private readonly uid = ++nextPromptId;
  protected readonly titleId = `prompt-title-${this.uid}`;
  protected readonly descId = `prompt-desc-${this.uid}`;
  protected readonly errId = `prompt-err-${this.uid}`;

  private readonly dialogRef = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly inputRef = viewChild.required<ElementRef<HTMLInputElement>>('input');

  protected readonly opts = signal<PromptOptions>({ title: '', label: '' });
  protected readonly value = signal('');
  protected readonly error = signal<string | null>(null);

  private pendingResolve: ((value: string | null) => void) | null = null;
  private returnFocus: HTMLElement | null = null;

  open(options: PromptOptions): Promise<string | null> {
    if (this.pendingResolve) this.finish(null);

    this.returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.opts.set({
      confirmText: 'Confirmar',
      cancelText: 'Cancelar',
      required: true,
      tone: 'primary',
      ...options,
    });
    this.value.set(options.initialValue ?? '');
    this.error.set(null);

    const dialog = this.dialogRef().nativeElement;
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }

    setTimeout(() => {
      const input = this.inputRef().nativeElement;
      if (input.isConnected) {
        input.focus();
        input.select();
      }
    });

    return new Promise<string | null>((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  dismiss(): void {
    this.finish(null);
  }

  ngOnDestroy(): void {
    if (this.pendingResolve) {
      this.pendingResolve(null);
      this.pendingResolve = null;
    }
  }

  protected onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
    if (this.error()) this.error.set(null);
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    const trimmed = this.value().trim();
    if (this.opts().required !== false && !trimmed) {
      this.error.set('Este campo es obligatorio.');
      this.inputRef().nativeElement.focus();
      return;
    }
    this.finish(trimmed);
  }

  protected onCancel(event: Event): void {
    event.preventDefault();
    this.finish(null);
  }

  protected onEscape(event: Event): void {
    event.preventDefault();
    this.finish(null);
  }

  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === this.dialogRef().nativeElement) this.finish(null);
  }

  private finish(result: string | null): void {
    const dialog = this.dialogRef().nativeElement;
    if (typeof dialog.showModal === 'function' && typeof dialog.close === 'function') {
      if (dialog.open) dialog.close();
    } else {
      dialog.removeAttribute('open');
    }

    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back?.isConnected) setTimeout(() => back.focus());
    resolve?.(result);
  }
}

import { signal } from '@angular/core';

export const DISCARD_MESSAGE = 'Hay cambios sin guardar. ¿Descartarlos?';

/**
 * List-first CRUD pages (docs/DEVELOPMENT.md § 5.2): the create/edit form stays closed until the user asks for it.
 * Opening moves the focus to its first field; closing gives the focus back to what opened it. Closing a form with
 * unsaved changes (`dirty`) asks first; an untouched form closes silently.
 */
export class FormPanel {
  readonly open = signal(false);
  private returnTo: HTMLElement | null = null;

  /** `formId`: id of the panel's <form>. `dirty`: whether it holds changes the user would lose. */
  constructor(
    private readonly formId: string,
    private readonly dirty: () => boolean = () => false,
  ) {}

  /** Opens the panel (or keeps it open) and focuses its first field. */
  show(): void {
    if (!this.open()) this.returnTo = document.activeElement as HTMLElement | null;
    this.open.set(true);
    setTimeout(() =>
      document
        .getElementById(this.formId)
        ?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea')
        ?.focus(),
    );
  }

  /** Closes it unless the user keeps unsaved changes. Returns whether it closed (true if it was closed). */
  close(): boolean {
    if (!this.open()) return true;
    if (this.dirty() && !confirm(DISCARD_MESSAGE)) return false;
    this.done();
    return true;
  }

  /** Closes without asking: the changes were saved. */
  done(): void {
    this.open.set(false);
    const back = this.returnTo;
    this.returnTo = null;
    setTimeout(() => back?.isConnected && back.focus());
  }
}

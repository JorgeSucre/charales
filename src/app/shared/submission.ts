import { signal } from '@angular/core';

/** Busy + result state for a form submit or action. Errors thrown by services become the message. */
export class Submission {
  readonly busy = signal(false);
  readonly result = signal<{ ok: boolean; text: string } | null>(null);

  async run<T>(
    action: () => Promise<T>,
    success: string | ((result: T) => string),
  ): Promise<boolean> {
    this.busy.set(true);
    this.result.set(null);
    try {
      const result = await action();
      this.result.set({ ok: true, text: typeof success === 'string' ? success : success(result) });
      return true;
    } catch (e) {
      this.result.set({ ok: false, text: e instanceof Error ? e.message : 'Ocurrió un error.' });
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}

export const today = () => new Date().toISOString().slice(0, 10);

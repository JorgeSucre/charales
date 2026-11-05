import { Injectable, signal } from '@angular/core';

/** A notice for the user that doesn't belong to any page: the shell shows it until it is closed. */
@Injectable({ providedIn: 'root' })
export class AppNotice {
  readonly message = signal<string | null>(null);

  show(message: string): void {
    this.message.set(message);
  }

  clear(): void {
    this.message.set(null);
  }
}

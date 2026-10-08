import { Injectable, inject } from '@angular/core';
import { MockDb } from '../data/mock-db';
import { nowDateTime } from '../../shared/dates';

/**
 * E-mail port. The mock writes to MockDb.outbox and the console; the backend sends real mail (reset links,
 * portal invitations). Callers never learn whether the address exists.
 */
@Injectable({ providedIn: 'root' })
export class MailerService {
  private db = inject(MockDb);

  send(to: string, subject: string, body: string): void {
    this.db.outbox.push({ to, subject, body, sentAt: nowDateTime() });
    console.info(`[correo simulado] para ${to}: ${subject}\n${body}`);
  }
}

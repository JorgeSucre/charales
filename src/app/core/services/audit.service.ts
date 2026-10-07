import { Injectable, inject } from '@angular/core';
import { SessionStore } from '../auth/session.store';
import { MockDb } from '../data/mock-db';
import { AuditAction, AuditEntry, DateTime, Id } from '../models';
import { nowDateTime } from '../../shared/dates';
import { Page, paginate } from '../../shared/page';

export interface AuditFilter {
  userId?: Id | null;
  module?: string;
  from?: string; // DATE
  to?: string; // DATE
  page?: number;
}

export interface AuditView extends AuditEntry {
  userEmail: string;
}

/**
 * auditoria (HU-007). Append-only: services call log() inside their write; nothing updates or deletes entries.
 * The backend writes the same rows in the same transaction as the change they describe.
 */
@Injectable({ providedIn: 'root' })
export class AuditService {
  private db = inject(MockDb);
  private session = inject(SessionStore);

  /** usuarios.id of the logged-in user, for *_por columns (cambiado_por, registrado_por…). */
  currentUserId(): Id | null {
    return this.session.user()?.userId ?? null;
  }

  log(
    action: AuditAction,
    module: string,
    entity: string | null,
    entityId: Id | null,
    description: string,
    before: unknown = null,
    after: unknown = null,
    userId: Id | null = this.session.user()?.userId ?? null,
  ): void {
    this.db.insert(this.db.audit, {
      userId,
      action,
      module,
      entity,
      entityId,
      description,
      before: before === null ? null : structuredClone(before),
      after: after === null ? null : structuredClone(after),
      ip: null,
      createdAt: nowDateTime(),
    });
  }

  /** Newest first, filtered by user, module and date range, paginated. */
  list(filter: AuditFilter = {}): Promise<Page<AuditView>> {
    const inRange = (at: DateTime) =>
      (!filter.from || at.slice(0, 10) >= filter.from) &&
      (!filter.to || at.slice(0, 10) <= filter.to);
    const rows = this.db.audit
      .filter(
        (a) =>
          (filter.userId == null || a.userId === filter.userId) &&
          (!filter.module || a.module === filter.module) &&
          inRange(a.createdAt),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
      .map((a) => ({
        ...a,
        userEmail: this.db.users.find((u) => u.id === a.userId)?.email ?? '—',
      }));
    return this.db.respond(paginate(rows, filter.page));
  }

  modules(): Promise<string[]> {
    return this.db.respond(
      [...new Set(this.db.audit.map((a) => a.module ?? ''))].filter(Boolean).sort(),
    );
  }
}

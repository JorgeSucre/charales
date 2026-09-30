import { Injectable, inject } from '@angular/core';
import { MockDb } from '../../core/data/mock-db';
import { Category, Player } from '../../core/models';

/** Category CRUD belongs to another team member; this covers HU-018 (players by category). */
@Injectable({ providedIn: 'root' })
export class CategoryService {
  private db = inject(MockDb);

  list(): Promise<Category[]> {
    return this.db.respond(this.db.categories);
  }

  playersByCategory(categoryId: string): Promise<Player[]> {
    const ids = new Set(
      this.db.enrollments
        .filter((e) => e.categoryId === categoryId && e.status === 'active')
        .map((e) => e.playerId),
    );
    return this.db.respond(
      this.db.players
        .filter((p) => ids.has(p.id))
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    );
  }
}

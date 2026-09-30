import { Injectable, inject } from '@angular/core';
import { MockDb } from '../data/mock-db';
import { Category, Player } from '../models';

/**
 * Shared read-only access to categories and their members (PlayerCategory).
 * Category CRUD and assigning players to categories belong to other team members.
 */
@Injectable({ providedIn: 'root' })
export class CategoryService {
  private db = inject(MockDb);

  list(): Promise<Category[]> {
    return this.db.respond(this.db.categories);
  }

  /** HU-018: current members (open PlayerCategory rows) of a category, by name. */
  players(categoryId: string): Promise<Player[]> {
    const ids = new Set(
      this.db.playerCategories
        .filter((pc) => pc.categoryId === categoryId && !pc.endDate)
        .map((pc) => pc.playerId),
    );
    return this.db.respond(
      this.db.players
        .filter((p) => ids.has(p.id))
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    );
  }
}

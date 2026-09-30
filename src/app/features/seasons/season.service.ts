import { Injectable, inject } from '@angular/core';
import { MockDb } from '../../core/data/mock-db';
import { Season } from '../../core/models';

@Injectable({ providedIn: 'root' })
export class SeasonService {
  private db = inject(MockDb);

  list(): Promise<Season[]> {
    return this.db.respond(this.db.seasons);
  }

  /** Saving a season as active deactivates the others (only one active season). */
  async save(draft: Omit<Season, 'id'> & { id?: string }): Promise<Season> {
    if (draft.endDate <= draft.startDate)
      throw new Error('La fecha de fin debe ser posterior al inicio.');
    const season: Season = { ...draft, id: draft.id ?? this.db.id('s') };
    const others = this.db.seasons
      .filter((s) => s.id !== season.id)
      .map((s) => (season.active ? { ...s, active: false } : s));
    this.db.seasons = [...others, season].sort((a, b) => b.startDate.localeCompare(a.startDate));
    return this.db.respond(season);
  }
}

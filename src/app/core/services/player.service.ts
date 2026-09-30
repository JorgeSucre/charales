import { Injectable, inject } from '@angular/core';
import { MockDb } from '../data/mock-db';
import { Player } from '../models';

/**
 * Read-only shared access to players. Player registration/editing (HU-008..010) belongs to
 * another team member; this exists only so Borrayo's features can list/select players.
 */
@Injectable({ providedIn: 'root' })
export class PlayerService {
  private db = inject(MockDb);

  list(): Promise<Player[]> {
    return this.db.respond(this.db.players);
  }
}

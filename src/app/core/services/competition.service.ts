import { Injectable, inject } from '@angular/core';
import { MockDb } from '../data/mock-db';
import { Competition } from '../models';

/** Shared read-only access to tournaments/leagues. Competition CRUD belongs to another team member. */
@Injectable({ providedIn: 'root' })
export class CompetitionService {
  private db = inject(MockDb);

  list(): Promise<Competition[]> {
    return this.db.respond(this.db.competitions);
  }
}

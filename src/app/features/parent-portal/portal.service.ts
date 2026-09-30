import { Injectable, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { MockDb } from '../../core/data/mock-db';
import { Competition, Player } from '../../core/models';
import { OrderView, UniformService } from '../uniforms/uniform.service';

export interface ChildCompetition {
  playerName: string;
  categoryName: string;
  competitionName: string;
  kind: Competition['kind'];
}

/**
 * Everything the tutor sees is scoped to the logged-in tutor's children.
 * The backend must enforce the same scoping from the token — never trust the client.
 */
@Injectable({ providedIn: 'root' })
export class PortalService {
  private db = inject(MockDb);
  private auth = inject(AuthService);
  private uniforms = inject(UniformService);

  private childIds(): string[] {
    const tutorId = this.auth.user()?.tutorId;
    return this.db.tutors.find((t) => t.id === tutorId)?.playerIds ?? [];
  }

  children(): Promise<Player[]> {
    const ids = this.childIds();
    return this.db.respond(this.db.players.filter((p) => ids.includes(p.id)));
  }

  // HU-056
  uniformOrders(): Promise<OrderView[]> {
    return this.uniforms.orders(this.childIds());
  }

  // HU-063: child → current category (PlayerCategory) → competitions that category is assigned to.
  competitions(): Promise<ChildCompetition[]> {
    const { db } = this;
    const children = this.childIds();
    const rows = db.playerCategories
      .filter((pc) => !pc.endDate && children.includes(pc.playerId))
      .flatMap((pc) => {
        const competitionIds = new Set(
          db.coachAssignments
            .filter((a) => a.categoryId === pc.categoryId)
            .map((a) => a.competitionId),
        );
        return db.competitions
          .filter((c) => competitionIds.has(c.id))
          .map((c) => ({
            playerName: db.players.find((p) => p.id === pc.playerId)?.fullName ?? '—',
            categoryName: db.categories.find((cat) => cat.id === pc.categoryId)?.name ?? '—',
            competitionName: c.name,
            kind: c.kind,
          }));
      });
    return db.respond(rows);
  }
}

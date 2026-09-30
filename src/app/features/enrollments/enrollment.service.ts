import { Injectable, inject } from '@angular/core';
import { MockDb } from '../../core/data/mock-db';
import { Enrollment } from '../../core/models';
import { today } from '../../shared/dates';

export interface EnrollmentView extends Enrollment {
  playerName: string;
  seasonName: string;
}

/** HU-020: administrative/annual enrollment. Category membership is PlayerCategory (not managed here). */
@Injectable({ providedIn: 'root' })
export class EnrollmentService {
  private db = inject(MockDb);

  list(): Promise<EnrollmentView[]> {
    return this.db.respond(
      this.db.enrollments.map((e) => ({
        ...e,
        playerName: this.db.players.find((p) => p.id === e.playerId)?.fullName ?? '—',
        seasonName: this.db.seasons.find((s) => s.id === e.seasonId)?.name ?? '—',
      })),
    );
  }

  async enroll(draft: Pick<Enrollment, 'playerId' | 'seasonId' | 'notes'>): Promise<Enrollment> {
    if (!this.db.seasons.some((s) => s.id === draft.seasonId))
      throw new Error('Temporada no encontrada.');
    const dup = this.db.enrollments.some(
      (e) =>
        e.playerId === draft.playerId && e.seasonId === draft.seasonId && e.status === 'active',
    );
    if (dup) throw new Error('El jugador ya está inscrito en esta temporada.');
    const enrollment: Enrollment = {
      ...draft,
      id: this.db.id('e'),
      enrolledAt: today(),
      status: 'active',
    };
    this.db.enrollments = [...this.db.enrollments, enrollment];
    return this.db.respond(enrollment);
  }
}

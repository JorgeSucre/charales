import { Injectable, inject } from '@angular/core';
import { MockDb } from '../../core/data/mock-db';
import { Enrollment } from '../../core/models';

export interface EnrollmentView extends Enrollment {
  playerName: string;
  categoryName: string;
  seasonName: string;
}

@Injectable({ providedIn: 'root' })
export class EnrollmentService {
  private db = inject(MockDb);

  list(): Promise<EnrollmentView[]> {
    const name = <T extends { id: string }>(list: T[], id: string, key: keyof T) =>
      String(list.find((x) => x.id === id)?.[key] ?? '—');
    return this.db.respond(
      this.db.enrollments.map((e) => ({
        ...e,
        playerName: name(this.db.players, e.playerId, 'fullName'),
        categoryName: name(this.db.categories, e.categoryId, 'name'),
        seasonName: name(this.db.seasons, e.seasonId, 'name'),
      })),
    );
  }

  async enroll(draft: Pick<Enrollment, 'playerId' | 'categoryId' | 'notes'>): Promise<Enrollment> {
    const category = this.db.categories.find((c) => c.id === draft.categoryId);
    if (!category) throw new Error('Categoría no encontrada.');
    const dup = this.db.enrollments.some(
      (e) =>
        e.playerId === draft.playerId && e.seasonId === category.seasonId && e.status === 'active',
    );
    if (dup) throw new Error('El jugador ya está inscrito en esta temporada.');
    const enrollment: Enrollment = {
      ...draft,
      id: this.db.id('e'),
      seasonId: category.seasonId,
      enrolledAt: new Date().toISOString().slice(0, 10),
      status: 'active',
    };
    this.db.enrollments = [...this.db.enrollments, enrollment];
    return this.db.respond(enrollment);
  }
}

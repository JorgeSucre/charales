import { Injectable, inject } from '@angular/core';
import { MockDb } from '../../core/data/mock-db';
import { Coach, CoachAssignment, Competition } from '../../core/models';

export interface AssignmentView extends CoachAssignment {
  coachName: string;
  competitionName: string;
  categoryName: string;
}

/** HU-022 (coaches) and HU-026 (coach ↔ competition ↔ category). Competition CRUD is out of scope. */
@Injectable({ providedIn: 'root' })
export class CoachService {
  private db = inject(MockDb);

  list(): Promise<Coach[]> {
    return this.db.respond(this.db.coaches);
  }

  async save(draft: Omit<Coach, 'id'> & { id?: string }): Promise<Coach> {
    const coach: Coach = { ...draft, id: draft.id ?? this.db.id('c') };
    this.db.coaches = draft.id
      ? this.db.coaches.map((c) => (c.id === coach.id ? coach : c))
      : [...this.db.coaches, coach];
    return this.db.respond(coach);
  }

  competitions(): Promise<Competition[]> {
    return this.db.respond(this.db.competitions);
  }

  assignments(): Promise<AssignmentView[]> {
    return this.db.respond(
      this.db.coachAssignments.map((a) => ({
        ...a,
        coachName: this.db.coaches.find((c) => c.id === a.coachId)?.fullName ?? '—',
        competitionName: this.db.competitions.find((c) => c.id === a.competitionId)?.name ?? '—',
        categoryName: this.db.categories.find((c) => c.id === a.categoryId)?.name ?? '—',
      })),
    );
  }

  async assign(draft: Omit<CoachAssignment, 'id'>): Promise<CoachAssignment> {
    const dup = this.db.coachAssignments.some(
      (a) =>
        a.coachId === draft.coachId &&
        a.competitionId === draft.competitionId &&
        a.categoryId === draft.categoryId,
    );
    if (dup) throw new Error('Esa asignación ya existe.');
    const assignment = { ...draft, id: this.db.id('a') };
    this.db.coachAssignments = [...this.db.coachAssignments, assignment];
    return this.db.respond(assignment);
  }

  async unassign(id: string): Promise<void> {
    this.db.coachAssignments = this.db.coachAssignments.filter((a) => a.id !== id);
    await this.db.respond(null);
  }
}

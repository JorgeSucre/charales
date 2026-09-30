import { Injectable, inject } from '@angular/core';
import { MockDb } from '../../core/data/mock-db';
import { Tutor } from '../../core/models';

@Injectable({ providedIn: 'root' })
export class TutorService {
  private db = inject(MockDb);

  list(): Promise<Tutor[]> {
    return this.db.respond(this.db.tutors);
  }

  async save(draft: Omit<Tutor, 'id'> & { id?: string }): Promise<Tutor> {
    if (!draft.playerIds.length) throw new Error('Selecciona al menos un jugador.');
    const tutor: Tutor = { ...draft, id: draft.id ?? this.db.id('t') };
    this.db.tutors = draft.id
      ? this.db.tutors.map((t) => (t.id === tutor.id ? tutor : t))
      : [...this.db.tutors, tutor];
    return this.db.respond(tutor);
  }
}

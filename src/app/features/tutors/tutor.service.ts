import { Injectable, inject } from '@angular/core';
import { MockDb } from '../../core/data/mock-db';
import { Tutor } from '../../core/models';

@Injectable({ providedIn: 'root' })
export class TutorService {
  private db = inject(MockDb);

  list(): Promise<Tutor[]> {
    return this.db.respond(this.db.tutors);
  }

  /** Rejects (does not reassign) a primary contact for a player who already has one, like the DB unique index. */
  async save(draft: Omit<Tutor, 'id'> & { id?: string }): Promise<Tutor> {
    if (!draft.players.length) throw new Error('Selecciona al menos un jugador.');
    const taken = draft.players.find(
      (l) =>
        l.isPrimary &&
        this.db.tutors.some(
          (t) =>
            t.id !== draft.id && t.players.some((o) => o.playerId === l.playerId && o.isPrimary),
        ),
    );
    if (taken) {
      const name = this.db.players.find((p) => p.id === taken.playerId)?.fullName ?? 'El jugador';
      throw new Error(`${name} ya tiene un contacto principal.`);
    }
    const email = draft.email?.trim().toLowerCase() || undefined;
    const tutor: Tutor = { ...draft, email, id: draft.id ?? this.db.id('t') };
    this.db.tutors = draft.id
      ? this.db.tutors.map((t) => (t.id === tutor.id ? tutor : t))
      : [...this.db.tutors, tutor];
    return this.db.respond(tutor);
  }
}

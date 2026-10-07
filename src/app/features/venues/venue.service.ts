import { Injectable, inject } from '@angular/core';
import { MockDb } from '../../core/data/mock-db';
import { Id, Venue } from '../../core/models';
import { AuditService } from '../../core/services/audit.service';
import { nowDateTime } from '../../shared/dates';
import { optional, required } from '../../shared/validate';

export type VenueDraft = Pick<Venue, 'name' | 'location' | 'reference'>;

export interface VenueView extends Venue {
  /** Schedules, sessions and matches that use it: a venue with history is deactivated, never deleted. */
  uses: number;
}

/** HU-069: venues/pitches (sedes), shared by schedules, sessions and matches. */
@Injectable({ providedIn: 'root' })
export class VenueService {
  private db = inject(MockDb);
  private audit = inject(AuditService);

  list(onlyActive = false): Promise<VenueView[]> {
    return this.db.respond(
      this.db.venues
        .filter((v) => !onlyActive || v.active)
        .map((v) => ({
          ...v,
          uses:
            this.db.schedules.filter((s) => s.venueId === v.id).length +
            this.db.trainingSessions.filter((s) => s.venueId === v.id).length +
            this.db.matches.filter((m) => m.venueId === v.id).length,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  async save(draft: VenueDraft & { id?: Id }): Promise<Venue> {
    const data = {
      name: required(draft.name, 'El nombre', 100),
      location: optional(draft.location, 'La ubicación'),
      reference: optional(draft.reference, 'La referencia'),
    };
    if (
      this.db.venues.some(
        (v) => v.name.toLowerCase() === data.name.toLowerCase() && v.id !== draft.id,
      )
    )
      throw new Error('Ya existe una sede con ese nombre.');
    let venue: Venue;
    if (draft.id) {
      const before = this.db.get(this.db.venues, draft.id, 'Sede');
      venue = this.db.update(this.db.venues, draft.id, data);
      this.audit.log(
        'EDITAR',
        'sedes',
        'sedes',
        venue.id,
        `Edición de ${venue.name}`,
        before,
        venue,
      );
    } else {
      venue = this.db.insert(this.db.venues, { ...data, active: true, createdAt: nowDateTime() });
      this.audit.log('CREAR', 'sedes', 'sedes', venue.id, `Alta de ${venue.name}`, null, venue);
    }
    return this.db.respond(venue);
  }

  async setActive(id: Id, active: boolean): Promise<void> {
    const before = this.db.get(this.db.venues, id, 'Sede');
    this.db.update(this.db.venues, id, { active });
    this.audit.log(
      'EDITAR',
      'sedes',
      'sedes',
      id,
      active ? 'Activación' : 'Desactivación',
      { active: before.active },
      { active },
    );
    await this.db.respond(null);
  }
}

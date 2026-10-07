import { Injectable, inject } from '@angular/core';
import { MockDb } from '../../core/data/mock-db';
import { Id, TrainingSchedule } from '../../core/models';
import { AuditService } from '../../core/services/audit.service';
import { isTime, nowDateTime } from '../../shared/dates';

export type ScheduleDraft = Pick<
  TrainingSchedule,
  'categoryId' | 'venueId' | 'weekday' | 'startTime' | 'endTime'
>;

export interface ScheduleView extends TrainingSchedule {
  categoryName: string;
  venueName: string;
}

/** HU-016: regular weekly training schedules per category (horarios_entrenamiento). Several per category. */
@Injectable({ providedIn: 'root' })
export class ScheduleService {
  private db = inject(MockDb);
  private audit = inject(AuditService);

  list(filter: { categoryIds?: Id[]; onlyActive?: boolean } = {}): Promise<ScheduleView[]> {
    return this.db.respond(this.views(filter));
  }

  /** Same as list() but synchronous, for other services that compose it (coach panel, portal). */
  views(filter: { categoryIds?: Id[]; onlyActive?: boolean } = {}): ScheduleView[] {
    return this.db.schedules
      .filter(
        (s) =>
          (!filter.onlyActive || s.active) &&
          (!filter.categoryIds || filter.categoryIds.includes(s.categoryId)),
      )
      .map((s) => ({
        ...s,
        categoryName: this.db.categories.find((c) => c.id === s.categoryId)?.name ?? '—',
        venueName: this.db.venues.find((v) => v.id === s.venueId)?.name ?? '—',
      }))
      .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
  }

  async save(draft: ScheduleDraft & { id?: Id }): Promise<TrainingSchedule> {
    const category = this.db.get(this.db.categories, draft.categoryId, 'Categoría');
    const venue = this.db.get(this.db.venues, draft.venueId, 'Sede');
    if (!venue.active) throw new Error('La sede está inactiva.');
    if (!Number.isInteger(draft.weekday) || draft.weekday < 1 || draft.weekday > 7)
      throw new Error('Día inválido.');
    if (!isTime(draft.startTime) || !isTime(draft.endTime)) throw new Error('Horas inválidas.');
    if (draft.endTime <= draft.startTime)
      throw new Error('La hora de fin debe ser posterior a la de inicio.');
    let schedule: TrainingSchedule;
    if (draft.id) {
      const before = this.db.get(this.db.schedules, draft.id, 'Horario');
      schedule = this.db.update(this.db.schedules, draft.id, draft);
      this.audit.log(
        'EDITAR',
        'categorias',
        'horarios_entrenamiento',
        schedule.id,
        `Horario de ${category.name}`,
        before,
        schedule,
      );
    } else {
      schedule = this.db.insert(this.db.schedules, {
        ...draft,
        active: true,
        createdAt: nowDateTime(),
      });
      this.audit.log(
        'CREAR',
        'categorias',
        'horarios_entrenamiento',
        schedule.id,
        `Horario de ${category.name}`,
        null,
        schedule,
      );
    }
    return this.db.respond(schedule);
  }

  /** HU-016.4: deactivate instead of delete (past sessions may point to it). */
  async setActive(id: Id, active: boolean): Promise<void> {
    this.db.get(this.db.schedules, id, 'Horario');
    this.db.update(this.db.schedules, id, { active });
    this.audit.log(
      'EDITAR',
      'categorias',
      'horarios_entrenamiento',
      id,
      active ? 'Activación' : 'Desactivación',
    );
    await this.db.respond(null);
  }
}

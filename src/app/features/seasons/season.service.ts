import { Injectable, inject } from '@angular/core';
import { AuthorizationService } from '../../core/auth/authorization.service';
import { MockDb } from '../../core/data/mock-db';
import { Id, Season } from '../../core/models';
import { AuditService } from '../../core/services/audit.service';
import { isISODate, nowDateTime } from '../../shared/dates';
import { required } from '../../shared/validate';

export type SeasonDraft = Pick<Season, 'name' | 'startDate' | 'endDate' | 'active' | 'isCurrent'>;

export interface SeasonView extends Season {
  categories: number;
  competitions: number;
  enrollments: number;
}

/**
 * HU-070: seasons (temporadas). One current season at most (uq_temporada_actual) and it must be active
 * (chk_temporada_actual_activa). Closing a season keeps its categories, competitions and enrollments queryable.
 */
@Injectable({ providedIn: 'root' })
export class SeasonService {
  private db = inject(MockDb);
  private authz = inject(AuthorizationService);
  private audit = inject(AuditService);

  async list(): Promise<SeasonView[]> {
    this.authz.requireOffice();
    return this.db.respond(
      [...this.db.seasons]
        .sort((a, b) => b.startDate.localeCompare(a.startDate))
        .map((s) => ({
          ...s,
          categories: this.db.categories.filter((c) => c.seasonId === s.id).length,
          competitions: this.db.competitions.filter((c) => c.seasonId === s.id).length,
          enrollments: this.db.enrollments.filter((e) => e.seasonId === s.id).length,
        })),
    );
  }

  async current(): Promise<Season | null> {
    this.authz.requireOffice();
    return this.db.respond(this.db.seasons.find((s) => s.isCurrent) ?? null);
  }

  /** Marking a season current unmarks the previous one in the same transaction (the DB requires that order). */
  async save(draft: SeasonDraft & { id?: Id }): Promise<Season> {
    this.authz.require(draft.id ? 'temporadas.editar' : 'temporadas.crear');
    const name = required(draft.name, 'El nombre', 100);
    if (!isISODate(draft.startDate) || !isISODate(draft.endDate))
      throw new Error('Fechas inválidas.');
    if (draft.endDate < draft.startDate)
      throw new Error('La fecha de fin no puede ser anterior al inicio.');
    if (draft.isCurrent && !draft.active) throw new Error('La temporada actual debe estar activa.');
    if (
      this.db.seasons.some((s) => s.name.toLowerCase() === name.toLowerCase() && s.id !== draft.id)
    )
      throw new Error('Ya existe una temporada con ese nombre.');
    const season = this.db.transaction(() => {
      if (draft.isCurrent)
        for (const s of this.db.seasons.filter((s) => s.isCurrent && s.id !== draft.id))
          this.db.update(this.db.seasons, s.id, { isCurrent: false });
      const data = { ...draft, name };
      if (draft.id) {
        const before = this.db.get(this.db.seasons, draft.id, 'Temporada');
        const saved = this.db.update(this.db.seasons, draft.id, data);
        this.audit.log(
          'EDITAR',
          'temporadas',
          'temporadas',
          saved.id,
          `Edición de ${saved.name}`,
          before,
          saved,
        );
        return saved;
      }
      const saved = this.db.insert(this.db.seasons, { ...data, createdAt: nowDateTime() });
      this.audit.log(
        'CREAR',
        'temporadas',
        'temporadas',
        saved.id,
        `Alta de ${saved.name}`,
        null,
        saved,
      );
      return saved;
    });
    return this.db.respond(season);
  }
}

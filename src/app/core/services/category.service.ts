import { Injectable, inject } from '@angular/core';
import { MockDb } from '../data/mock-db';
import { Category, Id, ISODate, fullName } from '../models';
import { AuditService } from './audit.service';
import { ageOn, nowDateTime, today } from '../../shared/dates';
import { matches } from '../../shared/page';
import { required } from '../../shared/validate';

export type CategoryDraft = Pick<
  Category,
  'seasonId' | 'name' | 'minAge' | 'maxAge' | 'maxCapacity'
>;

export interface CategoryView extends Category {
  seasonName: string | null;
  /** Current members (jugador_categoria with fecha_fin NULL) — HU-021.4. */
  occupancy: number;
  full: boolean;
}

export interface CategoryMember {
  playerId: Id;
  name: string;
  identifier: string;
  age: number;
  since: ISODate;
  isAgeException: boolean;
  primaryTutor: string | null;
  primaryPhone: string | null;
}

/** Categories (categorias) — the category is the sporting group. Shared read access lives here too. */
@Injectable({ providedIn: 'root' })
export class CategoryService {
  private db = inject(MockDb);
  private audit = inject(AuditService);

  list(filter: { seasonId?: Id | null; onlyActive?: boolean } = {}): Promise<CategoryView[]> {
    return this.db.respond(
      this.db.categories
        .filter(
          (c) =>
            (!filter.onlyActive || c.active) &&
            (filter.seasonId == null || c.seasonId === filter.seasonId),
        )
        .map((c) => this.view(c))
        .sort(
          (a, b) => (b.seasonName ?? '').localeCompare(a.seasonName ?? '') || a.minAge - b.minAge,
        ),
    );
  }

  get(id: Id): Promise<CategoryView> {
    return this.db.respond(this.view(this.db.get(this.db.categories, id, 'Categoría')));
  }

  /** HU-015 + HU-021: unique name per season, valid non-inverted age range, optional capacity. */
  async save(draft: CategoryDraft & { id?: Id }): Promise<Category> {
    const name = required(draft.name, 'El nombre', 100);
    const ages = [draft.minAge, draft.maxAge];
    if (ages.some((a) => !Number.isInteger(a) || a < 0 || a > 99))
      throw new Error('Edades inválidas.');
    if (draft.maxAge < draft.minAge)
      throw new Error('La edad máxima no puede ser menor que la mínima.');
    if (
      draft.maxCapacity !== null &&
      (!Number.isInteger(draft.maxCapacity) || draft.maxCapacity < 1 || draft.maxCapacity > 65535)
    )
      throw new Error('El cupo debe ser un entero positivo o vacío (sin límite).');
    if (draft.seasonId !== null) this.db.get(this.db.seasons, draft.seasonId, 'Temporada');
    // uq_categoria_temporada_nombre. With season NULL MariaDB would allow repeats; the app also rejects them
    // (pending decision noted in escuela_futbol_mariadb_checks.sql, resolved here in favour of uniqueness).
    if (
      this.db.categories.some(
        (c) =>
          c.id !== draft.id &&
          c.seasonId === draft.seasonId &&
          c.name.toLowerCase() === name.toLowerCase(),
      )
    )
      throw new Error('Ya existe una categoría con ese nombre en la temporada.');
    const now = nowDateTime();
    const data = { ...draft, name };
    let category: Category;
    if (draft.id) {
      const before = this.db.get(this.db.categories, draft.id, 'Categoría');
      category = this.db.update(this.db.categories, draft.id, { ...data, updatedAt: now });
      this.audit.log(
        'EDITAR',
        'categorias',
        'categorias',
        category.id,
        `Edición de ${name}`,
        before,
        category,
      );
    } else {
      category = this.db.insert(this.db.categories, {
        ...data,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      this.audit.log(
        'CREAR',
        'categorias',
        'categorias',
        category.id,
        `Alta de ${name}`,
        null,
        category,
      );
    }
    return this.db.respond(category);
  }

  /** Inactive categories keep their history but accept no new players (HU-015.3). */
  async setActive(id: Id, active: boolean): Promise<void> {
    const before = this.db.get(this.db.categories, id, 'Categoría');
    this.db.update(this.db.categories, id, { active, updatedAt: nowDateTime() });
    this.audit.log(
      'EDITAR',
      'categorias',
      'categorias',
      id,
      active ? 'Activación' : 'Desactivación',
      { active: before.active },
      { active },
    );
    await this.db.respond(null);
  }

  /** HU-018: active players currently in the category, with age, primary tutor and contact. */
  members(categoryId: Id, query = ''): Promise<CategoryMember[]> {
    const on = today();
    return this.db.respond(
      this.db.playerCategories
        .filter((pc) => pc.categoryId === categoryId && !pc.endDate)
        .map((pc) => ({ pc, player: this.db.get(this.db.players, pc.playerId, 'Jugador') }))
        .filter(
          ({ player }) =>
            player.status === 'ACTIVO' && (!query || matches(fullName(player), query)),
        )
        .map(({ pc, player }) => {
          const link = this.db.tutorPlayers.find((tp) => tp.playerId === player.id && tp.isPrimary);
          const tutor = this.db.tutors.find((t) => t.id === link?.tutorId);
          return {
            playerId: player.id,
            name: fullName(player),
            identifier: player.identifier,
            age: ageOn(player.birthDate, on),
            since: pc.startDate,
            isAgeException: pc.isAgeException,
            primaryTutor: tutor ? fullName(tutor) : null,
            primaryPhone: tutor?.phone ?? tutor?.email ?? null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  /** Coaches currently assigned (entrenador_categoria vigente). */
  coaches(
    categoryId: Id,
  ): Promise<{ coachId: Id; name: string; responsibility: string | null; since: ISODate }[]> {
    return this.db.respond(
      this.db.coachCategories
        .filter((cc) => cc.categoryId === categoryId && cc.active && !cc.endDate)
        .map((cc) => ({
          coachId: cc.coachId,
          name: fullName(this.db.get(this.db.coaches, cc.coachId, 'Entrenador')),
          responsibility: cc.responsibility,
          since: cc.startDate,
        })),
    );
  }

  /** Current members, counted the same way everywhere (capacity checks, dashboards). */
  occupancy(categoryId: Id): number {
    return this.db.playerCategories.filter((pc) => pc.categoryId === categoryId && !pc.endDate)
      .length;
  }

  private view(c: Category): CategoryView {
    const occupancy = this.occupancy(c.id);
    return {
      ...c,
      seasonName: this.db.seasons.find((s) => s.id === c.seasonId)?.name ?? null,
      occupancy,
      full: c.maxCapacity !== null && occupancy >= c.maxCapacity,
    };
  }
}

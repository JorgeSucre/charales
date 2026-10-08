import { Injectable, inject } from '@angular/core';
import { AuthorizationService } from '../../core/auth/authorization.service';
import { SessionStore } from '../../core/auth/session.store';
import { MockDb } from '../../core/data/mock-db';
import { CompetitionStatus, Id, ISODate } from '../../core/models';
import { CategoryMember, CategoryService } from '../../core/services/category.service';
import { CompetitionService, ParticipationView } from '../../core/services/competition.service';
import { overlaps, today, isCurrentAssignment } from '../../shared/dates';
import { MatchFilter, MatchService, MatchView } from '../matches/match.service';
import { NoticeService, NoticeView } from '../notices/notice.service';
import { ScheduleService, ScheduleView } from '../trainings/schedule.service';
import { SessionView, TrainingService } from '../trainings/training.service';

export interface MyCategory {
  categoryId: Id;
  name: string;
  responsibility: string | null;
  members: CategoryMember[];
  schedules: ScheduleView[];
}

export interface MyCompetition extends ParticipationView {
  competitionStatus: CompetitionStatus;
  startDate: ISODate | null;
  endDate: ISODate | null;
  nextMatches: MatchView[];
}

/**
 * Coach panel (HU-024, 025, 027, 029, 038, 041, 060). Everything derives from the logged-in coach
 * (entrenadores.usuario_id): current entrenador_categoria and entrenador_competencia_categoria. Read-only.
 */
@Injectable({ providedIn: 'root' })
export class CoachPanelService {
  private db = inject(MockDb);
  private authz = inject(AuthorizationService);
  private session = inject(SessionStore);
  private categories = inject(CategoryService);
  private schedules = inject(ScheduleService);
  private trainings = inject(TrainingService);
  private competitions = inject(CompetitionService);
  private matches = inject(MatchService);
  private noticeService = inject(NoticeService);

  /** HU-024: my current categories, with their active players and schedules. */
  async myCategories(): Promise<MyCategory[]> {
    this.authz.require('panel_entrenador.consultar');
    const assignments = this.db.coachCategories.filter(
      (a) => a.coachId === this.coachId() && isCurrentAssignment(a),
    );
    return Promise.all(
      assignments.map(async (a) => ({
        categoryId: a.categoryId,
        name: this.db.get(this.db.categories, a.categoryId, 'Categoría').name,
        responsibility: a.responsibility,
        members: await this.categories.members(a.categoryId),
        schedules: this.schedules.views({ categoryIds: [a.categoryId], onlyActive: true }),
      })),
    );
  }

  /** HU-025: weekly calendar of my categories; `overlap` marks slots that clash on the same day. */
  async weeklySchedule(): Promise<(ScheduleView & { overlap: boolean })[]> {
    this.authz.require('panel_entrenador.consultar');
    const rows = this.schedules.views({ categoryIds: this.myCategoryIds(), onlyActive: true });
    return this.db.respond(
      rows.map((r) => ({
        ...r,
        overlap: rows.some(
          (o) =>
            o.id !== r.id &&
            o.weekday === r.weekday &&
            overlaps(
              { start: r.startTime, end: r.endTime },
              { start: o.startTime, end: o.endTime },
            ),
        ),
      })),
    );
  }

  /** HU-029: my sessions (led by me or of my categories) in a date range. */
  async sessions(from?: ISODate, to?: ISODate): Promise<SessionView[]> {
    this.authz.require('panel_entrenador.consultar');
    const coachId = this.coachId();
    const mine = new Set(this.myCategoryIds());
    return this.db.respond(
      this.trainings
        .views({ from, to })
        .filter((s) => s.coachId === coachId || mine.has(s.categoryId)),
    );
  }

  /** HU-027: competitions where I'm currently assigned, with category, dates and next matches. */
  async myCompetitions(): Promise<MyCompetition[]> {
    this.authz.require('panel_entrenador.consultar');
    const ids = this.db.coachCompetitions
      .filter((a) => a.coachId === this.coachId() && isCurrentAssignment(a))
      .map((a) => a.competitionCategoryId);
    const on = today();
    return this.db.respond(
      this.competitions.participationViews({ ids }).map((p) => {
        const c = this.db.get(this.db.competitions, p.competitionId, 'Competencia');
        return {
          ...p,
          competitionStatus: c.status,
          startDate: c.startDate,
          endDate: c.endDate,
          nextMatches: this.matches
            .views({ participationIds: [p.id], from: on })
            .filter((m) => m.upcoming)
            .slice(0, 3),
        };
      }),
    );
  }

  /** HU-038 / HU-041: matches of my categories' participations (calendar or results). */
  async myMatches(filter: Omit<MatchFilter, 'participationIds'> = {}): Promise<MatchView[]> {
    this.authz.require('panel_entrenador.consultar');
    return this.db.respond(
      this.matches.views({ ...filter, participationIds: this.myParticipationIds() }),
    );
  }

  /** Competitions available as filter in my calendars. */
  async competitionOptions(): Promise<{ id: Id; name: string }[]> {
    this.authz.require('panel_entrenador.consultar');
    const ids = new Set(
      this.db.competitionCategories
        .filter((cc) => this.myParticipationIds().includes(cc.id))
        .map((cc) => cc.competitionId),
    );
    return this.db.respond(
      this.db.competitions.filter((c) => ids.has(c.id)).map((c) => ({ id: c.id, name: c.name })),
    );
  }

  /** HU-041: categories available as filter (only the coach's current ones). */
  async categoryOptions(): Promise<{ id: Id; name: string }[]> {
    this.authz.require('panel_entrenador.consultar');
    return this.db.respond(
      this.myCategoryIds().map((id) => ({
        id,
        name: this.db.get(this.db.categories, id, 'Categoría').name,
      })),
    );
  }

  /** HU-060 */
  async notices(): Promise<NoticeView[]> {
    this.authz.require('panel_entrenador.consultar');
    return this.db.respond(this.noticeService.forCoach(this.coachId()));
  }

  private coachId(): Id {
    const id = this.session.user()?.coachId;
    if (!id) throw new Error('Tu cuenta no está vinculada a un entrenador activo.');
    return id;
  }

  private myCategoryIds(): Id[] {
    this.coachId();
    return this.authz.coachCategories();
  }

  private myParticipationIds(): Id[] {
    this.coachId();
    return this.authz.coachParticipations();
  }
}

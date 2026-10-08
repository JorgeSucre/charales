import { Injectable, inject } from '@angular/core';
import { AuthorizationService, ForbiddenError } from '../../core/auth/authorization.service';
import { SessionStore } from '../../core/auth/session.store';
import { MockDb } from '../../core/data/mock-db';
import {
  AttendanceStatus,
  Cents,
  CompetitionStatus,
  CompetitionType,
  Id,
  ISODate,
  Tutor,
  fullName,
} from '../../core/models';
import { ageOn, today, isCurrentAssignment } from '../../shared/dates';
import { BillingService, StatementView } from '../billing/billing.service';
import { MatchService, MatchView } from '../matches/match.service';
import { NoticeService, NoticeView } from '../notices/notice.service';
import { ContactDraft, TutorService } from '../tutors/tutor.service';
import { AttendanceService, AttendanceSummary } from '../trainings/attendance.service';
import { ScheduleService, ScheduleView } from '../trainings/schedule.service';
import { OrderView, UniformService } from '../uniforms/uniform.service';

export interface ChildCard {
  playerId: Id;
  name: string;
  age: number;
  categoryName: string | null;
  nextMatch: MatchView | null;
  balanceCents: Cents;
  overdueCents: Cents;
}

export interface ChildCompetition {
  competitionName: string;
  type: CompetitionType;
  status: CompetitionStatus;
  startDate: ISODate | null;
  endDate: ISODate | null;
  categoryName: string;
  participationId: Id;
}

export interface ChildDetail {
  playerId: Id;
  name: string;
  identifier: string;
  age: number;
  category: { name: string; since: ISODate } | null;
  schedules: ScheduleView[];
  coaches: { name: string; responsibility: string | null }[];
  competitions: ChildCompetition[];
  upcoming: MatchView[];
  results: MatchView[];
  statement: StatementView;
  attendance: {
    rows: { date: ISODate; categoryName: string; status: AttendanceStatus; notes: string | null }[];
    summary: AttendanceSummary;
  };
  uniforms: OrderView[];
}

/**
 * Family portal (HU-061..064, 033, 039, 042, 047, 056, 059, 063). Scope is ALWAYS derived from the session:
 * session.tutorId → tutor_jugador → jugadores. A playerId coming from the URL is checked against that set before
 * anything is read (assertChild); the API must do the same from its token.
 */
@Injectable({ providedIn: 'root' })
export class PortalService {
  private db = inject(MockDb);
  private authz = inject(AuthorizationService);
  private session = inject(SessionStore);
  private billing = inject(BillingService);
  private matches = inject(MatchService);
  private notices = inject(NoticeService);
  private tutors = inject(TutorService);
  private attendanceService = inject(AttendanceService);
  private schedules = inject(ScheduleService);
  private uniforms = inject(UniformService);

  /** HU-061: one card per child with category, next match and balance. */
  async overview(): Promise<ChildCard[]> {
    this.authz.require('portal.consultar');
    const on = today();
    const statements = await Promise.all(this.childIds().map((id) => this.billing.statement(id)));
    return statements.map((st) => {
      const player = this.db.get(this.db.players, st.playerId, 'Jugador');
      const pc = this.currentCategory(player.id);
      return {
        playerId: player.id,
        name: fullName(player),
        age: ageOn(player.birthDate, on),
        categoryName: pc ? this.db.get(this.db.categories, pc.categoryId, 'Categoría').name : null,
        nextMatch:
          this.matches
            .views({ participationIds: this.rosterParticipations(player.id), from: on })
            .find((m) => m.upcoming) ?? null,
        balanceCents: st.totals.balanceCents,
        overdueCents: st.totals.overdueCents,
      };
    });
  }

  /** Everything about one child; rejects players that aren't the tutor's. */
  async child(playerId: Id): Promise<ChildDetail> {
    this.authz.require('portal.consultar');
    this.assertChild(playerId);
    const on = today();
    const player = this.db.get(this.db.players, playerId, 'Jugador');
    const pc = this.currentCategory(playerId);
    const participations = this.rosterParticipations(playerId);
    const statement = await this.billing.statement(playerId);
    const matches = this.matches.views({ participationIds: participations });
    return this.db.respond({
      playerId,
      name: fullName(player),
      identifier: player.identifier,
      age: ageOn(player.birthDate, on),
      category: pc
        ? {
            name: this.db.get(this.db.categories, pc.categoryId, 'Categoría').name,
            since: pc.startDate,
          }
        : null,
      // HU-062: weekly schedules, venue and coaches of the current category.
      schedules: pc ? this.schedules.views({ categoryIds: [pc.categoryId], onlyActive: true }) : [],
      coaches: pc
        ? this.db.coachCategories
            .filter((a) => a.categoryId === pc.categoryId && isCurrentAssignment(a))
            .map((a) => ({
              name: fullName(this.db.get(this.db.coaches, a.coachId, 'Entrenador')),
              responsibility: a.responsibility,
            }))
        : [],
      // HU-063: only competitions where the child is in the roster.
      competitions: participations.map((id) => {
        const cc = this.db.get(this.db.competitionCategories, id, 'Participación');
        const c = this.db.get(this.db.competitions, cc.competitionId, 'Competencia');
        return {
          competitionName: c.name,
          type: c.type,
          status: c.status,
          startDate: c.startDate,
          endDate: c.endDate,
          categoryName: this.db.get(this.db.categories, cc.categoryId, 'Categoría').name,
          participationId: id,
        };
      }),
      // HU-039 / HU-042: read-only calendar and results, including cancellations and reschedules.
      upcoming: matches.filter((m) => m.date >= on && m.status !== 'JUGADO'),
      results: matches.filter((m) => m.status === 'JUGADO').reverse(),
      statement, // HU-047
      attendance: this.attendanceService.history(playerId), // HU-033
      uniforms: this.uniforms.views({ playerIds: [playerId] }), // HU-056
    });
  }

  /** HU-059 */
  /** HU-033: one child's attendance in a period (inclusive DATEs), with the % for that period. */
  async attendance(playerId: Id, from?: ISODate, to?: ISODate): Promise<ChildDetail['attendance']> {
    this.authz.require('portal.consultar');
    this.assertChild(playerId);
    return this.db.respond(
      this.attendanceService.history(playerId, from || undefined, to || undefined),
    );
  }

  async noticeList(): Promise<NoticeView[]> {
    this.authz.require('portal.consultar');
    return this.db.respond(this.notices.forTutor(this.tutorId()));
  }

  /** HU-064 */
  async profile(): Promise<Tutor> {
    this.authz.require('portal.consultar');
    return this.db.respond(this.db.get(this.db.tutors, this.tutorId(), 'Tutor'));
  }

  async updateProfile(draft: ContactDraft): Promise<Tutor> {
    this.authz.require('portal.editar');
    return this.tutors.updateContact(this.tutorId(), draft);
  }

  async childOptions(): Promise<{ id: Id; name: string }[]> {
    this.authz.require('portal.consultar');
    return this.db.respond(
      this.childIds().map((id) => ({
        id,
        name: fullName(this.db.get(this.db.players, id, 'Jugador')),
      })),
    );
  }

  private tutorId(): Id {
    const id = this.session.user()?.tutorId;
    if (!id) throw new Error('Tu cuenta no está vinculada a un tutor.');
    return id;
  }

  private childIds(): Id[] {
    return this.authz.tutorChildren();
  }

  /** Authorization by relation, never by the id the client sends (HU-003.2, HU-072). */
  private assertChild(playerId: Id): void {
    if (!this.childIds().includes(playerId))
      throw new ForbiddenError('No tienes acceso a la información de este jugador.');
  }

  private currentCategory(playerId: Id) {
    return this.db.playerCategories.find((pc) => pc.playerId === playerId && !pc.endDate) ?? null;
  }

  /** Participations where the child is in the active roster (jugador_competencia_categoria). */
  private rosterParticipations(playerId: Id): Id[] {
    return this.db.rosters
      .filter((r) => r.playerId === playerId && r.active)
      .map((r) => r.competitionCategoryId);
  }
}

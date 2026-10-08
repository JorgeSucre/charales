import { Injectable, inject } from '@angular/core';
import { AuthorizationService } from '../../core/auth/authorization.service';
import { MockDb } from '../../core/data/mock-db';
import { DateTime, Id, Notice, NoticeAudience, NoticeRecipient, fullName } from '../../core/models';
import { AuditService } from '../../core/services/audit.service';
import { nowDateTime, isCurrentAssignment } from '../../shared/dates';
import { required } from '../../shared/validate';

export interface NoticeDraft {
  title: string;
  message: string;
  startsAt: DateTime | null;
  endsAt: DateTime | null;
  published: boolean;
  /** Empty = GENERAL. Otherwise one or more categories / tutors / coaches (HU-057.2, HU-058). */
  categoryIds: Id[];
  tutorIds: Id[];
  coachIds: Id[];
}

export interface NoticeView extends Notice {
  audience: string[];
  recipients: NoticeRecipient[];
  current: boolean;
  authorEmail: string | null;
}

/** Visible now: published and inside its validity window (open ends allowed). */
export function isCurrentNotice(n: Notice, now: DateTime): boolean {
  return n.published && (!n.startsAt || n.startsAt <= now) && (!n.endsAt || n.endsAt >= now);
}

/** Avisos (avisos + aviso_destinatario). Read access for tutors/coaches is computed from their relations. */
@Injectable({ providedIn: 'root' })
export class NoticeService {
  private db = inject(MockDb);
  private authz = inject(AuthorizationService);
  private audit = inject(AuditService);

  /** Office list: every notice, newest first (HU-057.4). */
  async list(): Promise<NoticeView[]> {
    this.authz.require('avisos.consultar');
    const now = nowDateTime();
    return this.db.respond(
      [...this.db.notices]
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id - a.id)
        .map((n) => this.view(n, now)),
    );
  }

  async save(draft: NoticeDraft & { id?: Id }): Promise<Notice> {
    this.authz.require(draft.id ? 'avisos.editar' : 'avisos.crear');
    const title = required(draft.title, 'El título', 200);
    const message = required(draft.message, 'El mensaje', 10000);
    const startsAt = draft.startsAt || null;
    const endsAt = draft.endsAt || null;
    if (startsAt && endsAt && endsAt < startsAt)
      throw new Error('La vigencia termina antes de empezar.');
    for (const id of draft.categoryIds) this.db.get(this.db.categories, id, 'Categoría');
    for (const id of draft.tutorIds) this.db.get(this.db.tutors, id, 'Tutor');
    for (const id of draft.coachIds) this.db.get(this.db.coaches, id, 'Entrenador');
    const now = nowDateTime();
    const notice = this.db.transaction(() => {
      const data = { title, message, startsAt, endsAt, published: draft.published, updatedAt: now };
      let saved: Notice;
      if (draft.id) {
        const before = this.view(this.db.get(this.db.notices, draft.id, 'Aviso'), now);
        saved = this.db.update(this.db.notices, draft.id, data);
        this.db.noticeRecipients = this.db.noticeRecipients.filter((r) => r.noticeId !== saved.id);
        this.audit.log('EDITAR', 'avisos', 'avisos', saved.id, `Aviso «${title}»`, before, saved);
      } else {
        const author = this.audit.currentUserId();
        if (author === null) throw new Error('Sesión no iniciada.');
        saved = this.db.insert(this.db.notices, {
          ...data,
          createdBy: author,
          publishedAt: now,
          createdAt: now,
        });
        this.audit.log('CREAR', 'avisos', 'avisos', saved.id, `Aviso «${title}»`, null, saved);
      }
      const add = (
        audience: NoticeAudience,
        ids: Partial<Pick<NoticeRecipient, 'categoryId' | 'tutorId' | 'coachId'>> = {},
      ) =>
        this.db.insert(this.db.noticeRecipients, {
          noticeId: saved.id,
          audience,
          categoryId: null,
          tutorId: null,
          coachId: null,
          ...ids,
        });
      const targeted = draft.categoryIds.length + draft.tutorIds.length + draft.coachIds.length;
      if (!targeted) add('GENERAL');
      for (const categoryId of new Set(draft.categoryIds)) add('CATEGORIA', { categoryId });
      for (const tutorId of new Set(draft.tutorIds)) add('TUTOR', { tutorId });
      for (const coachId of new Set(draft.coachIds)) add('ENTRENADOR', { coachId });
      return saved;
    });
    return this.db.respond(notice);
  }

  /** HU-057.3: publish / unpublish without deleting. */
  async setPublished(id: Id, published: boolean): Promise<void> {
    this.authz.require('avisos.editar');
    this.db.get(this.db.notices, id, 'Aviso');
    this.db.update(this.db.notices, id, { published, updatedAt: nowDateTime() });
    this.audit.log('EDITAR', 'avisos', 'avisos', id, published ? 'Publicado' : 'Despublicado');
    await this.db.respond(null);
  }

  /** HU-059: current notices for a tutor — general + categories of their children + addressed to them. */
  forTutor(tutorId: Id): NoticeView[] {
    if (this.authz.user().tutorId !== tutorId) this.authz.require('avisos.consultar');
    const children = this.db.tutorPlayers
      .filter((tp) => tp.tutorId === tutorId)
      .map((tp) => tp.playerId);
    const categories = this.db.playerCategories
      .filter((pc) => children.includes(pc.playerId) && !pc.endDate)
      .map((pc) => pc.categoryId);
    return this.visible(
      (r) =>
        r.audience === 'GENERAL' ||
        (r.audience === 'CATEGORIA' && categories.includes(r.categoryId!)) ||
        r.tutorId === tutorId,
    );
  }

  /** HU-060: current notices for a coach — general + categories currently assigned + addressed to them. */
  forCoach(coachId: Id): NoticeView[] {
    if (this.authz.user().coachId !== coachId) this.authz.require('avisos.consultar');
    const categories = this.db.coachCategories
      .filter((a) => a.coachId === coachId && isCurrentAssignment(a))
      .map((a) => a.categoryId);
    return this.visible(
      (r) =>
        r.audience === 'GENERAL' ||
        (r.audience === 'CATEGORIA' && categories.includes(r.categoryId!)) ||
        r.coachId === coachId,
    );
  }

  private visible(match: (r: NoticeRecipient) => boolean): NoticeView[] {
    const now = nowDateTime();
    const ids = new Set(this.db.noticeRecipients.filter(match).map((r) => r.noticeId));
    return this.db.notices
      .filter((n) => ids.has(n.id) && isCurrentNotice(n, now))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id - a.id)
      .map((n) => this.view(n, now));
  }

  private view(n: Notice, now: DateTime): NoticeView {
    const recipients = this.db.noticeRecipients.filter((r) => r.noticeId === n.id);
    return {
      ...n,
      recipients,
      current: isCurrentNotice(n, now),
      authorEmail: this.db.users.find((u) => u.id === n.createdBy)?.email ?? null,
      audience: recipients.map((r) => {
        if (r.audience === 'CATEGORIA')
          return `Categoría ${this.db.categories.find((c) => c.id === r.categoryId)?.name ?? '—'}`;
        if (r.audience === 'TUTOR') {
          const t = this.db.tutors.find((x) => x.id === r.tutorId);
          return `Tutor ${t ? fullName(t) : '—'}`;
        }
        if (r.audience === 'ENTRENADOR') {
          const c = this.db.coaches.find((x) => x.id === r.coachId);
          return `Entrenador ${c ? fullName(c) : '—'}`;
        }
        return 'General';
      }),
    };
  }
}

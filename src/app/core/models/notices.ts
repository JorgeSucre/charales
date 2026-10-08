import { DateTime, Id } from './common';

/** avisos. Visible when published and now ∈ [startsAt, endsAt] (open ends allowed). */
export interface Notice {
  id: Id;
  createdBy: Id;
  title: string;
  message: string;
  publishedAt: DateTime;
  startsAt: DateTime | null;
  endsAt: DateTime | null;
  published: boolean;
  createdAt: DateTime;
  updatedAt: DateTime;
}

export type NoticeAudience = 'GENERAL' | 'CATEGORIA' | 'TUTOR' | 'ENTRENADOR';

/** aviso_destinatario. Each audience carries exactly its FK; GENERAL none (chk_aviso_dest_audiencia). */
export interface NoticeRecipient {
  id: Id;
  noticeId: Id;
  audience: NoticeAudience;
  categoryId: Id | null;
  tutorId: Id | null;
  coachId: Id | null;
}

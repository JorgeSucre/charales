import { Injectable, inject } from '@angular/core';
import { MockDb } from '../../core/data/mock-db';
import { Id, Tutor, fullName } from '../../core/models';
import { AuditService } from '../../core/services/audit.service';
import { nowDateTime } from '../../shared/dates';
import { matches } from '../../shared/page';
import { optional, optionalEmail, optionalPhone, required } from '../../shared/validate';
import { UserService } from '../users/user.service';

export interface TutorLinkDraft {
  playerId: Id;
  relationship: string;
  isPrimary: boolean;
}

export interface TutorDraft {
  firstName: string;
  lastName1: string;
  lastName2: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  links: TutorLinkDraft[];
}

export interface TutorView extends Tutor {
  name: string;
  accountEmail: string | null;
  links: (TutorLinkDraft & { playerName: string })[];
}

export type ContactDraft = Pick<Tutor, 'phone' | 'email' | 'address'>;

/** Tutors (tutores) and their children (tutor_jugador, N:M; relationship and primary contact per pair). */
@Injectable({ providedIn: 'root' })
export class TutorService {
  private db = inject(MockDb);
  private audit = inject(AuditService);
  private users = inject(UserService);

  list(query = ''): Promise<TutorView[]> {
    return this.db.respond(
      this.db.tutors
        .map((t) => this.view(t))
        .filter((t) => !query || matches(`${t.name} ${t.email ?? ''} ${t.phone ?? ''}`, query))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  get(id: Id): Promise<TutorView> {
    return this.db.respond(this.view(this.db.get(this.db.tutors, id, 'Tutor')));
  }

  /**
   * HU-011: create/edit a tutor and replace their links. Rules: at least one player; at most one primary contact
   * per player (uq_tutor_jugador_un_principal); a link with registered payments can't be removed
   * (fk_pago_tutor_jugador); phone/e-mail validated when given.
   */
  async save(draft: TutorDraft & { id?: Id }): Promise<TutorView> {
    const data = {
      firstName: required(draft.firstName, 'El nombre', 100),
      lastName1: required(draft.lastName1, 'El apellido paterno', 100),
      lastName2: optional(draft.lastName2, 'El apellido materno', 100),
      phone: optionalPhone(draft.phone),
      email: optionalEmail(draft.email),
      address: optional(draft.address, 'La dirección'),
    };
    if (!data.phone && !data.email)
      throw new Error('Captura al menos un teléfono o correo de contacto.');
    if (!draft.links.length) throw new Error('Selecciona al menos un jugador.');
    const ids = draft.links.map((l) => l.playerId);
    if (new Set(ids).size !== ids.length) throw new Error('Un jugador aparece dos veces.');
    for (const link of draft.links) {
      this.db.get(this.db.players, link.playerId, 'Jugador');
      required(link.relationship, 'El parentesco', 50);
      if (!link.isPrimary) continue;
      const taken = this.db.tutorPlayers.find(
        (tp) => tp.playerId === link.playerId && tp.isPrimary && tp.tutorId !== draft.id,
      );
      if (taken) {
        const player = this.db.get(this.db.players, link.playerId, 'Jugador');
        throw new Error(`${fullName(player)} ya tiene un contacto principal.`);
      }
    }
    const now = nowDateTime();
    const tutor = this.db.transaction(() => {
      let saved: Tutor;
      if (draft.id) {
        const before = this.view(this.db.get(this.db.tutors, draft.id, 'Tutor'));
        const removed = before.links.filter((l) => !ids.includes(l.playerId));
        for (const link of removed)
          if (this.db.payments.some((p) => p.tutorId === draft.id && p.playerId === link.playerId))
            throw new Error(
              `No se puede desvincular a ${link.playerName}: hay pagos registrados por este tutor.`,
            );
        saved = this.db.update(this.db.tutors, draft.id, { ...data, updatedAt: now });
        const created = new Map(
          this.db.tutorPlayers
            .filter((tp) => tp.tutorId === draft.id)
            .map((tp) => [tp.playerId, tp.createdAt]),
        );
        this.db.tutorPlayers = this.db.tutorPlayers.filter((tp) => tp.tutorId !== draft.id);
        this.db.tutorPlayers.push(
          ...draft.links.map((l) => ({
            tutorId: saved.id,
            playerId: l.playerId,
            relationship: l.relationship.trim(),
            isPrimary: l.isPrimary,
            createdAt: created.get(l.playerId) ?? now,
          })),
        );
        this.audit.log(
          'EDITAR',
          'tutores',
          'tutores',
          saved.id,
          `Edición de ${fullName(saved)}`,
          before,
          this.view(saved),
        );
      } else {
        saved = this.db.insert(this.db.tutors, {
          ...data,
          userId: null,
          createdAt: now,
          updatedAt: now,
        });
        this.db.tutorPlayers.push(
          ...draft.links.map((l) => ({
            tutorId: saved.id,
            playerId: l.playerId,
            relationship: l.relationship.trim(),
            isPrimary: l.isPrimary,
            createdAt: now,
          })),
        );
        this.audit.log(
          'CREAR',
          'tutores',
          'tutores',
          saved.id,
          `Alta de ${fullName(saved)}`,
          null,
          this.view(saved),
        );
      }
      return saved;
    });
    return this.db.respond(this.view(tutor));
  }

  /**
   * HU-012: enable the family portal. Only registered tutors; one account per tutor and one tutor per account;
   * the account is reused if the e-mail already logs in (e.g. a coach), otherwise created and invited by e-mail.
   */
  async linkAccount(tutorId: Id, email: string): Promise<{ email: string; created: boolean }> {
    const tutor = this.db.get(this.db.tutors, tutorId, 'Tutor');
    if (tutor.userId) throw new Error('El tutor ya tiene una cuenta vinculada.');
    const { user, created } = await this.users.profileAccount(email);
    if (this.db.tutors.some((t) => t.userId === user.id))
      throw new Error('Esa cuenta ya está vinculada a otro tutor.');
    this.db.update(this.db.tutors, tutorId, { userId: user.id, updatedAt: nowDateTime() });
    this.audit.log(
      'EDITAR',
      'tutores',
      'tutores',
      tutorId,
      `Cuenta ${user.email} vinculada al portal`,
      { userId: null },
      { userId: user.id },
    );
    return this.db.respond({ email: user.email, created });
  }

  async unlinkAccount(tutorId: Id): Promise<void> {
    const tutor = this.db.get(this.db.tutors, tutorId, 'Tutor');
    if (!tutor.userId) return;
    this.db.update(this.db.tutors, tutorId, { userId: null, updatedAt: nowDateTime() });
    this.audit.log(
      'EDITAR',
      'tutores',
      'tutores',
      tutorId,
      'Cuenta desvinculada del portal',
      { userId: tutor.userId },
      { userId: null },
    );
    await this.db.respond(null);
  }

  /** HU-064: contact fields only (never identity or children). Called by the portal for the logged-in tutor. */
  async updateContact(tutorId: Id, draft: ContactDraft): Promise<Tutor> {
    const before = this.db.get(this.db.tutors, tutorId, 'Tutor');
    const data = {
      phone: optionalPhone(draft.phone),
      email: optionalEmail(draft.email),
      address: optional(draft.address, 'La dirección'),
    };
    if (!data.phone && !data.email)
      throw new Error('Deja al menos un teléfono o correo de contacto.');
    const tutor = this.db.update(this.db.tutors, tutorId, { ...data, updatedAt: nowDateTime() });
    this.audit.log(
      'EDITAR',
      'tutores',
      'tutores',
      tutorId,
      'Actualización de contacto desde el portal',
      before,
      tutor,
    );
    return this.db.respond(tutor);
  }

  private view(t: Tutor): TutorView {
    return {
      ...t,
      name: fullName(t),
      accountEmail: this.db.users.find((u) => u.id === t.userId)?.email ?? null,
      links: this.db.tutorPlayers
        .filter((tp) => tp.tutorId === t.id)
        .map((tp) => {
          const p = this.db.players.find((x) => x.id === tp.playerId);
          return {
            playerId: tp.playerId,
            relationship: tp.relationship,
            isPrimary: tp.isPrimary,
            playerName: p ? fullName(p) : '—',
          };
        }),
    };
  }
}

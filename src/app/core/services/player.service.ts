import { multiplyCents, sumCents } from '../../shared/money';
import { Injectable, inject } from '@angular/core';
import { AuthorizationService } from '../auth/authorization.service';
import { MockDb } from '../data/mock-db';
import {
  Cents,
  Charge,
  ChargeStatus,
  Id,
  ISODate,
  Player,
  PlayerStatus,
  PlayerStatusChange,
  Sex,
  fullName,
} from '../models';
import { AuditService } from './audit.service';
import { ageOn, isISODate, nowDateTime, today } from '../../shared/dates';
import { Page, matches, paginate } from '../../shared/page';
import { optional, optionalEmail, optionalPhone, required, sameName } from '../../shared/validate';
import {
  chargeBalance,
  chargeStatus,
  effectiveApplications,
  netAmount,
  paidOn,
} from '../../features/billing/billing.rules';

export interface PlayerDraft {
  firstName: string;
  lastName1: string;
  lastName2: string | null;
  birthDate: ISODate;
  sex: Sex;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export interface PlayerSearch {
  query?: string;
  categoryId?: Id | null;
  status?: PlayerStatus | '';
  page?: number;
}

export interface PlayerListItem {
  player: Player;
  name: string;
  age: number;
  categoryId: Id | null;
  categoryName: string | null;
}

export interface PlayerOption {
  id: Id;
  name: string;
  status: PlayerStatus;
}

/** Expediente (HU-013): one aggregated read, so the page makes a single call (no N+1). */
export interface PlayerRecord {
  player: Player;
  name: string;
  age: number;
  statusHistory: (PlayerStatusChange & { changedByEmail: string | null })[];
  tutors: {
    tutorId: Id;
    name: string;
    relationship: string;
    isPrimary: boolean;
    phone: string | null;
    email: string | null;
  }[];
  enrollments: {
    id: Id;
    seasonName: string;
    enrolledOn: ISODate;
    amountCents: Cents;
    status: string;
  }[];
  categories: {
    id: Id;
    categoryName: string;
    seasonName: string | null;
    startDate: ISODate;
    endDate: ISODate | null;
    isAgeException: boolean;
    exceptionReason: string | null;
  }[];
  categoryChanges: { changedAt: string; from: string | null; to: string; reason: string | null }[];
  charges: {
    id: Id;
    label: string;
    dueDate: ISODate | null;
    netCents: Cents;
    paidCents: Cents;
    balanceCents: Cents;
    status: ChargeStatus;
  }[];
  payments: {
    id: Id;
    folio: string;
    paidAt: string;
    amountCents: Cents;
    method: string;
    status: string;
  }[];
  balanceCents: Cents;
  overdueCents: Cents;
  uniforms: { id: Id; requestedOn: ISODate; status: string; items: string[]; totalCents: Cents }[];
  competitions: {
    competitionName: string;
    type: string;
    categoryName: string;
    joinedOn: ISODate;
    leftOn: ISODate | null;
    active: boolean;
  }[];
  attendance: { total: number; present: number; absent: number; justified: number };
}

export const STATUS_LABELS: Record<PlayerStatus, string> = {
  ACTIVO: 'Activo',
  BAJA_TEMPORAL: 'Baja temporal',
  BAJA_DEFINITIVA: 'Baja definitiva',
};

export const SEX_LABELS: Record<Sex, string> = {
  F: 'Femenino',
  M: 'Masculino',
  OTRO: 'Otro',
  NO_ESPECIFICADO: 'No especificado',
};

/** Players (jugadores, historial_estatus). Shared: every module reads players through here. */
@Injectable({ providedIn: 'root' })
export class PlayerService {
  private db = inject(MockDb);
  private authz = inject(AuthorizationService);
  private audit = inject(AuditService);

  /** HU-014: partial name search + combinable filters + pagination. */
  async search(filter: PlayerSearch = {}): Promise<Page<PlayerListItem>> {
    this.authz.require('jugadores.consultar');
    const on = today();
    const current = new Map(
      this.db.playerCategories
        .filter((pc) => !pc.endDate)
        .map((pc) => [pc.playerId, pc.categoryId]),
    );
    const rows = this.db.players
      .filter(
        (p) =>
          (!filter.query || matches(`${fullName(p)} ${p.identifier}`, filter.query)) &&
          (!filter.status || p.status === filter.status) &&
          (!filter.categoryId || current.get(p.id) === filter.categoryId),
      )
      .map((player) => {
        const categoryId = current.get(player.id) ?? null;
        return {
          player,
          name: fullName(player),
          age: ageOn(player.birthDate, on),
          categoryId,
          categoryName: this.db.categories.find((c) => c.id === categoryId)?.name ?? null,
        };
      })
      .sort((a, b) =>
        `${a.player.lastName1} ${a.player.lastName2 ?? ''} ${a.player.firstName}`.localeCompare(
          `${b.player.lastName1} ${b.player.lastName2 ?? ''} ${b.player.firstName}`,
        ),
      );
    return this.db.respond(paginate(rows, filter.page));
  }

  /** For selects. `onlyActive` hides players in BAJA (they can't join new categories, competitions, etc.). */
  async options(onlyActive = false): Promise<PlayerOption[]> {
    this.authz.requireOffice();
    return this.db.respond(
      this.db.players
        .filter((p) => !onlyActive || p.status === 'ACTIVO')
        .map((p) => ({ id: p.id, name: fullName(p), status: p.status }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  async get(id: Id): Promise<Player> {
    this.authz.require('jugadores.consultar');
    return this.db.respond(this.db.get(this.db.players, id, 'Jugador'));
  }

  /** HU-008: validates, rejects evident duplicates (same name + birth date) and generates the identifier. */
  async create(draft: PlayerDraft, status: PlayerStatus = 'ACTIVO'): Promise<Player> {
    this.authz.require('jugadores.crear');
    const data = this.validate(draft);
    const duplicate = this.db.players.find(
      (p) => p.birthDate === data.birthDate && sameName(fullName(p), fullName(data)),
    );
    if (duplicate)
      throw new Error(
        `Posible duplicado: ${fullName(duplicate)} (${duplicate.identifier}) tiene el mismo nombre y fecha de nacimiento.`,
      );
    const now = nowDateTime();
    const player = this.db.transaction(() => {
      const created = this.db.insert(this.db.players, {
        ...data,
        identifier: this.nextIdentifier(),
        status,
        createdAt: now,
        updatedAt: now,
      });
      this.db.insert(this.db.statusHistory, {
        playerId: created.id,
        previousStatus: null,
        newStatus: status,
        reason: 'Alta',
        changedBy: this.audit.currentUserId(),
        changedAt: now,
      });
      this.audit.log(
        'CREAR',
        'jugadores',
        'jugadores',
        created.id,
        `Alta de ${fullName(created)}`,
        null,
        created,
      );
      return created;
    });
    return this.db.respond(player);
  }

  /** HU-009: keeps id/identifier/status; updates actualizado_en; audits before/after. */
  async update(id: Id, draft: PlayerDraft): Promise<Player> {
    this.authz.require('jugadores.editar');
    const before = this.db.get(this.db.players, id, 'Jugador');
    const data = this.validate(draft);
    const duplicate = this.db.players.find(
      (p) => p.id !== id && p.birthDate === data.birthDate && sameName(fullName(p), fullName(data)),
    );
    if (duplicate)
      throw new Error(`Ya existe ${fullName(duplicate)} (${duplicate.identifier}) con esos datos.`);
    const player = this.db.update(this.db.players, id, { ...data, updatedAt: nowDateTime() });
    this.audit.log(
      'EDITAR',
      'jugadores',
      'jugadores',
      id,
      `Edición de ${fullName(player)}`,
      before,
      player,
    );
    return this.db.respond(player);
  }

  /** HU-010: status change with history; nothing is deleted (payments, matches, categories stay). */
  async changeStatus(id: Id, status: PlayerStatus, reason: string): Promise<Player> {
    this.authz.require('jugadores.editar');
    const before = this.db.get(this.db.players, id, 'Jugador');
    if (before.status === status) throw new Error('El jugador ya tiene ese estatus.');
    const motive = required(reason, 'El motivo');
    const now = nowDateTime();
    const player = this.db.transaction(() => {
      const updated = this.db.update(this.db.players, id, { status, updatedAt: now });
      this.db.insert(this.db.statusHistory, {
        playerId: id,
        previousStatus: before.status,
        newStatus: status,
        reason: motive,
        changedBy: this.audit.currentUserId(),
        changedAt: now,
      });
      this.audit.log(
        'EDITAR',
        'jugadores',
        'jugadores',
        id,
        `Estatus ${before.status} → ${status}: ${motive}`,
        { status: before.status },
        { status },
      );
      return updated;
    });
    return this.db.respond(player);
  }

  /** HU-013: integrated record (data, categories, payments, uniforms, competitions, attendance). */
  async record(id: Id): Promise<PlayerRecord> {
    this.authz.assertPlayer(id, 'jugadores.consultar');
    const { db } = this;
    const player = db.get(db.players, id, 'Jugador');
    const on = today();
    const apps = effectiveApplications(db.payments, db.paymentApplications);
    const userEmail = (uid: Id | null) => db.users.find((u) => u.id === uid)?.email ?? null;
    const categoryName = (cid: Id | null) => db.categories.find((c) => c.id === cid)?.name ?? null;
    const seasonName = (sid: Id | null) => db.seasons.find((s) => s.id === sid)?.name ?? null;
    const charges = db.charges.filter((c) => c.playerId === id);
    const chargeRows = charges
      .map((c) => ({
        id: c.id,
        label: this.chargeLabel(c),
        dueDate: c.dueDate,
        netCents: c.status === 'CANCELADO' ? 0 : netAmount(c, db.discounts),
        paidCents: paidOn(c.id, apps),
        balanceCents: chargeBalance(c, apps, db.discounts),
        status: chargeStatus(c, apps, db.discounts, on),
      }))
      .sort((a, b) => (b.dueDate ?? '').localeCompare(a.dueDate ?? ''));
    const record: PlayerRecord = {
      player,
      name: fullName(player),
      age: ageOn(player.birthDate, on),
      statusHistory: db.statusHistory
        .filter((h) => h.playerId === id)
        .sort((a, b) => b.changedAt.localeCompare(a.changedAt) || b.id - a.id)
        .map((h) => ({ ...h, changedByEmail: userEmail(h.changedBy) })),
      tutors: db.tutorPlayers
        .filter((tp) => tp.playerId === id)
        .map((tp) => {
          const t = db.get(db.tutors, tp.tutorId, 'Tutor');
          return {
            tutorId: t.id,
            name: fullName(t),
            relationship: tp.relationship,
            isPrimary: tp.isPrimary,
            phone: t.phone,
            email: t.email,
          };
        })
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)),
      enrollments: db.enrollments
        .filter((e) => e.playerId === id)
        .map((e) => ({
          id: e.id,
          seasonName: seasonName(e.seasonId) ?? '—',
          enrolledOn: e.enrolledOn,
          amountCents: e.amountCents,
          status: e.status,
        })),
      categories: db.playerCategories
        .filter((pc) => pc.playerId === id)
        .sort((a, b) => b.startDate.localeCompare(a.startDate))
        .map((pc) => {
          const cat = db.categories.find((c) => c.id === pc.categoryId);
          return {
            id: pc.id,
            categoryName: cat?.name ?? '—',
            seasonName: seasonName(cat?.seasonId ?? null),
            startDate: pc.startDate,
            endDate: pc.endDate,
            isAgeException: pc.isAgeException,
            exceptionReason: pc.exceptionReason,
          };
        }),
      categoryChanges: db.categoryHistory
        .filter((h) => h.playerId === id)
        .sort((a, b) => b.changedAt.localeCompare(a.changedAt) || b.id - a.id)
        .map((h) => ({
          changedAt: h.changedAt,
          from: categoryName(h.previousCategoryId),
          to: categoryName(h.newCategoryId) ?? '—',
          reason: h.reason,
        })),
      charges: chargeRows,
      payments: db.payments
        .filter((p) => p.playerId === id)
        .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
        .map((p) => ({
          id: p.id,
          folio: p.folio,
          paidAt: p.paidAt,
          amountCents: p.amountCents,
          method: p.method,
          status: p.status,
        })),
      balanceCents: sumCents(chargeRows.map((c) => c.balanceCents)),
      overdueCents: sumCents(
        chargeRows.filter((c) => c.status === 'VENCIDO').map((c) => c.balanceCents),
      ),
      uniforms: db.uniformOrders
        .filter((o) => o.playerId === id)
        .map((o) => {
          const lines = db.uniformOrderLines.filter((l) => l.orderId === o.id);
          return {
            id: o.id,
            requestedOn: o.requestedOn,
            status: o.status,
            items: lines.map((l) => {
              const v = db.uniformVariants.find((x) => x.id === l.variantId);
              const p = db.uniformProducts.find((x) => x.id === v?.productId);
              return `${l.quantity} × ${p?.name ?? '—'} ${v?.size ?? ''}`.trim();
            }),
            totalCents: sumCents(lines.map((l) => multiplyCents(l.unitPriceCents, l.quantity))),
          };
        }),
      competitions: db.rosters
        .filter((r) => r.playerId === id)
        .map((r) => {
          const cc = db.get(db.competitionCategories, r.competitionCategoryId, 'Participación');
          const comp = db.get(db.competitions, cc.competitionId, 'Competencia');
          return {
            competitionName: comp.name,
            type: comp.type,
            categoryName: categoryName(cc.categoryId) ?? '—',
            joinedOn: r.joinedOn,
            leftOn: r.leftOn,
            active: r.active,
          };
        }),
      attendance: (() => {
        const rows = db.attendance.filter((a) => a.playerId === id);
        return {
          total: rows.length,
          present: rows.filter((a) => a.status === 'PRESENTE').length,
          absent: rows.filter((a) => a.status === 'AUSENTE').length,
          justified: rows.filter((a) => a.status === 'JUSTIFICADO').length,
        };
      })(),
    };
    return db.respond(record);
  }

  /** "Mensualidad 2026-09", "Inscripción anual · INS-3", … (cargos has no description column). */
  chargeLabel(charge: Charge): string {
    const concept = this.db.concepts.find((c) => c.id === charge.conceptId)?.name ?? 'Cargo';
    return [concept, charge.period, charge.reference].filter(Boolean).join(' · ');
  }

  private validate(draft: PlayerDraft): PlayerDraft {
    if (!isISODate(draft.birthDate)) throw new Error('Fecha de nacimiento inválida.');
    if (draft.birthDate > today()) throw new Error('La fecha de nacimiento no puede ser futura.');
    if (!(['F', 'M', 'OTRO', 'NO_ESPECIFICADO'] as Sex[]).includes(draft.sex))
      throw new Error('Sexo inválido.');
    return {
      firstName: required(draft.firstName, 'El nombre', 100),
      lastName1: required(draft.lastName1, 'El apellido paterno', 100),
      lastName2: optional(draft.lastName2, 'El apellido materno', 100),
      birthDate: draft.birthDate,
      sex: draft.sex,
      phone: optionalPhone(draft.phone),
      email: optionalEmail(draft.email),
      address: optional(draft.address, 'La dirección'),
    };
  }

  /** jugadores.identificador: 'J-0001'… (HU-008.4). The API generates it in the INSERT transaction. */
  private nextIdentifier(): string {
    const max = this.db.players.reduce(
      (m, p) => Math.max(m, Number(p.identifier.replace(/\D/g, '')) || 0),
      0,
    );
    return `J-${String(max + 1).padStart(4, '0')}`;
  }
}

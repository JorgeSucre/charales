import { sumCents } from '../../shared/money';
import { Injectable, inject } from '@angular/core';
import { AuthorizationService } from '../../core/auth/authorization.service';
import { MockDb } from '../../core/data/mock-db';
import { Cents, Id, ISODate, PlayerStatus, Time, fullName } from '../../core/models';
import { addDays, ageOn, today, isCurrentAssignment } from '../../shared/dates';
import {
  chargeBalance,
  debtsByPlayer,
  effectiveApplications,
  incomeByMonthAndConcept,
  netAmount,
} from '../billing/billing.rules';
import { BillingService } from '../billing/billing.service';
import { MatchService } from '../matches/match.service';

export type KpiKey = 'players' | 'categories' | 'matches' | 'overdue' | 'overduePlayers' | 'income';

/** A KPI says in plain words what it counts (HU-065.2) and links to the module behind it. */
export interface Kpi {
  key: KpiKey;
  label: string;
  value: number;
  money?: boolean;
  /** What the number means, for the user (never table or column names). */
  hint: string;
  link: string;
}

/** Charges by their derived status (HU-044.3); CANCELADO never counts. */
export type OpenChargeStatus = 'PENDIENTE' | 'PARCIAL' | 'PAGADO' | 'VENCIDO';

export interface Dashboard {
  /** The period of the income KPI (inclusive dates); every other KPI is a snapshot of today. */
  period: { from: ISODate; to: ISODate };
  kpis: Kpi[];
  /** Every player by status (ACTIVO, BAJA_TEMPORAL, BAJA_DEFINITIVA), zeros included. */
  playersByStatus: { status: PlayerStatus; count: number }[];
  /** Non-cancelled charges by status: how many, what they amount to after discounts, and what is still owed. */
  chargesByStatus: {
    status: OpenChargeStatus;
    count: number;
    netCents: Cents;
    balanceCents: Cents;
  }[];
  categories: { id: Id; name: string; occupancy: number; capacity: number | null }[];
  upcoming: {
    date: ISODate;
    time: Time;
    title: string;
    venueName: string | null;
    status: string;
  }[];
}

export interface IncomeView {
  month: string;
  conceptName: string;
  totalCents: Cents;
}

export interface PlayersByCategoryRow {
  categoryId: Id | null;
  categoryName: string;
  players: {
    name: string;
    identifier: string;
    age: number;
    status: PlayerStatus;
    tutor: string | null;
    contact: string | null;
  }[];
}

export interface AgendaItem {
  kind: 'training' | 'match';
  date: ISODate;
  start: Time;
  end: Time | null;
  categoryId: Id;
  categoryName: string;
  coachIds: Id[];
  coachNames: string;
  venueName: string;
  detail: string;
  status: string;
}

/** Reports and the administrative dashboard (HU-065..068). Sources are the same tables the modules write. */
@Injectable({ providedIn: 'root' })
export class ReportService {
  private db = inject(MockDb);
  private authz = inject(AuthorizationService);
  private billing = inject(BillingService);
  private matches = inject(MatchService);

  /**
   * HU-065: KPIs (income for the period, default the current month up to today; the rest a snapshot of today) and
   * the dashboard charts. Charge states are synced first, so VENCIDO is current.
   */
  async dashboard(
    from: ISODate = `${today().slice(0, 7)}-01`,
    to: ISODate = today(),
  ): Promise<Dashboard> {
    this.authz.require('reportes.consultar');
    this.billing.syncStatuses();
    const on = today();
    const apps = effectiveApplications(this.db.payments, this.db.paymentApplications);
    const debts = debtsByPlayer(this.db.charges, apps, this.db.discounts, on);
    const income = incomeByMonthAndConcept(this.db.payments, apps, this.db.charges, from, to);
    const season = this.db.seasons.find((s) => s.isCurrent);
    const categories = this.db.categories.filter((c) => c.active && c.seasonId === season?.id);
    const upcoming = this.matches
      .views({ from: on, to: addDays(on, 14) })
      .filter((m) => m.upcoming);
    return this.db.respond({
      period: { from, to },
      kpis: [
        {
          key: 'players',
          label: 'Jugadores activos',
          value: this.db.players.filter((p) => p.status === 'ACTIVO').length,
          hint: 'Con estatus Activo; no incluye bajas temporales ni definitivas.',
          link: '/admin/players',
        },
        {
          key: 'categories',
          label: 'Categorías activas',
          value: categories.length,
          hint: season
            ? `Categorías activas de la temporada actual (${season.name}).`
            : 'No hay temporada actual.',
          link: '/sports/categories',
        },
        {
          key: 'matches',
          label: 'Partidos próximos',
          value: upcoming.length,
          hint: 'Programados o reprogramados en los próximos 14 días.',
          link: '/sports/matches',
        },
        {
          key: 'overdue',
          label: 'Adeudo vencido',
          value: sumCents(debts.map((d) => d.overdueCents)),
          money: true,
          hint: 'Saldo de cargos con vencimiento pasado, ya con descuentos y pagos aplicados.',
          link: '/admin/billing/debts',
        },
        {
          // Counted per player (debtsByPlayer), as it always was; the label used to say «familias».
          key: 'overduePlayers',
          label: 'Jugadores con adeudo vencido',
          value: debts.filter((d) => d.overdueCents > 0).length,
          hint: 'Jugadores con al menos un cargo vencido sin pagar.',
          link: '/admin/billing/debts',
        },
        {
          key: 'income',
          label: 'Ingresos del periodo',
          value: sumCents(income.map((r) => r.totalCents)),
          money: true,
          hint: 'Pagos registrados en el periodo; los cancelados no cuentan.',
          link: '/admin/reports/income',
        },
      ],
      playersByStatus: (['ACTIVO', 'BAJA_TEMPORAL', 'BAJA_DEFINITIVA'] as const).map((status) => ({
        status,
        count: this.db.players.filter((p) => p.status === status).length,
      })),
      chargesByStatus: (['PENDIENTE', 'PARCIAL', 'VENCIDO', 'PAGADO'] as const).map((status) => {
        const rows = this.db.charges.filter((c) => c.status === status);
        return {
          status,
          count: rows.length,
          netCents: sumCents(rows.map((c) => netAmount(c, this.db.discounts))),
          balanceCents: sumCents(rows.map((c) => chargeBalance(c, apps, this.db.discounts))),
        };
      }),
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        occupancy: this.db.playerCategories.filter((pc) => pc.categoryId === c.id && !pc.endDate)
          .length,
        capacity: c.maxCapacity,
      })),
      upcoming: upcoming.slice(0, 5).map((m) => ({
        date: m.date,
        time: m.time,
        title: `${m.categoryName} vs ${m.opponentName ?? '—'} (${m.competitionName})`,
        venueName: m.venueName,
        status: m.status,
      })),
    });
  }

  /** HU-066: players by current category with primary tutor and contact; filter by category and status. */
  async playersByCategory(
    filter: { categoryId?: Id | null; status?: PlayerStatus | '' } = {},
  ): Promise<PlayersByCategoryRow[]> {
    this.authz.require('reportes.consultar');
    const on = today();
    const current = new Map(
      this.db.playerCategories
        .filter((pc) => !pc.endDate)
        .map((pc) => [pc.playerId, pc.categoryId]),
    );
    const groups = new Map<Id | null, PlayersByCategoryRow>();
    for (const p of this.db.players) {
      if (filter.status && p.status !== filter.status) continue;
      const categoryId = current.get(p.id) ?? null;
      if (filter.categoryId != null && categoryId !== filter.categoryId) continue;
      const group = groups.get(categoryId) ?? {
        categoryId,
        categoryName: this.db.categories.find((c) => c.id === categoryId)?.name ?? 'Sin categoría',
        players: [],
      };
      const link = this.db.tutorPlayers.find((tp) => tp.playerId === p.id && tp.isPrimary);
      const tutor = this.db.tutors.find((t) => t.id === link?.tutorId);
      group.players.push({
        name: fullName(p),
        identifier: p.identifier,
        age: ageOn(p.birthDate, on),
        status: p.status,
        tutor: tutor ? fullName(tutor) : null,
        contact: tutor ? [tutor.phone, tutor.email].filter(Boolean).join(' · ') : null,
      });
      groups.set(categoryId, group);
    }
    return this.db.respond(
      [...groups.values()]
        .map((g) => ({ ...g, players: g.players.sort((a, b) => a.name.localeCompare(b.name)) }))
        .sort((a, b) => a.categoryName.localeCompare(b.categoryName)),
    );
  }

  /** HU-067: payments received in the range (cancelled excluded), grouped by month and concept. */
  async income(from: ISODate, to: ISODate): Promise<IncomeView[]> {
    this.authz.require('reportes.consultar');
    const rows = incomeByMonthAndConcept(
      this.db.payments,
      this.db.paymentApplications,
      this.db.charges,
      from,
      to,
    );
    return this.db.respond(
      rows.map((r) => ({
        month: r.month,
        conceptName: this.db.concepts.find((c) => c.id === r.conceptId)?.name ?? '—',
        totalCents: r.totalCents,
      })),
    );
  }

  /** HU-068: trainings and matches together, by date; the page filters by type, category and coach. */
  async agenda(from: ISODate, to: ISODate): Promise<AgendaItem[]> {
    this.authz.require('reportes.consultar');
    const { db } = this;
    const category = (id: Id) => db.categories.find((c) => c.id === id)?.name ?? '—';
    const venue = (id: Id | null) => db.venues.find((v) => v.id === id)?.name ?? '—';
    const coachName = (id: Id) => {
      const c = db.coaches.find((x) => x.id === id);
      return c ? fullName(c) : '—';
    };
    const trainings: AgendaItem[] = db.trainingSessions
      .filter((s) => s.date >= from && s.date <= to)
      .map((s) => ({
        kind: 'training',
        date: s.date,
        start: s.startTime,
        end: s.endTime,
        categoryId: s.categoryId,
        categoryName: category(s.categoryId),
        coachIds: s.coachId ? [s.coachId] : [],
        coachNames: s.coachId ? coachName(s.coachId) : '—',
        venueName: venue(s.venueId),
        detail: s.objective ? `Entrenamiento: ${s.objective}` : 'Entrenamiento',
        status: s.status,
      }));
    const matches: AgendaItem[] = this.matches.views({ from, to }).map((m) => {
      const coachIds = db.coachCompetitions
        .filter(
          (a) =>
            a.competitionCategoryId === m.competitionCategoryId && isCurrentAssignment(a, m.date),
        )
        .map((a) => a.coachId);
      return {
        kind: 'match',
        date: m.date,
        start: m.time,
        end: null,
        categoryId: m.categoryId,
        categoryName: m.categoryName,
        coachIds,
        coachNames: coachIds.map(coachName).join(', ') || '—',
        venueName: m.venueName ?? '—',
        detail: `vs ${m.opponentName ?? '—'} · ${m.competitionName}`,
        status: m.status,
      };
    });
    return db.respond(
      [...trainings, ...matches].sort((a, b) =>
        `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`),
      ),
    );
  }
}

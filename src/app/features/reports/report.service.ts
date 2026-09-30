import { Injectable, inject } from '@angular/core';
import { MockDb } from '../../core/data/mock-db';
import { incomeByMonthAndConcept } from '../billing/billing.rules';

export interface IncomeView {
  month: string;
  conceptName: string;
  totalCents: number;
}

export interface AgendaItem {
  kind: 'training' | 'match';
  startsAt: string;
  categoryId: string;
  categoryName: string;
  coachName: string;
  venueName: string;
  detail: string;
}

/** HU-067 and HU-068. Aggregations should move to the backend once it exists. */
@Injectable({ providedIn: 'root' })
export class ReportService {
  private db = inject(MockDb);

  income(from: string, to: string): Promise<IncomeView[]> {
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

  agenda(): Promise<AgendaItem[]> {
    const { db } = this;
    const category = (id: string) => db.categories.find((c) => c.id === id)?.name ?? '—';
    const venue = (id: string) => db.venues.find((v) => v.id === id)?.name ?? '—';
    const coach = (id?: string) => db.coaches.find((c) => c.id === id)?.fullName ?? '—';
    const items: AgendaItem[] = [
      ...db.trainings.map((t) => ({
        kind: 'training' as const,
        startsAt: t.startsAt,
        categoryId: t.categoryId,
        categoryName: category(t.categoryId),
        coachName: coach(t.coachId),
        venueName: venue(t.venueId),
        detail: `Entrenamiento (${t.durationMin} min)`,
      })),
      ...db.matches.map((m) => ({
        kind: 'match' as const,
        startsAt: m.startsAt,
        categoryId: m.categoryId,
        categoryName: category(m.categoryId),
        coachName: coach(
          db.coachAssignments.find(
            (a) => a.competitionId === m.competitionId && a.categoryId === m.categoryId,
          )?.coachId,
        ),
        venueName: venue(m.venueId),
        detail: `vs ${m.opponent} — ${db.competitions.find((c) => c.id === m.competitionId)?.name ?? ''}`,
      })),
    ];
    return db.respond(items.sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
  }
}

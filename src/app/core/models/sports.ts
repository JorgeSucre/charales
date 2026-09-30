/** Seasons, categories, enrollments, competitions and schedule. */

export interface Season {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  active: boolean;
}

export interface Category {
  id: string;
  seasonId: string;
  name: string;
  birthYearFrom: number;
  birthYearTo: number;
}

/**
 * Administrative enrollment of a player in a category for a season (HU-020).
 * It is also the player↔category link, so there is no separate PlayerCategory entity.
 */
export interface Enrollment {
  id: string;
  playerId: string;
  seasonId: string;
  categoryId: string;
  enrolledAt: string;
  status: 'active' | 'cancelled';
  notes?: string;
}

export interface Competition {
  id: string;
  seasonId: string;
  name: string;
  kind: 'tournament' | 'league';
}

/** Which coach takes which category to which competition (HU-026). */
export interface CoachAssignment {
  id: string;
  coachId: string;
  competitionId: string;
  categoryId: string;
}

export interface Venue {
  id: string;
  name: string;
  address: string;
}

export interface Match {
  id: string;
  competitionId: string;
  categoryId: string;
  venueId: string;
  startsAt: string; // ISO datetime
  opponent: string;
}

export interface TrainingSession {
  id: string;
  categoryId: string;
  coachId: string;
  venueId: string;
  startsAt: string;
  durationMin: number;
}

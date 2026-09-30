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
 * Administrative/annual enrollment (HU-020): the player is registered with the school for a season.
 * It says nothing about the category — see PlayerCategory.
 */
export interface Enrollment {
  id: string;
  playerId: string;
  seasonId: string;
  enrolledAt: string;
  status: 'active' | 'cancelled';
  notes?: string;
}

/**
 * Sporting membership (spec: jugador_categoria): which category the player belongs to.
 * The season comes from the category. Open-ended while `endDate` is unset; a category change
 * closes the current row and opens a new one, so history is kept.
 */
export interface PlayerCategory {
  id: string;
  playerId: string;
  categoryId: string;
  startDate: string;
  endDate?: string;
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

import { Cents, DateTime, Id, ISODate, Time } from './common';

/** temporadas. Only one isCurrent (uq_temporada_actual) and the current one must be active. */
export interface Season {
  id: Id;
  name: string;
  startDate: ISODate;
  endDate: ISODate;
  active: boolean;
  isCurrent: boolean;
  createdAt: DateTime;
}

/** sedes (venue / pitch). */
export interface Venue {
  id: Id;
  name: string;
  location: string | null;
  reference: string | null;
  active: boolean;
  createdAt: DateTime;
}

/** categorias. The category IS the sporting group (there is no "team" entity). */
export interface Category {
  id: Id;
  seasonId: Id | null;
  name: string;
  minAge: number;
  maxAge: number;
  maxCapacity: number | null;
  active: boolean;
  createdAt: DateTime;
  updatedAt: DateTime;
}

export type EnrollmentStatus = 'PENDIENTE' | 'ACTIVA' | 'CANCELADA' | 'FINALIZADA';

/**
 * inscripciones — administrative/annual enrollment (HU-020): player + season. It says nothing about the
 * category; that is PlayerCategory. One per player and season (uq_inscripcion_jugador_temporada).
 */
export interface Enrollment {
  id: Id;
  playerId: Id;
  seasonId: Id;
  enrolledOn: ISODate;
  amountCents: Cents;
  status: EnrollmentStatus;
  createdAt: DateTime;
}

/**
 * jugador_categoria — sporting membership (HU-017). Current = endDate null (one per player,
 * uq_jugador_categoria_vigente). A change closes the current row and opens a new one (HU-019).
 */
export interface PlayerCategory {
  id: Id;
  playerId: Id;
  categoryId: Id;
  startDate: ISODate;
  endDate: ISODate | null;
  isAgeException: boolean;
  exceptionReason: string | null;
  active: boolean;
  createdAt: DateTime;
}

/** historial_categoria */
export interface CategoryChange {
  id: Id;
  playerId: Id;
  previousCategoryId: Id | null;
  newCategoryId: Id;
  reason: string | null;
  changedBy: Id | null;
  changedAt: DateTime;
}

/** entrenador_categoria (HU-023). Current = active with no endDate. */
export interface CoachCategory {
  id: Id;
  coachId: Id;
  categoryId: Id;
  responsibility: string | null;
  startDate: ISODate;
  endDate: ISODate | null;
  active: boolean;
  createdAt: DateTime;
}

/** horarios_entrenamiento (HU-016). weekday: 1 = Monday … 7 = Sunday. */
export interface TrainingSchedule {
  id: Id;
  categoryId: Id;
  venueId: Id;
  weekday: number;
  startTime: Time;
  endTime: Time;
  active: boolean;
  createdAt: DateTime;
}

export type TrainingStatus = 'PROGRAMADO' | 'REALIZADO' | 'CANCELADO';

/** sesiones_entrenamiento (HU-028). scheduleId, when set, belongs to the same category. */
export interface TrainingSession {
  id: Id;
  categoryId: Id;
  venueId: Id;
  coachId: Id | null;
  scheduleId: Id | null;
  date: ISODate;
  startTime: Time;
  endTime: Time;
  status: TrainingStatus;
  objective: string | null;
  notes: string | null;
  createdAt: DateTime;
  updatedAt: DateTime;
}

export type AttendanceStatus = 'PRESENTE' | 'AUSENTE' | 'JUSTIFICADO';

/** asistencias. One per session and player (uq_asistencia_sesion_jugador). */
export interface Attendance {
  id: Id;
  sessionId: Id;
  playerId: Id;
  status: AttendanceStatus;
  notes: string | null;
  recordedBy: Id | null;
  recordedAt: DateTime;
  updatedAt: DateTime;
}

export type CompetitionType = 'TORNEO' | 'LIGA' | 'OTRO';
export type CompetitionStatus = 'PLANIFICADA' | 'ACTIVA' | 'FINALIZADA' | 'CANCELADA';

/** competencias — tournaments, leagues and others share one entity (tipo). */
export interface Competition {
  id: Id;
  seasonId: Id | null;
  name: string;
  type: CompetitionType;
  organizer: string | null;
  contact: string | null;
  startDate: ISODate | null;
  endDate: ISODate | null;
  status: CompetitionStatus;
  notes: string | null;
  createdAt: DateTime;
}

export type ParticipationStatus = 'PENDIENTE' | 'INSCRITA' | 'BAJA' | 'FINALIZADA';

/** competencia_categoria (HU-035): a category takes part in a competition. Unique per pair. */
export interface CompetitionCategory {
  id: Id;
  competitionId: Id;
  categoryId: Id;
  registeredOn: ISODate;
  costCents: Cents | null;
  status: ParticipationStatus;
  createdAt: DateTime;
}

/** jugador_competencia_categoria (HU-036): roster. Unique per (player, participation). */
export interface RosterEntry {
  id: Id;
  playerId: Id;
  competitionCategoryId: Id;
  joinedOn: ISODate;
  leftOn: ISODate | null;
  active: boolean;
  createdAt: DateTime;
}

/** entrenador_competencia_categoria (HU-026): coach of a participation, with validity. Unique per pair. */
export interface CoachCompetition {
  id: Id;
  coachId: Id;
  competitionCategoryId: Id;
  startDate: ISODate;
  endDate: ISODate | null;
  active: boolean;
  createdAt: DateTime;
}

/** rivales */
export interface Opponent {
  id: Id;
  name: string;
  contact: string | null;
  notes: string | null;
  active: boolean;
}

export type MatchStatus = 'PROGRAMADO' | 'JUGADO' | 'CANCELADO' | 'REPROGRAMADO';

/** partidos. Score only when JUGADO, both sides or none (chk_partido_goles). */
export interface Match {
  id: Id;
  competitionCategoryId: Id;
  opponentId: Id | null;
  venueId: Id | null;
  date: ISODate;
  time: Time;
  homeAway: 'LOCAL' | 'VISITANTE';
  goalsFor: number | null;
  goalsAgainst: number | null;
  status: MatchStatus;
  rescheduleReason: string | null;
  notes: string | null;
  createdAt: DateTime;
  updatedAt: DateTime;
}

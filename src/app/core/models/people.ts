/** Shared people contracts. Players are owned by another team member (HU-008..010); only the contract lives here. */

export type Role = 'admin' | 'secretary' | 'coach' | 'tutor';

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  active: boolean;
  /** Set when role === 'tutor'. */
  tutorId?: string;
  /** Set when role === 'coach'. */
  coachId?: string;
}

export interface Player {
  id: string;
  fullName: string;
  birthDate: string; // ISO date
  active: boolean;
}

/** Tutor ↔ player link (tutor_players). `isPrimary` is per player: at most one primary contact per player. */
export interface TutorPlayer {
  playerId: string;
  isPrimary: boolean;
}

export interface Tutor {
  id: string;
  fullName: string;
  relationship: string; // padre, madre, abuela...
  phone: string;
  email?: string;
  players: TutorPlayer[];
}

export interface Coach {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  active: boolean;
}

import {
  ChargeStatus,
  CompetitionStatus,
  EnrollmentStatus,
  MatchStatus,
  ParticipationStatus,
  PaymentStatus,
  PlayerStatus,
  TrainingStatus,
  UniformOrderStatus,
} from '../core/models';

/**
 * Colour of a status tag (`class="tag {{ tone }}"`, styles.css): ok = correct or done, warn = pending, temporary or
 * scheduled, danger = breach or definitive leave, neutral = no longer in progress without being an error. Display
 * only: the status strings stay as the services return them, and the tag always shows its label too.
 */
export type Tone = 'ok' | 'warn' | 'danger' | 'neutral';

export const PLAYER_TONE: Record<PlayerStatus, Tone> = {
  ACTIVO: 'ok',
  BAJA_TEMPORAL: 'warn',
  BAJA_DEFINITIVA: 'danger',
};

export const TRAINING_TONE: Record<TrainingStatus, Tone> = {
  PROGRAMADO: 'warn',
  REALIZADO: 'ok',
  CANCELADO: 'neutral',
};

export const MATCH_TONE: Record<MatchStatus, Tone> = {
  PROGRAMADO: 'warn',
  REPROGRAMADO: 'warn',
  JUGADO: 'ok',
  CANCELADO: 'neutral',
};

export const CHARGE_TONE: Record<ChargeStatus, Tone> = {
  PAGADO: 'ok',
  PENDIENTE: 'warn',
  PARCIAL: 'warn',
  VENCIDO: 'danger',
  CANCELADO: 'neutral',
};

export const PAYMENT_TONE: Record<PaymentStatus, Tone> = {
  APLICADO: 'ok',
  CANCELADO: 'neutral',
};

export const ORDER_TONE: Record<UniformOrderStatus, Tone> = {
  ENTREGADO: 'ok',
  PAGADO: 'ok',
  SOLICITADO: 'warn',
  CANCELADO: 'neutral',
};

export const ENROLLMENT_TONE: Record<EnrollmentStatus, Tone> = {
  ACTIVA: 'ok',
  PENDIENTE: 'warn',
  FINALIZADA: 'neutral',
  CANCELADA: 'neutral',
};

export const COMPETITION_TONE: Record<CompetitionStatus, Tone> = {
  PLANIFICADA: 'warn',
  ACTIVA: 'ok',
  FINALIZADA: 'neutral',
  CANCELADA: 'neutral',
};

export const PARTICIPATION_TONE: Record<ParticipationStatus, Tone> = {
  INSCRITA: 'ok',
  PENDIENTE: 'warn',
  FINALIZADA: 'neutral',
  BAJA: 'danger',
};

/** For views typed with a plain string status: an unknown value is shown as neutral. */
export function toneOf(tones: Record<string, Tone>, status: string): Tone {
  return tones[status] ?? 'neutral';
}

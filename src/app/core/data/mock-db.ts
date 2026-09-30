import { Injectable } from '@angular/core';
import {
  Category,
  Charge,
  ChargeConcept,
  Coach,
  CoachAssignment,
  Competition,
  CompetitionCategory,
  Enrollment,
  Match,
  Payment,
  PaymentApplication,
  Player,
  PlayerCategory,
  Season,
  TrainingSession,
  Tutor,
  UniformOrder,
  UniformProduct,
  UniformVariant,
  User,
  Venue,
} from '../models';

/**
 * In-memory stand-in for the future API. ONLY services may inject this.
 * To connect a backend: replace the MockDb calls inside each service with HttpClient and delete this file.
 * No passwords are stored here on purpose.
 */
@Injectable({ providedIn: 'root' })
export class MockDb {
  users: User[] = [
    { id: 'u1', email: 'admin@charales.mx', fullName: 'Ana Admin', role: 'admin', active: true },
    {
      id: 'u2',
      email: 'secretaria@charales.mx',
      fullName: 'Sofía Secretaria',
      role: 'secretary',
      active: true,
    },
    {
      id: 'u3',
      email: 'coach@charales.mx',
      fullName: 'Carlos Coach',
      role: 'coach',
      active: true,
      coachId: 'c1',
    },
    {
      id: 'u4',
      email: 'tutor@charales.mx',
      fullName: 'Teresa Tutor',
      role: 'tutor',
      active: true,
      tutorId: 't1',
    },
    {
      id: 'u5',
      email: 'baja@charales.mx',
      fullName: 'Usuario Inactivo',
      role: 'secretary',
      active: false,
    },
  ];
  players: Player[] = [
    { id: 'p1', fullName: 'Diego Hernández', birthDate: '2016-03-12', active: true },
    { id: 'p2', fullName: 'Lucía Hernández', birthDate: '2014-07-01', active: true },
    { id: 'p3', fullName: 'Mateo Ruiz', birthDate: '2016-11-20', active: true },
    { id: 'p4', fullName: 'Valeria Soto', birthDate: '2014-02-05', active: false },
  ];
  tutors: Tutor[] = [
    {
      id: 't1',
      fullName: 'Teresa Tutor',
      relationship: 'Madre',
      phone: '5550000001',
      email: 'tutor@charales.mx',
      playerIds: ['p1', 'p2'],
    },
    {
      id: 't2',
      fullName: 'Jorge Ruiz',
      relationship: 'Padre',
      phone: '5550000002',
      playerIds: ['p3'],
    },
  ];
  coaches: Coach[] = [
    {
      id: 'c1',
      fullName: 'Carlos Coach',
      phone: '5551111111',
      email: 'coach@charales.mx',
      active: true,
    },
    {
      id: 'c2',
      fullName: 'Marta Díaz',
      phone: '5552222222',
      email: 'marta@charales.mx',
      active: true,
    },
  ];
  seasons: Season[] = [
    {
      id: 's1',
      name: 'Temporada 2026-2027',
      startDate: '2026-08-01',
      endDate: '2027-06-30',
      active: true,
    },
  ];
  categories: Category[] = [
    { id: 'cat1', seasonId: 's1', name: 'Sub-10', birthYearFrom: 2016, birthYearTo: 2017 },
    { id: 'cat2', seasonId: 's1', name: 'Sub-12', birthYearFrom: 2014, birthYearTo: 2015 },
  ];
  enrollments: Enrollment[] = [
    {
      id: 'e1',
      playerId: 'p1',
      seasonId: 's1',
      enrolledAt: '2026-08-05',
      status: 'active',
    },
    {
      id: 'e2',
      playerId: 'p2',
      seasonId: 's1',
      enrolledAt: '2026-08-05',
      status: 'active',
    },
    {
      id: 'e3',
      playerId: 'p3',
      seasonId: 's1',
      enrolledAt: '2026-08-10',
      status: 'active',
    },
  ];
  playerCategories: PlayerCategory[] = [
    { id: 'pc1', playerId: 'p1', categoryId: 'cat1', startDate: '2026-08-05' },
    { id: 'pc2', playerId: 'p2', categoryId: 'cat2', startDate: '2026-08-05' },
    { id: 'pc3', playerId: 'p3', categoryId: 'cat1', startDate: '2026-08-10' },
  ];
  competitions: Competition[] = [
    { id: 'comp1', seasonId: 's1', name: 'Liga Municipal', kind: 'league' },
    { id: 'comp2', seasonId: 's1', name: 'Copa Otoño', kind: 'tournament' },
  ];
  competitionCategories: CompetitionCategory[] = [
    { id: 'cc1', competitionId: 'comp1', categoryId: 'cat1' },
    { id: 'cc2', competitionId: 'comp2', categoryId: 'cat2' },
    { id: 'cc3', competitionId: 'comp1', categoryId: 'cat2' }, // participates, no coach assigned yet
  ];
  coachAssignments: CoachAssignment[] = [
    { id: 'a1', coachId: 'c1', competitionId: 'comp1', categoryId: 'cat1' },
    { id: 'a2', coachId: 'c2', competitionId: 'comp2', categoryId: 'cat2' },
  ];
  venues: Venue[] = [
    { id: 'v1', name: 'Campo Principal', address: 'Av. Siempre Viva 123' },
    { id: 'v2', name: 'Unidad Deportiva Norte', address: 'Calle Norte 45' },
  ];
  matches: Match[] = [
    {
      id: 'm1',
      competitionId: 'comp1',
      categoryId: 'cat1',
      venueId: 'v2',
      startsAt: '2026-10-04T10:00',
      opponent: 'Tiburones',
    },
    {
      id: 'm2',
      competitionId: 'comp2',
      categoryId: 'cat2',
      venueId: 'v1',
      startsAt: '2026-10-05T12:00',
      opponent: 'Halcones',
    },
  ];
  trainings: TrainingSession[] = [
    {
      id: 'tr1',
      categoryId: 'cat1',
      coachId: 'c1',
      venueId: 'v1',
      startsAt: '2026-10-01T17:00',
      durationMin: 90,
    },
    {
      id: 'tr2',
      categoryId: 'cat2',
      coachId: 'c2',
      venueId: 'v1',
      startsAt: '2026-10-02T17:00',
      durationMin: 90,
    },
  ];
  concepts: ChargeConcept[] = [
    { id: 'cc1', name: 'Mensualidad', kind: 'monthly', defaultAmountCents: 60000, active: true },
    {
      id: 'cc2',
      name: 'Inscripción anual',
      kind: 'enrollment',
      defaultAmountCents: 120000,
      active: true,
    },
    { id: 'cc3', name: 'Uniforme', kind: 'uniform', defaultAmountCents: 0, active: true },
  ];
  charges: Charge[] = [
    {
      id: 'ch1',
      playerId: 'p1',
      conceptId: 'cc1',
      amountCents: 60000,
      description: 'Mensualidad 2026-09',
      dueDate: '2026-09-10',
      period: '2026-09',
    },
    {
      id: 'ch2',
      playerId: 'p2',
      conceptId: 'cc1',
      amountCents: 60000,
      description: 'Mensualidad 2026-09',
      dueDate: '2026-09-10',
      period: '2026-09',
    },
    {
      id: 'ch3',
      playerId: 'p3',
      conceptId: 'cc2',
      amountCents: 120000,
      description: 'Inscripción 2026-2027',
      dueDate: '2026-08-15',
    },
  ];
  payments: Payment[] = [
    {
      id: 'pay1',
      receiptNumber: 'R-0001',
      playerId: 'p1',
      amountCents: 60000,
      method: 'cash',
      paidAt: '2026-09-08',
    },
    {
      id: 'pay2',
      receiptNumber: 'R-0002',
      playerId: 'p3',
      amountCents: 50000,
      method: 'transfer',
      paidAt: '2026-08-20',
    },
  ];
  paymentApplications: PaymentApplication[] = [
    { paymentId: 'pay1', chargeId: 'ch1', amountCents: 60000 },
    { paymentId: 'pay2', chargeId: 'ch3', amountCents: 50000 },
  ];
  uniformProducts: UniformProduct[] = [
    { id: 'up1', name: 'Jersey local', active: true },
    { id: 'up2', name: 'Short', active: true },
  ];
  uniformVariants: UniformVariant[] = [
    { id: 'uv1', productId: 'up1', size: 'CH', priceCents: 35000, active: true },
    { id: 'uv2', productId: 'up1', size: 'M', priceCents: 35000, active: true },
    { id: 'uv3', productId: 'up2', size: 'CH', priceCents: 15000, active: true },
  ];
  uniformOrders: UniformOrder[] = [];

  private seq = 1000;

  id(prefix: string): string {
    return `${prefix}${++this.seq}`;
  }

  /** Simulates network latency and returns a copy, so callers can't mutate the "server" state. */
  async respond<T>(value: T): Promise<T> {
    await new Promise((r) => setTimeout(r, 150));
    return structuredClone(value);
  }
}

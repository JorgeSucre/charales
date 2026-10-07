import { Injectable } from '@angular/core';
import {
  Attendance,
  AuditEntry,
  Category,
  CategoryChange,
  Charge,
  ChargeConcept,
  Coach,
  CoachCategory,
  CoachCompetition,
  Competition,
  CompetitionCategory,
  DateTime,
  Discount,
  Enrollment,
  Id,
  Match,
  Notice,
  NoticeRecipient,
  Opponent,
  PasswordResetToken,
  Payment,
  PaymentApplication,
  Permission,
  Player,
  PlayerCategory,
  PlayerStatusChange,
  Role,
  RolePermission,
  RosterEntry,
  Season,
  Session,
  Tutor,
  TutorPlayer,
  TrainingSchedule,
  TrainingSession,
  UniformOrder,
  UniformOrderLine,
  UniformProduct,
  UniformVariant,
  User,
  Venue,
} from '../models';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_CATALOG, splitPermission } from '../auth/permissions';

/** usuarios row as stored; password_hash never leaves the "server" (services strip it). */
export type UserRow = User & { passwordHash: string };

/** Simulated mail gateway (HU-005, HU-012). The backend replaces it with real e-mail. */
export interface OutboxMessage {
  to: string;
  subject: string;
  body: string;
  sentAt: DateTime;
}

const T0 = '2026-08-01T09:00:00';
/** Mock-only salted SHA-256 of 'demo1234' (salt 'charales-demo'). The real backend uses argon2/bcrypt. */
const DEMO_HASH =
  'sha256$charales-demo$bae467a27eb25473688afda13ab3bad86b1db12cea53ae219357c7b396244c65';

function seedPermissions(): { permissions: Permission[]; rolePermissions: RolePermission[] } {
  const permissions = PERMISSION_CATALOG.map((key, i) => ({
    id: i + 1,
    ...splitPermission(key),
    description: null,
  }));
  const roleIds = { ADMINISTRADOR: 1, SECRETARIA: 2, ENTRENADOR: 3, TUTOR: 4 } as const;
  const rolePermissions = Object.entries(DEFAULT_ROLE_PERMISSIONS).flatMap(([role, keys]) =>
    keys.map((key) => ({
      roleId: roleIds[role as keyof typeof roleIds],
      permissionId: PERMISSION_CATALOG.indexOf(key) + 1,
      createdAt: T0,
    })),
  );
  return { permissions, rolePermissions };
}

/**
 * In-memory stand-in for the API + MariaDB. ONLY services may inject it.
 * One array per table of docs/escuela_futbol_mariadb.sql, with numeric AUTO_INCREMENT ids and the relations
 * (and bridge tables) of the schema. Services enforce the same PK/FK/UNIQUE/CHECK rules the database does;
 * mock-db.integrity.ts verifies them in the tests.
 * To connect the backend: replace the MockDb calls inside each service with HttpClient and delete this file.
 */
@Injectable({ providedIn: 'root' })
export class MockDb {
  // ── Security ──────────────────────────────────────────────────────────
  roles: Role[] = [
    {
      id: 1,
      name: 'ADMINISTRADOR',
      kind: 'SEGURIDAD',
      description: 'Acceso completo al sistema',
      active: true,
      createdAt: T0,
    },
    {
      id: 2,
      name: 'SECRETARIA',
      kind: 'SEGURIDAD',
      description: 'Gestión administrativa y cobranza',
      active: true,
      createdAt: T0,
    },
    {
      id: 3,
      name: 'ENTRENADOR',
      kind: 'PERFIL',
      description: 'Lo otorga entrenadores.usuario_id con activo',
      active: true,
      createdAt: T0,
    },
    {
      id: 4,
      name: 'TUTOR',
      kind: 'PERFIL',
      description: 'Lo otorga tutores.usuario_id',
      active: true,
      createdAt: T0,
    },
  ];
  permissions: Permission[];
  rolePermissions: RolePermission[];
  users: UserRow[] = [
    {
      id: 1,
      roleId: 1,
      firstName: 'Ana',
      lastName: 'Administradora',
      email: 'admin@example.com',
      passwordHash: DEMO_HASH,
      active: true,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 2,
      roleId: 2,
      firstName: 'Sofía',
      lastName: 'Secretaria',
      email: 'secretaria@example.com',
      passwordHash: DEMO_HASH,
      active: true,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 3,
      roleId: null,
      firstName: null,
      lastName: null,
      email: 'coach@example.com',
      passwordHash: DEMO_HASH,
      active: true,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 4,
      roleId: null,
      firstName: null,
      lastName: null,
      email: 'tutor@example.com',
      passwordHash: DEMO_HASH,
      active: true,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 5,
      roleId: 2,
      firstName: 'Usuario',
      lastName: 'Inactivo',
      email: 'baja@example.com',
      passwordHash: DEMO_HASH,
      active: false,
      createdAt: T0,
      updatedAt: T0,
    },
    // Same account is coach (Marta Díaz) AND tutor (of Emiliano): profiles, not a single role.
    {
      id: 6,
      roleId: null,
      firstName: null,
      lastName: null,
      email: 'marta@example.com',
      passwordHash: DEMO_HASH,
      active: true,
      createdAt: T0,
      updatedAt: T0,
    },
  ];
  sessions: Session[] = [];
  resetTokens: PasswordResetToken[] = [];
  audit: AuditEntry[] = [];
  outbox: OutboxMessage[] = [];

  // ── People ────────────────────────────────────────────────────────────
  players: Player[] = [
    {
      id: 1,
      identifier: 'J-0001',
      firstName: 'Diego',
      lastName1: 'Hernández',
      lastName2: 'López',
      birthDate: '2016-03-12',
      sex: 'M',
      phone: null,
      email: null,
      address: 'Calle Pino 12',
      status: 'ACTIVO',
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 2,
      identifier: 'J-0002',
      firstName: 'Lucía',
      lastName1: 'Hernández',
      lastName2: 'López',
      birthDate: '2014-07-01',
      sex: 'F',
      phone: null,
      email: null,
      address: 'Calle Pino 12',
      status: 'ACTIVO',
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 3,
      identifier: 'J-0003',
      firstName: 'Mateo',
      lastName1: 'Ruiz',
      lastName2: null,
      birthDate: '2016-11-20',
      sex: 'M',
      phone: null,
      email: null,
      address: null,
      status: 'ACTIVO',
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 4,
      identifier: 'J-0004',
      firstName: 'Valeria',
      lastName1: 'Soto',
      lastName2: 'Mena',
      birthDate: '2014-02-05',
      sex: 'F',
      phone: null,
      email: null,
      address: null,
      status: 'BAJA_TEMPORAL',
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 5,
      identifier: 'J-0005',
      firstName: 'Emiliano',
      lastName1: 'Díaz',
      lastName2: null,
      birthDate: '2017-05-09',
      sex: 'M',
      phone: null,
      email: null,
      address: null,
      status: 'ACTIVO',
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 6,
      identifier: 'J-0006',
      firstName: 'Sofía',
      lastName1: 'Ruiz',
      lastName2: null,
      birthDate: '2015-01-15',
      sex: 'F',
      phone: null,
      email: null,
      address: null,
      status: 'ACTIVO',
      createdAt: T0,
      updatedAt: T0,
    },
  ];
  statusHistory: PlayerStatusChange[] = [
    ...[1, 2, 3, 4, 5, 6].map((playerId) => ({
      id: playerId,
      playerId,
      previousStatus: null,
      newStatus: 'ACTIVO' as const,
      reason: 'Alta',
      changedBy: 2,
      changedAt: T0,
    })),
    {
      id: 7,
      playerId: 4,
      previousStatus: 'ACTIVO',
      newStatus: 'BAJA_TEMPORAL',
      reason: 'Lesión',
      changedBy: 2,
      changedAt: '2026-09-15T10:00:00',
    },
  ];
  tutors: Tutor[] = [
    {
      id: 1,
      userId: 4,
      firstName: 'Teresa',
      lastName1: 'López',
      lastName2: null,
      phone: '0000000001',
      email: 'tutor@example.com',
      address: 'Calle Pino 12',
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 2,
      userId: null,
      firstName: 'Jorge',
      lastName1: 'Ruiz',
      lastName2: null,
      phone: '0000000002',
      email: null,
      address: null,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 3,
      userId: 6,
      firstName: 'Marta',
      lastName1: 'Díaz',
      lastName2: null,
      phone: '0000000012',
      email: 'marta@example.com',
      address: null,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 4,
      userId: null,
      firstName: 'Ramón',
      lastName1: 'Soto',
      lastName2: null,
      phone: '0000000004',
      email: null,
      address: null,
      createdAt: T0,
      updatedAt: T0,
    },
  ];
  tutorPlayers: TutorPlayer[] = [
    { tutorId: 1, playerId: 1, relationship: 'Madre', isPrimary: true, createdAt: T0 },
    { tutorId: 1, playerId: 2, relationship: 'Madre', isPrimary: true, createdAt: T0 },
    { tutorId: 2, playerId: 3, relationship: 'Padre', isPrimary: true, createdAt: T0 },
    { tutorId: 2, playerId: 6, relationship: 'Padre', isPrimary: true, createdAt: T0 },
    { tutorId: 3, playerId: 5, relationship: 'Madre', isPrimary: true, createdAt: T0 },
    { tutorId: 4, playerId: 4, relationship: 'Padre', isPrimary: true, createdAt: T0 },
  ];
  coaches: Coach[] = [
    {
      id: 1,
      userId: 3,
      firstName: 'Carlos',
      lastName1: 'Pérez',
      lastName2: null,
      phone: '0000000011',
      email: 'coach@example.com',
      active: true,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 2,
      userId: 6,
      firstName: 'Marta',
      lastName1: 'Díaz',
      lastName2: null,
      phone: '0000000012',
      email: 'marta@example.com',
      active: true,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 3,
      userId: null,
      firstName: 'Luis',
      lastName1: 'Gómez',
      lastName2: null,
      phone: '0000000013',
      email: null,
      active: true,
      createdAt: T0,
      updatedAt: T0,
    },
  ];

  // ── Catalogs ──────────────────────────────────────────────────────────
  seasons: Season[] = [
    {
      id: 1,
      name: 'Temporada 2025-2026',
      startDate: '2025-08-01',
      endDate: '2026-06-30',
      active: true,
      isCurrent: false,
      createdAt: T0,
    },
    {
      id: 2,
      name: 'Temporada 2026-2027',
      startDate: '2026-08-01',
      endDate: '2027-06-30',
      active: true,
      isCurrent: true,
      createdAt: T0,
    },
  ];
  venues: Venue[] = [
    {
      id: 1,
      name: 'Campo Principal',
      location: 'Av. Siempre Viva 123',
      reference: 'Cancha 1',
      active: true,
      createdAt: T0,
    },
    {
      id: 2,
      name: 'Unidad Deportiva Norte',
      location: 'Calle Norte 45',
      reference: null,
      active: true,
      createdAt: T0,
    },
  ];
  categories: Category[] = [
    {
      id: 1,
      seasonId: 2,
      name: 'Sub-10',
      minAge: 8,
      maxAge: 10,
      maxCapacity: 20,
      active: true,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 2,
      seasonId: 2,
      name: 'Sub-12',
      minAge: 10,
      maxAge: 12,
      maxCapacity: 2,
      active: true,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 3,
      seasonId: 2,
      name: 'Sub-8',
      minAge: 6,
      maxAge: 8,
      maxCapacity: null,
      active: true,
      createdAt: T0,
      updatedAt: T0,
    },
  ];

  // ── Enrollment & membership ───────────────────────────────────────────
  enrollments: Enrollment[] = [
    ...[1, 2, 3, 5, 6].map((playerId, i) => ({
      id: i + 1,
      playerId,
      seasonId: 2,
      enrolledOn: '2026-08-05',
      amountCents: 120000,
      status: 'ACTIVA' as const,
      createdAt: T0,
    })),
    {
      id: 6,
      playerId: 4,
      seasonId: 1,
      enrolledOn: '2025-08-05',
      amountCents: 110000,
      status: 'FINALIZADA',
      createdAt: T0,
    },
  ];
  playerCategories: PlayerCategory[] = [
    {
      id: 1,
      playerId: 1,
      categoryId: 1,
      startDate: '2026-08-05',
      endDate: null,
      isAgeException: false,
      exceptionReason: null,
      active: true,
      createdAt: T0,
    },
    {
      id: 2,
      playerId: 2,
      categoryId: 2,
      startDate: '2026-08-05',
      endDate: null,
      isAgeException: false,
      exceptionReason: null,
      active: true,
      createdAt: T0,
    },
    {
      id: 3,
      playerId: 3,
      categoryId: 1,
      startDate: '2026-08-05',
      endDate: null,
      isAgeException: false,
      exceptionReason: null,
      active: true,
      createdAt: T0,
    },
    {
      id: 4,
      playerId: 5,
      categoryId: 1,
      startDate: '2026-08-05',
      endDate: null,
      isAgeException: false,
      exceptionReason: null,
      active: true,
      createdAt: T0,
    },
    {
      id: 5,
      playerId: 6,
      categoryId: 2,
      startDate: '2026-08-05',
      endDate: null,
      isAgeException: false,
      exceptionReason: null,
      active: true,
      createdAt: T0,
    },
    {
      id: 6,
      playerId: 4,
      categoryId: 2,
      startDate: '2026-08-05',
      endDate: '2026-09-15',
      isAgeException: false,
      exceptionReason: null,
      active: false,
      createdAt: T0,
    },
  ];
  categoryHistory: CategoryChange[] = [1, 2, 3, 5, 6, 4].map((playerId, i) => ({
    id: i + 1,
    playerId,
    previousCategoryId: null,
    newCategoryId: seedCategoryOf(playerId),
    reason: 'Inscripción inicial',
    changedBy: 2,
    changedAt: T0,
  }));
  coachCategories: CoachCategory[] = [
    {
      id: 1,
      coachId: 1,
      categoryId: 1,
      responsibility: 'Principal',
      startDate: '2026-08-01',
      endDate: null,
      active: true,
      createdAt: T0,
    },
    {
      id: 2,
      coachId: 2,
      categoryId: 2,
      responsibility: 'Principal',
      startDate: '2026-08-01',
      endDate: null,
      active: true,
      createdAt: T0,
    },
    {
      id: 3,
      coachId: 3,
      categoryId: 1,
      responsibility: 'Auxiliar',
      startDate: '2026-08-01',
      endDate: null,
      active: true,
      createdAt: T0,
    },
  ];

  // ── Training ──────────────────────────────────────────────────────────
  schedules: TrainingSchedule[] = [
    {
      id: 1,
      categoryId: 1,
      venueId: 1,
      weekday: 1,
      startTime: '17:00',
      endTime: '18:30',
      active: true,
      createdAt: T0,
    },
    {
      id: 2,
      categoryId: 1,
      venueId: 1,
      weekday: 3,
      startTime: '17:00',
      endTime: '18:30',
      active: true,
      createdAt: T0,
    },
    {
      id: 3,
      categoryId: 2,
      venueId: 1,
      weekday: 2,
      startTime: '17:00',
      endTime: '18:30',
      active: true,
      createdAt: T0,
    },
    {
      id: 4,
      categoryId: 2,
      venueId: 1,
      weekday: 4,
      startTime: '17:00',
      endTime: '18:30',
      active: true,
      createdAt: T0,
    },
    {
      id: 5,
      categoryId: 1,
      venueId: 2,
      weekday: 6,
      startTime: '09:00',
      endTime: '10:30',
      active: true,
      createdAt: T0,
    },
  ];
  trainingSessions: TrainingSession[] = [
    {
      id: 1,
      categoryId: 1,
      venueId: 1,
      coachId: 1,
      scheduleId: 1,
      date: '2026-10-05',
      startTime: '17:00',
      endTime: '18:30',
      status: 'REALIZADO',
      objective: 'Conducción y pase',
      notes: 'Buen trabajo en pases cortos.',
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 2,
      categoryId: 2,
      venueId: 1,
      coachId: 2,
      scheduleId: 3,
      date: '2026-10-06',
      startTime: '17:00',
      endTime: '18:30',
      status: 'REALIZADO',
      objective: 'Definición',
      notes: null,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 3,
      categoryId: 1,
      venueId: 1,
      coachId: 1,
      scheduleId: 2,
      date: '2026-10-07',
      startTime: '17:00',
      endTime: '18:30',
      status: 'PROGRAMADO',
      objective: null,
      notes: null,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 4,
      categoryId: 2,
      venueId: 1,
      coachId: 2,
      scheduleId: 4,
      date: '2026-10-08',
      startTime: '17:00',
      endTime: '18:30',
      status: 'PROGRAMADO',
      objective: null,
      notes: null,
      createdAt: T0,
      updatedAt: T0,
    },
  ];
  attendance: Attendance[] = [
    {
      id: 1,
      sessionId: 1,
      playerId: 1,
      status: 'PRESENTE',
      notes: null,
      recordedBy: 3,
      recordedAt: '2026-10-05T18:35:00',
      updatedAt: '2026-10-05T18:35:00',
    },
    {
      id: 2,
      sessionId: 1,
      playerId: 3,
      status: 'AUSENTE',
      notes: null,
      recordedBy: 3,
      recordedAt: '2026-10-05T18:35:00',
      updatedAt: '2026-10-05T18:35:00',
    },
    {
      id: 3,
      sessionId: 1,
      playerId: 5,
      status: 'JUSTIFICADO',
      notes: 'Cita médica',
      recordedBy: 3,
      recordedAt: '2026-10-05T18:35:00',
      updatedAt: '2026-10-05T18:35:00',
    },
    {
      id: 4,
      sessionId: 2,
      playerId: 2,
      status: 'PRESENTE',
      notes: null,
      recordedBy: 6,
      recordedAt: '2026-10-06T18:35:00',
      updatedAt: '2026-10-06T18:35:00',
    },
    {
      id: 5,
      sessionId: 2,
      playerId: 6,
      status: 'PRESENTE',
      notes: null,
      recordedBy: 6,
      recordedAt: '2026-10-06T18:35:00',
      updatedAt: '2026-10-06T18:35:00',
    },
  ];

  // ── Competitions ──────────────────────────────────────────────────────
  competitions: Competition[] = [
    {
      id: 1,
      seasonId: 2,
      name: 'Liga Municipal',
      type: 'LIGA',
      organizer: 'Liga Municipal de Fútbol Infantil',
      contact: 'liga@example.com',
      startDate: '2026-09-01',
      endDate: '2027-05-31',
      status: 'ACTIVA',
      notes: null,
      createdAt: T0,
    },
    {
      id: 2,
      seasonId: 2,
      name: 'Copa Otoño',
      type: 'TORNEO',
      organizer: 'Club Halcones',
      contact: null,
      startDate: '2026-10-15',
      endDate: '2026-11-30',
      status: 'PLANIFICADA',
      notes: null,
      createdAt: T0,
    },
  ];
  competitionCategories: CompetitionCategory[] = [
    {
      id: 1,
      competitionId: 1,
      categoryId: 1,
      registeredOn: '2026-08-20',
      costCents: 150000,
      status: 'INSCRITA',
      createdAt: T0,
    },
    {
      id: 2,
      competitionId: 2,
      categoryId: 2,
      registeredOn: '2026-09-10',
      costCents: null,
      status: 'INSCRITA',
      createdAt: T0,
    },
    {
      id: 3,
      competitionId: 1,
      categoryId: 2,
      registeredOn: '2026-08-20',
      costCents: 150000,
      status: 'INSCRITA',
      createdAt: T0,
    }, // no coach yet
  ];
  rosters: RosterEntry[] = [
    {
      id: 1,
      playerId: 1,
      competitionCategoryId: 1,
      joinedOn: '2026-08-25',
      leftOn: null,
      active: true,
      createdAt: T0,
    },
    {
      id: 2,
      playerId: 3,
      competitionCategoryId: 1,
      joinedOn: '2026-08-25',
      leftOn: null,
      active: true,
      createdAt: T0,
    },
    {
      id: 3,
      playerId: 2,
      competitionCategoryId: 2,
      joinedOn: '2026-09-12',
      leftOn: null,
      active: true,
      createdAt: T0,
    },
    {
      id: 4,
      playerId: 6,
      competitionCategoryId: 2,
      joinedOn: '2026-09-12',
      leftOn: null,
      active: true,
      createdAt: T0,
    },
    {
      id: 5,
      playerId: 2,
      competitionCategoryId: 3,
      joinedOn: '2026-08-25',
      leftOn: null,
      active: true,
      createdAt: T0,
    },
  ];
  coachCompetitions: CoachCompetition[] = [
    {
      id: 1,
      coachId: 1,
      competitionCategoryId: 1,
      startDate: '2026-08-20',
      endDate: null,
      active: true,
      createdAt: T0,
    },
    {
      id: 2,
      coachId: 2,
      competitionCategoryId: 2,
      startDate: '2026-09-10',
      endDate: null,
      active: true,
      createdAt: T0,
    },
  ];
  opponents: Opponent[] = [
    { id: 1, name: 'Tiburones', contact: null, notes: null, active: true },
    { id: 2, name: 'Halcones', contact: null, notes: null, active: true },
    { id: 3, name: 'Pumas', contact: null, notes: null, active: true },
  ];
  matches: Match[] = [
    {
      id: 1,
      competitionCategoryId: 1,
      opponentId: 1,
      venueId: 2,
      date: '2026-10-04',
      time: '10:00',
      homeAway: 'VISITANTE',
      goalsFor: 3,
      goalsAgainst: 1,
      status: 'JUGADO',
      rescheduleReason: null,
      notes: null,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 2,
      competitionCategoryId: 1,
      opponentId: 3,
      venueId: 1,
      date: '2026-10-11',
      time: '10:00',
      homeAway: 'LOCAL',
      goalsFor: null,
      goalsAgainst: null,
      status: 'REPROGRAMADO',
      rescheduleReason: 'Lluvia: se movió del 10 al 11 de octubre',
      notes: null,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 3,
      competitionCategoryId: 2,
      opponentId: 2,
      venueId: 1,
      date: '2026-10-18',
      time: '12:00',
      homeAway: 'LOCAL',
      goalsFor: null,
      goalsAgainst: null,
      status: 'PROGRAMADO',
      rescheduleReason: null,
      notes: null,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 4,
      competitionCategoryId: 3,
      opponentId: 3,
      venueId: 2,
      date: '2026-10-25',
      time: '11:00',
      homeAway: 'VISITANTE',
      goalsFor: null,
      goalsAgainst: null,
      status: 'PROGRAMADO',
      rescheduleReason: null,
      notes: null,
      createdAt: T0,
      updatedAt: T0,
    },
  ];

  // ── Billing ───────────────────────────────────────────────────────────
  concepts: ChargeConcept[] = [
    {
      id: 1,
      name: 'Mensualidad',
      suggestedAmountCents: 60000,
      recurring: true,
      active: true,
      createdAt: T0,
    },
    {
      id: 2,
      name: 'Inscripción anual',
      suggestedAmountCents: 120000,
      recurring: false,
      active: true,
      createdAt: T0,
    },
    {
      id: 3,
      name: 'Uniforme',
      suggestedAmountCents: 0,
      recurring: false,
      active: true,
      createdAt: T0,
    },
  ];
  charges: Charge[] = [
    {
      id: 1,
      playerId: 1,
      conceptId: 1,
      seasonId: 2,
      period: '2026-09',
      chargedOn: '2026-09-01',
      dueDate: '2026-09-10',
      originalAmountCents: 60000,
      status: 'PAGADO',
      reference: null,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 2,
      playerId: 2,
      conceptId: 1,
      seasonId: 2,
      period: '2026-09',
      chargedOn: '2026-09-01',
      dueDate: '2026-09-10',
      originalAmountCents: 60000,
      status: 'VENCIDO',
      reference: null,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 3,
      playerId: 3,
      conceptId: 2,
      seasonId: 2,
      period: null,
      chargedOn: '2026-08-05',
      dueDate: '2026-08-15',
      originalAmountCents: 120000,
      status: 'VENCIDO',
      reference: 'INS-3',
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 4,
      playerId: 6,
      conceptId: 1,
      seasonId: 2,
      period: '2026-09',
      chargedOn: '2026-09-01',
      dueDate: '2026-09-10',
      originalAmountCents: 60000,
      status: 'PAGADO',
      reference: null,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 5,
      playerId: 2,
      conceptId: 3,
      seasonId: null,
      period: null,
      chargedOn: '2026-09-20',
      dueDate: '2026-10-20',
      originalAmountCents: 35000,
      status: 'PENDIENTE',
      reference: 'PED-1',
      createdAt: T0,
      updatedAt: T0,
    },
  ];
  payments: Payment[] = [
    {
      id: 1,
      folio: 'R-0001',
      playerId: 1,
      tutorId: 1,
      paidAt: '2026-09-08T10:15:00',
      amountCents: 60000,
      method: 'EFECTIVO',
      status: 'APLICADO',
      cancellationReason: null,
      recordedBy: 2,
      createdAt: '2026-09-08T10:15:00',
    },
    {
      id: 2,
      folio: 'R-0002',
      playerId: 3,
      tutorId: 2,
      paidAt: '2026-08-20T12:00:00',
      amountCents: 50000,
      method: 'TRANSFERENCIA',
      status: 'APLICADO',
      cancellationReason: null,
      recordedBy: 2,
      createdAt: '2026-08-20T12:00:00',
    },
    {
      id: 3,
      folio: 'R-0003',
      playerId: 6,
      tutorId: 2,
      paidAt: '2026-09-09T11:00:00',
      amountCents: 30000,
      method: 'TARJETA',
      status: 'APLICADO',
      cancellationReason: null,
      recordedBy: 2,
      createdAt: '2026-09-09T11:00:00',
    },
  ];
  paymentApplications: PaymentApplication[] = [
    {
      id: 1,
      paymentId: 1,
      chargeId: 1,
      playerId: 1,
      amountCents: 60000,
      createdAt: '2026-09-08T10:15:00',
    },
    {
      id: 2,
      paymentId: 2,
      chargeId: 3,
      playerId: 3,
      amountCents: 50000,
      createdAt: '2026-08-20T12:00:00',
    },
    {
      id: 3,
      paymentId: 3,
      chargeId: 4,
      playerId: 6,
      amountCents: 30000,
      createdAt: '2026-09-09T11:00:00',
    },
  ];
  discounts: Discount[] = [
    {
      id: 1,
      chargeId: 4,
      type: 'BECA',
      reason: 'Beca deportiva 50%',
      originalAmountCents: 60000,
      adjustmentCents: 30000,
      finalAmountCents: 30000,
      authorizedBy: 1,
      createdAt: '2026-09-02T09:00:00',
    },
  ];

  // ── Uniforms ──────────────────────────────────────────────────────────
  uniformProducts: UniformProduct[] = [
    { id: 1, name: 'Jersey local', description: 'Playera oficial', active: true, createdAt: T0 },
    { id: 2, name: 'Short', description: null, active: true, createdAt: T0 },
  ];
  uniformVariants: UniformVariant[] = [
    { id: 1, productId: 1, size: 'CH', priceCents: 35000, active: true, createdAt: T0 },
    { id: 2, productId: 1, size: 'M', priceCents: 35000, active: true, createdAt: T0 },
    { id: 3, productId: 2, size: 'CH', priceCents: 15000, active: true, createdAt: T0 },
  ];
  uniformOrders: UniformOrder[] = [
    {
      id: 1,
      playerId: 2,
      requestedOn: '2026-09-20',
      status: 'SOLICITADO',
      chargeId: 5,
      deliveredOn: null,
      receivedBy: null,
      createdAt: T0,
      updatedAt: T0,
    },
  ];
  uniformOrderLines: UniformOrderLine[] = [
    { id: 1, orderId: 1, variantId: 2, quantity: 1, unitPriceCents: 35000, createdAt: T0 },
  ];

  // ── Notices ───────────────────────────────────────────────────────────
  notices: Notice[] = [
    {
      id: 1,
      createdBy: 2,
      title: 'Bienvenidos a la temporada 2026-2027',
      message: 'Consulten horarios y calendario en el portal.',
      publishedAt: '2026-08-01T09:00:00',
      startsAt: '2026-08-01T00:00:00',
      endsAt: null,
      published: true,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 2,
      createdBy: 2,
      title: 'Sub-10: entrenamiento del sábado en Unidad Norte',
      message: 'A partir de octubre el sábado se entrena en Unidad Deportiva Norte.',
      publishedAt: '2026-10-01T09:00:00',
      startsAt: '2026-10-01T00:00:00',
      endsAt: '2026-12-31T23:59:59',
      published: true,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 3,
      createdBy: 2,
      title: 'Fotos de equipo (vencido)',
      message: 'Sesión de fotos el 20 de septiembre.',
      publishedAt: '2026-09-10T09:00:00',
      startsAt: '2026-09-10T00:00:00',
      endsAt: '2026-09-20T23:59:59',
      published: true,
      createdAt: T0,
      updatedAt: T0,
    },
    {
      id: 4,
      createdBy: 2,
      title: 'Borrador: posada',
      message: 'Pendiente de confirmar.',
      publishedAt: '2026-10-05T09:00:00',
      startsAt: null,
      endsAt: null,
      published: false,
      createdAt: T0,
      updatedAt: T0,
    },
  ];
  noticeRecipients: NoticeRecipient[] = [
    { id: 1, noticeId: 1, audience: 'GENERAL', categoryId: null, tutorId: null, coachId: null },
    { id: 2, noticeId: 2, audience: 'CATEGORIA', categoryId: 1, tutorId: null, coachId: null },
    { id: 3, noticeId: 3, audience: 'GENERAL', categoryId: null, tutorId: null, coachId: null },
    { id: 4, noticeId: 4, audience: 'GENERAL', categoryId: null, tutorId: null, coachId: null },
  ];

  constructor() {
    ({ permissions: this.permissions, rolePermissions: this.rolePermissions } = seedPermissions());
  }

  // ── Table helpers (AUTO_INCREMENT, lookups, transactions) ─────────────

  /** INSERT … with AUTO_INCREMENT id (max + 1: rows are never deleted, so ids are never reused). */
  insert<T extends { id: Id }>(table: T[], row: Omit<T, 'id'>): T {
    const created = { ...row, id: table.reduce((max, r) => Math.max(max, r.id), 0) + 1 } as T;
    table.push(created);
    return created;
  }

  /** UPDATE … WHERE id = ?; returns the new row. */
  update<T extends { id: Id }>(table: T[], id: Id, patch: Partial<T>): T {
    const i = table.findIndex((r) => r.id === id);
    if (i < 0) throw new Error('Registro no encontrado.');
    table[i] = { ...table[i], ...patch, id };
    return table[i];
  }

  /** SELECT … WHERE id = ? that fails like a missing FK target. */
  get<T extends { id: Id }>(table: T[], id: Id, what = 'Registro'): T {
    const row = table.find((r) => r.id === id);
    if (!row) throw new Error(`${what} no encontrado.`);
    return row;
  }

  /**
   * BEGIN … COMMIT. Runs `work` synchronously; if it throws, every table is restored (ROLLBACK).
   * Critical operations (payments, cancellations, category changes) go through here.
   */
  transaction<T>(work: () => T): T {
    const snapshot = new Map(
      Object.entries(this)
        .filter(([, v]) => Array.isArray(v))
        .map(([k, v]) => [k, structuredClone(v)]),
    );
    try {
      return work();
    } catch (e) {
      for (const [k, v] of snapshot) (this as Record<string, unknown>)[k] = v;
      throw e;
    }
  }

  /** Simulates network latency and returns a copy, so callers can't mutate the "server" state. */
  async respond<T>(value: T): Promise<T> {
    await new Promise((r) => setTimeout(r, 120));
    return structuredClone(value);
  }
}

/** Seed helper: current category of each seeded player (before the class fields exist). */
function seedCategoryOf(playerId: number): Id {
  return ({ 1: 1, 2: 2, 3: 1, 4: 2, 5: 1, 6: 2 } as Record<number, Id>)[playerId];
}

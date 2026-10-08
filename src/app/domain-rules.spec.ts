import { TestBed } from '@angular/core/testing';
import { AuthService } from './core/auth/auth.service';
import { MockDb } from './core/data/mock-db';
import { integrityViolations } from './core/data/mock-db.integrity';
import { AuditService } from './core/services/audit.service';
import { CategoryService } from './core/services/category.service';
import { CompetitionService } from './core/services/competition.service';
import { PlayerService } from './core/services/player.service';
import { BillingService } from './features/billing/billing.service';
import { CoachPanelService } from './features/coach-panel/coach-panel.service';
import { CoachService } from './features/coaches/coach.service';
import { EnrollmentService } from './features/enrollments/enrollment.service';
import { PlayerCategoryService } from './features/enrollments/player-category.service';
import { MatchService } from './features/matches/match.service';
import { NoticeService } from './features/notices/notice.service';
import { PortalService } from './features/parent-portal/portal.service';
import { ReportService } from './features/reports/report.service';
import { SeasonService } from './features/seasons/season.service';
import { AttendanceService } from './features/trainings/attendance.service';
import { ScheduleService } from './features/trainings/schedule.service';
import { TrainingService } from './features/trainings/training.service';
import { TutorService } from './features/tutors/tutor.service';
import { UniformService } from './features/uniforms/uniform.service';
import { RoleService } from './features/users/role.service';
import { UserService } from './features/users/user.service';

const get = TestBed.inject.bind(TestBed);
const login = (who: string) => get(AuthService).login(`${who}@example.com`, 'demo1234');
const db = () => get(MockDb);

/** Business rules of every backlog phase, by HU, through the services. MockDb must stay consistent afterwards. */
describe('domain rules by HU', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 7, 12, 0));
    TestBed.resetTestingModule();
  });
  afterEach(() => {
    expect(integrityViolations(db())).toEqual([]);
    vi.useRealTimers();
  });

  describe('A · security', () => {
    it('HU-004: staff account by e-mail invitation, unique e-mail, deactivation closes sessions; last admin protected', async () => {
      await login('admin');
      const users = get(UserService);
      const u = await users.save({
        roleId: 2,
        firstName: 'Nora',
        lastName: 'Ruiz',
        email: 'Nora@Example.com',
      });
      expect(u).toMatchObject({ email: 'nora@example.com', active: true, roleName: 'SECRETARIA' });
      expect(db().outbox.at(-1)?.to).toBe('nora@example.com');
      await expect(
        users.save({ roleId: 2, firstName: 'Otra', lastName: '', email: 'NORA@example.com' }),
      ).rejects.toThrow('Ya existe');
      await expect(
        users.save({ roleId: 4, firstName: 'X', lastName: '', email: 'x@example.com' }),
      ).rejects.toThrow('rol de seguridad');
      await expect(users.setActive(1, false)).rejects.toThrow('propia cuenta');
      await users.setActive(u.id, false);
      expect(db().users.find((x) => x.id === u.id)?.active).toBe(false);
      expect('delete' in users).toBe(false); // accounts are never deleted
    });

    it('HU-006: permission matrix edits are audited and protected permissions cannot be removed', async () => {
      await login('admin');
      const roles = get(RoleService);
      const editRoles = db().permissions.find(
        (p) => p.module === 'roles' && p.action === 'editar',
      )!;
      await expect(roles.setPermission(1, editRoles.id, false)).rejects.toThrow(
        'quedaría sin acceso',
      );
      const p = db().permissions.find((x) => x.module === 'avisos' && x.action === 'crear')!;
      await roles.setPermission(2, p.id, false);
      expect(db().rolePermissions.some((rp) => rp.roleId === 2 && rp.permissionId === p.id)).toBe(
        false,
      );
      expect(db().audit.at(-1)).toMatchObject({ module: 'roles', userId: 1, action: 'EDITAR' });
      get(AuthService).logout();
      await login('secretaria');
      await expect(roles.setPermission(2, p.id, true)).rejects.toThrow('No tienes permiso');
    });

    it('HU-007: audit log records who/what/when on players, payments, enrollments and users; filterable, read-only', async () => {
      await login('secretaria');
      await get(PlayerService).changeStatus(1, 'BAJA_TEMPORAL', 'Viaje');
      await get(BillingService).registerPayment({
        playerId: 2,
        tutorId: 1,
        amountCents: 1000,
        method: 'EFECTIVO',
      });
      get(AuthService).logout();
      await login('admin'); // only the administrator reads the audit log
      await expect(get(AuditService).list()).resolves.toBeTruthy();
      const page = await get(AuditService).list({ module: 'jugadores' });
      expect(page.items[0]).toMatchObject({
        userEmail: 'secretaria@example.com',
        entity: 'jugadores',
        entityId: 1,
        action: 'EDITAR',
      });
      expect((await get(AuditService).list({ module: 'pagos' })).total).toBe(1);
      expect(Object.getOwnPropertyNames(AuditService.prototype)).not.toContain('update');
    });
  });

  describe('B · players and tutors', () => {
    it('HU-009: edit keeps id/identifier, updates actualizado_en and audits before/after', async () => {
      await login('secretaria');
      vi.setSystemTime(new Date(2026, 9, 8, 9, 0));
      const p = await get(PlayerService).update(1, {
        firstName: 'Diego A.',
        lastName1: 'Hernández',
        lastName2: 'López',
        birthDate: '2016-03-12',
        sex: 'M',
        phone: '5512345678',
        email: null,
        address: null,
      });
      expect(p).toMatchObject({ id: 1, identifier: 'J-0001', updatedAt: '2026-10-08T09:00:00' });
      expect(db().audit.at(-1)?.before).toMatchObject({ firstName: 'Diego' });
      await expect(get(PlayerService).update(1, { ...p, firstName: ' ' })).rejects.toThrow(
        'obligatorio',
      );
    });

    it('HU-010: status change needs a reason, keeps history; inactive players cannot join categories/rosters/enrollments', async () => {
      await login('secretaria');
      const players = get(PlayerService);
      await expect(players.changeStatus(3, 'BAJA_DEFINITIVA', '')).rejects.toThrow('motivo');
      await players.changeStatus(3, 'BAJA_DEFINITIVA', 'Cambio de ciudad');
      expect((await players.record(3)).statusHistory[0]).toMatchObject({
        previousStatus: 'ACTIVO',
        newStatus: 'BAJA_DEFINITIVA',
      });
      expect((await players.record(3)).payments).toHaveLength(1); // nothing deleted
      await expect(
        get(PlayerCategoryService).change({
          playerId: 3,
          categoryId: 3,
          date: '2026-10-10',
          reason: 'x',
          exceptionReason: null,
        }),
      ).rejects.toThrow('activos');
      await expect(get(CompetitionService).addToRoster(1, 5)).resolves.toBeTruthy();
      await expect(get(CompetitionService).addToRoster(3, 3)).rejects.toThrow();
    });

    it('HU-011/012: N:M with relationship per pair, one primary per player, links with payments kept; account linking', async () => {
      await login('secretaria');
      const tutors = get(TutorService);
      const draft = {
        firstName: 'Ana',
        lastName1: 'López',
        lastName2: null,
        phone: '5500000000',
        email: ' Ana@Example.COM ',
        address: null,
      };
      await expect(
        tutors.save({ ...draft, links: [{ playerId: 1, relationship: 'Tía', isPrimary: true }] }),
      ).rejects.toThrow('ya tiene un contacto principal');
      const ana = await tutors.save({
        ...draft,
        links: [
          { playerId: 1, relationship: 'Tía', isPrimary: false },
          { playerId: 2, relationship: 'Abuela', isPrimary: false },
        ],
      });
      expect(ana.links.map((l) => l.relationship)).toEqual(['Tía', 'Abuela']);
      expect(ana.email).toBe('ana@example.com');
      // Teresa paid for Diego (payment 1): that link can't be removed.
      const teresa = await tutors.get(1);
      await expect(
        tutors.save({ ...teresa, links: teresa.links.filter((l) => l.playerId !== 1) }),
      ).rejects.toThrow('pagos registrados');

      const linked = await tutors.linkAccount(ana.id, 'ana.portal@example.com');
      expect(linked.created).toBe(true);
      expect(db().users.find((u) => u.email === 'ana.portal@example.com')).toMatchObject({
        roleId: null,
        firstName: null,
      });
      await expect(tutors.linkAccount(2, 'ana.portal@example.com')).rejects.toThrow('otro tutor');
      expect((await tutors.linkAccount(2, 'coach@example.com')).created).toBe(false); // reuses the coach's login
    });

    it('HU-014: partial search + combinable filters + pagination', async () => {
      await login('secretaria');
      const players = get(PlayerService);
      expect((await players.search({ query: 'hernan' })).total).toBe(2);
      expect(
        (await players.search({ query: 'hernan', categoryId: 2 })).items.map((r) => r.player.id),
      ).toEqual([2]);
      expect(
        (await players.search({ status: 'BAJA_TEMPORAL' })).items.map((r) => r.player.id),
      ).toEqual([4]);
      const all = await players.search({ page: 1 });
      expect(all).toMatchObject({ total: 6, page: 1, pageSize: 20 });
    });
  });

  describe('C · categories and enrollment', () => {
    it('HU-015: unique name per season, no inverted ages; HU-070: one current season that must be active', async () => {
      await login('admin');
      const categories = get(CategoryService);
      await expect(
        categories.save({ seasonId: 2, name: 'sub-10', minAge: 8, maxAge: 10, maxCapacity: null }),
      ).rejects.toThrow('Ya existe');
      await expect(
        categories.save({ seasonId: 2, name: 'Sub-14', minAge: 14, maxAge: 12, maxCapacity: null }),
      ).rejects.toThrow('menor');
      expect(
        await categories.save({
          seasonId: 1,
          name: 'Sub-10',
          minAge: 8,
          maxAge: 10,
          maxCapacity: null,
        }),
      ).toBeTruthy();
      const seasons = get(SeasonService);
      await expect(
        seasons.save({
          name: 'T3',
          startDate: '2027-08-01',
          endDate: '2028-06-30',
          active: false,
          isCurrent: true,
        }),
      ).rejects.toThrow('activa');
      await seasons.save({
        name: 'T3',
        startDate: '2027-08-01',
        endDate: '2028-06-30',
        active: true,
        isCurrent: true,
      });
      expect(
        db()
          .seasons.filter((s) => s.isCurrent)
          .map((s) => s.name),
      ).toEqual(['T3']);
    });

    it('HU-016: weekly schedules validated (day, end after start, active venue), several per category', async () => {
      await login('admin');
      const schedules = get(ScheduleService);
      await expect(
        schedules.save({
          categoryId: 3,
          venueId: 1,
          weekday: 8,
          startTime: '17:00',
          endTime: '18:00',
        }),
      ).rejects.toThrow('Día');
      await expect(
        schedules.save({
          categoryId: 3,
          venueId: 1,
          weekday: 2,
          startTime: '18:00',
          endTime: '17:00',
        }),
      ).rejects.toThrow('posterior');
      await schedules.save({
        categoryId: 3,
        venueId: 1,
        weekday: 2,
        startTime: '16:00',
        endTime: '17:00',
      });
      await schedules.save({
        categoryId: 3,
        venueId: 2,
        weekday: 5,
        startTime: '16:00',
        endTime: '17:00',
      });
      expect((await schedules.list({ categoryIds: [3] })).length).toBe(2);
    });

    it('HU-017/021: full category needs an authorized exception; occupancy shown; HU-018 lists active members with tutor', async () => {
      await login('secretaria');
      const p = await get(PlayerService).create({
        firstName: 'Iker',
        lastName1: 'Mora',
        lastName2: null,
        birthDate: '2015-05-05',
        sex: 'M',
        phone: null,
        email: null,
        address: null,
      });
      const membership = get(PlayerCategoryService);
      expect(await membership.eligibility(p.id, 2, '2026-10-07')).toMatchObject({
        ageOk: true,
        full: true,
        occupancy: 2,
        capacity: 2,
      });
      await expect(
        membership.assign({
          playerId: p.id,
          categoryId: 2,
          date: '2026-10-07',
          exceptionReason: null,
        }),
      ).rejects.toThrow('llena');
      const row = await membership.assign({
        playerId: p.id,
        categoryId: 2,
        date: '2026-10-07',
        exceptionReason: 'Autoriza dirección deportiva',
      });
      expect(row).toMatchObject({
        isAgeException: false,
        exceptionReason: 'Autoriza dirección deportiva',
      });
      expect((await get(CategoryService).get(2)).occupancy).toBe(3);
      await expect(
        membership.assign({
          playerId: p.id,
          categoryId: 1,
          date: '2026-10-07',
          exceptionReason: 'x',
        }),
      ).rejects.toThrow('ya tiene una categoría vigente');
      const members = await get(CategoryService).members(1);
      expect(members.find((m) => m.playerId === 1)).toMatchObject({
        age: 10,
        primaryTutor: 'Teresa López',
      });
    });

    it('HU-019: change closes the previous membership, opens a new one, records reason and closes old rosters', async () => {
      await login('secretaria');
      await get(PlayerCategoryService).change({
        playerId: 1,
        categoryId: 3,
        date: '2026-10-10',
        reason: 'Ajuste de nivel',
        exceptionReason: 'Edad 10 en Sub-8 autorizada',
      });
      const rows = db().playerCategories.filter((pc) => pc.playerId === 1);
      expect(rows.map((r) => [r.categoryId, r.endDate, r.active])).toEqual([
        [1, '2026-10-09', false],
        [3, null, true],
      ]);
      expect(db().categoryHistory.at(-1)).toMatchObject({
        previousCategoryId: 1,
        newCategoryId: 3,
        reason: 'Ajuste de nivel',
        changedBy: 2,
      });
      expect(db().rosters.find((r) => r.playerId === 1)).toMatchObject({
        active: false,
        leftOn: '2026-10-09',
      });
    });

    it('HU-020: one enrollment per player and season whatever its status; cancel cancels the unpaid fee, refused if paid', async () => {
      await login('secretaria');
      const enrollments = get(EnrollmentService);
      const p = await get(PlayerService).create({
        firstName: 'Luis',
        lastName1: 'Vega',
        lastName2: null,
        birthDate: '2016-06-06',
        sex: 'M',
        phone: null,
        email: null,
        address: null,
      });
      const e = await enrollments.enroll({
        playerId: p.id,
        seasonId: 2,
        enrolledOn: '2026-10-07',
        amountCents: 50000,
        status: 'PENDIENTE',
        conceptId: 2,
        dueDate: '2026-10-20',
      });
      await expect(enrollments.setStatus(e.id, 'CANCELADA', '')).rejects.toThrow('motivo');
      await enrollments.setStatus(e.id, 'CANCELADA', 'Desistió');
      expect(db().charges.find((c) => c.reference === `INS-${e.id}`)?.status).toBe('CANCELADO');
      await expect(
        enrollments.enroll({
          playerId: p.id,
          seasonId: 2,
          enrolledOn: '2026-10-07',
          amountCents: 0,
          status: 'ACTIVA',
          conceptId: null,
          dueDate: null,
        }),
      ).rejects.toThrow('reactívala');
      await enrollments.setStatus(e.id, 'ACTIVA');
      // Mateo's enrollment fee (INS-3) has a payment: cancelling his enrollment is refused.
      await expect(enrollments.setStatus(3, 'CANCELADA', 'x')).rejects.toThrow('pagos aplicados');
    });
  });

  describe('D · coaches', () => {
    it('HU-022/023: duplicates rejected; several coaches per category; no duplicate current assignment; validity', async () => {
      await login('admin');
      const coaches = get(CoachService);
      await expect(
        coaches.save({
          firstName: 'carlos',
          lastName1: 'PÉREZ',
          lastName2: null,
          phone: '5500000099',
          email: null,
        }),
      ).rejects.toThrow('duplicado');
      await expect(
        coaches.assignCategory({
          coachId: 1,
          categoryId: 1,
          responsibility: null,
          startDate: '2026-10-07',
        }),
      ).rejects.toThrow('ya está asignado');
      const a = await coaches.assignCategory({
        coachId: 2,
        categoryId: 1,
        responsibility: 'Porteros',
        startDate: '2026-10-07',
      });
      expect((await get(CategoryService).coaches(1)).length).toBe(3);
      await coaches.endCategoryAssignment(a.id, '2026-10-07');
      expect(db().coachCategories.find((x) => x.id === a.id)).toMatchObject({
        active: false,
        endDate: '2026-10-07',
      });
    });

    it('HU-026: coach ↔ participation requires a current category assignment; exact duplicates rejected; ended pair reopened', async () => {
      await login('admin');
      const coaches = get(CoachService);
      await expect(
        coaches.assignCompetition({
          coachId: 1,
          competitionCategoryId: 2,
          startDate: '2026-10-07',
        }),
      ).rejects.toThrow('no tiene asignación vigente');
      await expect(
        coaches.assignCompetition({
          coachId: 1,
          competitionCategoryId: 1,
          startDate: '2026-10-07',
        }),
      ).rejects.toThrow('ya existe');
      await coaches.assignCompetition({
        coachId: 2,
        competitionCategoryId: 3,
        startDate: '2026-10-07',
      });
      await coaches.endCompetitionAssignment(1, '2026-10-07');
      const reopened = await coaches.assignCompetition({
        coachId: 1,
        competitionCategoryId: 1,
        startDate: '2026-10-08',
      });
      expect(reopened).toMatchObject({
        id: 1,
        active: true,
        endDate: null,
        startDate: '2026-10-08',
      });
    });

    it('HU-024/025/027/038/060: the coach panel only shows own categories, schedule (with overlaps), competitions, notices', async () => {
      await login('coach');
      const panel = get(CoachPanelService);
      expect((await panel.myCategories()).map((c) => [c.name, c.members.length])).toEqual([
        ['Sub-10', 3],
      ]);
      db().schedules.push({
        id: 99,
        categoryId: 1,
        venueId: 2,
        weekday: 1,
        startTime: '18:00',
        endTime: '19:00',
        active: true,
        createdAt: '',
      });
      expect(
        (await panel.weeklySchedule())
          .filter((s) => s.overlap)
          .map((s) => s.id)
          .sort(),
      ).toEqual([1, 99]);
      expect((await panel.myCompetitions()).map((c) => c.competitionName)).toEqual([
        'Liga Municipal',
      ]);
      expect((await panel.myMatches({})).every((m) => m.categoryName === 'Sub-10')).toBe(true);
      expect((await panel.notices()).map((n) => n.id)).toEqual([2, 1]);
    });
  });

  describe('E · trainings and attendance', () => {
    it('HU-028: sessions from recurring schedules are not duplicated; schedule must match category', async () => {
      await login('secretaria');
      const trainings = get(TrainingService);
      const first = await trainings.generateFromSchedules('2026-10-12', '2026-10-18');
      expect(first.created).toBe(5);
      expect((await trainings.generateFromSchedules('2026-10-12', '2026-10-18')).created).toBe(0);
      expect(db().trainingSessions.at(-1)?.coachId).toBe(1); // principal coach of Sub-10 (Saturday slot)
      await expect(
        trainings.program({
          categoryId: 2,
          venueId: 1,
          coachId: null,
          scheduleId: 1,
          date: '2026-10-20',
          startTime: '17:00',
          endTime: '18:00',
          objective: null,
        }),
      ).rejects.toThrow('otra categoría');
    });

    it('HU-030/031: the assigned coach records one attendance per player, corrections are audited; others cannot', async () => {
      await login('coach');
      const attendance = get(AttendanceService);
      await attendance.record(3, [
        { playerId: 1, status: 'PRESENTE', notes: null },
        { playerId: 3, status: 'AUSENTE', notes: null },
      ]);
      await attendance.record(3, [{ playerId: 3, status: 'JUSTIFICADO', notes: 'Enfermo' }]);
      expect(
        db()
          .attendance.filter((a) => a.sessionId === 3)
          .map((a) => a.status),
      ).toEqual(['PRESENTE', 'JUSTIFICADO']);
      expect(db().audit.at(-1)).toMatchObject({
        action: 'EDITAR',
        entity: 'asistencias',
        before: { status: 'AUSENTE' },
      });
      expect(db().trainingSessions.find((s) => s.id === 3)?.status).toBe('REALIZADO');
      await expect(
        attendance.record(2, [{ playerId: 2, status: 'PRESENTE', notes: null }]),
      ).rejects.toThrow('No puedes');
      await expect(
        attendance.record(3, [{ playerId: 2, status: 'PRESENTE', notes: null }]),
      ).rejects.toThrow('no pertenecen');
      await expect(attendance.record(4, [])).rejects.toThrow(); // other coach's future session
      await get(TrainingService).saveNotes(3, { objective: 'Tiros', notes: 'Bien' });
      get(AuthService).logout();
      await login('secretaria');
      await expect(
        get(TrainingService).saveNotes(3, { objective: 'x', notes: null }),
      ).rejects.toThrow('entrenador asignado');
    });

    it('HU-032: attendance report with percentages, distinguishing justified absences', async () => {
      await login('admin');
      const rows = await get(AttendanceService).report({ from: '2026-10-01', to: '2026-10-31' });
      expect(rows.find((r) => r.playerId === 5)).toMatchObject({
        total: 1,
        justified: 1,
        presentPct: 0,
        presentOrJustifiedPct: 100,
      });
      expect(rows.find((r) => r.playerId === 1)).toMatchObject({ presentPct: 100 });
    });
  });

  describe('F · competitions and matches', () => {
    it('HU-034/035/036: valid dates; unique participation; roster only with current members of the category', async () => {
      await login('secretaria');
      const competitions = get(CompetitionService);
      await expect(
        competitions.save({
          seasonId: 2,
          name: 'X',
          type: 'TORNEO',
          organizer: null,
          contact: null,
          startDate: '2026-12-01',
          endDate: '2026-11-01',
          status: 'PLANIFICADA',
          notes: null,
        }),
      ).rejects.toThrow('anterior');
      await expect(
        competitions.register({
          competitionId: 1,
          categoryId: 1,
          registeredOn: '2026-10-07',
          costCents: null,
          status: 'INSCRITA',
        }),
      ).rejects.toThrow('ya está inscrita');
      await expect(competitions.addToRoster(1, 2)).rejects.toThrow('no pertenece');
      await expect(competitions.addToRoster(1, 1)).rejects.toThrow('ya está en el plantel');
      await competitions.removeFromRoster(1, '2026-10-07');
      expect(await competitions.addToRoster(1, 1, '2026-10-08')).toMatchObject({
        id: 1,
        active: true,
        leftOn: null,
      });
      expect(await competitions.eligiblePlayers(1)).toEqual([{ id: 5, name: 'Emiliano Díaz' }]);
    });

    it('HU-040: score only for played matches, both sides, no negatives; a played match is not cancelled', async () => {
      await login('secretaria');
      const matches = get(MatchService);
      await expect(
        matches.recordResult(1, { goalsFor: 2.5, goalsAgainst: 1, notes: null }),
      ).rejects.toThrow('entero');
      expect(
        await matches.recordResult(1, { goalsFor: 2, goalsAgainst: 2, notes: 'Empate' }),
      ).toMatchObject({ status: 'JUGADO', goalsFor: 2 });
      await expect(matches.cancel(1, 'x')).rejects.toThrow('no se cancela');
    });
  });

  describe('G · billing', () => {
    it('HU-043/044: concept amount changes never touch charges; monthly generation with authorized exclusions', async () => {
      await login('secretaria');
      const billing = get(BillingService);
      await billing.saveConcept({
        id: 1,
        name: 'Mensualidad',
        suggestedAmountCents: 65000,
        recurring: true,
      });
      expect(db().charges.find((c) => c.id === 1)?.originalAmountCents).toBe(60000);
      await expect(
        billing.generateMonthlyFees({
          conceptId: 1,
          period: '2026-10',
          dueDate: '2026-10-10',
          excludedPlayerIds: [6],
          exclusionReason: null,
        }),
      ).rejects.toThrow('regla autorizada');
      const r = await billing.generateMonthlyFees({
        conceptId: 1,
        period: '2026-10',
        dueDate: '2026-10-10',
        excludedPlayerIds: [6],
        exclusionReason: 'Beca 100%',
      });
      expect(r).toEqual({ created: 4, skipped: 0 });
      expect(
        (
          await billing.generateMonthlyFees({
            conceptId: 1,
            period: '2026-10',
            dueDate: '2026-10-10',
            excludedPlayerIds: [],
            exclusionReason: null,
          })
        ).created,
      ).toBe(1);
      await expect(
        billing.generateMonthlyFees({
          conceptId: 2,
          period: '2026-10',
          dueDate: '2026-10-10',
          excludedPlayerIds: [],
          exclusionReason: null,
        }),
      ).rejects.toThrow('recurrente');
    });

    it('HU-046/050: statement totals and debts list with primary tutor, excluding cancelled charges', async () => {
      await login('secretaria');
      const billing = get(BillingService);
      const lucia = await billing.statement(2);
      expect(lucia.totals).toMatchObject({
        chargedCents: 95000,
        paidCents: 0,
        balanceCents: 95000,
        overdueCents: 60000,
      });
      const debts = await billing.debts({ onlyOverdue: true });
      expect(debts.map((d) => [d.playerName, d.overdueCents, d.tutorName])).toEqual([
        ['Mateo Ruiz', 70000, 'Jorge Ruiz'],
        ['Lucía Hernández López', 60000, 'Teresa López'],
      ]);
      await billing.cancelCharge(2, 'Error de captura');
      expect((await billing.debts({ onlyOverdue: true })).map((d) => d.playerId)).toEqual([3]);
      expect((await billing.debts({ categoryId: 2 })).map((d) => d.playerId)).toEqual([2]);
    });

    it('HU-049: only an authorized role cancels, with reason; HU-051: discounts by authorized users keep the original', async () => {
      await login('secretaria');
      const billing = get(BillingService);
      await expect(billing.cancelPayment(1, 'x')).rejects.toThrow('No tienes permiso');
      await expect(
        billing.addDiscount({ chargeId: 2, type: 'BECA', reason: 'x', adjustmentCents: 100 }),
      ).rejects.toThrow('No tienes permiso');
      get(AuthService).logout();
      await login('admin');
      await expect(billing.cancelPayment(1, ' ')).rejects.toThrow('motivo');
      await expect(
        billing.addDiscount({
          chargeId: 2,
          type: 'DESCUENTO',
          reason: 'Hermanos',
          adjustmentCents: 60001,
        }),
      ).rejects.toThrow('mayor al saldo');
      const d = await billing.addDiscount({
        chargeId: 2,
        type: 'DESCUENTO',
        reason: 'Hermanos',
        adjustmentCents: 6000,
      });
      expect(d).toMatchObject({
        originalAmountCents: 60000,
        adjustmentCents: 6000,
        finalAmountCents: 54000,
      });
      expect(db().charges.find((c) => c.id === 2)?.originalAmountCents).toBe(60000);
      expect((await billing.statement(2)).charges.find((c) => c.id === 2)?.balanceCents).toBe(
        54000,
      );
    });
  });

  describe('H · uniforms', () => {
    it('HU-053/054/055: price snapshot, charge = total, PAGADO from the balance, delivery, cancellation rules', async () => {
      await login('secretaria');
      const uniforms = get(UniformService);
      const order = await uniforms.createOrder(1, [{ variantId: 1, quantity: 2 }], 3);
      await uniforms.saveVariant({ id: 1, productId: 1, size: 'CH', priceCents: 99900 });
      expect(db().charges.find((c) => c.id === order.chargeId)).toMatchObject({
        originalAmountCents: 70000,
        reference: `PED-${order.id}`,
      });
      await get(BillingService).registerPayment({
        playerId: 1,
        tutorId: 1,
        amountCents: 70000,
        method: 'EFECTIVO',
        chargeIds: [order.chargeId!],
      });
      const view = (await uniforms.orders({ playerIds: [1] }))[0];
      expect(view).toMatchObject({ status: 'PAGADO', totalCents: 70000 });
      expect(view.lines[0].unitPriceCents).toBe(35000);
      await expect(uniforms.cancelOrder(order.id, 'x')).rejects.toThrow('pagos aplicados');
      await uniforms.deliver(order.id, 'Teresa');
      await expect(uniforms.deliver(order.id, 'Teresa')).rejects.toThrow('ya fue entregado');
      await uniforms.cancelOrder(1, 'Ya no lo necesita'); // Lucía's unpaid order
      expect(db().charges.find((c) => c.id === 5)?.status).toBe('CANCELADO');
      await expect(uniforms.deliver(1, 'X')).rejects.toThrow('cancelado');
    });

    it('a free order (total 0) creates no charge (cargo_id NULL)', async () => {
      await login('secretaria');
      const uniforms = get(UniformService);
      const free = await uniforms.saveVariant({ productId: 2, size: 'Regalo', priceCents: 0 });
      const charges = db().charges.length;
      expect(
        (await uniforms.createOrder(1, [{ variantId: free.id, quantity: 2 }], 3)).chargeId,
      ).toBeNull();
      expect(db().charges).toHaveLength(charges);
    });
  });

  describe('I · notices', () => {
    it('HU-057/058/059/060: audience segmentation, validity, publish/unpublish', async () => {
      await login('secretaria');
      const notices = get(NoticeService);
      await expect(
        notices.save({
          title: 'x',
          message: 'y',
          startsAt: '2026-10-10T00:00:00',
          endsAt: '2026-10-01T00:00:00',
          published: true,
          categoryIds: [],
          tutorIds: [],
          coachIds: [],
        }),
      ).rejects.toThrow('termina antes');
      const sub12 = await notices.save({
        title: 'Sub-12 y Sub-8',
        message: 'Uniforme blanco',
        startsAt: null,
        endsAt: null,
        published: true,
        categoryIds: [2, 3],
        tutorIds: [],
        coachIds: [],
      });
      const toJorge = await notices.save({
        title: 'Para Jorge',
        message: 'Pase a dirección',
        startsAt: null,
        endsAt: null,
        published: true,
        categoryIds: [],
        tutorIds: [2],
        coachIds: [],
      });
      expect(
        db()
          .noticeRecipients.filter((r) => r.noticeId === sub12.id)
          .map((r) => r.audience),
      ).toEqual(['CATEGORIA', 'CATEGORIA']);
      expect(notices.forTutor(1).map((n) => n.id)).toEqual([sub12.id, 2, 1]); // Lucía is in Sub-12; Diego in Sub-10
      expect(notices.forTutor(2).map((n) => n.id)).toContain(toJorge.id);
      expect(notices.forCoach(2).map((n) => n.id)).toEqual([sub12.id, 1]); // Marta coaches Sub-12
      await notices.setPublished(sub12.id, false);
      expect(notices.forCoach(2).map((n) => n.id)).toEqual([1]);
    });
  });

  describe('J · family portal', () => {
    it('HU-061/062/063/064: cards, sporting data, roster-based competitions and contact-only profile edits', async () => {
      await login('tutor');
      const portal = get(PortalService);
      const cards = await portal.overview();
      expect(cards.find((c) => c.playerId === 1)).toMatchObject({
        categoryName: 'Sub-10',
        balanceCents: 0,
        nextMatch: { id: 2 },
      });
      const diego = await portal.child(1);
      expect(diego.schedules.map((s) => s.weekday)).toEqual([1, 3, 6]);
      expect(diego.coaches.map((c) => c.name)).toEqual(['Carlos Pérez', 'Luis Gómez']);
      expect(diego.results.map((m) => m.goalsFor)).toEqual([3]);
      expect(diego.attendance.summary).toMatchObject({ total: 1, present: 1 });
      await expect(
        portal.updateProfile({ phone: '12', email: null, address: null }),
      ).rejects.toThrow('Teléfono');
      const t = await portal.updateProfile({
        phone: '5599998888',
        email: 'teresa@example.com',
        address: 'Calle Roble 3',
      });
      expect(t).toMatchObject({ firstName: 'Teresa', phone: '5599998888' });
      expect(db().audit.at(-1)).toMatchObject({ entity: 'tutores', entityId: 1, userId: 4 });
    });

    it('a family with a child only in one competition roster sees only that competition (HU-063.1)', async () => {
      db().tutors.find((t) => t.id === 2)!.userId = 6; // give Jorge a login for the test
      db().tutors.find((t) => t.id === 3)!.userId = null;
      await login('marta');
      const sofia = await get(PortalService).child(6);
      expect(sofia.competitions.map((c) => c.competitionName)).toEqual(['Copa Otoño']); // Sub-12 plays the Liga, Sofía isn't in that roster
    });
  });

  describe('K · reports', () => {
    it('HU-065/066/067/068: KPIs declare their source; players by category; income excludes cancelled; agenda merges events', async () => {
      await login('admin');
      const reports = get(ReportService);
      const dash = await reports.dashboard('2026-09-01', '2026-09-30');
      expect(dash.kpis.every((k) => k.source && k.link)).toBe(true);
      expect(dash.kpis.find((k) => k.label === 'Jugadores activos')?.value).toBe(5);
      expect(dash.kpis.find((k) => k.label.startsWith('Ingresos'))?.value).toBe(90000);
      const groups = await reports.playersByCategory({ status: 'ACTIVO' });
      expect(groups.map((g) => [g.categoryName, g.players.length])).toEqual([
        ['Sub-10', 3],
        ['Sub-12', 2],
      ]);
      await get(BillingService).cancelPayment(1, 'Error');
      expect(await reports.income('2026-09-01', '2026-09-30')).toEqual([
        { month: '2026-09', conceptName: 'Mensualidad', totalCents: 30000 },
      ]);
      const agenda = await reports.agenda('2026-10-01', '2026-10-31');
      expect(new Set(agenda.map((e) => e.kind))).toEqual(new Set(['training', 'match']));
      expect(agenda.map((e) => e.date)).toEqual([...agenda.map((e) => e.date)].sort());
    });
  });
});

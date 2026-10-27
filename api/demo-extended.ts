/**
 * Extended demo data (`npm run db:setup -- --demo --ampliada`): on top of the MockDb demo of api/demo.ts, a school
 * with enough fictitious data to show every module — ~50 players across six categories, families, coaches,
 * schedules, four weeks of sessions with attendance, a league and a finished cup with results, monthly fees with
 * paid, partial and overdue balances, uniforms and notices.
 *
 * Everything goes through the real domain services (api/domain, the same bridge as POST /api/rpc) as the demo
 * administrator — logged in like the app does (a real session, closed at the end) — so every business rule, charge
 * and audit entry is the one the app would produce. One unit of work: all or nothing. Dates are relative to today, which must fall inside the current season.
 *
 * Only for a dedicated *_demo database (api/setup.ts checks the name and NODE_ENV before calling this): demo rows are
 * not marked, so the way to remove them is to drop that database (`npm run db:demo:reset`), never to delete rows.
 */
import type { Pool } from 'mariadb';
import { login, logout, sessionUser } from './auth.ts';
import { domain, unitOfWork, type Tables } from './rpc.ts';
import type { Ctx } from './server.ts';

type Row = Record<string, any>;

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Local calendar arithmetic on 'YYYY-MM-DD' (never through UTC). */
function shift(date: string, days: number, years = 0): string {
  const [y, m, d] = date.split('-').map(Number);
  return iso(new Date(y! - years, m! - 1, d! + days));
}

const FIRST_F = [
  'Ana',
  'Camila',
  'Daniela',
  'Fernanda',
  'Isabela',
  'Jimena',
  'Mariana',
  'Regina',
  'Renata',
  'Ximena',
];
const FIRST_M = [
  'Alejandro',
  'Bruno',
  'Carlos',
  'Emilio',
  'Gael',
  'Iker',
  'Julián',
  'Leonardo',
  'Santiago',
  'Tomás',
];
const MOTHERS = ['Laura', 'Patricia', 'Verónica', 'Claudia', 'Mónica'];
const FATHERS = ['Jorge', 'Ricardo', 'Arturo', 'Héctor', 'Manuel'];
const SURNAMES = [
  'Aguilar',
  'Bautista',
  'Cárdenas',
  'Delgado',
  'Escobar',
  'Fuentes',
  'Guzmán',
  'Ibarra',
  'Juárez',
  'Lara',
  'Medina',
  'Navarro',
  'Ochoa',
  'Peña',
  'Quintero',
  'Rosales',
  'Serrano',
  'Trejo',
  'Valdez',
  'Zamora',
];

/** New categories of the current season (the demo already has Sub-8, Sub-10 and Sub-12, which is full on purpose). */
const NEW_CATEGORIES = [
  { name: 'Sub-6', minAge: 4, maxAge: 6, maxCapacity: 12 },
  { name: 'Sub-14', minAge: 12, maxAge: 14, maxCapacity: 18 },
  { name: 'Sub-16', minAge: 14, maxAge: 16, maxCapacity: 13 },
];
/** Players to create per category and the age they have today (inside the category's range). */
const SQUADS: [string, number, number][] = [
  ['Sub-6', 8, 5],
  ['Sub-8', 8, 7],
  ['Sub-10', 10, 9],
  ['Sub-14', 12, 13],
  ['Sub-16', 10, 15],
];

export interface ExtendedDemoSummary {
  players: number;
  tutors: number;
  sessions: number;
  attendance: number;
  matches: number;
  payments: number;
}

export async function loadExtendedDemo(db: Pool): Promise<ExtendedDemoSummary> {
  const ctx: Ctx = {
    body: { email: 'admin@example.com', password: 'demo1234' },
    token: null,
    ip: '127.0.0.1',
    userAgent: 'api/demo-extended.ts',
    secureCookie: false,
    mailer: null,
  };
  const reply = await login(ctx, db);
  if (reply.status !== 200 || !reply.cookie)
    throw new Error(
      'No se pudo entrar como admin@example.com: carga primero la demostración base (--demo).',
    );
  const session: Ctx = { ...ctx, body: null, token: /=([^;]*)/.exec(reply.cookie)![1]! };
  const user = await sessionUser(session, db);
  const d = await domain;
  try {
    return await load(db, user, d);
  } finally {
    await logout(session, db);
  }
}

async function load(
  db: Pool,
  user: unknown,
  d: Awaited<typeof domain>,
): Promise<ExtendedDemoSummary> {
  return (
    await unitOfWork(db, async (tables) => {
      let t: Tables = tables;
      /** One domain operation as the demo administrator, threading the tables (runDomain wants its own copies). */
      const call = async <T = Row>(
        service: string,
        method: string,
        ...args: unknown[]
      ): Promise<T> => {
        const copy = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, [...v]]));
        const out = await d.runDomain({ tables: copy, user: user as never, service, method, args });
        t = out.tables;
        return out.result as T;
      };
      const rows = (name: string) => t[name] as Row[];
      const byName = (name: string, value: string) => rows(name).find((r) => r['name'] === value)!;

      const today = iso(new Date());
      const season = rows('seasons').find((s) => s['isCurrent']);
      if (!season || today < season['startDate'] || today > season['endDate'])
        throw new Error('La fecha de hoy no cae en la temporada actual de la demostración.');
      if (
        rows('players').some((p) => p['firstName'] === FIRST_F[0] && p['lastName1'] === SURNAMES[0])
      )
        throw new Error('La demostración ampliada ya está cargada en esta base.');

      // ── Venues and categories ──────────────────────────────────────────────────────────────────────
      const palmas = await call('VenueService', 'save', {
        name: 'Cancha Las Palmas',
        location: 'Calle Las Palmas s/n',
        reference: 'Junto al parque',
      });
      const ribera = await call('VenueService', 'save', {
        name: 'Deportivo Ribera',
        location: 'Av. Ribera 200',
        reference: null,
      });
      const annex = await call('VenueService', 'save', {
        name: 'Cancha Anexa',
        location: 'Calle Pino 40',
        reference: 'En remodelación',
      });
      await call('VenueService', 'setActive', annex['id'], false);
      const main = byName('venues', 'Campo Principal');
      for (const c of NEW_CATEGORIES)
        await call('CategoryService', 'save', { seasonId: season['id'], ...c });
      const closed = await call('CategoryService', 'save', {
        seasonId: season['id'],
        name: 'Sub-18',
        minAge: 16,
        maxAge: 18,
        maxCapacity: null,
      });
      await call('CategoryService', 'setActive', closed['id'], false);
      const category = (name: string) =>
        rows('categories').find((c) => c['name'] === name && c['seasonId'] === season['id'])!;

      // ── Coaches and their categories (one ended assignment, one inactive coach) ────────────────────
      const coach = (firstName: string, lastName1: string, n: number) =>
        call('CoachService', 'save', {
          firstName,
          lastName1,
          lastName2: null,
          phone: `00000001${pad(n)}`,
          email: null,
        });
      const rafael = await coach('Rafael', 'Mendoza', 1);
      const gabriela = await coach('Gabriela', 'Ortiz', 2);
      const hugo = await coach('Hugo', 'Salas', 3);
      const since = shift(today, -60);
      const assign = (c: Row, name: string, responsibility: string, startDate = since) =>
        call('CoachService', 'assignCategory', {
          coachId: c['id'],
          categoryId: category(name)['id'],
          responsibility,
          startDate,
        });
      await assign(gabriela, 'Sub-6', 'Principal');
      await assign(rafael, 'Sub-14', 'Principal');
      await assign(rafael, 'Sub-16', 'Principal');
      await assign(gabriela, 'Sub-16', 'Auxiliar');
      const ended = await assign(hugo, 'Sub-14', 'Auxiliar', shift(today, -90));
      await call('CoachService', 'endCategoryAssignment', ended['id'], shift(today, -30));
      await call('CoachService', 'setActive', hugo['id'], false);

      // ── Players, families and enrollment (charges included) ────────────────────────────────────────
      const inscription = byName('concepts', 'Inscripción anual');
      const joined = shift(today, -50);
      const players: { row: Row; category: string; tutorId: number }[] = [];
      let n = 0;
      let family: Row | null = null;
      for (const [name, count, age] of SQUADS)
        for (let i = 0; i < count; i++, n++) {
          const female = n % 2 === 0;
          // Every fifth player is the younger sibling of the previous one: same surnames, same tutor.
          const sibling: boolean = family !== null && n % 5 === 1;
          const spread = Math.floor(n / 2) + Math.floor(n / 20); // no repeated full names in 50 players
          const first = (female ? FIRST_F : FIRST_M)[spread % 10]!;
          const surname: string = sibling
            ? players.at(-1)!.row['lastName1']
            : SURNAMES[n % SURNAMES.length]!;
          const second: string = sibling
            ? players.at(-1)!.row['lastName2']
            : SURNAMES[(n * 7 + 3) % SURNAMES.length]!;
          const player: Row = await call('PlayerService', 'create', {
            firstName: first,
            lastName1: surname,
            lastName2: second,
            // Turned `age` 60 to 330 days ago: the same age today and on the day they joined (50 days ago).
            birthDate: shift(today, -(60 + ((n * 37) % 270)), age),
            sex: female ? 'F' : 'M',
            phone: null,
            email: null,
            address: n % 3 === 0 ? `Calle ${SURNAMES[(n + 5) % SURNAMES.length]} ${10 + n}` : null,
          });
          if (!sibling) {
            const mother = n % 4 !== 3;
            family = await call('TutorService', 'save', {
              firstName: (mother ? MOTHERS : FATHERS)[spread % 5],
              lastName1: surname,
              lastName2: SURNAMES[(n + 11) % SURNAMES.length],
              phone: `00000002${pad(n)}`,
              email: `familia.${n}@example.com`,
              address: null,
              links: [
                {
                  playerId: player['id'],
                  relationship: mother ? 'Madre' : 'Padre',
                  isPrimary: true,
                },
              ],
            });
          } else {
            const current: Row = family!;
            const links = rows('tutorPlayers')
              .filter((l) => l['tutorId'] === current['id'])
              .map((l) => ({
                playerId: l['playerId'],
                relationship: l['relationship'],
                isPrimary: l['isPrimary'],
              }));
            family = await call('TutorService', 'save', {
              id: current['id'],
              firstName: current['firstName'],
              lastName1: current['lastName1'],
              lastName2: current['lastName2'],
              phone: current['phone'],
              email: current['email'],
              address: current['address'],
              links: [
                ...links,
                { playerId: player['id'], relationship: links[0]!.relationship, isPrimary: true },
              ],
            });
          }
          await call('EnrollmentService', 'enroll', {
            playerId: player['id'],
            seasonId: season['id'],
            enrolledOn: joined,
            amountCents: inscription['suggestedAmountCents'],
            status: 'ACTIVA',
            conceptId: inscription['id'],
            dueDate: shift(joined, 15),
          });
          await call('PlayerCategoryService', 'assign', {
            playerId: player['id'],
            categoryId: category(name)['id'],
            date: joined,
            exceptionReason: null,
          });
          players.push({ row: player, category: name, tutorId: family!['id'] });
        }

      // ── Training schedules (one deliberate overlap for Rafael: Sub-14 and Sub-16 on Tuesday) ───────
      const schedule = (
        name: string,
        weekday: number,
        startTime: string,
        endTime: string,
        venue: Row,
      ) =>
        call('ScheduleService', 'save', {
          categoryId: category(name)['id'],
          venueId: venue['id'],
          weekday,
          startTime,
          endTime,
        });
      await schedule('Sub-6', 2, '16:00', '17:00', palmas);
      await schedule('Sub-6', 4, '16:00', '17:00', palmas);
      await schedule('Sub-14', 2, '18:00', '19:30', main);
      await schedule('Sub-14', 4, '18:00', '19:30', main);
      await schedule('Sub-16', 2, '18:30', '20:00', ribera);
      await schedule('Sub-16', 5, '18:00', '19:30', ribera);

      // ── Sessions: four weeks back and two ahead; the past ones held (two cancelled) with attendance ──
      await call(
        'TrainingService',
        'generateFromSchedules',
        shift(today, -28),
        shift(today, 14),
        null,
      );
      const members = (categoryId: number) =>
        rows('playerCategories')
          .filter((m) => m['categoryId'] === categoryId && !m['endDate'])
          .map((m) => m['playerId'] as number)
          .filter((id) => rows('players').find((p) => p['id'] === id)!['status'] === 'ACTIVO');
      const past = rows('trainingSessions')
        .filter(
          (s) =>
            s['status'] === 'PROGRAMADO' && s['date'] >= shift(today, -28) && s['date'] < today,
        )
        .sort((a, b) => (a['date'] < b['date'] ? -1 : 1));
      let attendance = 0;
      for (const [i, s] of past.entries()) {
        if (i === 3 || i === 11) {
          await call(
            'TrainingService',
            'setStatus',
            s['id'],
            'CANCELADO',
            'Lluvia: cancha inundada',
          );
          continue;
        }
        await call('TrainingService', 'setStatus', s['id'], 'REALIZADO');
        const entries = members(s['categoryId']).map((playerId, j) => {
          const k = (playerId * 7 + i * 3 + j) % 20;
          const status = k < 17 ? 'PRESENTE' : k < 19 ? 'AUSENTE' : 'JUSTIFICADO';
          return { playerId, status, notes: status === 'JUSTIFICADO' ? 'Cita médica' : null };
        });
        if (!entries.length) continue;
        await call('AttendanceService', 'record', s['id'], entries);
        attendance += entries.length;
        if (i % 4 === 0)
          await call('TrainingService', 'saveNotes', s['id'], {
            objective: 'Pase corto y control orientado',
            notes: 'Buena intensidad; repetir el ejercicio de rondo.',
          });
      }

      // ── Competitions: Sub-14 and Sub-16 in the league, a finished cup with results ──────────────────
      const opponents: Row[] = [];
      for (const name of [
        'Deportivo Laguna',
        'Atlético Jocotepec',
        'Club Ajijic',
        'Halcones del Lago',
        'Unión Ixtlahuacán',
      ])
        opponents.push(
          await call('MatchService', 'saveOpponent', { name, contact: null, notes: null }),
        );
      const league = byName('competitions', 'Liga Municipal');
      const cup = await call('CompetitionService', 'save', {
        seasonId: season['id'],
        name: 'Copa Ribera',
        type: 'TORNEO',
        organizer: 'Liga de la Ribera',
        contact: null,
        startDate: shift(today, -45),
        endDate: shift(today, -20),
        status: 'ACTIVA',
        notes: null,
      });
      const register = (competition: Row, name: string) =>
        call('CompetitionService', 'register', {
          competitionId: competition['id'],
          categoryId: category(name)['id'],
          registeredOn: shift(today, -45),
          costCents: 25000,
          status: 'INSCRITA',
        });
      let matches = 0;
      for (const [competition, name] of [
        [league, 'Sub-14'],
        [league, 'Sub-16'],
        [cup, 'Sub-14'],
      ] as const) {
        const cc = await register(competition, name);
        for (const p of players.filter((x) => x.category === name))
          await call('CompetitionService', 'addToRoster', cc['id'], p.row['id'], shift(today, -44));
        await call('CoachService', 'assignCompetition', {
          coachId: rafael['id'],
          competitionCategoryId: cc['id'],
          startDate: shift(today, -44),
        });
        const days = competition === cup ? [-40, -30, -22] : [-21, -14, -7, 4, 11, 18];
        for (const [j, offset] of days.entries()) {
          const match = await call('MatchService', 'schedule', {
            competitionCategoryId: cc['id'],
            opponentId: opponents[(j + matches) % opponents.length]!['id'],
            venueId: j % 2 === 0 ? main['id'] : ribera['id'],
            date: shift(today, offset),
            time: j % 2 === 0 ? '10:00' : '12:00',
            homeAway: j % 2 === 0 ? 'LOCAL' : 'VISITANTE',
            notes: null,
          });
          matches++;
          if (offset < 0)
            await call('MatchService', 'recordResult', match['id'], {
              goalsFor: (j * 3 + matches) % 4,
              goalsAgainst: (j + matches) % 3,
              notes: null,
            });
          else if (offset === 11 && name === 'Sub-14')
            await call('MatchService', 'reschedule', match['id'], {
              date: shift(today, 12),
              time: '09:00',
              venueId: main['id'],
              reason: 'Cambio de horario del organizador',
            });
          else if (offset === 18 && name === 'Sub-16')
            await call(
              'MatchService',
              'cancel',
              match['id'],
              'El rival no se presentó al registro',
            );
        }
      }
      await call('CompetitionService', 'save', { ...cup, status: 'FINALIZADA' });

      // ── Billing: monthly fees since the season began, then paid / partial / overdue families ───────
      const monthly = byName('concepts', 'Mensualidad');
      await call('BillingService', 'saveConcept', {
        name: 'Cuota de torneo',
        suggestedAmountCents: 25000,
        recurring: false,
      });
      const clinic = await call('BillingService', 'saveConcept', {
        name: 'Clínica de porteros',
        suggestedAmountCents: 40000,
        recurring: false,
      });
      await call('BillingService', 'setConceptActive', clinic['id'], false);
      // Up to next month's fee, billed in advance (due on the 10th): the only kind a partial payment leaves PARCIAL,
      // since an overdue balance is VENCIDO whatever was paid (billing.rules.ts chargeStatus).
      const [ty, tm] = today.split('-').map(Number);
      const nextMonth = iso(new Date(ty!, tm!, 1)).slice(0, 7);
      for (let month = season['startDate'].slice(0, 7); month <= nextMonth;) {
        await call('BillingService', 'generateMonthlyFees', {
          conceptId: monthly['id'],
          period: month,
          dueDate: `${month}-10`,
          excludedPlayerIds: [],
          exclusionReason: null,
        });
        const [y, m] = month.split('-').map(Number);
        month = m === 12 ? `${y! + 1}-01` : `${y}-${pad(m! + 1)}`;
      }
      // Scholarships and discounts before paying (they lower what is owed).
      for (const [i, p] of players.slice(0, 4).entries()) {
        const charge = rows('charges').find(
          (c) => c['playerId'] === p.row['id'] && c['conceptId'] === monthly['id'],
        )!;
        await call('BillingService', 'addDiscount', {
          chargeId: charge['id'],
          type: i < 2 ? 'BECA' : 'DESCUENTO',
          reason: i < 2 ? 'Beca deportiva 50 %' : 'Descuento por hermanos',
          adjustmentCents: Math.round(charge['originalAmountCents'] * (i < 2 ? 0.5 : 0.1)),
        });
      }
      let payments = 0;
      for (const [i, p] of players.entries()) {
        const open = await call<Row[]>('BillingService', 'openCharges', p.row['id']);
        const due = open.filter((c) => c['dueDate'] < today);
        const next = open.find((c) => c['dueDate'] >= today);
        const owed = due.reduce((sum, c) => sum + c['balanceCents'], 0);
        // 0–5: up to date · 6–7: up to date plus half of next month (PARCIAL) · 8: half of what is due · 9: nothing.
        const plan = i % 10;
        if (plan === 9) continue;
        const ahead = plan === 6 || plan === 7 ? next : undefined;
        const amountCents =
          plan === 8
            ? Math.round(owed / 2)
            : owed + (ahead ? Math.round(ahead['balanceCents'] / 2) : 0);
        if (!amountCents) continue;
        const payment = await call('BillingService', 'registerPayment', {
          playerId: p.row['id'],
          tutorId: p.tutorId,
          amountCents,
          method: (['EFECTIVO', 'TRANSFERENCIA', 'TARJETA'] as const)[i % 3],
          chargeIds: [...due, ...(ahead ? [ahead] : [])].map((c) => c['id']),
          paidAt: `${shift(today, -(i % 9) - 1)}T10:30:00`,
        });
        payments++;
        if (i === 7 || i === 23)
          await call('BillingService', 'cancelPayment', payment['id'], 'Pago capturado dos veces');
      }

      // ── Uniforms: a product more, orders in every state ────────────────────────────────────────────
      const socks = await call('UniformService', 'saveProduct', {
        name: 'Medias',
        description: 'Medias oficiales',
      });
      const sockVariant = await call('UniformService', 'saveVariant', {
        productId: socks['id'],
        size: 'Única',
        priceCents: 8000,
      });
      const jersey = rows('uniformVariants').find((v) => v['size'] === 'M')!;
      const uniform = byName('concepts', 'Uniforme');
      for (const [i, p] of players.slice(10, 20).entries()) {
        const order = await call(
          'UniformService',
          'createOrder',
          p.row['id'],
          [
            { variantId: jersey['id'], quantity: 1 },
            { variantId: sockVariant['id'], quantity: 2 },
          ],
          uniform['id'],
        );
        if (i < 6) {
          await call('BillingService', 'registerPayment', {
            playerId: p.row['id'],
            tutorId: p.tutorId,
            amountCents: rows('charges').find((c) => c['id'] === order['chargeId'])![
              'originalAmountCents'
            ],
            method: 'EFECTIVO',
            chargeIds: [order['chargeId']],
          });
          payments++;
          if (i < 3) await call('UniformService', 'deliver', order['id'], 'Su madre', today);
        } else if (i >= 8)
          await call('UniformService', 'cancelOrder', order['id'], 'Cambio de talla');
      }

      // ── Status changes after the history exists (a leave keeps charges, attendance and matches) ───
      const leaving = players.filter((_, i) => i % 11 === 10);
      for (const [i, p] of leaving.entries())
        await call(
          'PlayerService',
          'changeStatus',
          p.row['id'],
          i < 3 ? 'BAJA_TEMPORAL' : 'BAJA_DEFINITIVA',
          i < 3 ? 'Lesión en recuperación' : 'Cambio de ciudad',
        );

      // ── Notices: current, by category, for coaches, expired, scheduled and a draft ─────────────────
      const notice = (title: string, message: string, extra: Row = {}) =>
        call('NoticeService', 'save', {
          title,
          message,
          startsAt: null,
          endsAt: null,
          published: true,
          categoryIds: [],
          tutorIds: [],
          coachIds: [],
          ...extra,
        });
      await notice(
        'Torneo relámpago de fin de mes',
        'Inscripciones abiertas en la oficina hasta el viernes.',
      );
      await notice('Cambio de horario Sub-14', 'El jueves se entrena de 17:30 a 19:00.', {
        categoryIds: [category('Sub-14')['id']],
      });
      await notice('Junta de entrenadores', 'Revisión de planteles el lunes a las 20:00.', {
        coachIds: [rafael['id'], gabriela['id']],
      });
      await notice('Fotos de temporada', 'La sesión de fotos ya se realizó.', {
        startsAt: `${shift(today, -30)}T08:00:00`,
        endsAt: `${shift(today, -10)}T20:00:00`,
      });
      await notice('Posada de fin de año', 'Detalles próximamente.', {
        startsAt: `${shift(today, 20)}T08:00:00`,
      });
      await notice('Borrador: rifa', 'Pendiente de autorización.', { published: false });

      return {
        tables: t,
        summary: {
          players: players.length,
          tutors: new Set(players.map((p) => p.tutorId)).size,
          sessions: past.length,
          attendance,
          matches,
          payments,
        },
      };
    })
  ).summary;
}

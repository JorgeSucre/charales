import { TestBed } from '@angular/core/testing';
import { MockDb } from './mock-db';
import { integrityViolations } from './mock-db.integrity';

/**
 * HU-073: the integrity checker itself must catch what MariaDB would reject. Each case corrupts a fresh MockDb in one
 * way and expects a violation naming the constraint. Plus explicit transaction rollback tests.
 */
describe('MockDb integrity checker', () => {
  let db: MockDb;
  beforeEach(() => {
    TestBed.resetTestingModule();
    db = TestBed.inject(MockDb);
  });

  it('the seed is consistent', () => {
    expect(integrityViolations(db)).toEqual([]);
  });

  const cases: [string, string, (db: MockDb) => void][] = [
    // relations (bridge tables)
    [
      'tutor_jugador: two primaries for one player',
      'uq_tutor_jugador_un_principal',
      (d) =>
        d.tutorPlayers.push({
          tutorId: 4,
          playerId: 1,
          relationship: 'Tío',
          isPrimary: true,
          createdAt: '',
        }),
    ],
    [
      'tutor_jugador: duplicate PK',
      'tutor_jugador PK',
      (d) => d.tutorPlayers.push({ ...d.tutorPlayers[0], isPrimary: false }),
    ],
    [
      'tutor_jugador: FK to a missing player',
      'FK tutor_jugador.playerId',
      (d) =>
        d.tutorPlayers.push({
          tutorId: 1,
          playerId: 999,
          relationship: 'x',
          isPrimary: false,
          createdAt: '',
        }),
    ],
    [
      'jugador_categoria: two current rows',
      'uq_jugador_categoria_vigente',
      (d) => d.playerCategories.push({ ...d.playerCategories[0], id: 99 }),
    ],
    [
      'jugador_categoria: end before start',
      'chk_jugador_categoria_fechas',
      (d) => (d.playerCategories[5].endDate = '2020-01-01'),
    ],
    [
      'competencia_categoria: duplicate pair',
      'uq_competencia_categoria',
      (d) => d.competitionCategories.push({ ...d.competitionCategories[0], id: 99 }),
    ],
    [
      'jugador_competencia_categoria: duplicate',
      'uq_jugador_competencia_categoria',
      (d) => d.rosters.push({ ...d.rosters[0], id: 99 }),
    ],
    [
      'jugador_competencia_categoria: leave before join',
      'chk_jcc_fechas',
      (d) => Object.assign(d.rosters[0], { active: false, leftOn: '2020-01-01' }),
    ],
    [
      'entrenador_categoria: end before start',
      'chk_ent_cat_fechas',
      (d) => Object.assign(d.coachCategories[0], { active: false, endDate: '2020-01-01' }),
    ],
    [
      'entrenador_competencia_categoria: FK to a missing coach',
      'FK entrenador_competencia_categoria.coachId',
      (d) => (d.coachCompetitions[0].coachId = 999),
    ],
    [
      'entrenador_competencia_categoria: duplicate',
      'uq_entrenador_comp_cat',
      (d) => d.coachCompetitions.push({ ...d.coachCompetitions[0], id: 99 }),
    ],
    // money
    [
      'pago_aplicacion: charge of another player',
      'fk_pago_aplicacion_cargo',
      (d) => (d.paymentApplications[0].chargeId = 2),
    ],
    [
      'pago_aplicacion: sum != payment amount',
      'pago aplicado por su importe',
      (d) => (d.paymentApplications[0].amountCents = 100),
    ],
    [
      'descuentos: adjustment > original',
      'chk_descuento_montos',
      (d) => (d.discounts[0].adjustmentCents = 99999999),
    ],
    [
      'conceptos_cobro: negative amount',
      'chk_concepto_importe',
      (d) => (d.concepts[0].suggestedAmountCents = -1),
    ],
    // uniforms
    [
      'detalle_uniforme: FK to a missing variant',
      'FK detalle_uniforme.variantId',
      (d) => (d.uniformOrderLines[0].variantId = 999),
    ],
    [
      'detalle_uniforme: quantity 0',
      'chk_detalle_uniforme',
      (d) => (d.uniformOrderLines[0].quantity = 0),
    ],
    // notices
    [
      'aviso_destinatario: CATEGORIA without category',
      'chk_aviso_dest_audiencia',
      (d) => (d.noticeRecipients[1].categoryId = null),
    ],
    [
      'aviso_destinatario: FK to a missing category',
      'FK aviso_destinatario.categoryId',
      (d) => (d.noticeRecipients[1].categoryId = 999),
    ],
    // security / catalogs
    [
      'rol_permiso: FK to a missing permission',
      'FK rol_permiso.permissionId',
      (d) => d.rolePermissions.push({ roleId: 1, permissionId: 999, createdAt: '' }),
    ],
    [
      'temporadas: duplicate name',
      'temporadas.nombre',
      (d) => d.seasons.push({ ...d.seasons[0], id: 9, isCurrent: false }),
    ],
  ];

  for (const [name, constraint, corrupt] of cases) {
    it(`detects ${name}`, () => {
      corrupt(db);
      expect(
        integrityViolations(db).some((v) => v.includes(constraint)),
        integrityViolations(db).join('\n'),
      ).toBe(true);
    });
  }

  it('covers 21 injected violations', () => expect(cases).toHaveLength(21));

  it('rollback: a valid write followed by a failing one leaves every table exactly as before', () => {
    const before = JSON.stringify(db);
    expect(() =>
      db.transaction(() => {
        const p = db.insert(db.players, { ...db.players[0], identifier: 'J-9999' }); // valid
        db.insert(db.statusHistory, { ...db.statusHistory[0], playerId: p.id });
        db.update(db.charges, 1, { status: 'CANCELADO' });
        db.get(db.players, 12345, 'Jugador'); // invalid: missing FK target → throws
      }),
    ).toThrow('Jugador no encontrado.');
    expect(JSON.stringify(db)).toBe(before);
    expect(integrityViolations(db)).toEqual([]);
  });

  it('commit: without errors the writes stay', () => {
    db.transaction(() => db.update(db.concepts, 1, { active: false }));
    expect(db.concepts[0].active).toBe(false);
  });
});

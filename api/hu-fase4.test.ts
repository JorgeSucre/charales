/**
 * Phase 4 HU (docs/TRACEABILITY.md): concepts, monthly fees, charges, payments, balances, receipts, cancellations,
 * debts, discounts, and uniforms linked to billing. Money must stay consistent in MariaDB: every check reads the
 * stored rows (DECIMAL) after going through `/api/rpc`.
 * Seed (api/demo.ts): charges 1 (Diego 600 PAGADO), 2 (Lucía 600 VENCIDO), 3 (Mateo 1200 VENCIDO), 4 (Sofía 600, beca
 * 300 + pago 300), 5 (Lucía 350, uniform order 1). Teresa (tutor@) → Diego and Lucía.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
let admin: string;
let secretaria: string;
let tutor: string;
before(async () => {
  t = await openTestDb('ef_hu4');
  [admin, secretaria, tutor] = await Promise.all(
    ['admin', 'secretaria', 'tutor'].map((u) => t.login(`${u}@example.com`)),
  );
});
after(() => t?.close());

const cents = async (sql: string, params: unknown[] = []) =>
  Math.round(Number((await t.db.query(sql, params))[0].v) * 100);

test('HU-043: concepts — name, suggested amount, recurring, status; used ones not deleted; price change keeps history', async () => {
  const c = await t.ok<{ id: number }>(
    t.call(secretaria, 'BillingService', 'saveConcept', {
      name: 'Torneo',
      suggestedAmountCents: 25_000,
      recurring: false,
    }),
  );
  const [row] = await t.db.query(
    'SELECT importe_sugerido, recurrente, activo FROM conceptos_cobro WHERE id = ?',
    [c.id],
  );
  assert.deepEqual({ ...row }, { importe_sugerido: '250.00', recurrente: 0, activo: 1 });
  const before = await cents('SELECT SUM(monto_original) AS v FROM cargos WHERE concepto_id = 1');
  await t.ok(
    t.call(secretaria, 'BillingService', 'saveConcept', {
      id: 1,
      name: 'Mensualidad',
      suggestedAmountCents: 65_000,
      recurring: true,
    }),
  );
  assert.equal(
    await cents('SELECT SUM(monto_original) AS v FROM cargos WHERE concepto_id = 1'),
    before,
    '4) charges keep their amount',
  );
  await t.ok(t.call(secretaria, 'BillingService', 'setConceptActive', 1, false));
  assert.equal(
    await t.count('SELECT COUNT(*) AS n FROM conceptos_cobro WHERE id = 1'),
    1,
    '3) used concept kept',
  );
  await t.ok(t.call(secretaria, 'BillingService', 'setConceptActive', 1, true));
  await t.refused(
    () =>
      t.call(secretaria, 'BillingService', 'saveConcept', {
        name: 'Torneo',
        suggestedAmountCents: 1,
        recurring: false,
      }),
    400,
    /^Ya existe un concepto con ese nombre\.$/,
  );
});

test('HU-044: monthly fees — one per player/concept/period, amount and due date, authorized exclusions, statuses', async () => {
  const res = await t.ok<{ created: number; skipped: number }>(
    t.call(secretaria, 'BillingService', 'generateMonthlyFees', {
      conceptId: 1,
      period: '2026-11',
      dueDate: '2026-11-10',
      excludedPlayerIds: [5],
      exclusionReason: 'Beca completa',
    }),
  );
  const rows = await t.db.query(
    "SELECT jugador_id, monto_original, fecha_vencimiento, estado FROM cargos WHERE periodo = '2026-11' ORDER BY jugador_id",
  );
  assert.deepEqual(
    rows.map((r: { jugador_id: number }) => r.jugador_id),
    [1, 2, 3, 6],
    'active players minus the excluded one; BAJA left out',
  );
  assert.equal(res.created, 4);
  assert.ok(
    rows.every(
      (r: { monto_original: string; fecha_vencimiento: string; estado: string }) =>
        r.monto_original === '650.00' &&
        r.fecha_vencimiento === '2026-11-10' &&
        r.estado === 'PENDIENTE',
    ),
  );
  const again = await t.ok<{ created: number }>(
    t.call(secretaria, 'BillingService', 'generateMonthlyFees', {
      conceptId: 1,
      period: '2026-11',
      dueDate: '2026-11-10',
      excludedPlayerIds: [],
      exclusionReason: null,
    }),
  );
  assert.equal(
    again.created,
    1,
    '1) only the one not generated yet (Emiliano) — never a duplicate',
  );
  assert.equal(
    await t.count("SELECT COUNT(*) AS n FROM cargos WHERE periodo = '2026-11' AND jugador_id = 1"),
    1,
  );
  await t.refused(
    () =>
      t.call(secretaria, 'BillingService', 'generateMonthlyFees', {
        conceptId: 1,
        period: '2026-12',
        dueDate: '2026-12-10',
        excludedPlayerIds: [1],
        exclusionReason: '',
      }),
    400,
    /^Indica la regla autorizada para excluir jugadores\.$/,
  );
  const [overdue] = await t.db.query('SELECT estado FROM cargos WHERE id = 2');
  assert.equal(overdue.estado, 'VENCIDO', '3) overdue status');
});

test('HU-045: payment — payer, concept, date, amount, method; partial; balance recomputed; folio', async () => {
  const p = await t.ok<{ id: number; folio: string }>(
    t.call(secretaria, 'BillingService', 'registerPayment', {
      playerId: 2,
      tutorId: 1,
      amountCents: 25_000,
      method: 'TRANSFERENCIA',
      reference: 'SPEI-HU045',
      chargeIds: [5],
      paidAt: '2026-10-12T18:30:00',
    }),
  );
  assert.match(p.folio, /^R-\d{4}$/, '4) folio');
  const [row] = await t.db.query(
    'SELECT tutor_id, fecha_pago, importe, forma_pago, estado FROM pagos WHERE id = ?',
    [p.id],
  );
  assert.deepEqual(
    { ...row },
    {
      tutor_id: 1,
      fecha_pago: '2026-10-12 18:30:00',
      importe: '250.00',
      forma_pago: 'TRANSFERENCIA',
      estado: 'APLICADO',
    },
  );
  assert.equal(
    (await t.db.query('SELECT estado FROM cargos WHERE id = 5'))[0].estado,
    'PARCIAL',
    '2/3) partial payment, status derived',
  );
  const st = await t.ok<{ totals: { balanceCents: number } }>(
    t.call(secretaria, 'BillingService', 'statement', 2),
  );
  assert.equal(st.totals.balanceCents, 60_000 - 25_000 + 35_000 + 65_000);
  await t.refused(
    () =>
      t.call(secretaria, 'BillingService', 'registerPayment', {
        playerId: 2,
        tutorId: 1,
        amountCents: 25_000,
        method: 'EFECTIVO',
        paidAt: '2099-01-01T00:00:00',
      }),
    400,
    /^La fecha de pago no puede ser futura\.$/,
  );
});

test('HU-046/047: statement — charges and payments, balance, overdue, filters; the tutor sees only own children', async () => {
  const st = await t.ok<{
    charges: { conceptId: number; status: string }[];
    payments: unknown[];
    totals: { balanceCents: number; overdueCents: number };
  }>(t.call(secretaria, 'BillingService', 'statement', 3));
  assert.ok(st.charges.length >= 1 && st.payments.length >= 1, '1) charges and payments');
  assert.ok(st.totals.overdueCents > 0, '3) overdue told apart');
  const filtered = await t.ok<{ charges: { conceptId: number }[] }>(
    t.call(secretaria, 'BillingService', 'statement', 3, { conceptId: 2 }),
  );
  assert.ok(filtered.charges.length > 0, '4) the concept filter keeps that concept'); // else .every() is vacuous
  assert.ok(
    filtered.charges.every((c) => c.conceptId === 2),
    '4) filter by concept',
  );
  const child = await t.ok<{ statement: { totals: { balanceCents: number } } }>(
    t.call(tutor, 'PortalService', 'child', 2),
  );
  assert.ok(child.statement.totals.balanceCents > 0, 'HU-047.2');
  await t.refused(
    () => t.call(tutor, 'BillingService', 'statement', 3),
    403,
    /^No tienes acceso a la información de este jugador\.$/,
  );
  await t.refused(
    () =>
      t.call(tutor, 'BillingService', 'registerPayment', {
        playerId: 1,
        tutorId: 1,
        amountCents: 1,
        method: 'EFECTIVO',
      }),
    403,
    /^No tienes permiso para realizar esta acción\.$/,
  );
});

test('HU-048: receipt — folio, date, player, concept, amount, method; by folio; read-only; cancelled flag', async () => {
  const r = await t.ok<{
    payment: { folio: string; status: string };
    playerName: string;
    lines: { label: string }[];
  }>(t.call(secretaria, 'BillingService', 'receipt', 1));
  assert.equal(r.payment.folio, 'R-0001');
  assert.ok(r.playerName && r.lines.length >= 1);
  const list = await t.ok<{ items: { payment: { folio: string } }[] }>(
    t.call(secretaria, 'BillingService', 'receipts', { query: 'R-0002' }),
  );
  assert.deepEqual(
    list.items.map((i) => i.payment.folio),
    ['R-0002'],
    '2) by folio',
  );
});

test('HU-049: cancel a payment — admin only, reason, reverts balance, kept as CANCELADO with audit', async () => {
  const before = (await t.db.query('SELECT estado FROM cargos WHERE id = 3'))[0].estado;
  await t.refused(
    () => t.call(secretaria, 'BillingService', 'cancelPayment', 2, 'x'),
    403,
    /^No tienes permiso para realizar esta acción\.$/,
  );
  await t.refused(
    () => t.call(admin, 'BillingService', 'cancelPayment', 2, ''),
    400,
    /^Falta el motivo de cancelación\. Es un dato obligatorio\.$/,
  );
  await t.ok(t.call(admin, 'BillingService', 'cancelPayment', 2, 'Cheque devuelto'));
  const [p] = await t.db.query('SELECT estado, motivo_cancelacion FROM pagos WHERE id = 2');
  assert.deepEqual({ ...p }, { estado: 'CANCELADO', motivo_cancelacion: 'Cheque devuelto' });
  assert.equal(
    await cents(
      'SELECT COALESCE(SUM(importe_aplicado), 0) AS v FROM pago_aplicacion WHERE pago_id = 2',
    ),
    50_000,
    'applications kept for traceability',
  );
  const st = await t.ok<{ totals: { paidCents: number } }>(
    t.call(admin, 'BillingService', 'statement', 3),
  );
  assert.equal(st.totals.paidCents, 0, '3) balance reverted');
  assert.equal(before, 'VENCIDO');
  assert.equal(
    await t.count(
      "SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'pagos' AND entidad_id = 2 AND accion = 'CANCELAR'",
    ),
    1,
  );
  const r = await t.ok<{ payment: { status: string } }>(
    t.call(admin, 'BillingService', 'receipt', 2),
  );
  assert.equal(r.payment.status, 'CANCELADO', 'HU-048.4');
});

test('HU-050: debts — period/category filters, primary tutor and contact, overdue balance, cancelled excluded', async () => {
  const debts = await t.ok<
    {
      playerId: number;
      tutorName: string | null;
      tutorContact: string | null;
      overdueCents: number;
    }[]
  >(t.call(secretaria, 'BillingService', 'debts', {}));
  const mateo = debts.find((d) => d.playerId === 3)!;
  assert.ok(mateo.tutorName && mateo.overdueCents > 0, '2/3) tutor and overdue balance');
  const sub12 = await t.ok<{ playerId: number }[]>(
    t.call(secretaria, 'BillingService', 'debts', { categoryId: 2 }),
  );
  assert.ok(
    sub12.every((d) => [2, 6].includes(d.playerId)),
    '1) by category',
  );
  const balanceOf5 = async () =>
    (
      await t.ok<{ playerId: number; balanceCents: number }[]>(
        t.call(secretaria, 'BillingService', 'debts', {}),
      )
    ).find((d) => d.playerId === 5)?.balanceCents ?? 0;
  const before = await balanceOf5();
  const c = await t.ok<{ id: number }>(
    t.call(secretaria, 'BillingService', 'createCharge', {
      playerId: 5,
      conceptId: 2,
      amountCents: 1000,
      dueDate: '2026-10-01',
      reference: null,
    }),
  );
  assert.equal(await balanceOf5(), before + 1000);
  await t.ok(t.call(secretaria, 'BillingService', 'cancelCharge', c.id, 'Error de captura'));
  assert.equal(await balanceOf5(), before, '4) cancelled charges excluded');
});

test('HU-051: discounts — type and reason, original and final kept, authorized users only', async () => {
  await t.refused(
    () =>
      t.call(secretaria, 'BillingService', 'addDiscount', {
        chargeId: 2,
        type: 'DESCUENTO',
        reason: 'x',
        adjustmentCents: 100,
      }),
    403,
    /^No tienes permiso para realizar esta acción\.$/,
  );
  await t.ok(
    t.call(admin, 'BillingService', 'addDiscount', {
      chargeId: 2,
      type: 'DESCUENTO',
      reason: 'Hermanos',
      adjustmentCents: 10_000,
    }),
  );
  const [d] = await t.db.query(
    'SELECT tipo, motivo, monto_original, monto_ajuste, monto_final, autorizado_por FROM descuentos WHERE cargo_id = 2',
  );
  assert.deepEqual(
    { ...d, autorizado_por: d.autorizado_por !== null },
    {
      tipo: 'DESCUENTO',
      motivo: 'Hermanos',
      monto_original: '600.00',
      monto_ajuste: '100.00',
      monto_final: '500.00',
      autorizado_por: true,
    },
  );
  assert.equal(
    (await t.db.query('SELECT monto_original FROM cargos WHERE id = 2'))[0].monto_original,
    '600.00',
    '2) original kept',
  );
  await t.refused(
    () =>
      t.call(admin, 'BillingService', 'addDiscount', {
        chargeId: 2,
        type: 'BECA',
        reason: 'Demasiado',
        adjustmentCents: 10_000_000,
      }),
    400,
    /^El descuento no puede ser mayor al saldo pendiente\.$/,
  );
  await t.ok(t.call(secretaria, 'BillingService', 'discounts'));
});

test('HU-052: uniform catalog — product with sizes and price, status, used products kept', async () => {
  const p = await t.ok<{ id: number }>(
    t.call(secretaria, 'UniformService', 'saveProduct', {
      name: 'Sudadera',
      description: 'Invierno',
    }),
  );
  await t.ok(
    t.call(secretaria, 'UniformService', 'saveVariant', {
      productId: p.id,
      size: 'CH',
      priceCents: 40_000,
    }),
  );
  await t.ok(
    t.call(secretaria, 'UniformService', 'saveVariant', {
      productId: p.id,
      size: 'M',
      priceCents: 42_000,
    }),
  );
  await t.refused(
    () =>
      t.call(secretaria, 'UniformService', 'saveVariant', {
        productId: p.id,
        size: 'CH',
        priceCents: 1,
      }),
    400,
    /^Esa talla ya existe para el producto\.$/,
  );
  assert.equal(
    await t.count('SELECT COUNT(*) AS n FROM variantes_uniforme WHERE producto_id = ?', [p.id]),
    2,
    '2) several sizes',
  );
  await t.ok(t.call(secretaria, 'UniformService', 'setProductActive', 1, false));
  assert.equal(
    await t.count('SELECT COUNT(*) AS n FROM productos_uniforme WHERE id = 1'),
    1,
    '3) never deleted',
  );
  await t.ok(t.call(secretaria, 'UniformService', 'setProductActive', 1, true));
});

test('HU-053/054/055: orders — price snapshot, charge = total, paid from the balance, delivery, cancellation', async () => {
  const order = await t.ok<{ id: number; chargeId: number; status: string }>(
    t.call(
      secretaria,
      'UniformService',
      'createOrder',
      1,
      [
        { variantId: 1, quantity: 2 },
        { variantId: 3, quantity: 1 },
      ],
      3,
    ),
  );
  assert.equal(order.status, 'SOLICITADO');
  const [line] = await t.db.query(
    'SELECT precio_unitario FROM detalle_uniforme WHERE pedido_id = ? AND variante_id = 1',
    [order.id],
  );
  assert.equal(line.precio_unitario, '350.00', 'HU-053.3 price at the moment');
  await t.ok(
    t.call(secretaria, 'UniformService', 'saveVariant', {
      id: 1,
      productId: 1,
      size: 'CH',
      priceCents: 99_900,
    }),
  );
  assert.equal(
    (
      await t.db.query(
        'SELECT precio_unitario FROM detalle_uniforme WHERE pedido_id = ? AND variante_id = 1',
        [order.id],
      )
    )[0].precio_unitario,
    '350.00',
    'HU-052.4 history kept',
  );
  assert.equal(
    await cents('SELECT monto_original AS v FROM cargos WHERE id = ?', [order.chargeId]),
    2 * 35_000 + 15_000,
    'HU-054.1/4 charge = total',
  );
  await t.refused(
    () => t.call(secretaria, 'UniformService', 'deliver', 9999, 'x'),
    400,
    /^Pedido inexistente: actualiza la página e inténtalo de nuevo\.$/,
  );
  await t.ok(
    t.call(secretaria, 'BillingService', 'registerPayment', {
      playerId: 1,
      tutorId: 1,
      amountCents: 85_000,
      method: 'EFECTIVO',
      chargeIds: [order.chargeId],
    }),
  );
  assert.equal(
    (await t.db.query('SELECT estado FROM pedidos_uniforme WHERE id = ?', [order.id]))[0].estado,
    'PAGADO',
    'HU-054.2 paid from the balance',
  );
  await t.ok(
    t.call(secretaria, 'UniformService', 'deliver', order.id, 'Teresa López', '2026-10-13'),
  );
  const [o] = await t.db.query(
    'SELECT estado, fecha_entrega, recibido_por FROM pedidos_uniforme WHERE id = ?',
    [order.id],
  );
  assert.deepEqual(
    { ...o },
    { estado: 'ENTREGADO', fecha_entrega: '2026-10-13', recibido_por: 'Teresa López' },
    'HU-055',
  );
  // HU-054.3: an unpaid order cancels with its charge; a cancelled order can't be delivered.
  const other = await t.ok<{ id: number; chargeId: number }>(
    t.call(secretaria, 'UniformService', 'createOrder', 3, [{ variantId: 2, quantity: 1 }], 3),
  );
  await t.ok(t.call(secretaria, 'UniformService', 'cancelOrder', other.id, 'Ya no lo necesita'));
  assert.equal(
    (await t.db.query('SELECT estado FROM cargos WHERE id = ?', [other.chargeId]))[0].estado,
    'CANCELADO',
  );
  await t.refused(
    () => t.call(secretaria, 'UniformService', 'deliver', other.id, 'x'),
    400,
    /^El pedido está cancelado\.$/,
  );
});

test('HU-056: family uniforms — own children only, product/size/quantity, status, read-only', async () => {
  const child = await t.ok<{
    uniforms: { status: string; lines: { product: string; size: string; quantity: number }[] }[];
  }>(t.call(tutor, 'PortalService', 'child', 2));
  assert.ok(
    child.uniforms.length >= 1 &&
      child.uniforms[0]!.lines.every((l) => l.product && l.size && l.quantity > 0),
  );
  await t.refused(
    () => t.call(tutor, 'UniformService', 'orders', {}),
    403,
    /^No tienes permiso para realizar esta acción\.$/,
  );
  await t.refused(
    () => t.call(tutor, 'UniformService', 'createOrder', 1, [{ variantId: 1, quantity: 1 }], 3),
    403,
    /^No tienes permiso para realizar esta acción\.$/,
  );
});

test('D5 / HU-044.3: the daily job marks unpaid charges past their due date VENCIDO (migration 002)', async () => {
  const [{ insertId }] = [
    await t.db.query(
      `INSERT INTO cargos (jugador_id, concepto_id, temporada_id, periodo, fecha_cargo, fecha_vencimiento, monto_original, estado)
       VALUES (5, 1, 2, '2026-01', '2026-01-01', '2026-01-10', 650.00, 'PENDIENTE')`,
    ),
  ];
  const untouched = await t.db.query(
    "SELECT id, estado FROM cargos WHERE estado IN ('PAGADO', 'CANCELADO') ORDER BY id",
  );
  await t.db.query('CALL marcar_cargos_vencidos()');
  assert.equal(
    (await t.db.query('SELECT estado FROM cargos WHERE id = ?', [insertId]))[0].estado,
    'VENCIDO',
  );
  assert.deepEqual(
    await t.db.query(
      "SELECT id, estado FROM cargos WHERE estado IN ('PAGADO', 'CANCELADO') ORDER BY id",
    ),
    untouched,
  );
  const [event] = await t.db.query(
    'SELECT EVENT_NAME, INTERVAL_VALUE, INTERVAL_FIELD FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE()',
  );
  assert.deepEqual(
    { ...event },
    { EVENT_NAME: 'ev_cargos_vencidos', INTERVAL_VALUE: '1', INTERVAL_FIELD: 'DAY' },
  );
});

test('HU-046.1/4: statement date filter — inclusive from/to on the charge date and the local payment date', async () => {
  // Own player and rows, so the expected sets are exact. Charges dated on both sides of September 2026 (charge date =
  // cargos.fecha_cargo, set with SQL: the API dates new charges today). Payments through the API at the edges of the
  // school's local day (pagos.fecha_pago is a local DATETIME: a UTC shift would move them across the boundary).
  const player = await t.ok<{ id: number }>(
    t.call(secretaria, 'PlayerService', 'create', {
      firstName: 'Periodo',
      lastName1: 'Filtro',
      lastName2: null,
      birthDate: '2016-04-04',
      sex: 'M',
      phone: null,
      email: null,
      address: null,
    }),
  );
  const [a, b] = (await t.db.query(
    'SELECT id FROM conceptos_cobro WHERE activo = 1 ORDER BY id LIMIT 2',
  )) as { id: number }[];
  assert.ok(a && b, 'fixture: two active concepts');
  const charge: Record<string, number> = {};
  for (const [day, concept] of [
    ['2026-08-31', a.id],
    ['2026-09-01', a.id],
    ['2026-09-15', b.id],
    ['2026-09-30', a.id],
    ['2026-10-01', a.id],
  ] as const) {
    const r = await t.db.query(
      `INSERT INTO cargos (jugador_id, concepto_id, fecha_cargo, monto_original, estado)
       VALUES (?, ?, ?, 100.00, 'PENDIENTE')`,
      [player.id, concept, day],
    );
    charge[day] = Number(r.insertId);
  }
  // A write outside the API must bump the data version, or the bridge keeps its cached tables (docs/API.md).
  await t.db.query('UPDATE version_datos SET version = version + 1 WHERE id = 1');
  const payment: Record<string, number> = {};
  for (const [paidAt, day] of [
    ['2026-08-31T23:59:59', '2026-08-31'],
    ['2026-09-01T00:00:00', '2026-09-01'],
    ['2026-09-30T23:59:59', '2026-09-30'],
    ['2026-10-01T00:00:00', '2026-10-01'],
  ] as const) {
    const p = await t.ok<{ id: number }>(
      t.call(secretaria, 'BillingService', 'registerPayment', {
        playerId: player.id,
        tutorId: null,
        amountCents: 1_000,
        method: 'EFECTIVO',
        chargeIds: [charge[day]],
        paidAt,
      }),
    );
    payment[paidAt] = p.id;
  }

  type Statement = {
    charges: { id: number; balanceCents: number }[];
    payments: { id: number }[];
    totals: { chargedCents: number; paidCents: number; balanceCents: number };
  };
  const statement = (filter: object) =>
    t.ok<Statement>(t.call(secretaria, 'BillingService', 'statement', player.id, filter));
  const ids = (s: Statement) => ({
    charges: s.charges.map((c) => c.id).sort((x, y) => x - y),
    payments: s.payments.map((p) => p.id).sort((x, y) => x - y),
  });
  const expect = (days: string[], paidAts: string[]) => ({
    charges: days.map((d) => charge[d]!).sort((x, y) => x - y),
    payments: paidAts.map((p) => payment[p]!).sort((x, y) => x - y),
  });

  // No dates: everything of the player (the behaviour without filters is unchanged).
  assert.deepEqual(
    ids(await statement({})),
    expect(Object.keys(charge), Object.keys(payment)),
    'no filter',
  );
  // September: both edges included, 08-31 (even at 23:59:59) and 10-01 (even at 00:00:00) excluded.
  const september = await statement({ from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(
    ids(september),
    expect(
      ['2026-09-01', '2026-09-15', '2026-09-30'],
      ['2026-09-01T00:00:00', '2026-09-30T23:59:59'],
    ),
    'from and to, inclusive',
  );
  // 2) the balance is the one of the listed charges: 3 × 100.00 charged, 2 × 10.00 paid.
  assert.deepEqual(
    {
      charged: september.totals.chargedCents,
      paid: september.totals.paidCents,
      balance: september.totals.balanceCents,
    },
    { charged: 30_000, paid: 2_000, balance: 28_000 },
  );
  assert.equal(
    september.totals.balanceCents,
    september.charges.reduce((s, c) => s + c.balanceCents, 0),
  );
  // Only `from`, only `to`, and a single day (from = to).
  assert.deepEqual(
    ids(await statement({ from: '2026-09-30' })),
    expect(['2026-09-30', '2026-10-01'], ['2026-09-30T23:59:59', '2026-10-01T00:00:00']),
    'only from',
  );
  assert.deepEqual(
    ids(await statement({ to: '2026-09-01' })),
    expect(['2026-08-31', '2026-09-01'], ['2026-08-31T23:59:59', '2026-09-01T00:00:00']),
    'only to',
  );
  assert.deepEqual(
    ids(await statement({ from: '2026-09-30', to: '2026-09-30' })),
    expect(['2026-09-30'], ['2026-09-30T23:59:59']),
    'a single day',
  );
  // 4) date and concept together: only the September charge of concept b.
  assert.deepEqual(
    ids(await statement({ from: '2026-09-01', to: '2026-09-30', conceptId: b.id })).charges,
    [charge['2026-09-15']],
    'date + concept',
  );
});

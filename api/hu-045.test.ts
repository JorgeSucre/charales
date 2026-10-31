/**
 * HU-045 · reference of a transfer or card payment (rule added 2026-10-29, pending ratification): required for
 * TRANSFERENCIA and TARJETA, optional otherwise; trimmed; stored in pagos.referencia (migration 004) and returned with
 * the payment. Checked on the API, so skipping Angular does not skip it; a refusal writes nothing.
 * Seed (api/demo.ts): charge 3 is Mateo's (player 3) $1,200 monthly fee, overdue.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
let secretaria: string;
before(async () => {
  t = await openTestDb('ef_hu045');
  secretaria = await t.login('secretaria@example.com');
});
after(() => t?.close());

const MISSING =
  /^Falta la referencia del comprobante\. Es un dato obligatorio para transferencia o tarjeta\.$/;
const pay = (method: string, reference?: unknown) =>
  t.call(secretaria, 'BillingService', 'registerPayment', {
    playerId: 3,
    tutorId: null,
    amountCents: 1000,
    method,
    ...(reference === undefined ? {} : { reference }),
    chargeIds: [3],
  });
const stored = async (id: number) => ({
  ...(await t.db.query('SELECT forma_pago, referencia FROM pagos WHERE id = ?', [id]))[0],
});

test('HU-045: cash needs no reference (stored as NULL)', async () => {
  const p = await t.ok<{ id: number; reference: string | null }>(pay('EFECTIVO'));
  assert.equal(p.reference, null);
  assert.deepEqual(await stored(p.id), { forma_pago: 'EFECTIVO', referencia: null });
});

test('HU-045: transfer and card without a reference, or with spaces only, are refused and write nothing', async () => {
  for (const method of ['TRANSFERENCIA', 'TARJETA'])
    for (const reference of [undefined, null, '', '   '])
      await t.refused(() => pay(method, reference), 400, MISSING);
});

test('HU-045: a reference over 100 characters is refused for any method; exactly 100 is kept', async () => {
  for (const method of ['TRANSFERENCIA', 'EFECTIVO'])
    await t.refused(
      () => pay(method, 'R'.repeat(101)),
      400,
      /^La referencia del comprobante admite como máximo 100 caracteres\.$/,
    );
  const p = await t.ok<{ id: number }>(pay('TARJETA', 'R'.repeat(100)));
  assert.equal((await stored(p.id)).referencia, 'R'.repeat(100));
});

test('HU-045: transfer and card with a reference — trimmed, stored in MariaDB and recoverable with the receipt', async () => {
  for (const [method, sent, kept] of [
    ['TRANSFERENCIA', '  SPEI-2026-001  ', 'SPEI-2026-001'],
    ['TARJETA', 'VISA ****4242 aut. 0042', 'VISA ****4242 aut. 0042'],
  ]) {
    const p = await t.ok<{ id: number; folio: string; reference: string }>(pay(method!, sent));
    assert.equal(p.reference, kept);
    assert.deepEqual(await stored(p.id), { forma_pago: method, referencia: kept });
    const r = await t.ok<{ payment: { folio: string; reference: string; method: string } }>(
      t.call(secretaria, 'BillingService', 'receipt', p.id),
    );
    assert.deepEqual(
      { folio: r.payment.folio, reference: r.payment.reference, method: r.payment.method },
      { folio: p.folio, reference: kept, method },
    );
  }
});

test('HU-045: a valid transfer keeps amount, method, applications, folio and audit; the balance is recomputed', async () => {
  const balance = async () =>
    Math.round(
      Number(
        (
          await t.db.query(
            `SELECT c.monto_original - COALESCE((SELECT SUM(pa.importe_aplicado) FROM pago_aplicacion pa
               JOIN pagos p ON p.id = pa.pago_id WHERE pa.cargo_id = c.id AND p.estado = 'APLICADO'), 0) AS v
               FROM cargos c WHERE c.id = 3`,
          )
        )[0].v,
      ) * 100,
    );
  const before = await balance();
  const p = await t.ok<{ id: number; folio: string }>(pay('TRANSFERENCIA', 'REF-77'));
  assert.match(p.folio, /^R-\d{4}$/);
  const [row] = await t.db.query(
    'SELECT importe, forma_pago, referencia, estado FROM pagos WHERE id = ?',
    [p.id],
  );
  assert.deepEqual(
    { ...row },
    { importe: '10.00', forma_pago: 'TRANSFERENCIA', referencia: 'REF-77', estado: 'APLICADO' },
  );
  const [app] = await t.db.query(
    'SELECT cargo_id, importe_aplicado FROM pago_aplicacion WHERE pago_id = ?',
    [p.id],
  );
  assert.deepEqual({ ...app }, { cargo_id: 3, importe_aplicado: '10.00' });
  assert.equal(await balance(), before - 1000);
  assert.equal(
    await t.count(
      "SELECT COUNT(*) AS n FROM auditoria WHERE entidad = 'pagos' AND entidad_id = ? AND accion = 'CREAR'",
      [p.id],
    ),
    1,
  );
  // an invalid method is still refused first, as before
  await t.refused(() => pay('CHEQUE', 'X'), 400, /^Selecciona una forma de pago válida\.$/);
});

// Last: it rebuilds the column on this temporary database.
test('migration 004 on a database that already has payments: every row kept, NULL reference, idempotent', async () => {
  const snapshot = () =>
    t.db.query(
      'SELECT id, folio, jugador_id, tutor_id, fecha_pago, importe, forma_pago, estado FROM pagos ORDER BY id',
    );
  const sql = readFileSync(
    new URL('../db/mariadb/migrations/004_pago_referencia.sql', import.meta.url),
    'utf8',
  )
    .split('\n')
    .filter((l) => !l.startsWith('--'))
    .join('\n');
  await t.db.query('ALTER TABLE pagos DROP COLUMN referencia'); // as a database before 004
  const before = await snapshot();
  assert.ok(before.length >= 3, 'fixture: existing payments, transfers and cards among them');
  await t.db.query(sql);
  await t.db.query(sql); // idempotent
  assert.deepEqual(await snapshot(), before);
  assert.equal(await t.count('SELECT COUNT(*) AS n FROM pagos WHERE referencia IS NOT NULL'), 0);
  const [col] = await t.db.query(
    "SELECT IS_NULLABLE AS nullable, CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pagos' AND COLUMN_NAME = 'referencia'",
  );
  assert.deepEqual({ nullable: col.nullable, len: Number(col.len) }, { nullable: 'YES', len: 100 });
});

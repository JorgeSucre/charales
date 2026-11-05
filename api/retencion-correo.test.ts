/** N-06: the retention of `correo_saliente`. What may still be sent is never touched; addresses don't pile up. */
import { after, before, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'mariadb';
import { localDateTime } from './auth.ts';
import { checkEnvironment } from './config.ts';
import {
  MAIL_RETENTION_DAYS,
  MailError,
  deliverMail,
  mailRetentionFrom,
  processMailQueue,
  purgeMailOutbox,
} from './mail.ts';
import { openTestDb, type TestDb } from './test-db.ts';

let t: TestDb;
let userId: number;
const DAY = 86_400_000;
const days = (n: number) => localDateTime(Date.now() + n * DAY);

before(async () => {
  t = await openTestDb('ef_reten');
  [{ id: userId }] = await t.db.query("SELECT id FROM usuarios WHERE email = 'marta@example.com'");
});
after(async () => {
  await t?.close();
});
beforeEach(async () => {
  await t.db.query('DELETE FROM correo_saliente');
});

interface Row {
  estado?: string;
  intentos?: number;
  cerrado?: number | null;
  vence?: number;
  lease?: number | null;
  proximo?: number;
  proveedor?: string | null;
}
async function insert(row: Row = {}): Promise<number> {
  const { insertId } = await t.db.query(
    `INSERT INTO correo_saliente (usuario_id, finalidad, destinatario, asunto, estado, intentos, proximo_intento,
       bloqueado_hasta, vence_en, proveedor_id, creado_en, cerrado_en, enviado_en)
     VALUES (?, 'RECUPERACION', 'persona@example.com', 'Asunto', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      row.estado ?? 'PENDIENTE',
      row.intentos ?? 0,
      days(row.proximo ?? -1),
      row.lease == null ? null : days(row.lease),
      days(row.vence ?? 1),
      row.proveedor ?? null,
      days(-400),
      row.cerrado == null ? null : days(row.cerrado),
      row.estado === 'ENVIADO' && row.cerrado != null ? days(row.cerrado) : null,
    ],
  );
  return Number(insertId);
}
const get = async (id: number) =>
  (await t.db.query('SELECT * FROM correo_saliente WHERE id = ?', [id]))[0] as
    Record<string, unknown> | undefined;
const purge = (options = {}) => purgeMailOutbox(t.db, options);

test('1) pending: kept, with its address, however old the row is', async () => {
  const id = await insert({ estado: 'PENDIENTE', vence: 1 });
  assert.equal((await purge()).anonymized, 0);
  assert.equal((await get(id))!['destinatario'], 'persona@example.com');
  assert.equal((await get(id))!['estado'], 'PENDIENTE');
});

test('2) being processed (live lease): kept, even past its validity', async () => {
  const id = await insert({ estado: 'ENVIANDO', lease: 1, vence: -30 });
  const r = await purge();
  assert.deepEqual([r.abandoned, r.anonymized, r.deleted], [0, 0, 0]);
  assert.equal((await get(id))!['estado'], 'ENVIANDO');
  assert.equal((await get(id))!['destinatario'], 'persona@example.com');
});

test('3) sent, past the retention: anonymized; only metadata stays. Not yet past it: untouched', async () => {
  const old = await insert({ estado: 'ENVIADO', cerrado: -31, proveedor: 'ref-1' });
  const recent = await insert({ estado: 'ENVIADO', cerrado: -29, proveedor: 'ref-2' });
  const r = await purge();
  assert.equal(r.anonymized, 1);
  const row = (await get(old))!;
  for (const field of ['destinatario', 'usuario_id', 'token_id', 'proveedor_id'])
    assert.equal(row[field], null, field);
  assert.ok(row['anonimizado_en']);
  assert.equal(row['estado'], 'ENVIADO');
  assert.equal(row['finalidad'], 'RECUPERACION');
  assert.equal((await get(recent))!['destinatario'], 'persona@example.com');
  assert.equal((await get(recent))!['proveedor_id'], 'ref-2');
});

test('4) failed, still to be retried: kept, and it is sent', async () => {
  const id = await insert({ estado: 'PENDIENTE', intentos: 3, vence: 1, proximo: -1 });
  await t.db.query(
    `INSERT INTO tokens_recuperacion (usuario_id, finalidad, token_hash, creado_en, expira_en)
     VALUES (?, 'RECUPERACION', ?, ?, ?)`,
    [userId, 'f'.repeat(64), days(0), days(1)],
  );
  const [{ id: token }] = await t.db.query(
    'SELECT id FROM tokens_recuperacion WHERE token_hash = ?',
    ['f'.repeat(64)],
  );
  await t.db.query('UPDATE correo_saliente SET token_id = ? WHERE id = ?', [token, id]);
  await purge();
  const sent: string[] = [];
  assert.equal(await processMailQueue(t.db, (to) => void sent.push(to)), 1);
  assert.deepEqual(sent, ['persona@example.com']);
  const row = (await get(id))!;
  assert.equal(row['estado'], 'ENVIADO');
  assert.ok(row['cerrado_en'], 'now it has a closing date for the retention');
});

test('5) failed for good: anonymized past the retention, gone after a year', async () => {
  const id = await insert({ estado: 'FALLIDO', intentos: 8, cerrado: -31 });
  assert.equal((await purge()).anonymized, 1);
  assert.equal((await get(id))!['intentos'], 8, 'metadata stays');
  await t.db.query('UPDATE correo_saliente SET cerrado_en = ? WHERE id = ?', [days(-366), id]);
  assert.equal((await purge()).deleted, 1);
  assert.equal(await get(id), undefined);
});

test('5b) abandoned: expired and nobody processed it → closed, and it then follows the retention', async () => {
  const pending = await insert({ estado: 'PENDIENTE', vence: -8 });
  const stale = await insert({ estado: 'ENVIANDO', lease: -1, vence: -8 });
  const notYet = await insert({ estado: 'PENDIENTE', vence: -6 });
  assert.equal((await purge()).abandoned, 2);
  for (const id of [pending, stale]) {
    const row = (await get(id))!;
    assert.equal(row['estado'], 'FALLIDO');
    assert.equal(row['ultimo_error'], 'ABANDONADO');
    assert.equal(row['destinatario'], 'persona@example.com', 'the retention starts now');
    assert.ok(row['cerrado_en']);
  }
  assert.equal((await get(notYet))!['estado'], 'PENDIENTE');
  await t.advance(31 * DAY);
  assert.equal((await purge()).anonymized, 2);
});

test('6) repeating it changes nothing', async () => {
  await insert({ estado: 'ENVIADO', cerrado: -31 });
  await insert({ estado: 'PENDIENTE' });
  await purge();
  const before = await t.db.query('SELECT * FROM correo_saliente ORDER BY id');
  assert.deepEqual(await purge(), { abandoned: 0, anonymized: 0, deleted: 0, more: false });
  assert.deepEqual(await t.db.query('SELECT * FROM correo_saliente ORDER BY id'), before);
});

async function bulk(n: number, closedDaysAgo: number) {
  const closed = days(-closedDaysAgo);
  const values = Array.from(
    { length: n },
    () =>
      `(${userId}, 'RECUPERACION', 'persona@example.com', 'A', 'ENVIADO', 1, '${closed}', '${closed}', '${closed}', '${closed}')`,
  ).join(',');
  await t.db.query(
    `INSERT INTO correo_saliente (usuario_id, finalidad, destinatario, asunto, estado, intentos, proximo_intento, vence_en, creado_en, cerrado_en)
     VALUES ${values}`,
  );
}
const remaining = () =>
  t.count('SELECT COUNT(*) AS n FROM correo_saliente WHERE destinatario IS NOT NULL');

test('7) many rows: each run is bounded and says there is more; repeated, it ends', async () => {
  await bulk(5000, 40);
  const started = performance.now();
  const first = await purge({ batch: 500, maxBatches: 3 });
  assert.deepEqual([first.anonymized, first.more], [1500, true]);
  assert.equal(await remaining(), 3500);
  const second = await purge();
  assert.deepEqual([second.anonymized, second.more], [3500, false]);
  assert.equal(await remaining(), 0);
  const ms = performance.now() - started;
  assert.ok(ms < 20_000, `${Math.round(ms)} ms for 5000 rows`);
});

test('8) interrupted: finished batches stay done, the rest is left whole, the next run finishes', async () => {
  await bulk(1200, 40);
  let transactions = 0;
  const failing = new Proxy(t.db, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (prop === 'getConnection')
        return () => {
          if (++transactions > 3) return Promise.reject(new Error('conexión perdida'));
          return (value as Function).call(target);
        };
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Pool;
  // Abandon step (1 transaction), then anonymizing: one batch of 500 goes through, then the connection is lost.
  await assert.rejects(purgeMailOutbox(failing, { batch: 500 }), /conexión perdida/);
  const left = await remaining();
  assert.equal(left % 500, 200, `whole batches only: ${left}`);
  assert.ok(left < 1200);
  assert.equal((await purge()).anonymized, left);
  assert.equal(await remaining(), 0);
});

test('8b) a row in use is skipped, not waited for', async () => {
  const id = await insert({ estado: 'ENVIADO', cerrado: -31 });
  const holder = await t.db.getConnection();
  await holder.beginTransaction();
  await holder.query('SELECT id FROM correo_saliente WHERE id = ? FOR UPDATE', [id]);
  try {
    const started = performance.now();
    assert.equal((await purge()).anonymized, 0);
    assert.ok(performance.now() - started < 1000, 'did not wait for the lock');
  } finally {
    await holder.rollback();
    holder.release();
  }
  assert.equal((await purge()).anonymized, 1);
});

test('9) the purge reads only what it needs: 3000 rows not yet due, almost none examined', async () => {
  await bulk(3000, 1);
  await t.db.query('ANALYZE TABLE correo_saliente');
  // ANALYZE runs the statement and reports the rows it really read (r_rows), whatever the plan says it would.
  const rows: Record<string, unknown>[] = await t.db.query(
    `ANALYZE SELECT id FROM correo_saliente FORCE INDEX (ix_correo_saliente_anonimizado)
      WHERE estado IN ('ENVIADO', 'FALLIDO') AND cerrado_en <= ? AND anonimizado_en IS NULL
      LIMIT 500`,
    [days(-30)],
  );
  assert.ok(Number(rows[0]!['r_rows']) < 2, JSON.stringify(rows[0]));
  assert.match(String(rows[0]!['key']), /anonimizado/);
  const started = performance.now();
  assert.equal((await purge()).anonymized, 0);
  assert.ok(performance.now() - started < 500);
  assert.equal(await remaining(), 3000);
});

test('10) the mail flow is unaffected, and an anonymized row can never be sent', async () => {
  const anonymized = await insert({ estado: 'FALLIDO', cerrado: -31 });
  await purge();
  assert.equal((await get(anonymized))!['destinatario'], null);
  assert.equal(await processMailQueue(t.db, () => assert.fail('nothing to send')), 0);
  const id = await insert({ estado: 'PENDIENTE' });
  assert.equal(
    await deliverMail(t.db, () => ({ id: 'r' }), id, 'persona@example.com', 'A', 'T'),
    'ENVIADO',
  );
  assert.ok((await get(id))!['cerrado_en']);
  const failed = await insert({ estado: 'PENDIENTE' });
  await deliverMail(
    t.db,
    () => {
      throw new MailError('HTTP_422', true);
    },
    failed,
    'persona@example.com',
    'A',
    'T',
  );
  assert.ok((await get(failed))!['cerrado_en'], 'a permanent failure closes it');
  const retry = await insert({ estado: 'PENDIENTE' });
  await deliverMail(
    t.db,
    () => {
      throw new MailError('TIMEOUT', false);
    },
    retry,
    'persona@example.com',
    'A',
    'T',
  );
  assert.equal((await get(retry))!['cerrado_en'], null, 'a retry stays open');
});

test('logs never carry the addresses', async () => {
  const lines: string[] = [];
  const spies = (['log', 'error', 'warn', 'info'] as const).map((m) =>
    mock.method(console, m, (...a: unknown[]) => void lines.push(a.join(' '))),
  );
  try {
    await insert({ estado: 'ENVIADO', cerrado: -31 });
    await purge();
    const id = await insert({ estado: 'PENDIENTE' });
    await deliverMail(
      t.db,
      () => {
        throw new Error('fallo con persona@example.com');
      },
      id,
      'persona@example.com',
      'A',
      'T',
    );
  } finally {
    for (const s of spies) s.mock.restore();
  }
  assert.ok(lines.length, 'something was logged');
  assert.doesNotMatch(lines.join('\n'), /@/);
});

test('the retention is configurable and validated; it is not a legal term', () => {
  assert.equal(mailRetentionFrom({}), MAIL_RETENTION_DAYS);
  assert.equal(mailRetentionFrom({ CORREO_RETENCION_DIAS: '90' }), 90);
  for (const bad of ['0', '-1', '366', '1.5', 'x'])
    assert.throws(() => mailRetentionFrom({ CORREO_RETENCION_DIAS: bad }), /CORREO_RETENCION_DIAS/);
  assert.match(checkEnvironment({ CORREO_RETENCION_DIAS: 'x' }).errors.join(), /CORREO_RETENCION/);
});

test('migration 008 closes what 007 left open, and repeating it changes nothing', async () => {
  const { runSqlFile } = await import('./schema.ts');
  const id = await insert({ estado: 'ENVIADO', cerrado: null });
  await t.db.query('UPDATE correo_saliente SET cerrado_en = NULL, enviado_en = ? WHERE id = ?', [
    days(-2),
    id,
  ]);
  for (let i = 0; i < 2; i++)
    await runSqlFile(process.env, t.name, 'db/mariadb/migrations/008_retencion_y_dispositivos.sql');
  assert.ok((await get(id))!['cerrado_en']);
  assert.equal(
    await t.count(
      "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'origen_conocido'",
    ),
    0,
  );
});

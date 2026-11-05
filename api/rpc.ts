/**
 * Domain bridge (decision D13, docs/database/MARIADB.md): `POST /api/rpc {service, method, args}` runs one domain
 * operation of the allowlist (src/app/core/api/rpc-methods.ts) with the session of the cookie, on the data in MariaDB.
 *
 * Unit of work, all inside one transaction and under one named lock:
 *   tables → run the Angular service (api/domain) → diff → INSERT/UPDATE/DELETE the changed rows → COMMIT.
 * The services keep doing what they did over MockDb (validation, AuthorizationService, audit); MariaDB adds its
 * PK/FK/UNIQUE/CHECK on top (HU-073), and a failed operation leaves nothing behind (ROLLBACK).
 *
 * Tables (HU-075): the ones only this bridge writes are kept in memory, frozen, and re-read when `version_datos`
 * changes (migration 003: every write here and the daily job bump it, so several API instances stay consistent).
 * The ones the auth endpoints also write are read on every request: `usuarios`, `tokens_recuperacion`, the open and
 * the latest session of each account, and `auditoria` only for AuditService (everyone else just appends to it).
 * ponytail: one global lock — fine for one school; per-table locks if writes ever queue up.
 */
import type { Pool, PoolConnection } from 'mariadb';
import type { Ctx, Reply } from './server.ts';
import { argon2Gate, type Argon2Gate } from './argon2-guard.ts';
import { NO_SESSION, localDateTime, sessionUser } from './auth.ts';
import { revokeDevices } from './device-trust.ts';
import { deliverMail, enqueueMail, tokenHashOf } from './mail.ts';
import { TABLES, type TableMap } from './tables.ts';

type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;
interface Domain {
  isRpcMethod(service: string, method: string): boolean;
  runDomain(input: {
    tables: Tables;
    user: unknown;
    service: string;
    method: string;
    args: unknown[];
  }): Promise<{
    result: unknown;
    tables: Tables;
    outbox: { to: string; subject: string; body: string }[];
  }>;
  seedTables(): Tables;
  isForbidden(e: unknown): boolean;
}

/** Built by `npm run api:build` (esbuild): the Angular services can't run under Node's type stripping. */
export const domain: Promise<Domain> = import(
  new URL('./.build/domain.mjs', import.meta.url).href
) as Promise<Domain>;

/** Per database, so test and development databases on one server don't wait for each other. */
const LOCK = 'charales_domain:';
const LOCK_SECONDS = 10;
/** Raised by MariaDB when a concurrent auth request touched a row we also write (snapshot isolation) or on deadlock. */
const RETRYABLE = new Set([1020, 1213, 1205]);
/** Rules MariaDB enforces itself: duplicate key, FK, CHECK. */
const INTEGRITY = new Set([1062, 1451, 1452, 4025, 3819]);
/** A TypeError in a service: the browser sent a shape it can't use. Nothing written; logged in case it is a bug. */
export const TYPE_ERROR_MESSAGE =
  'No se pudieron procesar los datos enviados. Revisa el formulario e inténtalo de nuevo.';
const INTEGRITY_MESSAGE =
  'La operación no respeta una regla de integridad de los datos. Revisa la información e intenta de nuevo.';
/** The constraint MariaDB enforced, in the user's words (no table or column names). */
const INTEGRITY_MESSAGES: Record<number, string> = {
  1062: 'Ya existe un registro con esos datos.',
  1451: 'No se puede quitar: hay otros registros que dependen de éste.',
  1452: 'Hace referencia a un registro que no existe. Actualiza la página e inténtalo de nuevo.',
};
const JSON_COLUMNS = new Set(['auditoria.datos_anteriores', 'auditoria.datos_nuevos']);
const SECRET_FIELDS = new Set(['passwordHash', 'tokenHash']);

export async function rpc(ctx: Ctx, db: Pool): Promise<Reply> {
  const { service, method, args } = (ctx.body ?? {}) as {
    service?: unknown;
    method?: unknown;
    args?: unknown;
  };
  if (typeof service !== 'string' || typeof method !== 'string' || !Array.isArray(args))
    return {
      status: 400,
      body: { error: 'No se pudo procesar la solicitud. Recarga la página e inténtalo de nuevo.' },
    };
  const d = await domain;
  if (!d.isRpcMethod(service, method))
    return { status: 404, body: { error: 'Esa operación no está disponible.' } };
  if (!ctx.token) return { status: 401, body: { error: NO_SESSION } };
  // Every operation holds a connection and the global lock, so one session flooding the bridge would queue everyone
  // else (F5-10). Its operations run a few at a time, in order; past the queue it is told to wait, before any query.
  const gate = sessionGate(ctx.token);
  try {
    const turn = await gate.run(async () => {
      const user = await sessionUser(ctx, db);
      if (!user) return { status: 401, body: { error: NO_SESSION } };
      return runOperation(ctx, db, d, user, service, method, args);
    });
    return turn.busy ? { status: 429, body: { error: TOO_MANY_AT_ONCE } } : turn.value;
  } finally {
    const { active, waiting } = gate.stats();
    if (!active && !waiting) gates.delete(ctx.token);
  }
}

async function runOperation(
  ctx: Ctx,
  db: Pool,
  d: Domain,
  user: NonNullable<Awaited<ReturnType<typeof sessionUser>>>,
  service: string,
  method: string,
  args: unknown[],
): Promise<Reply> {
  for (let attempt = 1; ; attempt++) {
    try {
      const mailIds: number[] = [];
      const { result, outbox } = await unitOfWork(
        db,
        async (tables) => {
          const out = await d.runDomain({ tables, user, service, method, args });
          // HU-004/012/022 invitations: without a mail transport the operation can't finish (D4b) → ROLLBACK.
          if (out.outbox.length && !ctx.mailer) throw new MailUnavailable();
          return out;
        },
        {
          audit: service === 'AuditService',
          // In the same transaction: the operation and its notice are committed together (F5-08).
          beforeCommit: async (conn, out, before) => {
            await settleAccountChanges(conn, before, out.tables);
            mailIds.length = 0;
            for (const m of out.outbox)
              mailIds.push(await enqueueMail(conn, m.to, m.subject, tokenHashOf(m.body)));
          },
        },
      );
      // After COMMIT the operation HAPPENED, whatever the provider says: a failure stays queued for the worker and the
      // answer says so, never as an error of the operation (and never with the provider's words).
      let mailPending = false;
      for (const [i, m] of outbox.entries())
        if (
          (await deliverMail(db, ctx.mailer!, mailIds[i]!, m.to, m.subject, m.body)) !== 'ENVIADO'
        )
          mailPending = true;
      return {
        status: 200,
        body: { result: scrub(result) ?? null, ...(mailPending ? { mailPending } : {}) },
      };
    } catch (e) {
      const code = (e as { errno?: number }).errno;
      if (code && RETRYABLE.has(code) && attempt < 3) continue;
      if (e instanceof MailUnavailable || e instanceof LockTimeout)
        return { status: 503, body: { error: e.message } };
      if (d.isForbidden(e)) return { status: 403, body: { error: (e as Error).message } };
      if (code && INTEGRITY.has(code)) {
        console.error(`rpc ${service}.${method}: integridad (errno ${code})`);
        return { status: 409, body: { error: INTEGRITY_MESSAGES[code] ?? INTEGRITY_MESSAGE } };
      }
      // Arguments come from the browser (a trust boundary): a TypeError means the service got a shape it can't use.
      // Nothing was written (ROLLBACK); it answers 400 and is logged, in case it is a bug and not bad input.
      if (e instanceof TypeError) {
        console.error(`rpc ${service}.${method}: ${e.message}`);
        return { status: 400, body: { error: TYPE_ERROR_MESSAGE } };
      }
      // Only plain Errors are business rules; anything else stays a logged 500.
      if (code || !(e instanceof Error) || e.constructor !== Error) throw e;
      // Business-rule errors of the services (Spanish messages meant for the user), like over MockDb.
      return { status: 400, body: { error: e.message } };
    }
  }
}

/** Operations of one session running at once: less than the pool (5 by default), so others always find a connection. */
const SESSION_LIMITS = { limit: 3, waitMs: 5000 };
const TOO_MANY_AT_ONCE = 'Demasiadas solicitudes a la vez. Espera un momento e inténtalo de nuevo.';
/** Only sessions with operations running or queued are here, so it can't grow beyond what is in flight. */
const gates = new Map<string, Argon2Gate>();
function sessionGate(token: string): Argon2Gate {
  let gate = gates.get(token);
  if (!gate) gates.set(token, (gate = argon2Gate(SESSION_LIMITS)));
  return gate;
}

/** The database doesn't match the code (a migration is missing): logged in full, a generic 500 for the client. */
class SchemaError extends Error {}

/**
 * An account that changed e-mail or was deactivated: what trusted the old state stops counting, in the same transaction
 * (audit IND-01, IND-08). Its trusted browsers go, and no queued message may go out; the service already revoked its tokens.
 */
async function settleAccountChanges(conn: PoolConnection, before: Tables, after: Tables) {
  const old = new Map((before['users'] ?? []).map((u) => [u['id'], u]));
  for (const user of after['users'] ?? []) {
    const prev = old.get(user['id']);
    if (!prev || prev === user) continue;
    if (prev['email'] === user['email'] && (user['active'] || !prev['active'])) continue;
    await revokeDevices(conn, user['id'] as number);
    const now = localDateTime();
    await conn.query(
      `UPDATE correo_saliente SET estado = 'FALLIDO', ultimo_error = 'CUENTA_MODIFICADA', cerrado_en = ?, bloqueado_hasta = NULL
        WHERE usuario_id = ? AND estado IN ('PENDIENTE', 'ENVIANDO')`,
      [now, user['id']],
    );
  }
}

class MailUnavailable extends Error {
  constructor() {
    super(
      'El envío de correo no está configurado: no se pudo enviar el acceso. Intenta más tarde.',
    );
  }
}
class LockTimeout extends Error {}

/** Also written by the auth endpoints, outside the domain lock: never cached. */
const FRESH = new Set(['usuarios', 'tokens_recuperacion', 'sesiones', 'auditoria']);
const caches = new WeakMap<Pool, { version: number; tables: Tables }>();
const metas = new WeakMap<Pool, Meta>();

/**
 * Gives `work` the tables (see the header) under the named lock and in a transaction, writes the difference and
 * commits; anything thrown rolls everything back. Rows are frozen: services replace rows (MockDb.update/insert),
 * never edit them in place. `audit: true` also loads `auditoria` (AuditService). Also used by api/demo.ts.
 */
export async function unitOfWork<T extends { tables: Tables }>(
  db: Pool,
  work: (tables: Tables) => Promise<T>,
  options: {
    audit?: boolean;
    /** Runs on the same connection, after the writes and before COMMIT: its writes share the transaction. */
    beforeCommit?: (conn: PoolConnection, out: T, before: Tables) => Promise<void>;
  } = {},
): Promise<T> {
  const conn = await db.getConnection();
  try {
    const [{ locked }] = await conn.query('SELECT GET_LOCK(CONCAT(?, DATABASE()), ?) AS locked', [
      LOCK,
      LOCK_SECONDS,
    ]);
    if (locked !== 1) throw new LockTimeout('El sistema está ocupado. Intenta de nuevo.');
    try {
      await conn.beginTransaction();
      try {
        const meta = metas.get(db) ?? (await columns(conn));
        metas.set(db, meta);
        const [row] = await conn.query('SELECT version FROM version_datos WHERE id = 1');
        if (!row) throw new SchemaError('Falta version_datos: aplica db/mariadb/migrations.');
        const version = Number(row.version);
        let cache = caches.get(db);
        if (cache?.version !== version) {
          const stable = await loadTables(conn, meta, { only: (t) => !FRESH.has(t.table) });
          cache = { version, tables: freeze(stable) };
          caches.set(db, cache);
        }
        const fresh = await loadTables(conn, meta, {
          only: (t) => FRESH.has(t.table),
          openSessionsOnly: true,
          audit: options.audit ?? false,
        });
        const before = { ...cache.tables, ...fresh };
        const out = await work(
          Object.fromEntries(Object.entries(before).map(([k, rows]) => [k, [...rows]])),
        );
        const changed = await applyChanges(conn, meta, before, out.tables);
        await options.beforeCommit?.(conn, out, before);
        const touched = [...changed].filter((t) => !FRESH.has(t));
        let next: Tables | null = null;
        if (touched.length) {
          await conn.query('UPDATE version_datos SET version = version + 1 WHERE id = 1');
          // Re-read what was written, inside the transaction: the cache must hold what MariaDB stored (defaults,
          // ON UPDATE timestamps, generated columns), not what the service computed.
          const reread = await loadTables(conn, meta, { only: (t) => touched.includes(t.table) });
          next = { ...cache.tables, ...freeze(reread) };
        }
        await conn.commit();
        if (next) caches.set(db, { version: version + 1, tables: next });
        return out;
      } catch (e) {
        await conn.rollback().catch(() => undefined);
        throw e;
      }
    } finally {
      await conn.query('SELECT RELEASE_LOCK(CONCAT(?, DATABASE()))', [LOCK]);
    }
  } finally {
    conn.release();
  }
}

/** The in-memory copy of the stable tables (tests compare it with MariaDB). */
export const cachedTables = (db: Pool): Tables | undefined => caches.get(db)?.tables;

function freeze(tables: Tables): Tables {
  for (const rows of Object.values(tables)) for (const r of rows) Object.freeze(r);
  return tables;
}

// ---------------------------------------------------------------- column metadata and conversions

type Kind = 'money' | 'bool' | 'datetime' | 'time' | 'json' | 'plain';
interface Column {
  name: string;
  field: string;
  kind: Kind;
  generated: boolean;
}
type Meta = Map<string, Column[]>;

export async function columns(conn: PoolConnection): Promise<Meta> {
  const rows: { t: string; c: string; dt: string; ct: string; g: string }[] = await conn.query(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS dt, COLUMN_TYPE AS ct, IS_GENERATED AS g
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`,
  );
  const meta: Meta = new Map();
  for (const t of TABLES) {
    const cols = Object.entries(t.cols).map(([name, field]) => {
      const info = rows.find((r) => r.t === t.table && r.c === name);
      if (!info)
        throw new SchemaError(
          `Columna ${t.table}.${name} no existe: aplica db/mariadb/migrations.`,
        );
      const kind: Kind = JSON_COLUMNS.has(`${t.table}.${name}`)
        ? 'json'
        : info.dt === 'decimal'
          ? 'money'
          : info.ct === 'tinyint(1)'
            ? 'bool'
            : info.dt === 'datetime' || info.dt === 'timestamp'
              ? 'datetime'
              : info.dt === 'time'
                ? 'time'
                : 'plain';
      return { name, field, kind, generated: info.g === 'ALWAYS' };
    });
    meta.set(t.table, cols);
  }
  return meta;
}

function toModel(kind: Kind, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (kind) {
    case 'money':
      return Math.round(Number(v) * 100);
    case 'bool':
      return Boolean(v);
    case 'datetime':
      return String(v).replace(' ', 'T');
    case 'time':
      return String(v).slice(0, 5);
    case 'json':
      return typeof v === 'string' ? JSON.parse(v) : v;
    default:
      return v;
  }
}

function toSql(kind: Kind, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (kind) {
    case 'money':
      return (Number(v) / 100).toFixed(2);
    case 'bool':
      return v ? 1 : 0;
    case 'datetime':
      return String(v).replace('T', ' ');
    case 'json':
      return JSON.stringify(v);
    default:
      return v;
  }
}

/**
 * Reads tables into model rows. By default every row of every table; the unit of work narrows it with `only`,
 * `openSessionsOnly` (open sessions + the latest of each account: all the services use) and `audit`.
 */
export async function loadTables(
  conn: PoolConnection,
  meta: Meta,
  options: { only?: (t: TableMap) => boolean; openSessionsOnly?: boolean; audit?: boolean } = {},
): Promise<Tables> {
  const tables: Tables = {};
  for (const t of TABLES) {
    if (options.only && !options.only(t)) continue;
    if (t.table === 'auditoria' && options.audit === false) {
      tables[t.key] = [];
      continue;
    }
    const cols = meta.get(t.table)!;
    const where =
      t.table === 'sesiones' && options.openSessionsOnly
        ? ' WHERE cerrada_en IS NULL OR id IN (SELECT MAX(id) FROM sesiones GROUP BY usuario_id)'
        : '';
    const rows: Row[] = await conn.query(
      `SELECT ${cols.map((c) => `\`${c.name}\``).join(', ')} FROM \`${t.table}\`${where} ORDER BY ${t.pk.map((c) => `\`${c}\``).join(', ')}`,
    );
    tables[t.key] = rows.map((r) =>
      Object.fromEntries(cols.map((c) => [c.field, toModel(c.kind, r[c.name])])),
    );
  }
  return tables;
}

// ---------------------------------------------------------------- diff and write-back

const keyOf = (t: TableMap, row: Row): unknown =>
  t.pk.length === 1 ? row[t.cols[t.pk[0]!]!] : t.pk.map((pk) => row[t.cols[pk]!]).join('|');
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Writes `after` − `before` and returns the tables it touched: parents first for INSERT/UPDATE (TABLES order),
 * children first for DELETE. A row object the service didn't replace is unchanged (rows are frozen), so only
 * replaced rows are compared column by column. A statement that only fails because of the order of two rows (e.g.
 * moving the unique «current season» flag) is retried after the others of its table.
 */
export async function applyChanges(
  conn: PoolConnection,
  meta: Meta,
  before: Tables,
  after: Tables,
): Promise<Set<string>> {
  const touched = new Set<string>();
  for (const t of [...TABLES].reverse()) {
    const cols = meta.get(t.table)!;
    const keep = new Set((after[t.key] ?? []).map((r) => keyOf(t, r)));
    for (const row of before[t.key] ?? [])
      if (!keep.has(keyOf(t, row)) && touched.add(t.table))
        await conn.query(
          `DELETE FROM \`${t.table}\` WHERE ${t.pk.map((c) => `\`${c}\` = ?`).join(' AND ')}`,
          t.pk.map((pk) => row[cols.find((c) => c.name === pk)!.field]),
        );
  }
  for (const t of TABLES) {
    const cols = meta.get(t.table)!;
    const writable = cols.filter((c) => !c.generated);
    const old = new Map((before[t.key] ?? []).map((r) => [keyOf(t, r), r]));
    const statements: [string, unknown[]][] = [];
    for (const row of after[t.key] ?? []) {
      const prev = old.get(keyOf(t, row));
      if (prev === row) continue;
      if (!prev) {
        if (t.table === 'sesiones')
          throw new Error('Las sesiones sólo las crea el inicio de sesión.');
        const set = writable.filter(
          (c) => row[c.field] !== undefined && !(t.dbAssignsId && c.name === 'id'),
        );
        statements.push([
          `INSERT INTO \`${t.table}\` (${set.map((c) => `\`${c.name}\``).join(', ')}) VALUES (${set.map(() => '?').join(', ')})`,
          set.map((c) => toSql(c.kind, row[c.field])),
        ]);
      } else {
        const changed = writable.filter((c) => !same(prev[c.field], row[c.field]));
        if (changed.length)
          statements.push([
            `UPDATE \`${t.table}\` SET ${changed.map((c) => `\`${c.name}\` = ?`).join(', ')} WHERE ${t.pk.map((c) => `\`${c}\` = ?`).join(' AND ')}`,
            [
              ...changed.map((c) => toSql(c.kind, row[c.field])),
              ...t.pk.map((pk) => prev[cols.find((c) => c.name === pk)!.field]),
            ],
          ]);
      }
    }
    // UPDATEs before INSERTs (close the old membership, then open the new one); duplicates retried after the rest.
    statements.sort(
      (a, b) => Number(a[0].startsWith('INSERT')) - Number(b[0].startsWith('INSERT')),
    );
    if (statements.length) touched.add(t.table);
    let pending = statements;
    while (pending.length) {
      const failed: [string, unknown[]][] = [];
      let lastError: unknown;
      for (const s of pending) {
        try {
          await conn.query(s[0], s[1]);
        } catch (e) {
          if ((e as { errno?: number }).errno !== 1062) throw e;
          failed.push(s);
          lastError = e;
        }
      }
      if (failed.length === pending.length) throw lastError;
      pending = failed;
    }
  }
  return touched;
}

/** Results never carry password or token hashes (publicUser already strips them; this is the safety net). */
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !SECRET_FIELDS.has(k))
        .map(([k, v]) => [k, scrub(v)]),
    );
  return value;
}

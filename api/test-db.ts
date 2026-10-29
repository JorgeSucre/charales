/**
 * Shared harness of the tests that run the app over a real MariaDB: a temporary database `<prefix>_<pid>` prepared
 * like `npm run db:setup` (schema, migrations, 010) plus the MockDb demo seed (api/demo.ts), plus the API listening on a free port. Dropped
 * at the end. Used by api/rpc.test.ts and the per-phase HU tests (api/hu-*.test.ts).
 */
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Pool } from 'mariadb';
import { loadDemo } from './demo.ts';
import { dropTestDatabase, setupDatabase } from './schema.ts';
import { TYPE_ERROR_MESSAGE } from './rpc.ts';
import { createApp, createPool } from './server.ts';

export interface TestDb {
  /** The temporary database (ef_*). */
  name: string;
  db: Pool;
  base: string;
  mail: { to: string; subject: string; text: string }[];
  login(email: string, password?: string): Promise<string>;
  call(
    cookie: string | null,
    service: string,
    method: string,
    ...args: unknown[]
  ): Promise<Response>;
  ok<T = unknown>(res: Promise<Response>): Promise<T>;
  /**
   * A rejected operation (T3): `status` with the operation's own error, and nothing written (see `unchanged`).
   * `send` is a function so the tables are read before the request goes out. A 400 must name its reason — `message`
   * is required — and the bridge's generic answer to a TypeError ({@link TYPE_ERROR_MESSAGE}: the service hit a
   * programming error with those arguments, api/rpc.ts) never passes as a rejection unless `message` is exactly
   * {@link TYPE_ERROR} (a loose pattern such as /inválid/ is not enough).
   */
  refused(send: () => Promise<Response>, status: 400, message: RegExp): Promise<void>;
  refused(
    send: () => Promise<Response>,
    status: 401 | 403 | 404 | 409 | 413 | 503,
    message?: RegExp,
  ): Promise<void>;
  /**
   * Runs `action` and checks that no table changed (CHECKSUM TABLE: row order doesn't matter, NULL ≠ ''), except
   * `except` — by default `sesiones`, whose last use every request renews. Returns what `action` returned.
   */
  unchanged<T>(action: () => Promise<T>, except?: readonly string[]): Promise<T>;
  count(sql: string, params?: unknown[]): Promise<number>;
  /** Moves the fixed clock forward (Node and MariaDB stay in step). */
  advance(ms: number): Promise<void>;
  close(): Promise<void>;
}

/**
 * The demo seed has fixed dates (sessions in October 2026, notices until December…), so the API tests run on a fixed
 * clock, like the frontend tests (vi.setSystemTime): Node's Date is mocked and every MariaDB connection gets the same
 * instant (`SET timestamp`), so NOW()/CURDATE() agree with the services. 12:00 at the school (America/Mexico_City, UTC−6).
 */
export const TEST_NOW = new Date('2026-10-13T18:00:00Z');
/** What api/rpc.ts answers (400) when a service throws a TypeError on the arguments it got. */
export { TYPE_ERROR_MESSAGE };
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The only `message` that lets `refused` accept {@link TYPE_ERROR_MESSAGE}: a test that wants that answer says so. */
export const TYPE_ERROR = new RegExp(`^${escape(TYPE_ERROR_MESSAGE)}$`);
/** Written by every authenticated request (last use of the session), so never part of «nothing written». */
const VOLATILE = ['sesiones'] as const;
const wallClock = (d: Date) => d.toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' });

export async function openTestDb(
  prefix: string,
  options: { realClock?: boolean } = {},
): Promise<TestDb> {
  if (!options.realClock) mock.timers.enable({ apis: ['Date'], now: TEST_NOW });
  const name = `${prefix}_${process.pid}`;
  // Same preparation as `npm run db:setup` (schema + migrations + permissions), on a fresh ef_* database.
  await dropTestDatabase(process.env, name);
  await setupDatabase({ ...process.env, DB_NAME: name });
  // Every pooled connection runs at the mocked instant (re-read on each new connection).
  const db = createPool(
    { ...process.env, DB_NAME: name },
    options.realClock
      ? {}
      : { initSql: `SET timestamp = UNIX_TIMESTAMP('${wallClock(new Date())}')` },
  );
  await loadDemo(db);
  const mail: TestDb['mail'] = [];
  const server: Server = createApp(db, {
    secureCookie: false,
    mailer: (to, subject, text) => void mail.push({ to, subject, text }),
  }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const call: TestDb['call'] = (cookie, service, method, ...args) =>
    fetch(`${base}/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ service, method, args }),
    });
  /** Checksum of every table of the test database but `except`, by name. */
  const checksums = async (except: readonly string[]) => {
    const tables: { t: string }[] = await db.query(
      `SELECT TABLE_NAME AS t FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
    );
    const names = tables.map((r) => r.t).filter((n) => !except.includes(n));
    const rows: { Table: string; Checksum: number }[] = await db.query(
      `CHECKSUM TABLE ${names.map((n) => `\`${n}\``).join(', ')}`,
    );
    return Object.fromEntries(rows.map((r) => [r.Table.split('.').pop(), r.Checksum]));
  };
  const unchanged: TestDb['unchanged'] = async (action, except = VOLATILE) => {
    const before = await checksums(except);
    const result = await action();
    assert.deepEqual(await checksums(except), before, 'the operation wrote to the database');
    return result;
  };
  return {
    name,
    db,
    base,
    mail,
    call,
    async login(email, password = 'demo1234') {
      const res = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(res.status, 200, `login ${email}`);
      return res.headers.get('set-cookie')!.split(';')[0]!;
    },
    async ok<T>(res: Promise<Response>) {
      const r = await res;
      const body = await r.json();
      assert.equal(r.status, 200, JSON.stringify(body));
      return body.result as T;
    },
    unchanged,
    async refused(send: () => Promise<Response>, status: number, message?: RegExp) {
      const body = await unchanged(async () => {
        const r = await send();
        const json = await r.json();
        assert.equal(r.status, status, JSON.stringify(json));
        return json as { error?: unknown };
      });
      assert.equal(typeof body.error, 'string', `an error message: ${JSON.stringify(body)}`);
      const error = body.error as string;
      if (error === TYPE_ERROR_MESSAGE && message !== TYPE_ERROR)
        assert.fail(
          `${status} «${error}» is the API's answer to a TypeError in the service (a programming error, logged ` +
            'by api/rpc.ts as «rpc Service.method: …»), not the rejection this test expects.',
        );
      if (status === 400) assert.ok(message, 'a 400 must say which rejection it expects (message)');
      if (message) assert.match(error, message);
    },
    async count(sql, params = []) {
      return Number((await db.query(sql, params))[0].n);
    },
    async advance(ms) {
      mock.timers.tick(ms);
      // Connections already open keep their instant: move them all (the pool is small) by draining it.
      const conns = await Promise.all(Array.from({ length: 5 }, () => db.getConnection()));
      for (const c of conns) {
        await c.query(`SET timestamp = UNIX_TIMESTAMP('${wallClock(new Date())}')`);
        c.release();
      }
    },
    async close() {
      server.close();
      await db.end();
      await dropTestDatabase(process.env, name);
    },
  };
}

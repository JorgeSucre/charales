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
  /** 4xx with the message of the API. */
  refused(res: Promise<Response>, status: number, message?: RegExp): Promise<void>;
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
    async refused(res, status, message) {
      const r = await res;
      const body = await r.json();
      assert.equal(r.status, status, JSON.stringify(body));
      if (message) assert.match(body.error, message);
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

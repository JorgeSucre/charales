/**
 * Domain bridge, server side (decision D13, docs/database/MARIADB.md): runs the SAME Angular domain services the
 * frontend tests cover (validation, transactions, audit, AuthorizationService) inside the API, on tables loaded from
 * MariaDB, with the user of the session cookie. api/rpc.ts loads the tables and writes the changes back.
 *
 * Bundled by esbuild (`npm run api:build` → api/.build/domain.mjs): the services use decorators and extension-less
 * imports, which Node's type stripping can't run. Angular itself stays an external package (JIT via @angular/compiler).
 */
import '@angular/compiler';
import { Injectable, Injector, ɵINJECTOR_SCOPE as INJECTOR_SCOPE } from '@angular/core';
import { MockDb, type OutboxMessage } from '../../src/app/core/data/mock-db';
import { SessionStore, type AuthUser } from '../../src/app/core/auth/session.store';
import { ForbiddenError } from '../../src/app/core/auth/authorization.service';
import { MailerService } from '../../src/app/core/services/mailer.service';
import { RPC_METHODS } from '../../src/app/core/api/rpc-methods';
import { RPC_SERVICES } from '../../src/app/core/api/rpc-services';

export { RPC_METHODS };
export type Tables = Record<string, Record<string, unknown>[]>;

/** MockDb without the simulated latency: here it is the unit of work over the loaded tables. */
@Injectable()
class ServerDb extends MockDb {
  override async respond<T>(value: T): Promise<T> {
    return structuredClone(value);
  }
}

/** Whether `service.method` is a domain operation the browser may call. */
export function isRpcMethod(service: string, method: string): boolean {
  // Own keys only: «constructor», «__proto__»… come from the client and must not reach Object.prototype.
  return (
    Object.hasOwn(RPC_METHODS, service) &&
    (RPC_METHODS as Record<string, readonly string[]>)[service]!.includes(method)
  );
}

/**
 * Runs one operation on a fresh injector (nothing is shared between requests) and returns its result, every table
 * after it (the caller diffs them against what it loaded) and the e-mails it queued (sent only after COMMIT).
 * The session is fixed: the cookie's, already validated by the API.
 */
export async function runDomain(input: {
  tables: Tables;
  user: AuthUser;
  service: string;
  method: string;
  args: unknown[];
}): Promise<{ result: unknown; tables: Tables; outbox: OutboxMessage[] }> {
  if (!isRpcMethod(input.service, input.method))
    throw new Error('Esa operación no está disponible.');
  const outbox: OutboxMessage[] = [];
  const session = { user: () => input.user, token: () => null, set: () => undefined };
  const injector = Injector.create({
    providers: [
      { provide: INJECTOR_SCOPE, useValue: 'root' },
      { provide: MockDb, useClass: ServerDb },
      { provide: SessionStore, useValue: session },
      {
        provide: MailerService,
        useValue: {
          send: (to: string, subject: string, body: string) =>
            void outbox.push({ to, subject, body, sentAt: '' }),
        },
      },
    ],
  });
  const db = injector.get(MockDb) as unknown as Tables;
  // The caller hands over its own array copies (rows are frozen: services replace them, never edit in place).
  for (const [key, rows] of Object.entries(input.tables)) db[key] = rows;
  const service = injector.get(RPC_SERVICES[input.service as keyof typeof RPC_METHODS]) as Record<
    string,
    (...args: unknown[]) => Promise<unknown>
  >;
  const result = await service[input.method]!(...input.args);
  const tables: Tables = {};
  for (const key of Object.keys(input.tables)) tables[key] = db[key]!;
  return { result, tables, outbox };
}

/** The MockDb seed (demo data of the frontend): tables keyed like MockDb, for the demo loader and the tests. */
export function seedTables(): Tables {
  const db = new ServerDb() as unknown as Tables;
  return Object.fromEntries(Object.entries(db).filter(([, v]) => Array.isArray(v))) as Tables;
}

export const isForbidden = (e: unknown) => e instanceof ForbiddenError;

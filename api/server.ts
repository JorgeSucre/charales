/**
 * Charales API (Milestone 1): plain node:http + the official MariaDB driver. Runs as TypeScript with Node's type
 * stripping (no build step). Contract: docs/API.md. Start: `npm run api:start` (reads .env if present).
 * ponytail: exact-match route table; add a router when the first path parameter (/players/:id) shows up.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { isIP } from 'node:net';
import mariadb, { type Pool, type PoolConfig } from 'mariadb';
import * as auth from './auth.ts';
import * as password from './password.ts';
import { rpc } from './rpc.ts';
import { ARGON2_DEFAULTS, argon2Gate, argon2LimitsFrom, type Argon2Gate } from './argon2-guard.ts';

/** Any failure without a message meant for the user: never a stack trace, SQL or internal detail (logged instead). */
export const UNEXPECTED_MESSAGE =
  'Ocurrió un error inesperado. Inténtalo de nuevo; si continúa, avisa al administrador.';

export interface Ctx {
  body: unknown;
  /** Value of the session cookie, if any. */
  token: string | null;
  ip: string;
  userAgent: string | null;
  secureCookie: boolean;
  /** E-mail transport for HU-005 recovery; null = recovery unavailable (503). */
  mailer: password.Mailer | null;
  /** Pool of the login attempt limiter (S-01): its own small pool in production, the main one otherwise. */
  limiterDb: Pool;
  /** Argon2id gate of this process (S-02, api/argon2-guard.ts). */
  argon2: Argon2Gate;
}
export interface Reply {
  status: number;
  body?: unknown;
  cookie?: string;
}
type Handler = (ctx: Ctx, db: Pool) => Promise<Reply>;

const MAX_BODY_BYTES = 10_000;
/** Domain operations carry whole forms (attendance lists, notice texts). */
const MAX_RPC_BODY_BYTES = 200_000;

const routes: Record<string, Handler> = {
  'GET /health': health,
  'POST /auth/login': auth.login,
  'GET /auth/session': auth.session,
  'POST /auth/logout': auth.logout,
  // HU-005 (docs/API.md § Contraseñas)
  'POST /auth/password': password.changePassword,
  'POST /auth/password-reset/request': password.requestPasswordReset,
  'POST /auth/password-reset/confirm': password.confirmPasswordReset,
  // Lab exercise (docs/API.md § Práctica): plain table reads, same permissions as PlayerService.search and
  // CategoryService.list. Rows go out as stored (snake_case), so they compare 1:1 with SELECT * in MariaDB.
  'GET /api/jugadores': async (ctx, db) =>
    (await auth.requireOffice(ctx, db, 'jugadores.consultar')) ?? {
      status: 200,
      body: await db.query('SELECT * FROM jugadores ORDER BY id'),
    },
  'GET /api/categorias': async (ctx, db) =>
    (await auth.requireOffice(ctx, db)) ?? {
      status: 200,
      body: await db.query('SELECT * FROM categorias ORDER BY id'),
    },
  // Domain operations of the app (D13, docs/API.md § Operaciones de dominio): the services run here, on MariaDB.
  'POST /api/rpc': rpc,
};

async function health(_ctx: Ctx, db: Pool): Promise<Reply> {
  try {
    await db.query('SELECT 1');
    return { status: 200, body: { status: 'ok', database: 'ok' } };
  } catch {
    return { status: 503, body: { status: 'error', database: 'unreachable' } };
  }
}

export function createApp(
  db: Pool,
  options: {
    secureCookie: boolean;
    mailer?: password.Mailer | null;
    /** Addresses of the reverse proxies whose X-Forwarded-For is believed (TRUSTED_PROXIES); none by default. */
    trustedProxies?: readonly string[];
    /** Small pool for the login limiter, so a login flood can't take the connections of the rest of the API (M-1). */
    limiterDb?: Pool;
    /** Argon2id gate of this process (S-02); one with ARGON2_DEFAULTS if omitted. */
    argon2?: Argon2Gate;
  },
): Server {
  const trusted = new Set((options.trustedProxies ?? []).map(plainIp));
  const gate = options.argon2 ?? argon2Gate(ARGON2_DEFAULTS);
  for (const ip of trusted)
    if (!isIP(ip))
      throw new Error(`TRUSTED_PROXIES: «${ip}» no es una dirección IP (sin rangos ni nombres).`);
  return createServer(async (req, res) => {
    let reply: Reply;
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      const handler = routes[`${req.method} ${path}`];
      reply = handler
        ? await handler(
            {
              body: await readJson(req, path === '/api/rpc' ? MAX_RPC_BODY_BYTES : MAX_BODY_BYTES),
              token: cookieValue(req.headers.cookie, auth.COOKIE),
              ip: clientIp(req, trusted),
              userAgent: req.headers['user-agent']?.slice(0, 500) ?? null,
              secureCookie: options.secureCookie,
              mailer: options.mailer ?? null,
              limiterDb: options.limiterDb ?? db,
              argon2: gate,
            },
            db,
          )
        : { status: 404, body: { error: 'Recurso no encontrado.' } };
    } catch (e) {
      if (e instanceof BadRequest) reply = { status: e.status, body: { error: e.message } };
      else {
        console.error(e);
        reply = { status: 500, body: { error: UNEXPECTED_MESSAGE } };
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (reply.cookie) res.setHeader('Set-Cookie', reply.cookie);
    if (reply.body === undefined) res.writeHead(reply.status).end();
    else
      res
        .writeHead(reply.status, { 'Content-Type': 'application/json; charset=utf-8' })
        .end(JSON.stringify(reply.body));
  });
}

class BadRequest extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** JSON bodies only (a cross-site form can't send one without a CORS preflight); anything else reads as undefined. */
async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json')) return undefined;
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new BadRequest(413, 'Solicitud demasiado grande.');
  }
  try {
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    throw new BadRequest(
      400,
      'No se pudo procesar la solicitud. Recarga la página e inténtalo de nuevo.',
    );
  }
}

const plainIp = (ip: string) => ip.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');

/**
 * The client's address, for the attempt limits, sessions and audit (S-01). The TCP peer, unless it is one of our own
 * reverse proxies: then the X-Forwarded-For hop just before them (the rightmost one they didn't add). A direct client
 * can't choose its address with that header, and nothing is believed when no proxy is configured. A hop that isn't an
 * IP address leaves the peer's (the proxy is misconfigured; never an attacker-chosen value).
 */
export function clientIp(req: IncomingMessage, trusted: ReadonlySet<string>): string {
  const peer = plainIp(req.socket.remoteAddress ?? '');
  if (!trusted.has(peer)) return peer;
  const header = req.headers['x-forwarded-for'];
  const hops = (Array.isArray(header) ? header.join(',') : (header ?? '')).split(',').map(plainIp);
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i]!;
    if (!hop) continue;
    if (!isIP(hop)) return peer;
    if (!trusted.has(hop)) return hop;
  }
  return peer;
}

function cookieValue(header: string | undefined, name: string): string | null {
  for (const part of header?.split(';') ?? []) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=') || null;
  }
  return null;
}

export function createPool(
  env: Record<string, string | undefined> = process.env,
  extra: Partial<PoolConfig> = {},
): Pool {
  return mariadb.createPool({
    ...extra,
    ...(env['DB_SOCKET']
      ? { socketPath: env['DB_SOCKET'] }
      : { host: env['DB_HOST'] ?? '127.0.0.1', port: Number(env['DB_PORT'] ?? 3306) }),
    user: env['DB_USER'],
    password: env['DB_PASSWORD'],
    database: env['DB_NAME'] ?? 'escuela_futbol',
    connectionLimit: extra.connectionLimit ?? Number(env['DB_POOL_SIZE'] ?? 5),
    // DATETIME stays the school's local wall-clock string (MARIADB.md § 1); ids are plain numbers.
    dateStrings: true,
    bigIntAsNumber: true,
    insertIdAsNumber: true,
    // Errors must not echo query parameters (e-mails, hashes, IPs) into the logs (M0 D4d). The driver's default is true.
    logParam: false,
    // Defense in depth (T1): the services validate their input, but a server configured without strict mode would
    // store '' for an ENUM value they let through instead of rejecting it. Runs last, after any caller's initSql.
    initSql: [...[extra.initSql ?? []].flat(), STRICT_MODE],
  });
}

/** S-01: seconds a limiter statement waits for a counter row another request holds before MariaDB answers 1205. */
export const LIMITER_LOCK_WAIT_S = 2;

/**
 * M-1: the login limiter's own pool — 2 connections, at most 3 s to get one (then the login answers 503) — so a flood
 * can't take the connections of the rest of the API. S-01: every connection of THIS pool (also the ones it opens
 * later) waits at most {@link LIMITER_LOCK_WAIT_S} for a row lock instead of the server's innodb_lock_wait_timeout
 * (50 s by default). A session setting: the main pool and the server keep their value. `extra` is for tests.
 */
export function createLimiterPool(
  env: Record<string, string | undefined> = process.env,
  extra: Partial<PoolConfig> = {},
): Pool {
  return createPool(env, {
    connectionLimit: 2,
    acquireTimeout: 3000,
    ...extra,
    initSql: [
      `SET SESSION innodb_lock_wait_timeout = ${LIMITER_LOCK_WAIT_S}`,
      ...[extra.initSql ?? []].flat(),
    ],
  });
}

/** Adds STRICT_TRANS_TABLES to whatever sql_mode the server has. */
export const STRICT_MODE =
  "SET SESSION sql_mode = IF(@@sql_mode = '', 'STRICT_TRANS_TABLES', CONCAT(@@sql_mode, ',STRICT_TRANS_TABLES'))";

if (import.meta.main) {
  const env = process.env;
  const db = createPool(env);
  const port = Number(env['PORT'] ?? 3000);
  const secureCookie = env['NODE_ENV'] === 'production' || env['COOKIE_SECURE'] === 'true';
  const trustedProxies = (env['TRUSTED_PROXIES'] ?? '').split(',').filter((ip) => ip.trim());
  const limiterDb = createLimiterPool(env);
  createApp(db, {
    secureCookie,
    mailer: password.mailerFromEnv(env),
    trustedProxies,
    limiterDb,
    argon2: argon2Gate(argon2LimitsFrom(env)), // S-02, per process; an invalid value stops the start
  }).listen(port, () =>
    console.log(
      `Charales API en http://localhost:${port} (BD ${env['DB_NAME'] ?? 'escuela_futbol'})`,
    ),
  );
}

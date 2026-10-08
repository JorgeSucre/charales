/**
 * Charales API (Milestone 1): plain node:http + the official MariaDB driver. Runs as TypeScript with Node's type
 * stripping (no build step). Contract: docs/API.md. Start: `npm run api:start` (reads .env if present).
 * ponytail: exact-match route table; add a router when the first path parameter (/players/:id) shows up.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import mariadb, { type Pool } from 'mariadb';
import * as auth from './auth.ts';

export interface Ctx {
  body: unknown;
  /** Value of the session cookie, if any. */
  token: string | null;
  ip: string;
  userAgent: string | null;
  secureCookie: boolean;
}
export interface Reply {
  status: number;
  body?: unknown;
  cookie?: string;
}
type Handler = (ctx: Ctx, db: Pool) => Promise<Reply>;

const MAX_BODY_BYTES = 10_000;

const routes: Record<string, Handler> = {
  'GET /health': health,
  'POST /auth/login': auth.login,
  'GET /auth/session': auth.session,
  'POST /auth/logout': auth.logout,
};

async function health(_ctx: Ctx, db: Pool): Promise<Reply> {
  try {
    await db.query('SELECT 1');
    return { status: 200, body: { status: 'ok', database: 'ok' } };
  } catch {
    return { status: 503, body: { status: 'error', database: 'unreachable' } };
  }
}

export function createApp(db: Pool, options: { secureCookie: boolean }): Server {
  return createServer(async (req, res) => {
    let reply: Reply;
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      const handler = routes[`${req.method} ${path}`];
      reply = handler
        ? await handler(
            {
              body: await readJson(req),
              token: cookieValue(req.headers.cookie, auth.COOKIE),
              ip: req.socket.remoteAddress ?? '',
              userAgent: req.headers['user-agent']?.slice(0, 500) ?? null,
              secureCookie: options.secureCookie,
            },
            db,
          )
        : { status: 404, body: { error: 'Recurso no encontrado.' } };
    } catch (e) {
      if (e instanceof BadRequest) reply = { status: e.status, body: { error: e.message } };
      else {
        console.error(e);
        reply = { status: 500, body: { error: 'Error interno.' } };
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
async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json')) return undefined;
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY_BYTES) throw new BadRequest(413, 'Solicitud demasiado grande.');
  }
  try {
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    throw new BadRequest(400, 'JSON inválido.');
  }
}

function cookieValue(header: string | undefined, name: string): string | null {
  for (const part of header?.split(';') ?? []) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=') || null;
  }
  return null;
}

export function createPool(env: Record<string, string | undefined> = process.env): Pool {
  return mariadb.createPool({
    ...(env['DB_SOCKET']
      ? { socketPath: env['DB_SOCKET'] }
      : { host: env['DB_HOST'] ?? '127.0.0.1', port: Number(env['DB_PORT'] ?? 3306) }),
    user: env['DB_USER'],
    password: env['DB_PASSWORD'],
    database: env['DB_NAME'] ?? 'escuela_futbol',
    connectionLimit: Number(env['DB_POOL_SIZE'] ?? 5),
    // DATETIME stays the school's local wall-clock string (MARIADB.md § 1); ids are plain numbers.
    dateStrings: true,
    bigIntAsNumber: true,
    insertIdAsNumber: true,
  });
}

if (import.meta.main) {
  const env = process.env;
  const db = createPool(env);
  const port = Number(env['PORT'] ?? 3000);
  const secureCookie = env['NODE_ENV'] === 'production' || env['COOKIE_SECURE'] === 'true';
  createApp(db, { secureCookie }).listen(port, () =>
    console.log(
      `Charales API en http://localhost:${port} (BD ${env['DB_NAME'] ?? 'escuela_futbol'})`,
    ),
  );
}

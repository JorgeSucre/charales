/**
 * Charales API (Milestone 1): plain node:http + the official MariaDB driver. Runs as TypeScript with Node's type
 * stripping (no build step). Contract: docs/API.md. Start: `npm run api:start` (reads .env if present).
 * ponytail: exact-match route table; add a router when the first path parameter (/players/:id) shows up.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import mariadb, { type Pool } from 'mariadb';
import * as auth from './auth.ts';
import * as password from './password.ts';

export interface Ctx {
  body: unknown;
  /** Value of the session cookie, if any. */
  token: string | null;
  ip: string;
  userAgent: string | null;
  secureCookie: boolean;
  /** E-mail transport for HU-005 recovery; null = recovery unavailable (503). */
  mailer: password.Mailer | null;
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
  options: { secureCookie: boolean; mailer?: password.Mailer | null },
): Server {
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
              mailer: options.mailer ?? null,
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
    // Errors must not echo query parameters (e-mails, hashes, IPs) into the logs (M0 D4d). The driver's default is true.
    logParam: false,
  });
}

if (import.meta.main) {
  const env = process.env;
  const db = createPool(env);
  const port = Number(env['PORT'] ?? 3000);
  const secureCookie = env['NODE_ENV'] === 'production' || env['COOKIE_SECURE'] === 'true';
  createApp(db, { secureCookie, mailer: password.mailerFromEnv(env) }).listen(port, () =>
    console.log(
      `Charales API en http://localhost:${port} (BD ${env['DB_NAME'] ?? 'escuela_futbol'})`,
    ),
  );
}

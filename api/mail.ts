/**
 * E-mail: providers and the transactional outbox (F5-02, F5-08). A message is recorded in `correo_saliente` in the same
 * transaction as the operation that asks for it, then sent right after COMMIT. A provider failure leaves the row to be
 * retried, so it neither loses the notice nor reports a committed operation as failed.
 *
 * `correo_saliente` never holds a body or a token (only token hashes are ever stored). The first send uses the link
 * already in memory; a retry issues a NEW token and revokes the previous one. Delivery is at least once: if the provider
 * accepted a message but the answer was lost, the person gets two, and only the newest link works.
 */
import { randomBytes } from 'node:crypto';
import type { Pool, PoolConnection } from 'mariadb';
import { localDateTime, sha256 } from './auth.ts';
import { isProduction } from './config.ts';
import { transaction } from './password.ts';

export const RESET_TOKEN_MINUTES = 60;
export const INVITATION_MINUTES = 24 * 60;
/** What the provider said, if anything; `id` is its reference for the message. */
export type MailReceipt = { id?: string } | void;
/** Sends one e-mail. Never receives a password; the access link (raw token) only goes through here. */
export type Mailer = (
  to: string,
  subject: string,
  text: string,
) => Promise<MailReceipt> | MailReceipt;

/** A provider failure with a code safe to store and log: never a message, a key or a host. */
export class MailError extends Error {
  readonly code: string;
  readonly permanent: boolean;
  constructor(code: string, permanent: boolean) {
    super(`Fallo del proveedor de correo: ${code}`);
    this.code = code;
    this.permanent = permanent;
  }
}

/** Resend's REST API with the platform's fetch: no extra dependency. `baseUrl` is for tests against a simulator. */
export function resendMailer(options: {
  apiKey: string;
  from: string;
  baseUrl?: string;
  timeoutMs?: number;
}): Mailer {
  const url = `${(options.baseUrl ?? 'https://api.resend.com').replace(/\/+$/, '')}/emails`;
  return async (to, subject, text) => {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: options.from, to: [to], subject, text }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
    } catch (e) {
      throw new MailError((e as Error).name === 'TimeoutError' ? 'TIMEOUT' : 'RED', false);
    }
    if (!res.ok) {
      await res.body?.cancel();
      // Our request is wrong (bad key, unverified domain, invalid address): repeating it can't help.
      const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
      throw new MailError(`HTTP_${res.status}`, !retryable);
    }
    const body = (await res.json().catch(() => ({}))) as { id?: unknown };
    return typeof body.id === 'string' ? { id: body.id.slice(0, 120) } : undefined;
  };
}

/**
 * The transport of the environment, or null (recovery and invitations answer 503, D4b). The console one is dev-only
 * (D4a): it prints access links, so it never runs with NODE_ENV=production.
 */
export function mailerFromEnv(env: Record<string, string | undefined>): Mailer | null {
  const provider = env['MAIL_PROVIDER']?.trim().toLowerCase();
  const appUrl = env['APP_URL'] ?? 'http://localhost:4200';
  if (provider === 'resend' && env['RESEND_API_KEY'] && env['MAIL_FROM'])
    return withAppUrl(
      resendMailer({
        apiKey: env['RESEND_API_KEY'],
        from: env['MAIL_FROM'],
        baseUrl: env['RESEND_BASE_URL'],
      }),
      appUrl,
    );
  if (isProduction(env) || provider === 'none' || provider === 'resend') return null;
  if (env['MAIL_CONSOLE'] !== 'true') return null;
  const toConsole: Mailer = (to, subject, text) =>
    console.info(`[correo de desarrollo] para ${to}: ${subject}\n${text}`);
  return withAppUrl(toConsole, appUrl);
}

/**
 * The services write app links as paths (`/reset-password?token=…`); an e-mail needs them absolute. APP_URL is where
 * the app is served (dev: http://localhost:4200). Every transport goes through this.
 */
export function withAppUrl(mailer: Mailer, appUrl: string): Mailer {
  const base = appUrl.replace(/\/+$/, '');
  return (to, subject, text) =>
    mailer(to, subject, text.replace(/(^|\s)\/reset-password\?/g, `$1${base}/reset-password?`));
}

const minutesOf = (finalidad: string) =>
  finalidad === 'INVITACION' ? INVITATION_MINUTES : RESET_TOKEN_MINUTES;
const validityOf = (minutes: number) =>
  minutes >= 60 * 24 ? `${minutes / 60} h` : `${minutes} min`;

export function accessMailText(finalidad: string, token: string): string {
  return `Abre este enlace para definir tu contraseña (válido ${validityOf(minutesOf(finalidad))}): /reset-password?token=${token}`;
}

/** Seconds before the worker may touch a new row: the request that created it sends it first. */
const FIRST_SEND_GRACE_MS = 2 * 60_000;
const LEASE_MS = 5 * 60_000;
export const MAX_MAIL_ATTEMPTS = 8;
const backoffMs = (attempts: number) => Math.min(60, 2 ** attempts) * 60_000;

/** Records one access e-mail inside the caller's transaction; its token row (by hash) must already be written. */
export async function enqueueMail(
  tx: PoolConnection,
  to: string,
  subject: string,
  tokenHash: string,
): Promise<number> {
  const [token]: { id: number; usuario_id: number; finalidad: string }[] = await tx.query(
    'SELECT id, usuario_id, finalidad FROM tokens_recuperacion WHERE token_hash = ?',
    [tokenHash],
  );
  if (!token) throw new Error('Correo sin token de acceso: no se puede registrar.');
  const now = Date.now();
  const { insertId } = await tx.query(
    `INSERT INTO correo_saliente
       (usuario_id, token_id, finalidad, destinatario, asunto, proximo_intento, vence_en, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      token.usuario_id,
      token.id,
      token.finalidad,
      to.slice(0, 150),
      subject.slice(0, 200),
      localDateTime(now + FIRST_SEND_GRACE_MS),
      localDateTime(now + minutesOf(token.finalidad) * 60_000),
      localDateTime(now),
    ],
  );
  return Number(insertId);
}

/** The hash of the token inside a message the domain produced. */
export function tokenHashOf(text: string): string {
  const token = /[?&]token=([\w-]+)/.exec(text)?.[1];
  if (!token) throw new Error('Correo sin token de acceso: no se puede registrar.');
  return sha256(token);
}

export type MailState = 'ENVIADO' | 'PENDIENTE' | 'FALLIDO';

/** Sends one recorded message and stores the outcome. Never throws: the operation that asked for it already happened. */
export async function deliverMail(
  db: Pool,
  mailer: Mailer,
  id: number,
  to: string,
  subject: string,
  text: string,
): Promise<MailState> {
  let receipt: MailReceipt;
  try {
    receipt = await mailer(to, subject, text);
  } catch (e) {
    return recordFailure(db, id, e);
  }
  try {
    await db.query(
      `UPDATE correo_saliente SET estado = 'ENVIADO', intentos = intentos + 1, enviado_en = ?, cerrado_en = ?,
              proveedor_id = ?, ultimo_error = NULL, bloqueado_hasta = NULL WHERE id = ?`,
      [localDateTime(), localDateTime(), receipt?.id ?? null, id],
    );
  } catch {
    // Accepted by the provider but not recorded: the worker sends it again (at least once, see the header).
    console.error(`Correo ${id}: enviado, pero no se pudo registrar.`);
  }
  return 'ENVIADO';
}

async function recordFailure(db: Pool, id: number, e: unknown): Promise<MailState> {
  const code = e instanceof MailError ? e.code : 'ERROR';
  const permanent = e instanceof MailError ? e.permanent : false;
  console.error(`Correo ${id}: no enviado (${code}).`);
  try {
    const [row]: { intentos: number }[] = await db.query(
      'SELECT intentos FROM correo_saliente WHERE id = ?',
      [id],
    );
    const attempts = Number(row?.intentos ?? 0) + 1;
    const state: MailState = permanent || attempts >= MAX_MAIL_ATTEMPTS ? 'FALLIDO' : 'PENDIENTE';
    await db.query(
      `UPDATE correo_saliente SET estado = ?, intentos = ?, ultimo_error = ?, proximo_intento = ?, cerrado_en = ?,
              bloqueado_hasta = NULL
        WHERE id = ?`,
      [
        state,
        attempts,
        code,
        localDateTime(Date.now() + backoffMs(attempts)),
        state === 'FALLIDO' ? localDateTime() : null,
        id,
      ],
    );
    return state;
  } catch {
    console.error(`Correo ${id}: no se pudo registrar el fallo.`);
    return 'PENDIENTE';
  }
}

interface QueuedMail {
  id: number;
  usuario_id: number;
  token_id: number | null;
  finalidad: string;
  destinatario: string;
  asunto: string;
  vence_en: string;
}

/** Sends what is due: pending retries and rows a crashed process left behind. Returns how many it handled. */
export async function processMailQueue(db: Pool, mailer: Mailer, limit = 5): Promise<number> {
  const now = localDateTime();
  const due: QueuedMail[] = await transaction(db, async (tx) => {
    const rows: QueuedMail[] = await tx.query(
      `SELECT id, usuario_id, token_id, finalidad, destinatario, asunto, vence_en FROM correo_saliente
        WHERE (estado = 'PENDIENTE' AND proximo_intento <= ?) OR (estado = 'ENVIANDO' AND bloqueado_hasta <= ?)
        ORDER BY proximo_intento LIMIT ${Number(limit)} FOR UPDATE SKIP LOCKED`,
      [now, now],
    );
    if (rows.length)
      await tx.query(
        "UPDATE correo_saliente SET estado = 'ENVIANDO', bloqueado_hasta = ? WHERE id IN (?)",
        [localDateTime(Date.now() + LEASE_MS), rows.map((r) => r.id)],
      );
    return rows;
  });
  for (const row of due) {
    try {
      const issued = await reissue(db, row);
      if (issued)
        await deliverMail(
          db,
          mailer,
          row.id,
          row.destinatario,
          row.asunto,
          accessMailText(row.finalidad, issued),
        );
    } catch (e) {
      // The lease expires and the row comes back.
      console.error(
        `Correo ${row.id}: reintento fallido (${(e as { code?: string }).code ?? 'ERROR'}).`,
      );
    }
  }
  return due.length;
}

/** A fresh token for a retry, or null if the message no longer makes sense (then the row is closed with the reason). */
async function reissue(db: Pool, row: QueuedMail): Promise<string | null> {
  const close = (tx: PoolConnection, reason: string) =>
    tx.query(
      "UPDATE correo_saliente SET estado = 'FALLIDO', ultimo_error = ?, cerrado_en = ?, bloqueado_hasta = NULL WHERE id = ?",
      [reason, localDateTime(), row.id],
    );
  return transaction(db, async (tx) => {
    // Lock order usuarios → tokens_recuperacion, the same as the password endpoints (R1/R2).
    const [user]: { activo: number; email: string }[] = await tx.query(
      'SELECT activo, email FROM usuarios WHERE id = ? FOR UPDATE',
      [row.usuario_id],
    );
    const now = localDateTime();
    if (row.vence_en <= now) {
      await close(tx, 'VENCIDO');
      return null;
    }
    if (!user?.activo) {
      await close(tx, 'CUENTA_INACTIVA');
      return null;
    }
    // An access link only ever goes to the account's current address (audit IND-01).
    if (user.email !== row.destinatario) {
      await close(tx, 'CORREO_CAMBIADO');
      return null;
    }
    const [current]: { usado_en: string | null }[] = await tx.query(
      'SELECT usado_en FROM tokens_recuperacion WHERE id = ? FOR UPDATE',
      [row.token_id],
    );
    // Used, or revoked by a newer request: this message is out of date.
    if (!current || current.usado_en) {
      await close(tx, 'TOKEN_YA_USADO');
      return null;
    }
    await tx.query('UPDATE tokens_recuperacion SET usado_en = ? WHERE id = ?', [now, row.token_id]);
    const token = randomBytes(32).toString('base64url');
    const { insertId } = await tx.query(
      `INSERT INTO tokens_recuperacion (usuario_id, finalidad, token_hash, creado_en, expira_en)
       VALUES (?, ?, ?, ?, ?)`,
      [
        row.usuario_id,
        row.finalidad,
        sha256(token),
        now,
        localDateTime(Date.now() + minutesOf(row.finalidad) * 60_000),
      ],
    );
    await tx.query('UPDATE correo_saliente SET token_id = ? WHERE id = ?', [
      Number(insertId),
      row.id,
    ]);
    return token;
  });
}

/**
 * Retention (N-06). The address is only needed while a message may be sent, and for a while after to answer «did it go
 * out?»: an access link lasts 24 h at most, and what happened to an account is in `auditoria`. 30 days by default, not a
 * legal term: change it with CORREO_RETENCION_DIAS once the school defines its policy (F5-25).
 *
 * A message is closed when sent or failed for good. PENDIENTE (with its retries) and ENVIANDO under a live lease are never
 * touched. One whose link expired long ago and that nobody processed (no worker running) can't be sent any more: it is closed
 * as ABANDONADO and follows the same path. Past the retention the row loses all that identifies a person; its metadata
 * (state, purpose, attempts, error code, dates) is kept a year for statistics, then the row goes.
 *
 * Small batches, each its own transaction with SKIP LOCKED: it never waits for a row in use, never holds locks long, and an
 * interruption leaves finished batches done and the rest for the next run. Running it twice changes nothing. Note that
 * backups keep the addresses for as long as they are kept.
 */
export const MAIL_RETENTION_DAYS = 30;
const MAIL_METADATA_DAYS = 365;
const ABANDON_GRACE_DAYS = 7;

export function mailRetentionFrom(env: Record<string, string | undefined>): number {
  const raw = env['CORREO_RETENCION_DIAS']?.trim();
  if (!raw) return MAIL_RETENTION_DAYS;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > MAIL_METADATA_DAYS)
    throw new Error(
      `CORREO_RETENCION_DIAS: «${raw}» no es un entero entre 1 y ${MAIL_METADATA_DAYS}.`,
    );
  return days;
}

export interface PurgeResult {
  abandoned: number;
  anonymized: number;
  deleted: number;
  /** The run stopped at its limit: there is more for the next one. */
  more: boolean;
}

export async function purgeMailOutbox(
  db: Pool,
  options: { retentionDays?: number; batch?: number; maxBatches?: number } = {},
): Promise<PurgeResult> {
  const days = options.retentionDays ?? MAIL_RETENTION_DAYS;
  const batch = options.batch ?? 500;
  const maxBatches = options.maxBatches ?? 20;
  const ago = (d: number) => localDateTime(Date.now() - d * 86_400_000);
  const now = localDateTime();
  /** Claims a batch and applies `change`, in one short transaction. How many rows it took. */
  const inBatches = async (
    hint: string,
    select: string,
    params: unknown[],
    change: (tx: PoolConnection, ids: number[]) => Promise<unknown>,
  ): Promise<[number, boolean]> => {
    let total = 0;
    for (let i = 0; i < maxBatches; i++) {
      const n = await transaction(db, async (tx) => {
        const rows: { id: number }[] = await tx.query(
          `SELECT id FROM correo_saliente ${hint} WHERE ${select} LIMIT ${Number(batch)} FOR UPDATE SKIP LOCKED`,
          params,
        );
        if (rows.length)
          await change(
            tx,
            rows.map((r) => Number(r.id)),
          );
        return rows.length;
      });
      total += n;
      if (n < batch) return [total, false];
    }
    return [total, true];
  };
  // The optimizer may prefer a full scan while few rows exist; on a table that has grown that would lock and read it all.
  const retentionIndex = 'FORCE INDEX (ix_correo_saliente_anonimizado)';
  const [abandoned, moreA] = await inBatches(
    '',
    `estado IN ('PENDIENTE', 'ENVIANDO') AND vence_en <= ? AND (estado = 'PENDIENTE' OR bloqueado_hasta <= ?)`,
    [ago(ABANDON_GRACE_DAYS), now],
    (tx, ids) =>
      tx.query(
        `UPDATE correo_saliente SET estado = 'FALLIDO', ultimo_error = 'ABANDONADO', cerrado_en = ?, bloqueado_hasta = NULL
          WHERE id IN (?)`,
        [now, ids],
      ),
  );
  const [anonymized, moreB] = await inBatches(
    retentionIndex,
    `estado IN ('ENVIADO', 'FALLIDO') AND cerrado_en <= ? AND anonimizado_en IS NULL`,
    [ago(days)],
    (tx, ids) =>
      tx.query(
        `UPDATE correo_saliente
            SET destinatario = NULL, usuario_id = NULL, token_id = NULL, proveedor_id = NULL, anonimizado_en = ?
          WHERE id IN (?)`,
        [now, ids],
      ),
  );
  const [deleted, moreC] = await inBatches(
    retentionIndex,
    `anonimizado_en IS NOT NULL AND cerrado_en <= ?`,
    [ago(MAIL_METADATA_DAYS)],
    (tx, ids) => tx.query('DELETE FROM correo_saliente WHERE id IN (?)', [ids]),
  );
  return { abandoned, anonymized, deleted, more: moreA || moreB || moreC };
}

/** Applies the retention at the start and every hour, with or without a mail provider. `unref`: never keeps the process alive. */
export function startMailRetention(db: Pool, days: number, everyMs = 3_600_000): () => void {
  const run = () =>
    purgeMailOutbox(db, { retentionDays: days })
      .then((r) => {
        if (r.abandoned || r.anonymized || r.deleted)
          console.log(
            `Retención de correo: ${r.abandoned} abandonados, ${r.anonymized} anonimizados, ${r.deleted} borrados.`,
          );
      })
      .catch((e: { code?: string }) => console.error(`Retención de correo: ${e.code ?? 'ERROR'}.`));
  void run();
  const timer = setInterval(() => void run(), everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

/** Runs the queue while the process lives. One pass at a time; `unref` so it never keeps the process alive. */
export function startMailWorker(db: Pool, mailer: Mailer, everyMs = 60_000): () => void {
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    processMailQueue(db, mailer)
      .catch((e: { code?: string }) => console.error(`Cola de correo: ${e.code ?? 'ERROR'}.`))
      .finally(() => {
        busy = false;
      });
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

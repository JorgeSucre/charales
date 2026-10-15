/**
 * `npm run db:admin` — creates an ADMINISTRADOR account in DB_NAME with a password you type (never stored in the repo
 * nor shown). Refuses an e-mail that already exists: it never resets anyone's password (use «¿Olvidaste tu contraseña?»
 * for that). Non-interactive use (scripts, tests): CHARALES_ADMIN_EMAIL, CHARALES_ADMIN_NAME, CHARALES_ADMIN_PASSWORD.
 */
import { createInterface } from 'node:readline';
import type { Pool } from 'mariadb';
import { hashPassword, localDateTime } from './auth.ts';
import { passwordProblem } from './password.ts';
import { createPool } from './server.ts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createAdmin(
  db: Pool,
  input: { email: string; firstName: string; lastName: string | null; password: string },
): Promise<number> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 150) throw new Error('Correo inválido.');
  const firstName = input.firstName.trim();
  if (!firstName || firstName.length > 100)
    throw new Error('El nombre es obligatorio (máx. 100 caracteres).');
  const problem = passwordProblem(input.password);
  if (problem) throw new Error(problem);
  const hash = await hashPassword(input.password);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [taken] = await conn.query('SELECT id FROM usuarios WHERE email = ? FOR UPDATE', [email]);
    if (taken)
      throw new Error(
        `Ya existe una cuenta con ${email}. No se cambió nada: para otra contraseña usa «¿Olvidaste tu contraseña?».`,
      );
    const [role] = await conn.query(
      "SELECT id FROM roles WHERE nombre = 'ADMINISTRADOR' AND tipo = 'SEGURIDAD'",
    );
    if (!role) throw new Error('Falta el rol ADMINISTRADOR: ejecuta primero npm run db:setup.');
    const now = localDateTime();
    const { insertId } = await conn.query(
      `INSERT INTO usuarios (rol_id, rol_tipo, nombre, apellido, email, password_hash, activo, creado_en, actualizado_en)
       VALUES (?, 'SEGURIDAD', ?, ?, ?, ?, TRUE, ?, ?)`,
      [role.id, firstName, input.lastName?.trim() || null, email, hash, now, now],
    );
    await conn.query(
      `INSERT INTO auditoria (usuario_id, accion, modulo, entidad, entidad_id, descripcion, creado_en)
       VALUES (NULL, 'CREAR', 'usuarios', 'usuarios', ?, ?, ?)`,
      [insertId, `Alta de administrador ${email} (npm run db:admin)`, now],
    );
    await conn.query('UPDATE version_datos SET version = version + 1 WHERE id = 1');
    await conn.commit();
    return Number(insertId);
  } catch (e) {
    await conn.rollback().catch(() => undefined);
    throw e;
  } finally {
    conn.release();
  }
}

/** Reads a line; with `hidden`, nothing is echoed (passwords). */
function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden)
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (s.startsWith(question)) process.stdout.write(question);
    };
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    }),
  );
}

if (import.meta.main) {
  const env = process.env;
  const db = createPool(env);
  try {
    const email = env['CHARALES_ADMIN_EMAIL'] ?? (await ask('Correo del administrador: '));
    const name = env['CHARALES_ADMIN_NAME'] ?? (await ask('Nombre: '));
    let password = env['CHARALES_ADMIN_PASSWORD'];
    if (!password) {
      password = await ask('Contraseña (8+ caracteres, letras y números): ', true);
      if ((await ask('Repite la contraseña: ', true)) !== password)
        throw new Error('Las contraseñas no coinciden.');
    }
    const [firstName, ...rest] = name.trim().split(/\s+/);
    const id = await createAdmin(db, {
      email,
      firstName: firstName ?? '',
      lastName: rest.join(' ') || null,
      password,
    });
    console.log(
      `Administrador creado (id ${id}). Inicia sesión en la app con ${email.trim().toLowerCase()}.`,
    );
  } catch (e) {
    console.error(`Error: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

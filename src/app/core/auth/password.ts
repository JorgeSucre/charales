/**
 * Password and token helpers for the MOCK backend (HU-005, HU-072). Passwords are never stored or compared in plain
 * text, even here. ponytail: salted SHA-256 via WebCrypto is enough for a mock; the real API must hash with
 * argon2id/bcrypt server-side and the browser must never see a hash.
 */

const encoder = new TextEncoder();

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 16): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 'sha256$<salt>$<hex>' */
export async function hashPassword(password: string, salt = randomToken(8)): Promise<string> {
  return `sha256$${salt}$${await sha256Hex(`${salt}:${password}`)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, hash] = stored.split('$');
  return algo === 'sha256' && (await sha256Hex(`${salt}:${password}`)) === hash;
}

/** Password policy (HU-005): 8+ characters with at least one letter and one digit. Returns the problem or null. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (!/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password))
    return 'La contraseña debe incluir letras y números.';
  return null;
}

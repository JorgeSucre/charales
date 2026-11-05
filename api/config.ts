/**
 * What the API checks about its environment before it starts. In production a wrong setting stops the start: each of
 * these failed silently before (a cookie without Secure, every client sharing the proxy's attempt limit, links over
 * plain HTTP). Outside production they only warn.
 */
import { trustedProxies, trustedProxiesFromEnv } from './client-ip.ts';
import { mailRetentionFrom } from './mail.ts';

export interface EnvironmentReport {
  errors: string[];
  warnings: string[];
}

export const isProduction = (env: Record<string, string | undefined>) =>
  env['NODE_ENV'] === 'production';

export function checkEnvironment(env: Record<string, string | undefined>): EnvironmentReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const production = isProduction(env);
  // A bad list always stops the start, whatever the environment.
  try {
    trustedProxies(trustedProxiesFromEnv(env['TRUSTED_PROXIES']));
  } catch (e) {
    errors.push((e as Error).message);
  }
  try {
    mailRetentionFrom(env);
  } catch (e) {
    errors.push((e as Error).message);
  }
  // Anything else (a typo, a value with a comment stuck to it) would silently switch off every check below (audit IND-04).
  const mode = env['NODE_ENV'];
  if (mode && !['production', 'development', 'test'].includes(mode))
    errors.push(`NODE_ENV: «${mode}» no es production, development ni test.`);
  if (!production) {
    if (env['COOKIE_SECURE'] !== 'true')
      warnings.push(
        'Modo desarrollo: la cookie de sesión no lleva Secure. En un servidor usa NODE_ENV=production.',
      );
    return { errors, warnings };
  }
  if (!env['TRUSTED_PROXIES']?.trim())
    errors.push(
      'TRUSTED_PROXIES es obligatorio en producción: las IP o rangos del proxy inverso, o «none» si no hay proxy. ' +
        'Vacío, todos los clientes detrás de un proxy comparten un solo límite de intentos.',
    );
  if (env['TRUSTED_PROXIES']?.trim().toLowerCase() === 'none')
    warnings.push(
      'TRUSTED_PROXIES=none: se cuenta la IP de la conexión. Correcto sólo si ningún proxy atiende a la API.',
    );
  if (env['COOKIE_SECURE'] === 'false')
    errors.push('COOKIE_SECURE=false contradice NODE_ENV=production: quítalo.');
  if (!/^https:\/\/[^/\s]+/.test(env['APP_URL'] ?? ''))
    errors.push(
      'APP_URL debe ser la dirección https:// de la aplicación (enlaces de los correos).',
    );
  if (env['MAIL_CONSOLE'] === 'true')
    errors.push(
      'MAIL_CONSOLE=true imprime enlaces de acceso en el log: no se admite en producción.',
    );
  const provider = env['MAIL_PROVIDER']?.trim().toLowerCase();
  if (provider === 'resend') {
    if (!env['RESEND_API_KEY']?.trim())
      errors.push('MAIL_PROVIDER=resend requiere RESEND_API_KEY.');
    if (!env['MAIL_FROM']?.trim()) errors.push('MAIL_PROVIDER=resend requiere MAIL_FROM.');
  } else if (provider === 'none')
    warnings.push(
      'MAIL_PROVIDER=none: las invitaciones y la recuperación de contraseña responderán 503.',
    );
  else errors.push('MAIL_PROVIDER es obligatorio en producción: «resend» o «none».');
  return { errors, warnings };
}

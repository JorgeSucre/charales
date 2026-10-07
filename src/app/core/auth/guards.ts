import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { PermissionKey } from './permissions';

/**
 * Requires a valid (not expired) session; with a permission, also requires it. Direct URLs are covered too
 * (HU-002.3). The API repeats every check — the guard only protects the UI.
 */
export function requirePermission(permission?: PermissionKey): CanActivateFn {
  return (_route, state) => {
    const auth = inject(AuthService);
    const router = inject(Router);
    const hadSession = auth.isLoggedIn();
    if (!auth.checkSession()) {
      const queryParams: Record<string, string> = { returnUrl: state.url };
      if (hadSession) queryParams['expired'] = '1';
      return router.createUrlTree(['/login'], { queryParams });
    }
    if (permission && !auth.can(permission)) return router.createUrlTree(['/forbidden']);
    return true;
  };
}

/** Keeps logged-in users out of the login page. */
export const guestOnly: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? inject(Router).parseUrl(auth.homeUrl()) : true;
};

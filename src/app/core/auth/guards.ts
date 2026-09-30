import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { Permission } from './permissions';

/** Requires a session; with a permission, also requires that permission. */
export function requirePermission(permission?: Permission): CanActivateFn {
  return (_route, state) => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (!auth.isLoggedIn())
      return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
    if (permission && !auth.can(permission)) return router.createUrlTree(['/forbidden']);
    return true;
  };
}

/** Keeps logged-in users out of the login page. */
export const guestOnly: CanActivateFn = () =>
  inject(AuthService).isLoggedIn() ? inject(Router).parseUrl('/') : true;

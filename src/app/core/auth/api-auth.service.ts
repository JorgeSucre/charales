import { Injectable, computed, inject } from '@angular/core';
import { ApiError, CharalesApi } from '../api/charales-api.service';
import { PermissionKey } from './permissions';
import { AuthUser, SessionStore, grants, homeUrlOf } from './session.store';

/**
 * Authentication of the app against the real API (HU-001..003, HU-005, HU-072; docs/API.md): argon2id and the
 * session live on the server; the browser only holds the HttpOnly cookie (never readable here) and a copy of the
 * AuthUser for menus and guards. Provided as `AuthService` in app.config.ts, so pages and guards don't change.
 */
@Injectable({ providedIn: 'root' })
export class ApiAuthService {
  private api = inject(CharalesApi);
  private store = inject(SessionStore);

  readonly user = this.store.user;
  readonly isLoggedIn = computed(() => this.store.user() !== null);

  /** Same rule as the services (`grants`), so routes and menus never promise what the API refuses. */
  can(permission: PermissionKey): boolean {
    return grants(this.store.user(), permission);
  }

  hasRole(role: string): boolean {
    return !!this.store.user()?.roles.includes(role);
  }

  homeUrl(): string {
    return homeUrlOf(this.store.user());
  }

  async login(email: string, password: string): Promise<AuthUser> {
    const user = await this.api.login(email.trim(), password);
    this.store.set({ user, token: '' });
    return user;
  }

  /** Clears the local copy at once; the API closes and audits the session (best effort). */
  logout(): void {
    this.store.set(null);
    this.api.logout().catch(() => undefined);
  }

  /**
   * Guards call this on every protected navigation: the API validates the cookie (8 h, 30 min idle, account still
   * active, HU-002.4), renews its use and returns the AuthUser with its current permissions. A valid cookie also
   * restores the session in a new tab.
   */
  async checkSession(): Promise<boolean> {
    try {
      const user = await this.api.session();
      this.store.set(user ? { user, token: '' } : null);
      return !!user;
    } catch (e) {
      if (e instanceof ApiError) {
        this.store.set(null);
        return false;
      }
      throw e;
    }
  }

  /** HU-005: requires the current password; the API applies the policy and closes the other sessions (D2). */
  changePassword(current: string, next: string): Promise<void> {
    return this.api.changePassword(current, next);
  }

  /** HU-005: same answer whether the account exists or not (D7). */
  requestPasswordReset(email: string): Promise<void> {
    return this.api.requestPasswordReset(email.trim());
  }

  /** HU-005 / initial access: a valid single-use token sets the password; the API closes every session. */
  async resetPassword(token: string, next: string): Promise<void> {
    await this.api.confirmPasswordReset(token, next);
    this.store.set(null);
  }
}

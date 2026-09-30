import { Injectable, computed, inject, signal } from '@angular/core';
import { MockDb } from '../data/mock-db';
import { User } from '../models';
import { Permission, roleCan } from './permissions';

const SESSION_KEY = 'charales.session';

/**
 * MOCK authentication. It does NOT verify passwords — that is the backend's job (HU-072:
 * hashing with bcrypt/argon2, rate limiting, HTTPS). Replace login/requestPasswordReset/changePassword
 * with API calls; the backend should return a token (ideally an HttpOnly cookie) and the user profile.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private db = inject(MockDb);
  private readonly current = signal<User | null>(this.restore());

  readonly user = this.current.asReadonly();
  readonly isLoggedIn = computed(() => this.current() !== null);

  can(permission: Permission): boolean {
    const user = this.current();
    return !!user && roleCan(user.role, permission);
  }

  async login(email: string, password: string): Promise<User> {
    const user = this.db.users.find((u) => u.email === email.trim().toLowerCase() && u.active);
    // Mock: any non-empty password is accepted for demo users.
    if (!user || !password) throw new Error('Correo o contraseña incorrectos.');
    this.current.set(user);
    this.persist(user.id);
    return this.db.respond(user);
  }

  logout(): void {
    this.current.set(null);
    this.persist(null);
  }

  /** Always resolves, so the UI doesn't reveal whether an account exists. */
  async requestPasswordReset(_email: string): Promise<void> {
    await this.db.respond(null);
  }

  async changePassword(current: string, next: string): Promise<void> {
    if (!this.current()) throw new Error('Sesión no iniciada.');
    if (current === next) throw new Error('La nueva contraseña debe ser distinta a la actual.');
    await this.db.respond(null);
  }

  private persist(userId: string | null): void {
    try {
      if (userId) sessionStorage.setItem(SESSION_KEY, userId);
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* storage unavailable: session just won't survive reload */
    }
  }

  private restore(): User | null {
    try {
      const id = sessionStorage.getItem(SESSION_KEY);
      return this.db.users.find((u) => u.id === id && u.active) ?? null;
    } catch {
      return null;
    }
  }
}

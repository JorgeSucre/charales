import { Injectable, inject } from '@angular/core';
import { MockDb } from '../../core/data/mock-db';
import { User } from '../../core/models';

export type UserDraft = Omit<User, 'id' | 'active'> & { id?: string };

@Injectable({ providedIn: 'root' })
export class UserService {
  private db = inject(MockDb);

  list(): Promise<User[]> {
    return this.db.respond(this.db.users);
  }

  /** Creates or updates. The backend will send the invite / temporary-password email; no password is set here. */
  async save(draft: UserDraft): Promise<User> {
    const email = draft.email.trim().toLowerCase();
    if (this.db.users.some((u) => u.email === email && u.id !== draft.id)) {
      throw new Error('Ya existe un usuario con ese correo.');
    }
    const existing = this.db.users.find((u) => u.id === draft.id);
    const user: User = {
      ...draft,
      email,
      id: existing?.id ?? this.db.id('u'),
      active: existing?.active ?? true,
    };
    this.db.users = existing
      ? this.db.users.map((u) => (u.id === user.id ? user : u))
      : [...this.db.users, user];
    return this.db.respond(user);
  }

  async setActive(id: string, active: boolean): Promise<void> {
    this.db.users = this.db.users.map((u) => (u.id === id ? { ...u, active } : u));
    await this.db.respond(null);
  }
}

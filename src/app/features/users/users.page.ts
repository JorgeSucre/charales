import { Component, inject, resource, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ROLE_LABELS } from '../../core/auth/permissions';
import { Role, User } from '../../core/models';
import { FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { Submission } from '../../shared/submission';
import { UserService } from './user.service';

/** HU-004: create, edit, activate/deactivate users. */
@Component({
  selector: 'app-users-page',
  imports: [ReactiveFormsModule, FieldError, LoadState],
  template: `
    <h1>Usuarios</h1>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="grid-form">
      <h2>{{ editingId() ? 'Editar usuario' : 'Nuevo usuario' }}</h2>
      <label>Nombre <input formControlName="fullName" /></label>
      <app-field-error [control]="form.controls.fullName" />
      <label>Correo <input type="email" formControlName="email" /></label>
      <app-field-error [control]="form.controls.email" />
      <label
        >Rol
        <select formControlName="role">
          @for (r of roles; track r[0]) {
            <option [value]="r[0]">{{ r[1] }}</option>
          }
        </select>
      </label>
      @if (submission.result(); as r) {
        <p class="alert" [class.ok]="r.ok" [class.error]="!r.ok" role="status">{{ r.text }}</p>
      }
      <div class="actions">
        <button type="submit" [disabled]="submission.busy()">Guardar</button>
        @if (editingId()) {
          <button type="button" class="secondary" (click)="cancel()">Cancelar</button>
        }
      </div>
    </form>

    <app-load-state [res]="users" [empty]="!users.value()?.length">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Rol</th>
              <th>Estado</th>
              <th><span class="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            @for (u of users.value() ?? []; track u.id) {
              <tr>
                <td>{{ u.fullName }}</td>
                <td>{{ u.email }}</td>
                <td>{{ roleLabels[u.role] }}</td>
                <td>
                  <span class="tag" [class.off]="!u.active">{{
                    u.active ? 'Activo' : 'Inactivo'
                  }}</span>
                </td>
                <td class="row-actions">
                  <button type="button" class="link" (click)="edit(u)">Editar</button>
                  <button type="button" class="link" (click)="toggle(u)">
                    {{ u.active ? 'Desactivar' : 'Activar' }}
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </app-load-state>
  `,
})
export class UsersPage {
  private service = inject(UserService);
  protected roleLabels = ROLE_LABELS;
  protected roles = Object.entries(ROLE_LABELS) as [Role, string][];
  protected users = resource({ loader: () => this.service.list() });
  protected submission = new Submission();
  protected editingId = signal<string | null>(null);
  protected form = inject(FormBuilder).nonNullable.group({
    fullName: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    role: ['secretary' as Role, Validators.required],
  });

  edit(user: User): void {
    this.editingId.set(user.id);
    this.form.setValue({ fullName: user.fullName, email: user.email, role: user.role });
  }

  cancel(): void {
    this.editingId.set(null);
    this.form.reset();
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    const draft = { ...this.form.getRawValue(), id: this.editingId() ?? undefined };
    if (await this.submission.run(() => this.service.save(draft), 'Usuario guardado.')) {
      this.cancel();
      this.users.reload();
    }
  }

  async toggle(user: User): Promise<void> {
    if (user.active && !confirm(`¿Desactivar a ${user.fullName}? No podrá iniciar sesión.`)) return;
    await this.submission.run(
      () => this.service.setActive(user.id, !user.active),
      'Estado actualizado.',
    );
    this.users.reload();
  }
}

import { Component, computed, inject, resource, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../core/auth/auth.service';
import { ROLE_LABELS } from '../../core/auth/permissions';
import { Id, Permission } from '../../core/models';
import { AuditService } from '../../core/services/audit.service';
import { FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { Submission } from '../../shared/submission';
import { Paginator, SubmissionAlert, idOrNull } from '../../shared/ui';
import { RoleService } from './role.service';
import { UserService, UserView } from './user.service';

/** HU-004: staff accounts (security role) — create, edit, activate/deactivate; tutor/coach accounts come from their profile. */
@Component({
  selector: 'app-users-page',
  imports: [ReactiveFormsModule, FormsModule, FieldError, LoadState, SubmissionAlert, DatePipe],
  template: `
    <h1>Usuarios</h1>
    @if (auth.can('usuarios.crear') || editingId()) {
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="grid-form">
        <h2>{{ editingId() ? 'Editar cuenta de personal' : 'Nueva cuenta de personal' }}</h2>
        <p class="muted">
          Las cuentas de tutores y entrenadores se crean al vincular su perfil (Tutores /
          Entrenadores). La persona recibe un enlace para definir su contraseña; aquí nunca se
          captura.
        </p>
        <label>Nombre <input formControlName="firstName" autocomplete="off" /></label>
        <app-field-error [control]="form.controls.firstName" />
        <label>Apellido <input formControlName="lastName" autocomplete="off" /></label>
        <label>Correo <input type="email" formControlName="email" autocomplete="off" /></label>
        <app-field-error [control]="form.controls.email" />
        <label
          >Rol
          <select formControlName="roleId">
            @for (r of roles.value() ?? []; track r.id) {
              <option [ngValue]="r.id">{{ label(r.name) }}</option>
            }
          </select>
        </label>
        <app-field-error [control]="form.controls.roleId" />
        <app-submission-alert [submission]="submission" />
        <div class="actions">
          <button type="submit" [disabled]="submission.busy()">Guardar</button>
          @if (editingId()) {
            <button type="button" class="secondary" (click)="cancel()">Cancelar</button>
          }
        </div>
      </form>
    }

    <div class="filters">
      <label
        >Buscar <input type="search" [ngModel]="query()" (ngModelChange)="query.set($event)"
      /></label>
      <label
        >Estado
        <select [ngModel]="active()" (ngModelChange)="active.set($event)">
          <option value="">Todos</option>
          <option value="1">Activos</option>
          <option value="0">Inactivos</option>
        </select>
      </label>
    </div>
    <app-load-state [res]="users"
      ><ng-template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Rol / perfiles</th>
                <th>Último acceso</th>
                <th>Estado</th>
                <th><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (u of users.value() ?? []; track u.id) {
                <tr>
                  <td>{{ u.displayName }}</td>
                  <td>{{ u.email }}</td>
                  <td>{{ roleText(u) }}</td>
                  <td>{{ u.lastAccess ? (u.lastAccess | date: 'd MMM y, HH:mm') : '—' }}</td>
                  <td>
                    <span class="tag" [class.off]="!u.active">{{
                      u.active ? 'Activo' : 'Inactivo'
                    }}</span>
                  </td>
                  <td class="row-actions">
                    @if (u.roleId && auth.can('usuarios.editar')) {
                      <button type="button" class="link" (click)="edit(u)">Editar</button>
                    }
                    @if (auth.can('usuarios.cancelar')) {
                      <button
                        type="button"
                        class="link"
                        [class.danger]="u.active"
                        (click)="toggle(u)"
                      >
                        {{ u.active ? 'Desactivar' : 'Activar' }}
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </ng-template></app-load-state
    >
  `,
})
export class UsersPage {
  private service = inject(UserService);
  protected auth = inject(AuthService);
  protected query = signal('');
  protected active = signal('');
  protected users = resource({
    params: () => ({
      query: this.query(),
      active: this.active() === '' ? undefined : this.active() === '1',
    }),
    loader: ({ params }) => this.service.list(params),
  });
  protected roles = resource({ loader: () => this.service.securityRoles() });
  protected submission = new Submission();
  protected editingId = signal<Id | null>(null);
  protected form = inject(FormBuilder).nonNullable.group({
    firstName: ['', Validators.required],
    lastName: [''],
    email: ['', [Validators.required, Validators.email]],
    roleId: [2 as Id, Validators.required],
  });

  label(name: string): string {
    return ROLE_LABELS[name] ?? name;
  }

  roleText(u: UserView): string {
    return [u.roleName ? this.label(u.roleName) : null, ...u.profiles]
      .filter((x) => !!x)
      .join(' · ');
  }

  edit(u: UserView): void {
    this.editingId.set(u.id);
    this.form.setValue({
      firstName: u.firstName ?? '',
      lastName: u.lastName ?? '',
      email: u.email,
      roleId: u.roleId!,
    });
  }

  cancel(): void {
    this.editingId.set(null);
    this.form.reset();
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    const draft = { ...this.form.getRawValue(), id: this.editingId() ?? undefined };
    const ok = await this.submission.run(
      () => this.service.save(draft),
      (u) =>
        draft.id
          ? 'Usuario actualizado.'
          : `Cuenta creada. Se envió a ${u.email} el enlace para definir su contraseña.`,
    );
    if (ok) {
      this.cancel();
      this.users.reload();
    }
  }

  async toggle(u: UserView): Promise<void> {
    if (
      u.active &&
      !confirm(
        `¿Desactivar a ${u.displayName}? No podrá iniciar sesión y se cerrarán sus sesiones.`,
      )
    )
      return;
    await this.submission.run(() => this.service.setActive(u.id, !u.active), 'Estado actualizado.');
    this.users.reload();
  }
}

/** HU-006: permission matrix by role. Changes apply to sessions started afterwards; every change is audited. */
@Component({
  selector: 'app-permissions-page',
  imports: [LoadState, SubmissionAlert],
  template: `
    <h1>Permisos por rol</h1>
    <p class="muted">
      Los cambios aplican a las sesiones que se inicien después. Los permisos marcados con 🔒 no se
      pueden retirar para que ningún rol base se quede sin acceso.
    </p>
    <app-submission-alert [submission]="submission" />
    <app-load-state [res]="matrix"
      ><ng-template>
        @if (matrix.value(); as m) {
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Módulo</th>
                  <th>Acción</th>
                  @for (r of m.roles; track r.id) {
                    <th>{{ label(r.name) }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (p of m.permissions; track p.id) {
                  <tr>
                    <td>{{ p.module }}</td>
                    <td>{{ p.action }}</td>
                    @for (r of m.roles; track r.id) {
                      <td>
                        <label class="check">
                          <input
                            type="checkbox"
                            [checked]="granted().has(r.id + ':' + p.id)"
                            [disabled]="!canEdit || submission.busy()"
                            (change)="set(r.id, p, $any($event.target).checked)"
                          />
                          <span class="sr-only"
                            >{{ label(r.name) }} {{ p.module }}.{{ p.action }}</span
                          >
                        </label>
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </ng-template></app-load-state
    >
  `,
})
export class PermissionsPage {
  private service = inject(RoleService);
  protected canEdit = inject(AuthService).can('roles.editar');
  protected matrix = resource({ loader: () => this.service.matrix() });
  protected granted = computed(() => new Set(this.matrix.value()?.granted ?? []));
  protected submission = new Submission();

  label(name: string): string {
    return ROLE_LABELS[name] ?? name;
  }

  async set(roleId: Id, p: Permission, granted: boolean): Promise<void> {
    await this.submission.run(
      () => this.service.setPermission(roleId, p.id, granted),
      `${granted ? 'Otorgado' : 'Retirado'} ${p.module}.${p.action}. Aplica en nuevas sesiones.`,
    );
    this.matrix.reload();
  }
}

/** HU-007: read-only audit log, filterable by user, module and dates. */
@Component({
  selector: 'app-audit-page',
  imports: [FormsModule, LoadState, DatePipe, Paginator],
  template: `
    <h1>Bitácora de auditoría</h1>
    <div class="filters">
      <label
        >Usuario
        <select [ngModel]="userId()" (ngModelChange)="userId.set(idOrNull($event)); page.set(1)">
          <option [ngValue]="null">Todos</option>
          @for (u of users.value() ?? []; track u.id) {
            <option [ngValue]="u.id">{{ u.email }}</option>
          }
        </select>
      </label>
      <label
        >Módulo
        <select [ngModel]="module()" (ngModelChange)="module.set($event); page.set(1)">
          <option value="">Todos</option>
          @for (m of modules.value() ?? []; track m) {
            <option [value]="m">{{ m }}</option>
          }
        </select>
      </label>
      <label
        >Desde
        <input type="date" [ngModel]="from()" (ngModelChange)="from.set($event); page.set(1)"
      /></label>
      <label
        >Hasta <input type="date" [ngModel]="to()" (ngModelChange)="to.set($event); page.set(1)"
      /></label>
    </div>
    <app-load-state [res]="entries" emptyText="Sin registros."
      ><ng-template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha y hora</th>
                <th>Usuario</th>
                <th>Acción</th>
                <th>Módulo</th>
                <th>Entidad</th>
                <th>Descripción</th>
              </tr>
            </thead>
            <tbody>
              @for (e of entries.value()?.items ?? []; track e.id) {
                <tr>
                  <td>{{ e.createdAt | date: 'd MMM y, HH:mm:ss' }}</td>
                  <td>{{ e.userEmail }}</td>
                  <td>{{ e.action }}</td>
                  <td>{{ e.module }}</td>
                  <td>{{ e.entity }}{{ e.entityId ? ' #' + e.entityId : '' }}</td>
                  <td class="wrap">{{ e.description }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <app-paginator [page]="entries.value()" (go)="page.set($event)" /> </ng-template
    ></app-load-state>
  `,
})
export class AuditPage {
  private service = inject(AuditService);
  private userService = inject(UserService);
  protected idOrNull = idOrNull;
  protected users = resource({ loader: () => this.userService.list() });
  protected modules = resource({ loader: () => this.service.modules() });
  protected userId = signal<Id | null>(null);
  protected module = signal('');
  protected from = signal('');
  protected to = signal('');
  protected page = signal(1);
  protected entries = resource({
    params: () => ({
      userId: this.userId(),
      module: this.module(),
      from: this.from(),
      to: this.to(),
      page: this.page(),
    }),
    loader: ({ params }) => this.service.list(params),
  });
}

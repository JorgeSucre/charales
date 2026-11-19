import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../core/auth/auth.service';
import { PROTECTED_PERMISSIONS, PermissionKey, ROLE_LABELS } from '../../core/auth/permissions';
import { BaseRole, Id, Permission } from '../../core/models';
import { AuditService } from '../../core/services/audit.service';
import { FormPanel } from '../../shared/form-panel';
import { focusFirstInvalid } from '../../shared/focus';
import { FieldA11y, FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { Submission } from '../../shared/submission';
import { emailValidator, personNameValidator } from '../../shared/validate';
import { Paginator, SubmissionAlert, idOrNull } from '../../shared/ui';
import { RoleService } from './role.service';
import { UserService, UserView } from './user.service';

const MODULE_LABELS: Record<string, string> = {
  usuarios: 'Usuarios y cuentas',
  roles: 'Roles y permisos',
  auditoria: 'Bitácora de auditoría',
  jugadores: 'Jugadores',
  tutores: 'Padres y tutores',
  entrenadores: 'Entrenadores',
  categorias: 'Categorías y horarios',
  temporadas: 'Temporadas',
  sedes: 'Sedes y canchas',
  inscripciones: 'Inscripciones',
  cobranza: 'Cobranza y cargos',
  descuentos: 'Descuentos y becas',
  pagos: 'Pagos y recibos',
  uniformes: 'Uniformes y pedidos',
  entrenamientos: 'Entrenamientos',
  asistencias: 'Asistencias',
  competencias: 'Competencias y ligas',
  partidos: 'Partidos y resultados',
  avisos: 'Avisos',
  reportes: 'Reportes y agenda',
  portal: 'Portal familiar',
  panel_entrenador: 'Panel de entrenador',
};

const ACTION_LABELS: Record<string, string> = {
  consultar: 'Consultar / ver',
  crear: 'Crear / registrar',
  editar: 'Editar / actualizar',
  cancelar: 'Cancelar / dar de baja',
};

const AUDIT_ACTION_TONE: Record<string, string> = {
  CREAR: 'ok',
  OTORGAR: 'ok',
  EDITAR: 'warn',
  ACTUALIZAR: 'warn',
  CANCELAR: 'danger',
  BAJA: 'danger',
  ELIMINAR: 'danger',
  RETIRAR: 'danger',
};

/** HU-004: staff accounts (security role) — create, edit, activate/deactivate; tutor/coach accounts come from their profile. */
@Component({
  selector: 'app-users-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    FieldError,
    FieldA11y,
    LoadState,
    SubmissionAlert,
    DatePipe,
  ],
  template: `
    <div class="page-head">
      <div>
        <h1>Usuarios</h1>
        <p class="page-subtitle">
          Cuentas de acceso del personal administrativo; las cuentas de tutores y entrenadores se
          vinculan desde su perfil.
        </p>
      </div>
      @if (auth.can('usuarios.crear')) {
        <button
          type="button"
          (click)="create()"
          [attr.aria-expanded]="panel.open() && !editingId()"
          aria-controls="user-form"
        >
          Nueva cuenta
        </button>
      }
    </div>
    <app-submission-alert [submission]="submission" />
    @if (panel.open()) {
      <form
        id="user-form"
        [formGroup]="form"
        (ngSubmit)="submit()"
        novalidate
        class="grid-form"
        (keydown.escape)="cancel()"
      >
        <h2>{{ editingId() ? 'Editar cuenta de personal' : 'Nueva cuenta de personal' }}</h2>
        <p class="field-hint">
          Los campos con <span class="req" aria-hidden="true">*</span> son obligatorios. La persona
          recibe un enlace para definir su contraseña; aquí nunca se captura.
        </p>
        <div class="two-col">
          <div>
            <label
              ><span
                >Nombre <span class="req" aria-hidden="true">*</span
                ><span class="sr-only"> (obligatorio)</span></span
              >
              <input formControlName="firstName" autocomplete="off"
            /></label>
            <app-field-error [control]="form.controls.firstName" />
          </div>
          <div>
            <label>Apellido <input formControlName="lastName" autocomplete="off" /></label>
            <app-field-error [control]="form.controls.lastName" />
          </div>
        </div>
        <div class="two-col">
          <div>
            <label
              ><span
                >Correo <span class="req" aria-hidden="true">*</span
                ><span class="sr-only"> (obligatorio)</span></span
              >
              <input type="email" formControlName="email" autocomplete="off"
            /></label>
            <app-field-error [control]="form.controls.email" />
          </div>
          <div>
            <label
              ><span
                >Rol <span class="req" aria-hidden="true">*</span
                ><span class="sr-only"> (obligatorio)</span></span
              >
              <select formControlName="roleId">
                @for (r of roles.value() ?? []; track r.id) {
                  <option [ngValue]="r.id">{{ label(r.name) }}</option>
                }
              </select>
            </label>
            <app-field-error [control]="form.controls.roleId" />
          </div>
        </div>
        <div class="actions">
          <button type="submit" [disabled]="submission.busy()">
            {{ submission.busy() ? 'Guardando…' : 'Guardar' }}
          </button>
          <button type="button" class="secondary" (click)="cancel()">Cancelar</button>
        </div>
      </form>
    }

    <div class="filters">
      <label class="filter-grow"
        >Buscar
        <input
          type="search"
          placeholder="Nombre o correo…"
          [ngModel]="query()"
          (ngModelChange)="query.set($event)"
      /></label>
      <label
        >Estado
        <select [ngModel]="active()" (ngModelChange)="active.set($event)">
          <option value="">Todos</option>
          <option value="1">Activos</option>
          <option value="0">Inactivos</option>
        </select>
      </label>
      @if (hasFilters()) {
        <button type="button" class="secondary sm" (click)="clearFilters()">Limpiar filtros</button>
      }
    </div>
    <app-load-state [res]="users" emptyText="Sin cuentas con los filtros seleccionados."
      ><ng-template>
        <div class="list-meta">
          <p class="muted">
            Mostrando <strong class="tabular">{{ (users.value() ?? []).length }}</strong>
            {{ (users.value() ?? []).length === 1 ? 'cuenta' : 'cuentas' }}
          </p>
        </div>
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
                <tr [class.muted]="!u.active">
                  <td>
                    <strong>{{ u.displayName }}</strong>
                  </td>
                  <td class="mono">{{ u.email }}</td>
                  <td>{{ roleText(u) }}</td>
                  <td class="tabular">
                    {{ u.lastAccess ? (u.lastAccess | date: 'd MMM y, HH:mm') : '—' }}
                  </td>
                  <td>
                    <span class="tag" [class.ok]="u.active" [class.off]="!u.active">{{
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
  protected hasFilters = computed(() => !!this.query().trim() || this.active() !== '');
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
    firstName: ['', [Validators.required, personNameValidator]],
    lastName: ['', personNameValidator],
    email: ['', [Validators.required, emailValidator]],
    roleId: [2 as Id, Validators.required],
  });

  clearFilters(): void {
    this.query.set('');
    this.active.set('');
  }

  label(name: string): string {
    return ROLE_LABELS[name] ?? name;
  }

  roleText(u: UserView): string {
    return [u.roleName ? this.label(u.roleName) : null, ...u.profiles]
      .filter((x) => !!x)
      .join(' · ');
  }

  protected panel = new FormPanel('user-form', () => this.form.dirty);

  edit(u: UserView): void {
    if (!this.panel.close()) return;
    this.reset();
    this.submission.result.set(null);
    this.editingId.set(u.id);
    this.form.setValue({
      firstName: u.firstName ?? '',
      lastName: u.lastName ?? '',
      email: u.email,
      roleId: u.roleId!,
    });
    this.form.markAsPristine();
    this.panel.show();
  }

  /** Opens an empty form (asks first if the open one has unsaved changes). */
  create(): void {
    if (!this.panel.close()) return;
    this.reset();
    this.submission.result.set(null);
    this.panel.show();
  }

  /** Closes the form without saving (asks first if it has unsaved changes); the record is untouched. */
  cancel(): void {
    if (this.panel.close()) this.reset();
  }

  private reset(): void {
    this.editingId.set(null);
    this.form.reset();
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      setTimeout(() => focusFirstInvalid(document.getElementById('user-form')!));
      return;
    }
    const draft = { ...this.form.getRawValue(), id: this.editingId() ?? undefined };
    const ok = await this.submission.run(
      () => this.service.save(draft),
      (u) =>
        draft.id
          ? 'Usuario actualizado.'
          : `Cuenta creada. Se envió a ${u.email} el enlace para definir su contraseña.`,
    );
    if (ok) {
      this.panel.done();
      this.reset();
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, LoadState, SubmissionAlert],
  template: `
    <div class="page-head">
      <div>
        <h1>Permisos por rol</h1>
        <p class="page-subtitle">
          Matriz de acceso agrupada por módulo. Los cambios aplican desde la siguiente acción de
          cada usuario y quedan auditados.
        </p>
      </div>
    </div>
    <p class="alert info">
      Los permisos marcados con <span aria-hidden="true">🔒</span> están protegidos para evitar que
      un rol base pierda acceso esencial al sistema.
    </p>
    <app-submission-alert [submission]="submission" />
    <app-load-state [res]="matrix"
      ><ng-template>
        @if (matrix.value(); as m) {
          <div class="filters">
            <label class="filter-grow"
              >Buscar permiso o módulo
              <input
                type="search"
                placeholder="Ej. cobranza, editar, portal…"
                [ngModel]="query()"
                (ngModelChange)="query.set($event)"
            /></label>
            <label
              >Módulo
              <select [ngModel]="moduleFilter()" (ngModelChange)="moduleFilter.set($event)">
                <option value="">Todos ({{ moduleOptions().length }})</option>
                @for (opt of moduleOptions(); track opt.module) {
                  <option [value]="opt.module">{{ opt.label }}</option>
                }
              </select>
            </label>
            <div class="filter-actions">
              @if (hasFilters()) {
                <button type="button" class="secondary sm" (click)="clearFilters()">
                  Limpiar filtros
                </button>
              }
              <button type="button" class="secondary sm" (click)="expandAll()">
                Expandir todos
              </button>
              <button type="button" class="secondary sm" (click)="collapseAll()">
                Contraer todos
              </button>
            </div>
          </div>

          <div class="list-meta">
            <p class="muted">
              Mostrando <strong class="tabular">{{ filteredCount() }}</strong> de
              <strong class="tabular">{{ m.permissions.length }}</strong> permisos en
              <strong class="tabular">{{ groups().length }}</strong>
              {{ groups().length === 1 ? 'módulo' : 'módulos' }}
            </p>
          </div>

          @if (groups().length === 0) {
            <p class="empty">Ningún permiso coincide con el filtro actual.</p>
          } @else {
            <div class="table-wrap matrix-wrap">
              <table class="matrix-table">
                <caption class="sr-only">
                  Matriz de permisos agrupada por módulo y rol
                </caption>
                <thead>
                  <tr>
                    <th class="matrix-perm-col">Módulo / Permiso</th>
                    @for (r of m.roles; track r.id) {
                      <th class="matrix-role-col">{{ label(r.name) }}</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (g of groups(); track g.module) {
                    <tr class="matrix-group-row">
                      <th [attr.colspan]="m.roles.length + 1" scope="colgroup">
                        <button
                          type="button"
                          class="matrix-group-toggle"
                          [attr.aria-expanded]="isExpanded(g.module)"
                          (click)="toggleModule(g.module)"
                        >
                          <span aria-hidden="true">{{ isExpanded(g.module) ? '▾' : '▸' }}</span>
                          <span>{{ g.label }}</span>
                          <span class="tag neutral">{{ g.permissions.length }}</span>
                        </button>
                      </th>
                    </tr>
                    @if (isExpanded(g.module)) {
                      @for (p of g.permissions; track p.id) {
                        <tr>
                          <td class="matrix-perm-col">
                            <span class="matrix-action">{{ actionLabel(p.action) }}</span>
                            <span class="cell-sub mono">{{ p.module }}.{{ p.action }}</span>
                          </td>
                          @for (r of m.roles; track r.id) {
                            <td class="matrix-role-cell">
                              <label
                                class="check matrix-check"
                                [title]="isProtected(r.name, p) ? 'Permiso protegido del rol base' : ''"
                              >
                                <input
                                  type="checkbox"
                                  [checked]="granted().has(r.id + ':' + p.id)"
                                  [disabled]="!canEdit || submission.busy()"
                                  (change)="set(r.id, p, $any($event.target).checked)"
                                />
                                @if (isProtected(r.name, p)) {
                                  <span class="matrix-lock" aria-label="Protegido">🔒</span>
                                }
                                <span class="sr-only"
                                  >{{ label(r.name) }} {{ p.module }}.{{ p.action }}</span
                                >
                              </label>
                            </td>
                          }
                        </tr>
                      }
                    }
                  }
                </tbody>
              </table>
            </div>
          }
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
  protected query = signal('');
  protected moduleFilter = signal('');
  protected collapsed = signal(new Set<string>());
  protected hasFilters = computed(() => !!this.query().trim() || !!this.moduleFilter());

  protected moduleOptions = computed(() => {
    const mods = new Set((this.matrix.value()?.permissions ?? []).map((p) => p.module));
    return [...mods]
      .sort((a, b) => this.moduleLabel(a).localeCompare(this.moduleLabel(b)))
      .map((module) => ({ module, label: this.moduleLabel(module) }));
  });

  protected groups = computed(() => {
    const m = this.matrix.value();
    if (!m) return [];
    const q = this.query().trim().toLowerCase();
    const mod = this.moduleFilter();
    const byMod = new Map<string, Permission[]>();
    for (const p of m.permissions) {
      if (mod && p.module !== mod) continue;
      if (q) {
        const hay = [
          p.module,
          p.action,
          `${p.module}.${p.action}`,
          this.moduleLabel(p.module),
          this.actionLabel(p.action),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) continue;
      }
      const list = byMod.get(p.module) ?? [];
      list.push(p);
      byMod.set(p.module, list);
    }
    return [...byMod.entries()]
      .sort((a, b) => this.moduleLabel(a[0]).localeCompare(this.moduleLabel(b[0])))
      .map(([module, permissions]) => ({
        module,
        label: this.moduleLabel(module),
        permissions,
      }));
  });

  protected filteredCount = computed(() =>
    this.groups().reduce((sum, g) => sum + g.permissions.length, 0),
  );

  label(name: string): string {
    return ROLE_LABELS[name] ?? name;
  }

  moduleLabel(mod: string | null): string {
    return mod ? (MODULE_LABELS[mod] ?? mod) : '—';
  }

  actionLabel(action: string): string {
    return ACTION_LABELS[action] ?? action;
  }

  isProtected(roleName: string, p: Permission): boolean {
    const key = `${p.module}.${p.action}` as PermissionKey;
    return PROTECTED_PERMISSIONS[roleName as BaseRole]?.includes(key) ?? false;
  }

  isExpanded(mod: string): boolean {
    if (this.hasFilters()) return true;
    return !this.collapsed().has(mod);
  }

  toggleModule(mod: string): void {
    const next = new Set(this.collapsed());
    if (!next.delete(mod)) next.add(mod);
    this.collapsed.set(next);
  }

  expandAll(): void {
    this.collapsed.set(new Set());
  }

  collapseAll(): void {
    this.collapsed.set(new Set(this.groups().map((g) => g.module)));
  }

  clearFilters(): void {
    this.query.set('');
    this.moduleFilter.set('');
  }

  async set(roleId: Id, p: Permission, granted: boolean): Promise<void> {
    await this.submission.run(
      () => this.service.setPermission(roleId, p.id, granted),
      `${granted ? 'Otorgado' : 'Retirado'} ${p.module}.${p.action}. Aplica desde la siguiente acción de cada usuario.`,
    );
    this.matrix.reload();
  }
}

/** HU-007: read-only audit log, filterable by user, module and dates. */
@Component({
  selector: 'app-audit-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, LoadState, DatePipe, Paginator],
  template: `
    <div class="page-head">
      <div>
        <h1>Bitácora de auditoría</h1>
        <p class="page-subtitle">
          Historial de solo lectura con los movimientos relevantes por usuario, módulo y fecha.
        </p>
      </div>
    </div>
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
            <option [value]="m">{{ moduleLabel(m) }}</option>
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
      @if (hasFilters()) {
        <button type="button" class="secondary sm" (click)="clearFilters()">Limpiar filtros</button>
      }
    </div>
    <app-load-state [res]="entries" emptyText="Sin registros con los filtros seleccionados."
      ><ng-template>
        <div class="list-meta">
          <p class="muted">
            Mostrando <strong class="tabular">{{ (entries.value()?.items ?? []).length }}</strong> de
            <strong class="tabular">{{ entries.value()?.total ?? 0 }}</strong> registros
          </p>
        </div>
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
                  <td class="tabular">{{ e.createdAt | date: 'd MMM y, HH:mm:ss' }}</td>
                  <td class="mono">{{ e.userEmail }}</td>
                  <td>
                    <span class="tag {{ actionTone(e.action) }}">{{ e.action }}</span>
                  </td>
                  <td>{{ moduleLabel(e.module) }}</td>
                  <td class="mono">{{ e.entity }}{{ e.entityId ? ' #' + e.entityId : '' }}</td>
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
  protected hasFilters = computed(
    () => this.userId() !== null || !!this.module() || !!this.from() || !!this.to(),
  );
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

  moduleLabel(mod: string): string {
    return MODULE_LABELS[mod] ?? mod;
  }

  actionTone(action: string): string {
    return AUDIT_ACTION_TONE[action.toUpperCase()] ?? 'neutral';
  }

  clearFilters(): void {
    this.userId.set(null);
    this.module.set('');
    this.from.set('');
    this.to.set('');
    this.page.set(1);
  }
}

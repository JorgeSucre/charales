import { Injectable, inject } from '@angular/core';
import { AuthorizationService } from '../../core/auth/authorization.service';
import { PROTECTED_PERMISSIONS, PermissionKey } from '../../core/auth/permissions';
import { MockDb } from '../../core/data/mock-db';
import { BaseRole, Id, Permission, Role } from '../../core/models';
import { AuditService } from '../../core/services/audit.service';
import { nowDateTime } from '../../shared/dates';

export interface PermissionMatrix {
  roles: Role[];
  permissions: Permission[];
  /** `${roleId}:${permissionId}` of every rol_permiso row. */
  granted: string[];
}

/** HU-006: role → permission matrix (rol_permiso). Changes apply to sessions started afterwards. */
@Injectable({ providedIn: 'root' })
export class RoleService {
  private db = inject(MockDb);
  private authz = inject(AuthorizationService);
  private audit = inject(AuditService);

  async matrix(): Promise<PermissionMatrix> {
    this.authz.require('roles.consultar');
    return this.db.respond({
      roles: this.db.roles.filter((r) => r.active),
      permissions: [...this.db.permissions].sort(
        (a, b) => a.module.localeCompare(b.module) || a.id - b.id,
      ),
      granted: this.db.rolePermissions.map((rp) => `${rp.roleId}:${rp.permissionId}`),
    });
  }

  async setPermission(roleId: Id, permissionId: Id, granted: boolean): Promise<void> {
    this.authz.require('roles.editar');
    const role = this.db.get(this.db.roles, roleId, 'Rol');
    const permission = this.db.get(this.db.permissions, permissionId, 'Permiso');
    const key = `${permission.module}.${permission.action}` as PermissionKey;
    const exists = this.db.rolePermissions.some(
      (rp) => rp.roleId === roleId && rp.permissionId === permissionId,
    );
    if (exists === granted) return this.db.respond(undefined);
    if (!granted) {
      if (PROTECTED_PERMISSIONS[role.name as BaseRole]?.includes(key))
        throw new Error(`${role.name} no puede perder «${key}»: el rol quedaría sin acceso.`);
      if (this.db.rolePermissions.filter((rp) => rp.roleId === roleId).length === 1)
        throw new Error('Un rol base no puede quedarse sin permisos.');
      this.db.rolePermissions = this.db.rolePermissions.filter(
        (rp) => !(rp.roleId === roleId && rp.permissionId === permissionId),
      );
    } else {
      this.db.rolePermissions.push({ roleId, permissionId, createdAt: nowDateTime() });
    }
    this.audit.log(
      'EDITAR',
      'roles',
      'rol_permiso',
      roleId,
      `${granted ? 'Otorga' : 'Retira'} ${key} a ${role.name}`,
      { granted: !granted },
      { granted },
    );
    await this.db.respond(undefined);
  }
}

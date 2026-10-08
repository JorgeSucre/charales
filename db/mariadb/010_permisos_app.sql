-- 010 · Permisos que usa la app además de los del esquema base, y rol_permiso inicial.
-- Son DATOS (filas de permisos/rol_permiso), no cambios de esquema. Fuente: src/app/core/auth/permissions.ts
-- (PERMISSION_CATALOG y DEFAULT_ROLE_PERMISSIONS). Idempotente: INSERT IGNORE.

INSERT IGNORE INTO permisos (modulo, accion) VALUES
('roles','consultar'),
('roles','editar'),
('tutores','consultar'),
('tutores','crear'),
('tutores','editar'),
('entrenadores','consultar'),
('entrenadores','crear'),
('entrenadores','editar'),
('temporadas','consultar'),
('temporadas','crear'),
('temporadas','editar'),
('sedes','consultar'),
('sedes','crear'),
('sedes','editar'),
('cobranza','consultar'),
('cobranza','crear'),
('cobranza','editar'),
('cobranza','cancelar'),
('descuentos','consultar'),
('descuentos','crear'),
('reportes','consultar'),
('portal','consultar'),
('portal','editar'),
('panel_entrenador','consultar');

-- rol_permiso inicial (Matriz Roles del backlog). Después se edita desde la pantalla Permisos (HU-006).
-- ADMINISTRADOR: todo excepto los permisos de perfil (portal, panel_entrenador).
INSERT IGNORE INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p
WHERE r.nombre = 'ADMINISTRADOR' AND p.modulo NOT IN ('portal', 'panel_entrenador');

-- SECRETARIA (D12: administra la operación, no el sistema): sin usuarios/roles/auditoría, sin cancelar pagos,
-- descuentos sólo consulta, asistencia sólo consulta. Sí temporadas y cancelar cargos sin pagos (cobranza.cancelar).
INSERT IGNORE INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p
WHERE r.nombre = 'SECRETARIA'
  AND p.modulo NOT IN ('portal', 'panel_entrenador', 'usuarios', 'roles', 'auditoria')
  AND NOT (p.modulo = 'descuentos' AND p.accion = 'crear')
  AND NOT (p.modulo = 'pagos' AND p.accion = 'cancelar')
  AND NOT (p.modulo = 'asistencias' AND p.accion IN ('crear', 'editar'));

INSERT IGNORE INTO rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p
WHERE (r.nombre = 'ENTRENADOR' AND ((p.modulo = 'panel_entrenador' AND p.accion = 'consultar')
                                    OR (p.modulo = 'asistencias' AND p.accion IN ('crear', 'editar'))))
   OR (r.nombre = 'TUTOR' AND p.modulo = 'portal' AND p.accion IN ('consultar', 'editar'));

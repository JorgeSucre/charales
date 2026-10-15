-- 001 · tokens_recuperacion.finalidad (D3e): distingue la recuperación de contraseña (HU-005) de la invitación de
-- acceso inicial (HU-004 personal, HU-012 tutor, HU-022 entrenador). Una nueva solicitud de recuperación sólo
-- revoca tokens de recuperación; nunca una invitación pendiente. Las filas existentes eran todas de recuperación.
-- Idempotente. Se aplica después de docs/escuela_futbol_mariadb.sql con db/mariadb/scripts/migrate.sh.
ALTER TABLE tokens_recuperacion
    ADD COLUMN IF NOT EXISTS finalidad ENUM('RECUPERACION','INVITACION') NOT NULL DEFAULT 'RECUPERACION'
    AFTER usuario_id;

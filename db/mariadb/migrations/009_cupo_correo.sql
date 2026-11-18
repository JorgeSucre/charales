-- 009 · Límite global de correo (cierre funcional 2026). Aditiva e idempotente. Para revertirla: DROP TABLE correo_cupo.
--
-- Un presupuesto de envíos por hora para TODA la API, en MariaDB para que lo compartan todos sus procesos y sobreviva a
-- un reinicio (api/mail.ts, takeMailSlot). Dos filas: TOTAL, que gasta todo envío, y RECUPERACION, que además gastan las
-- recuperaciones de contraseña, así que una avalancha de solicitudes no deja sin cupo a las invitaciones. `usados` es
-- lo gastado en el instante `desde_ms` (milisegundos desde 1970); se recupera con el tiempo. No guarda datos personales.
CREATE TABLE IF NOT EXISTS correo_cupo (
    ambito VARCHAR(20) NOT NULL PRIMARY KEY,
    usados INT UNSIGNED NOT NULL DEFAULT 0,
    desde_ms BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB;
INSERT IGNORE INTO correo_cupo (ambito, usados, desde_ms) VALUES ('TOTAL', 0, 0), ('RECUPERACION', 0, 0);

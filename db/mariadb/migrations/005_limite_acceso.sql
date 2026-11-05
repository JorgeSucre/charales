-- 005 · Límite de intentos de inicio de sesión compartido (S-01 de la auditoría del 2026-11-01): un contador por clave
-- y ventana de 15 min, que la API reserva ANTES de verificar la contraseña (api/login-limit.ts). Vive en MariaDB para que
-- sobreviva a un reinicio y lo compartan varias instancias de la API.
-- `clave` es el SHA-256 del ámbito y del identificador (correo en minúsculas, IP del cliente o ambos): la tabla no guarda
-- correos, IP, contraseñas ni tokens. Las filas con la ventana vencida se borran solas en cada inicio de sesión.
-- Aditiva e idempotente. Para revertirla: DROP TABLE limite_acceso (la API anterior no la usa).
CREATE TABLE IF NOT EXISTS limite_acceso (
    clave CHAR(64) NOT NULL PRIMARY KEY,
    ambito ENUM('CUENTA', 'IP', 'CUENTA_IP') NOT NULL,
    intentos INT UNSIGNED NOT NULL DEFAULT 0,
    ventana_inicio DATETIME NOT NULL,
    KEY ix_limite_acceso_ventana (ventana_inicio)
) ENGINE=InnoDB;

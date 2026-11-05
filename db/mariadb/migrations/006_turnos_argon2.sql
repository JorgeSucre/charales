-- 006 · Tablas del diseño distribuido descartado de S-02 (auditoría del 2026-11-01), que coordinaba en MariaDB los
-- turnos de Argon2id entre instancias: `turnos_argon2` guardaba los turnos y `turnos_argon2_guarda`, de una sola fila,
-- se bloqueaba para contarlos y tomarlos de forma atómica.
-- El semáforo actual es local a cada proceso y vive en memoria (api/argon2-guard.ts). El código actual no consulta ni
-- modifica estas tablas.
-- Se conservan temporalmente por compatibilidad, porque no se ha confirmado si esta migración se aplicó en otros
-- entornos. No deben eliminarse hasta confirmar el estado de todos los entornos.
-- No guardan contraseñas, hashes, correos ni IP. Aditiva e idempotente.
CREATE TABLE IF NOT EXISTS turnos_argon2 (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    vence_en DATETIME(3) NOT NULL,
    KEY ix_turnos_argon2_vence (vence_en)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS turnos_argon2_guarda (
    id TINYINT UNSIGNED PRIMARY KEY,
    CONSTRAINT chk_turnos_argon2_guarda_una_fila CHECK (id = 1)
) ENGINE=InnoDB;
INSERT IGNORE INTO turnos_argon2_guarda (id) VALUES (1);

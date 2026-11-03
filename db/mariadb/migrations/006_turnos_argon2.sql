-- 006 · Turnos de Argon2id compartidos (S-02 de la auditoría del 2026-11-01): cada verificación o cálculo de hash de una
-- contraseña ocupa un turno mientras dura (unos 19 MiB de memoria y un hilo del pool de libuv). La API sólo empieza si
-- quedan turnos libres (ARGON2_MAX_CONCURRENT) contando TODAS sus instancias (api/argon2-guard.ts). Un turno que su
-- proceso no devolvió (se cayó) vence solo: `vence_en` usa el reloj de MariaDB, el mismo para todas las instancias.
-- `turnos_argon2_guarda` es una fila única que se bloquea al tomar un turno, para que contar y tomar sean atómicos.
-- No guarda contraseñas, hashes, correos ni IP. Aditiva e idempotente.
-- Para revertirla: DROP TABLE turnos_argon2, turnos_argon2_guarda (la API anterior no las usa).
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

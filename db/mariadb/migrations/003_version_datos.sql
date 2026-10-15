-- 003 · Contador de versión de los datos del dominio (D13, HU-075): la API guarda en memoria las tablas que sólo
-- escribe el puente de dominio y las vuelve a leer cuando este número cambia. Lo incrementa cada operación que las
-- modifica (en su misma transacción) y el trabajo diario de VENCIDO. Un cambio hecho a mano con SQL sobre esas tablas
-- debe incrementarlo también (UPDATE version_datos SET version = version + 1), o reiniciar la API.
-- Idempotente.
CREATE TABLE IF NOT EXISTS version_datos (
    id TINYINT UNSIGNED PRIMARY KEY,
    version BIGINT UNSIGNED NOT NULL DEFAULT 0,
    CONSTRAINT chk_version_datos_una_fila CHECK (id = 1)
) ENGINE=InnoDB;
INSERT IGNORE INTO version_datos (id, version) VALUES (1, 0);

DROP PROCEDURE IF EXISTS marcar_cargos_vencidos;
DELIMITER //
CREATE PROCEDURE marcar_cargos_vencidos()
BEGIN
    UPDATE cargos SET estado = 'VENCIDO'
     WHERE estado IN ('PENDIENTE', 'PARCIAL') AND fecha_vencimiento IS NOT NULL AND fecha_vencimiento < CURDATE();
    IF ROW_COUNT() > 0 THEN
        UPDATE version_datos SET version = version + 1 WHERE id = 1;
    END IF;
END//
DELIMITER ;

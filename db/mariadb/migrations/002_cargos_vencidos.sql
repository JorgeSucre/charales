-- 002 · Trabajo diario de VENCIDO (D5, HU-044.3): un cargo no pagado ni cancelado cuya fecha de vencimiento ya pasó
-- queda VENCIDO aunque nadie abra la cobranza. Misma regla que billing.rules.ts#chargeStatus; la API la sigue
-- aplicando en cada operación. Un cargo PENDIENTE/PARCIAL tiene saldo > 0 por definición (el pagado es PAGADO).
-- El EVENT corre sólo con el planificador activo: SET GLOBAL event_scheduler = ON (o event_scheduler=ON en my.cnf).
-- CURDATE() usa la zona del servidor: debe ser la de la escuela (America/Mexico_City), como DATETIME (MARIADB.md § 1).
-- Idempotente.
DROP PROCEDURE IF EXISTS marcar_cargos_vencidos;
DELIMITER //
CREATE PROCEDURE marcar_cargos_vencidos()
BEGIN
    UPDATE cargos SET estado = 'VENCIDO'
     WHERE estado IN ('PENDIENTE', 'PARCIAL') AND fecha_vencimiento IS NOT NULL AND fecha_vencimiento < CURDATE();
END//
DELIMITER ;
CREATE EVENT IF NOT EXISTS ev_cargos_vencidos
    ON SCHEDULE EVERY 1 DAY STARTS (CURDATE() + INTERVAL 1 DAY + INTERVAL 5 MINUTE)
    DO CALL marcar_cargos_vencidos();

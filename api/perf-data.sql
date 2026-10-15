-- HU-075 · Volumen de prueba (api/hu-fase6.test.ts): 5 000 jugadores, 20 000 cargos, 10 000 pagos, 20 000 filas de
-- auditoría, ficticios, sobre una base temporal con la semilla de demostración. Usa las tablas seq_* de MariaDB.
INSERT INTO jugadores (identificador, nombre, apellido_paterno, fecha_nacimiento, estatus, creado_en, actualizado_en)
SELECT CONCAT('P-', seq), CONCAT('Nombre', seq), CONCAT('Apellido', seq % 300), DATE('2014-01-01') + INTERVAL (seq % 1500) DAY, 'ACTIVO', NOW(), NOW()
  FROM seq_1_to_5000;
INSERT INTO jugador_categoria (jugador_id, categoria_id, fecha_inicio, activo, creado_en)
SELECT j.id, 1 + (j.id % 3), '2026-08-05', TRUE, NOW() FROM jugadores j WHERE j.identificador LIKE 'P-%';
INSERT INTO cargos (jugador_id, concepto_id, temporada_id, periodo, fecha_cargo, fecha_vencimiento, monto_original, estado, creado_en, actualizado_en)
SELECT j.id, 1, 2, CONCAT('2026-0', m.seq), CONCAT('2026-0', m.seq, '-01'), CONCAT('2026-0', m.seq, '-10'), 650.00,
       IF(m.seq <= 2, 'PAGADO', 'VENCIDO'), NOW(), NOW()
  FROM jugadores j JOIN seq_1_to_4 m WHERE j.identificador LIKE 'P-%';
INSERT INTO pagos (folio, jugador_id, fecha_pago, importe, forma_pago, estado, creado_en)
SELECT CONCAT('X-', c.id), c.jugador_id, CONCAT(c.fecha_cargo, ' 10:00:00'), 650.00, 'EFECTIVO', 'APLICADO', NOW()
  FROM cargos c WHERE c.estado = 'PAGADO' AND c.periodo IN ('2026-01', '2026-02') AND c.jugador_id IN (SELECT id FROM jugadores WHERE identificador LIKE 'P-%');
INSERT INTO pago_aplicacion (pago_id, cargo_id, jugador_id, importe_aplicado, creado_en)
SELECT p.id, CAST(SUBSTRING(p.folio, 3) AS UNSIGNED), p.jugador_id, 650.00, NOW() FROM pagos p WHERE p.folio LIKE 'X-%';
INSERT INTO auditoria (usuario_id, accion, modulo, entidad, entidad_id, descripcion, creado_en)
SELECT 1, 'EDITAR', 'jugadores', 'jugadores', 1, CONCAT('Edición ', seq), NOW() FROM seq_1_to_20000;

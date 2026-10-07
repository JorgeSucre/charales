-- ============================================================
-- ESCUELA DE FÚTBOL - PRUEBAS DE INTEGRIDAD DEL ESQUEMA
-- Valida las restricciones de docs/escuela_futbol_mariadb.sql.
-- Probado en MariaDB 10.6.28 y 13.0.2 con resultados idénticos.
--
-- Ejecutar SOLO sobre una copia vacía (inserta datos de prueba):
--   sed 's/escuela_futbol/ef_checks/g' docs/escuela_futbol_mariadb.sql | mariadb
--   mariadb ef_checks < docs/escuela_futbol_mariadb_checks.sql
-- Termina con error (exit != 0) si algún caso no se comporta como se espera.
--
-- Cada caso negativo indica la regla que valida y la restricción que DEBE
-- rechazarlo; no basta con que falle: debe fallar por esa restricción.
--
-- DECISIÓN PENDIENTE (HU-015), sin prueba a propósito:
--   categorias.temporada_id es opcional (HU-015 "nombre único por temporada si aplica";
--   HU-070 "pueden vincularse"). Falta decidir si los nombres de categorías con
--   temporada_id IS NULL deben ser únicos entre sí. Hoy el esquema lo PERMITE, porque
--   UNIQUE (temporada_id, nombre) no compara filas con NULL. Al decidirlo, agregar aquí su caso.
-- ============================================================

-- Protección: nunca sobre la base real ni sobre una base con datos.
DELIMITER //
BEGIN NOT ATOMIC
    IF DATABASE() IS NULL OR DATABASE() = 'escuela_futbol' OR (SELECT COUNT(*) FROM usuarios) > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Ejecutar sólo sobre una copia vacía del esquema (ver encabezado)';
    END IF;
END//
DELIMITER ;

CREATE TEMPORARY TABLE resultados (
    caso VARCHAR(10) NOT NULL,
    regla VARCHAR(255) NOT NULL,
    esperado VARCHAR(80) NOT NULL,
    obtenido VARCHAR(255) NOT NULL,
    ok BOOLEAN NOT NULL
);

DROP PROCEDURE IF EXISTS chk_debe_fallar;
DELIMITER //
/* Ejecuta p_sql; pasa sólo si falla con un mensaje que nombra p_restriccion. */
CREATE PROCEDURE chk_debe_fallar(
    IN p_caso VARCHAR(10), IN p_regla VARCHAR(255), IN p_restriccion VARCHAR(80), IN p_sql TEXT)
BEGIN
    DECLARE v_msg TEXT;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1 v_msg = MESSAGE_TEXT;
        INSERT INTO resultados VALUES (p_caso, p_regla, p_restriccion, LEFT(v_msg, 255), LOCATE(p_restriccion, v_msg) > 0);
    END;
    SET @chk_sql = p_sql;
    PREPARE chk_stmt FROM @chk_sql;
    EXECUTE chk_stmt;
    DEALLOCATE PREPARE chk_stmt;
    INSERT INTO resultados VALUES (p_caso, p_regla, p_restriccion, 'ACEPTADO (debía fallar)', FALSE);
END//
DELIMITER ;

-- ============================================================
-- DATOS VÁLIDOS: si alguno falla, el script se detiene (restricción demasiado estricta).
-- Ids resultantes: roles 1 ADMINISTRADOR, 2 SECRETARIA, 3 ENTRENADOR, 4 TUTOR (del esquema).
-- ============================================================

-- Personas y cuentas
INSERT INTO usuarios (rol_id, nombre, email, password_hash)
VALUES (1, 'Ana', 'admin@example.com', '$2b$x');                  -- u1: personal con rol y nombre
INSERT INTO usuarios (email, password_hash)
VALUES ('papa@example.com', '$2b$x');                             -- u2: sin rol ni nombre (tutor + entrenador)
INSERT INTO jugadores (identificador, nombre, apellido_paterno, fecha_nacimiento)
VALUES ('J1', 'Leo', 'P', '2015-01-01'), ('J2', 'Mia', 'P', '2016-01-01');
INSERT INTO tutores (usuario_id, nombre, apellido_paterno)
VALUES (2, 'Juan', 'P'),                                          -- t1: cuenta compartida con entrenador e1
       (1, 'Ana', 'Q'),                                           -- t2: administradora que también es tutora
       (NULL, 'Sin', 'Cuenta');                                   -- t3: tutor sin cuenta
INSERT INTO entrenadores (usuario_id, nombre, apellido_paterno)
VALUES (2, 'Juan', 'P'), (NULL, 'Coach', 'SinCuenta');            -- e1 misma cuenta que t1; e2 sin cuenta
INSERT INTO tutor_jugador (tutor_id, jugador_id, parentesco, es_contacto_principal)
VALUES (1, 1, 'Padre', TRUE), (1, 2, 'Tío', TRUE),                -- parentesco por par; un principal por jugador
       (2, 1, 'Madre', FALSE), (3, 1, 'Abuelo', FALSE);

-- Cobranza
INSERT INTO pagos (folio, jugador_id, tutor_id, importe, forma_pago)
VALUES ('F1', 1, 2, 100, 'EFECTIVO'),                             -- pago1: t2 es tutora de J1
       ('F2', 2, NULL, 100, 'EFECTIVO');                          -- pago2: sin tutor
INSERT INTO conceptos_cobro (nombre) VALUES ('M');
INSERT INTO cargos (jugador_id, concepto_id, fecha_cargo, monto_original)
VALUES (1, 1, '2026-10-01', 600);                                 -- cargo1: J1
INSERT INTO descuentos (cargo_id, tipo, motivo, monto_original, monto_ajuste)
VALUES (1, 'BECA', 'x', 600, 150);
INSERT INTO avisos (creado_por, titulo, mensaje) VALUES (1, 't', 'm');
INSERT INTO aviso_destinatario (aviso_id, tipo_audiencia) VALUES (1, 'GENERAL');
INSERT INTO aviso_destinatario (aviso_id, tipo_audiencia, tutor_id) VALUES (1, 'TUTOR', 1);

-- Temporadas, categorías y agenda
INSERT INTO temporadas (nombre, fecha_inicio, fecha_fin, es_actual)
VALUES ('T1', '2026-01-01', '2026-12-31', TRUE), ('T0', '2025-01-01', '2025-12-31', FALSE);
INSERT INTO categorias (temporada_id, nombre, edad_minima, edad_maxima)
VALUES (1, 'Sub10', 8, 10), (1, 'Sub12', 10, 12);
INSERT INTO sedes (nombre) VALUES ('S1');
INSERT INTO horarios_entrenamiento (categoria_id, sede_id, dia_semana, hora_inicio, hora_fin)
VALUES (1, 1, 1, '17:00', '18:00');                               -- horario1: Sub10
INSERT INTO sesiones_entrenamiento (categoria_id, sede_id, horario_id, fecha, hora_inicio, hora_fin)
VALUES (1, 1, 1, '2026-10-05', '17:00', '18:00'),                 -- horario de su misma categoría
       (2, 1, NULL, '2026-10-05', '17:00', '18:00');              -- sesión sin horario
INSERT INTO asistencias (sesion_entrenamiento_id, jugador_id, estado) VALUES (1, 1, 'PRESENTE');
INSERT INTO cargos (jugador_id, concepto_id, periodo, fecha_cargo, monto_original)
VALUES (2, 1, '2026-10', '2026-10-01', 300),                      -- cargo2: J2, periodo YYYY-MM
       (1, 1, NULL, '2026-10-01', 800);                           -- cargo3: J1, sin periodo
INSERT INTO pago_aplicacion (pago_id, cargo_id, jugador_id, importe_aplicado)
VALUES (1, 1, 1, 100);                                            -- pago y cargo del mismo jugador
INSERT INTO pedidos_uniforme (jugador_id, fecha_solicitud, cargo_id)
VALUES (1, '2026-10-01', 3),                                      -- pedido1: cargo del mismo jugador
       (1, '2026-10-01', NULL), (1, '2026-10-02', NULL);          -- pedidos 2 y 3 sin cargo
UPDATE pedidos_uniforme SET estado = 'ENTREGADO', fecha_entrega = '2026-10-03' WHERE id = 2;
UPDATE pagos SET estado = 'CANCELADO', motivo_cancelacion = 'error de captura' WHERE folio = 'F2';
-- Cambio de categoría (HU-019): cerrar la vigente y abrir la nueva
INSERT INTO jugador_categoria (jugador_id, categoria_id, fecha_inicio) VALUES (1, 1, '2026-01-01');
UPDATE jugador_categoria SET fecha_fin = '2026-06-30', activo = FALSE WHERE jugador_id = 1 AND categoria_id = 1;
INSERT INTO jugador_categoria (jugador_id, categoria_id, fecha_inicio) VALUES (1, 2, '2026-07-01');
INSERT INTO historial_categoria (jugador_id, categoria_anterior_id, categoria_nueva_id, motivo)
VALUES (1, 1, 2, 'avance');
INSERT INTO competencias (nombre) VALUES ('Liga');
INSERT INTO competencia_categoria (competencia_id, categoria_id, fecha_inscripcion, costo)
VALUES (1, 1, '2026-01-01', NULL);
INSERT INTO partidos (competencia_categoria_id, fecha, hora) VALUES (1, '2026-10-10', '10:00');
UPDATE partidos SET estado = 'JUGADO', goles_favor = 2, goles_contra = 1 WHERE id = 1;
INSERT INTO inscripciones (jugador_id, temporada_id, fecha_inscripcion, monto) VALUES (1, 1, '2026-01-01', 500);
-- Mover la temporada actual: primero se desmarca la anterior
UPDATE temporadas SET es_actual = FALSE WHERE id = 1;
UPDATE temporadas SET es_actual = TRUE WHERE id = 2;
INSERT INTO sesiones (usuario_id, token_hash, expira_en) VALUES (1, 'tok', NOW() + INTERVAL 1 DAY);
INSERT INTO tokens_recuperacion (usuario_id, token_hash, expira_en) VALUES (1, 'rec', NOW() + INTERVAL 1 HOUR);
INSERT INTO historial_estatus (jugador_id, estatus_anterior, estatus_nuevo)
VALUES (1, NULL, 'ACTIVO'), (1, 'ACTIVO', 'BAJA_TEMPORAL');

-- Valores derivados
INSERT INTO resultados
SELECT 'D1', 'descuentos.monto_final = monto_original - monto_ajuste (columna generada)', '450.00',
       monto_final, monto_final = 450 FROM descuentos WHERE id = 1;
INSERT INTO resultados
SELECT 'D2', 'jugadores.sexo por defecto NO_ESPECIFICADO (sin NULL como segundo "no especificado")',
       'NO_ESPECIFICADO', sexo, sexo = 'NO_ESPECIFICADO' FROM jugadores WHERE id = 1;

-- ============================================================
-- CASOS NEGATIVOS: personas, cuentas y roles
-- ============================================================

CALL chk_debe_fallar('U1', 'usuarios.rol_id sólo acepta roles de SEGURIDAD; TUTOR/ENTRENADOR salen del perfil',
    'fk_usuario_rol',
    'INSERT INTO usuarios (rol_id, nombre, email, password_hash) VALUES (4, ''X'', ''t@example.com'', ''h'')');
CALL chk_debe_fallar('U2', 'cuenta sin rol no guarda nombre (el nombre vive en el perfil)',
    'chk_usuario_nombre_personal',
    'INSERT INTO usuarios (email, password_hash, nombre) VALUES (''n@example.com'', ''h'', ''X'')');
CALL chk_debe_fallar('U3', 'cuenta de personal (con rol) requiere nombre',
    'chk_usuario_nombre_personal',
    'INSERT INTO usuarios (rol_id, email, password_hash) VALUES (2, ''s@example.com'', ''h'')');
CALL chk_debe_fallar('U4', 'email de login único sin importar mayúsculas (collation _ci)',
    '''email''',
    'INSERT INTO usuarios (rol_id, nombre, email, password_hash) VALUES (1, ''Y'', ''ADMIN@example.com'', ''h'')');
CALL chk_debe_fallar('U5', 'una cuenta se liga a lo más a un perfil de tutor',
    '''usuario_id''',
    'INSERT INTO tutores (usuario_id, nombre, apellido_paterno) VALUES (2, ''Dup'', ''P'')');
CALL chk_debe_fallar('T1', 'máximo un contacto principal por jugador',
    'uq_tutor_jugador_un_principal',
    'INSERT INTO tutor_jugador (tutor_id, jugador_id, parentesco, es_contacto_principal) VALUES (3, 2, ''Abuela'', TRUE)');
CALL chk_debe_fallar('T2', 'pagos.tutor_id debe ser tutor vinculado a ese jugador',
    'fk_pago_tutor_jugador',
    'INSERT INTO pagos (folio, jugador_id, tutor_id, importe, forma_pago) VALUES (''F3'', 2, 3, 100, ''EFECTIVO'')');
CALL chk_debe_fallar('T3', 'no se borra un vínculo tutor-jugador con pagos registrados',
    'fk_pago_tutor_jugador',
    'DELETE FROM tutor_jugador WHERE tutor_id = 2 AND jugador_id = 1');
CALL chk_debe_fallar('J1', 'jugadores.sexo no acepta NULL',
    '''sexo''',
    'INSERT INTO jugadores (identificador, nombre, apellido_paterno, fecha_nacimiento, sexo) VALUES (''J9'', ''a'', ''b'', ''2015-01-01'', NULL)');
CALL chk_debe_fallar('A1', 'audiencia TUTOR requiere tutor_id',
    'chk_aviso_dest_audiencia',
    'INSERT INTO aviso_destinatario (aviso_id, tipo_audiencia) VALUES (1, ''TUTOR'')');
CALL chk_debe_fallar('A2', 'audiencia GENERAL no lleva destinatario específico',
    'chk_aviso_dest_audiencia',
    'INSERT INTO aviso_destinatario (aviso_id, tipo_audiencia, tutor_id) VALUES (1, ''GENERAL'', 1)');

-- ============================================================
-- CASOS NEGATIVOS: hallazgos 1-15 y 17 de la auditoría (16 = HU-015, pendiente)
-- ============================================================

CALL chk_debe_fallar('H1', 'un pago sólo se aplica a cargos de su mismo jugador (lado cargo)',
    'fk_pago_aplicacion_cargo',
    'INSERT INTO pago_aplicacion (pago_id, cargo_id, jugador_id, importe_aplicado) VALUES (1, 2, 1, 50)');
CALL chk_debe_fallar('H1b', 'un pago sólo se aplica a cargos de su mismo jugador (lado pago)',
    'fk_pago_aplicacion_pago',
    'INSERT INTO pago_aplicacion (pago_id, cargo_id, jugador_id, importe_aplicado) VALUES (1, 2, 2, 50)');
CALL chk_debe_fallar('H2', 'el cargo de un pedido de uniforme es del mismo jugador',
    'fk_pedido_uniforme_cargo',
    'INSERT INTO pedidos_uniforme (jugador_id, fecha_solicitud, cargo_id) VALUES (1, ''2026-10-01'', 2)');
CALL chk_debe_fallar('H3', 'un cargo pertenece a lo más a un pedido de uniforme',
    'uq_pedido_uniforme_cargo',
    'INSERT INTO pedidos_uniforme (jugador_id, fecha_solicitud, cargo_id) VALUES (1, ''2026-10-02'', 3)');
CALL chk_debe_fallar('H4a', 'pago CANCELADO requiere motivo',
    'chk_pago_cancelacion',
    'INSERT INTO pagos (folio, jugador_id, importe, forma_pago, estado) VALUES (''F9'', 1, 10, ''EFECTIVO'', ''CANCELADO'')');
CALL chk_debe_fallar('H4b', 'pago APLICADO no lleva motivo de cancelación',
    'chk_pago_cancelacion',
    'INSERT INTO pagos (folio, jugador_id, importe, forma_pago, motivo_cancelacion) VALUES (''F8'', 1, 10, ''EFECTIVO'', ''x'')');
CALL chk_debe_fallar('H5', 'inscripción anual requiere temporada (HU-020)',
    '''temporada_id''',
    'INSERT INTO inscripciones (jugador_id, fecha_inscripcion) VALUES (2, ''2026-01-01'')');
CALL chk_debe_fallar('H6', 'una sola categoría vigente (fecha_fin NULL) por jugador',
    'uq_jugador_categoria_vigente',
    'INSERT INTO jugador_categoria (jugador_id, categoria_id, fecha_inicio) VALUES (1, 1, ''2026-08-01'')');
CALL chk_debe_fallar('H7a', 'una sola temporada actual',
    'uq_temporada_actual',
    'INSERT INTO temporadas (nombre, fecha_inicio, fecha_fin, es_actual) VALUES (''B'', ''2027-01-01'', ''2027-12-31'', TRUE)');
CALL chk_debe_fallar('H7b', 'la temporada actual debe estar activa',
    'chk_temporada_actual_activa',
    'UPDATE temporadas SET activa = FALSE WHERE id = 2');
CALL chk_debe_fallar('H8a', 'jugador_categoria inactiva requiere fecha_fin',
    'chk_jugador_categoria_activo',
    'INSERT INTO jugador_categoria (jugador_id, categoria_id, fecha_inicio, activo) VALUES (2, 1, ''2026-01-01'', FALSE)');
CALL chk_debe_fallar('H8b', 'entrenador_categoria inactiva requiere fecha_fin',
    'chk_ent_cat_activo',
    'INSERT INTO entrenador_categoria (entrenador_id, categoria_id, fecha_inicio, activo) VALUES (1, 1, ''2026-01-01'', FALSE)');
CALL chk_debe_fallar('H8c', 'jugador_competencia_categoria inactiva requiere fecha_baja',
    'chk_jcc_activo',
    'INSERT INTO jugador_competencia_categoria (jugador_id, competencia_categoria_id, fecha_alta, activo) VALUES (1, 1, ''2026-01-01'', FALSE)');
CALL chk_debe_fallar('H8d', 'entrenador_competencia_categoria inactiva requiere fecha_fin',
    'chk_ecc_activo',
    'INSERT INTO entrenador_competencia_categoria (entrenador_id, competencia_categoria_id, fecha_inicio, activo) VALUES (1, 1, ''2026-01-01'', FALSE)');
CALL chk_debe_fallar('H9a', 'sólo un partido JUGADO tiene marcador',
    'chk_partido_goles',
    'INSERT INTO partidos (competencia_categoria_id, fecha, hora, goles_favor, goles_contra) VALUES (1, ''2026-10-11'', ''10:00'', 1, 0)');
CALL chk_debe_fallar('H9b', 'el marcador va completo (favor y contra) o vacío',
    'chk_partido_goles',
    'INSERT INTO partidos (competencia_categoria_id, fecha, hora, estado, goles_favor) VALUES (1, ''2026-10-11'', ''10:00'', ''JUGADO'', 1)');
CALL chk_debe_fallar('H10a', 'pedido ENTREGADO requiere fecha_entrega',
    'chk_pedido_uniforme_entrega',
    'UPDATE pedidos_uniforme SET estado = ''ENTREGADO'' WHERE id = 3');
CALL chk_debe_fallar('H10b', 'sólo un pedido ENTREGADO tiene fecha_entrega',
    'chk_pedido_uniforme_entrega',
    'UPDATE pedidos_uniforme SET fecha_entrega = ''2026-10-05'' WHERE id = 3');
CALL chk_debe_fallar('H11', 'el horario de una sesión es de su misma categoría',
    'fk_sesion_ent_horario',
    'INSERT INTO sesiones_entrenamiento (categoria_id, sede_id, horario_id, fecha, hora_inicio, hora_fin) VALUES (2, 1, 1, ''2026-10-06'', ''17:00'', ''18:00'')');
CALL chk_debe_fallar('H12a', 'periodo de cargo con formato YYYY-MM (HU-044)',
    'chk_cargo_periodo',
    'INSERT INTO cargos (jugador_id, concepto_id, periodo, fecha_cargo, monto_original) VALUES (1, 1, ''oct-2026'', ''2026-10-01'', 600)');
CALL chk_debe_fallar('H12b', 'periodo de cargo con mes válido (01-12)',
    'chk_cargo_periodo',
    'INSERT INTO cargos (jugador_id, concepto_id, periodo, fecha_cargo, monto_original) VALUES (1, 1, ''2026-13'', ''2026-10-01'', 600)');
CALL chk_debe_fallar('H13a', 'costo de competencia no negativo',
    'chk_comp_cat_costo',
    'UPDATE competencia_categoria SET costo = -5 WHERE id = 1');
CALL chk_debe_fallar('H13b', 'monto de inscripción no negativo',
    'chk_inscripcion_monto',
    'INSERT INTO inscripciones (jugador_id, temporada_id, fecha_inscripcion, monto) VALUES (2, 1, ''2026-01-01'', -100)');
CALL chk_debe_fallar('H13c', 'importe sugerido de concepto no negativo',
    'chk_concepto_importe',
    'INSERT INTO conceptos_cobro (nombre, importe_sugerido) VALUES (''X'', -1)');
CALL chk_debe_fallar('H14a', 'un cambio de categoría cambia de categoría',
    'chk_hist_categoria_cambio',
    'INSERT INTO historial_categoria (jugador_id, categoria_anterior_id, categoria_nueva_id) VALUES (1, 1, 1)');
CALL chk_debe_fallar('H14b', 'un cambio de estatus cambia de estatus',
    'chk_hist_estatus_cambio',
    'INSERT INTO historial_estatus (jugador_id, estatus_anterior, estatus_nuevo) VALUES (1, ''ACTIVO'', ''ACTIVO'')');
CALL chk_debe_fallar('H15a', 'una sesión de login expira después de iniciar',
    'chk_sesion_expira',
    'INSERT INTO sesiones (usuario_id, token_hash, inicio_en, expira_en) VALUES (1, ''t2'', ''2026-10-01'', ''2026-09-01'')');
CALL chk_debe_fallar('H15b', 'un token de recuperación expira después de crearse',
    'chk_token_expira',
    'INSERT INTO tokens_recuperacion (usuario_id, token_hash, creado_en, expira_en) VALUES (1, ''r2'', ''2026-10-01'', ''2026-09-01'')');
CALL chk_debe_fallar('H17', 'un partido con marcador no puede dejar de estar JUGADO',
    'chk_partido_goles',
    'UPDATE partidos SET estado = ''CANCELADO'' WHERE id = 1');

-- ============================================================
-- RESULTADO
-- ============================================================

DROP PROCEDURE chk_debe_fallar;

SELECT caso, IF(ok, 'OK', 'FALLA') AS resultado, regla, esperado, obtenido FROM resultados;

SELECT COUNT(*) AS casos, SUM(ok) AS ok, COUNT(*) - SUM(ok) AS fallas FROM resultados;

DELIMITER //
BEGIN NOT ATOMIC
    IF (SELECT COUNT(*) FROM resultados WHERE NOT ok) > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hay casos de integridad que no se comportan como se espera';
    END IF;
END//
DELIMITER ;

-- 020 · Cuentas de DESARROLLO para la API (las mismas de docs/DEVELOPMENT.md y de MockDb). Son DATOS, no esquema.
-- Credenciales ficticias: dominio reservado example.com y contraseña pública de demostración «demo1234».
-- NUNCA se aplica a una base de producción. Requiere 010_permisos_app.sql. Idempotente.
-- Hash argon2id de 'demo1234', generado con: node api/auth.ts demo1234

SET @demo = '$argon2id$v=19$m=19456,t=2,p=1$sAY/by+Y+SUYyMEV46GE7w$Pbgp4kbr0EKk3mwvwxBkF2Q42ssRSc1aQiSzDJsXI5I';

INSERT INTO usuarios (rol_id, nombre, apellido, email, password_hash, activo) VALUES
((SELECT id FROM roles WHERE nombre = 'ADMINISTRADOR'), 'Ana', 'Administradora', 'admin@example.com', @demo, TRUE),
((SELECT id FROM roles WHERE nombre = 'SECRETARIA'), 'Sofía', 'Secretaria', 'secretaria@example.com', @demo, TRUE),
(NULL, NULL, NULL, 'coach@example.com', @demo, TRUE),
(NULL, NULL, NULL, 'tutor@example.com', @demo, TRUE),
((SELECT id FROM roles WHERE nombre = 'SECRETARIA'), 'Usuario', 'Inactivo', 'baja@example.com', @demo, FALSE),
(NULL, NULL, NULL, 'marta@example.com', @demo, TRUE)
ON DUPLICATE KEY UPDATE email = email;

-- Perfiles: TUTOR y ENTRENADOR salen de tutores/entrenadores.usuario_id (MARIADB.md § 3).
INSERT IGNORE INTO entrenadores (usuario_id, nombre, apellido_paterno, email)
SELECT id, 'Carlos', 'Pérez', email FROM usuarios WHERE email = 'coach@example.com'
UNION ALL
SELECT id, 'Marta', 'Díaz', email FROM usuarios WHERE email = 'marta@example.com';

INSERT IGNORE INTO tutores (usuario_id, nombre, apellido_paterno, email)
SELECT id, 'Teresa', 'López', email FROM usuarios WHERE email = 'tutor@example.com'
UNION ALL
SELECT id, 'Marta', 'Díaz', email FROM usuarios WHERE email = 'marta@example.com';

-- Datos deportivos mínimos (los de MockDb): temporada actual, sus categorías y los jugadores de demostración.
-- Personas ficticias. Idempotente por las claves únicas (temporadas.nombre, categorias(temporada_id, nombre),
-- jugadores.identificador).
INSERT IGNORE INTO temporadas (nombre, fecha_inicio, fecha_fin, activa, es_actual) VALUES
('Temporada 2026-2027', '2026-08-01', '2027-06-30', TRUE, TRUE);

INSERT IGNORE INTO categorias (temporada_id, nombre, edad_minima, edad_maxima, cupo_maximo)
SELECT t.id, c.nombre, c.edad_minima, c.edad_maxima, c.cupo_maximo
  FROM temporadas t
  JOIN (SELECT 'Sub-10' AS nombre, 8 AS edad_minima, 10 AS edad_maxima, 20 AS cupo_maximo
        UNION ALL SELECT 'Sub-12', 10, 12, 2
        UNION ALL SELECT 'Sub-8', 6, 8, NULL) c
 WHERE t.nombre = 'Temporada 2026-2027';

INSERT IGNORE INTO jugadores
  (identificador, nombre, apellido_paterno, apellido_materno, fecha_nacimiento, sexo, direccion, estatus) VALUES
('J-0001', 'Diego', 'Hernández', 'López', '2016-03-12', 'M', 'Calle Pino 12', 'ACTIVO'),
('J-0002', 'Lucía', 'Hernández', 'López', '2014-07-01', 'F', 'Calle Pino 12', 'ACTIVO'),
('J-0003', 'Mateo', 'Ruiz', NULL, '2016-11-20', 'M', NULL, 'ACTIVO'),
('J-0004', 'Valeria', 'Soto', 'Mena', '2014-02-05', 'F', NULL, 'BAJA_TEMPORAL'),
('J-0005', 'Emiliano', 'Díaz', NULL, '2017-05-09', 'M', NULL, 'ACTIVO'),
('J-0006', 'Sofía', 'Ruiz', NULL, '2015-01-15', 'F', NULL, 'ACTIVO');

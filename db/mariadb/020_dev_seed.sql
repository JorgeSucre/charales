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

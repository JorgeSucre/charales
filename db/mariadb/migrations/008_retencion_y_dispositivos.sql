-- 008 · Cierre de la remediación 2026. Idempotente. Tampoco borra nada que otra versión necesite: origen_conocido sólo la
-- creó 007, que nunca se publicó fuera de la rama de remediación, y guarda únicamente hashes.
--
-- correo_saliente (N-06): la dirección deja de conservarse sin límite. `cerrado_en` marca cuándo un mensaje dejó de
-- necesitar envío; pasada la retención se anonimiza (sin destinatario, usuario, token ni referencia del proveedor) y los
-- metadatos que quedan se borran más tarde. Las filas pendientes o en proceso no se tocan (api/mail.ts, purgeMailOutbox).
ALTER TABLE correo_saliente
    MODIFY destinatario VARCHAR(150) NULL,
    MODIFY usuario_id BIGINT UNSIGNED NULL,
    ADD COLUMN IF NOT EXISTS cerrado_en DATETIME NULL AFTER enviado_en,
    ADD COLUMN IF NOT EXISTS anonimizado_en DATETIME NULL AFTER cerrado_en;
UPDATE correo_saliente
   SET cerrado_en = COALESCE(enviado_en, proximo_intento, creado_en)
 WHERE estado IN ('ENVIADO', 'FALLIDO') AND cerrado_en IS NULL;
CREATE INDEX IF NOT EXISTS ix_correo_saliente_anonimizado ON correo_saliente (anonimizado_en, cerrado_en);

-- dispositivo_confiable: un navegador desde el que una cuenta ya entró (api/device-trust.ts). Sustituye a la confianza por
-- red: una red la comparten otras personas, un navegador no. `clave` es el SHA-256 del secreto de la cookie, y `cuenta` el
-- de la cuenta: no guarda el secreto, el correo ni la IP. Da una sola cosa: no gastar el límite por cuenta. Nunca evita la
-- contraseña, y `fallos` lo invalida tras 5 errores seguidos.
CREATE TABLE IF NOT EXISTS dispositivo_confiable (
    clave CHAR(64) NOT NULL PRIMARY KEY,
    cuenta CHAR(64) NOT NULL,
    usuario_id BIGINT UNSIGNED NOT NULL,
    fallos TINYINT UNSIGNED NOT NULL DEFAULT 0,
    creado_en DATETIME NOT NULL,
    vence_en DATETIME NOT NULL,
    KEY ix_dispositivo_usuario (usuario_id, creado_en),
    KEY ix_dispositivo_vence (vence_en),
    CONSTRAINT fk_dispositivo_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB;

DROP TABLE IF EXISTS origen_conocido;

-- limite_acceso: la parte de cada red en el presupuesto de una cuenta (api/login-limit.ts).
ALTER TABLE limite_acceso
    MODIFY ambito ENUM('CUENTA', 'IP', 'CUENTA_IP', 'RECUP_IP', 'RECUP_CUENTA', 'CAMBIO', 'CUENTA_RED') NOT NULL;

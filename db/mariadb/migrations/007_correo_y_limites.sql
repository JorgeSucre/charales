-- 007 · Correcciones de la auditoría Fase 5 (2026-11-05). Aditiva e idempotente. Para revertirla: DROP TABLE
-- correo_saliente, origen_conocido (la API anterior no las usa); los ámbitos nuevos de limite_acceso no estorban.
--
-- Las migraciones se reejecutan completas: este ENUM debe contener todos los ámbitos que usa la API, o esta sentencia
-- fallaría (o vaciaría el ámbito) sobre las filas existentes. 008 define el mismo. Si se añade uno, va en los dos.
-- limite_acceso: ámbitos nuevos, para que los límites de recuperación (RECUP_IP, RECUP_CUENTA) y de cambio de contraseña
-- (CAMBIO) se compartan entre procesos y no acumulen memoria. CUENTA ya existía: lo vuelve a usar el límite por cuenta de
-- R-1, ahora sólo para orígenes desconocidos, de modo que un atacante no bloquee a la persona desde donde suele entrar.
ALTER TABLE limite_acceso
    MODIFY ambito ENUM('CUENTA', 'IP', 'CUENTA_IP', 'RECUP_IP', 'RECUP_CUENTA', 'CAMBIO', 'CUENTA_RED') NOT NULL;

-- origen_conocido: una cuenta inició sesión correctamente desde esta red (IPv4 o /64 de IPv6). `clave` es un SHA-256:
-- no guarda correos ni IP. Las filas se borran solas pasados 90 días sin uso.
CREATE TABLE IF NOT EXISTS origen_conocido (
    clave CHAR(64) NOT NULL PRIMARY KEY,
    visto_en DATETIME NOT NULL,
    KEY ix_origen_conocido_visto (visto_en)
) ENGINE=InnoDB;

-- correo_saliente: bandeja de salida transaccional. La fila se confirma junto con la operación que pide el correo, así
-- que un fallo del proveedor no pierde el aviso ni deshace la cuenta. No guarda el cuerpo ni el token: un reintento emite
-- un token nuevo y revoca el anterior (tokens_recuperacion sólo guarda hashes).
CREATE TABLE IF NOT EXISTS correo_saliente (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    usuario_id BIGINT UNSIGNED NOT NULL,
    token_id BIGINT UNSIGNED NULL,
    finalidad ENUM('RECUPERACION', 'INVITACION') NOT NULL,
    destinatario VARCHAR(150) NOT NULL,
    asunto VARCHAR(200) NOT NULL,
    estado ENUM('PENDIENTE', 'ENVIANDO', 'ENVIADO', 'FALLIDO') NOT NULL DEFAULT 'PENDIENTE',
    intentos INT UNSIGNED NOT NULL DEFAULT 0,
    proximo_intento DATETIME NOT NULL,
    bloqueado_hasta DATETIME NULL,
    vence_en DATETIME NOT NULL,
    proveedor_id VARCHAR(120) NULL,
    ultimo_error VARCHAR(60) NULL,
    creado_en DATETIME NOT NULL,
    enviado_en DATETIME NULL,
    KEY ix_correo_saliente_cola (estado, proximo_intento),
    CONSTRAINT fk_correo_saliente_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
) ENGINE=InnoDB;

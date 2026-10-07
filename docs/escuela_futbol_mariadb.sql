-- ============================================================
-- ESCUELA DE FÚTBOL - MODELO RELACIONAL
-- MariaDB 10.6+
-- Generado a partir de las historias de usuario del proyecto
-- ============================================================

CREATE DATABASE IF NOT EXISTS escuela_futbol
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE escuela_futbol;

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- SEGURIDAD Y ACCESO
-- ============================================================

DROP TABLE IF EXISTS auditoria;
DROP TABLE IF EXISTS sesiones;
DROP TABLE IF EXISTS tokens_recuperacion;
DROP TABLE IF EXISTS rol_permiso;
DROP TABLE IF EXISTS permisos;
DROP TABLE IF EXISTS usuarios;
DROP TABLE IF EXISTS roles;

/* SEGURIDAD: se asigna a una cuenta (usuarios.rol_id).
   PERFIL: TUTOR/ENTRENADOR; nunca se asigna, lo otorga tener un perfil ligado
   (tutores.usuario_id / entrenadores.usuario_id). Sus permisos viven igual en rol_permiso. */
CREATE TABLE roles (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    tipo ENUM('SEGURIDAD','PERFIL') NOT NULL,
    descripcion VARCHAR(255),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_rol_id_tipo (id, tipo) /* Destino de la FK compuesta de usuarios */
) ENGINE=InnoDB;

CREATE TABLE permisos (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    modulo VARCHAR(80) NOT NULL, /* Ejemplo: 'usuarios', 'jugadores', 'categorias', etc. */
    accion ENUM('consultar','crear','editar','cancelar') NOT NULL,
    descripcion VARCHAR(255),
    UNIQUE KEY uq_permiso_modulo_accion (modulo, accion)
) ENGINE=InnoDB;

CREATE TABLE rol_permiso (
    rol_id BIGINT UNSIGNED NOT NULL,
    permiso_id BIGINT UNSIGNED NOT NULL,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (rol_id, permiso_id),
    CONSTRAINT fk_rol_permiso_rol
        FOREIGN KEY (rol_id) REFERENCES roles(id),
    CONSTRAINT fk_rol_permiso_permiso
        FOREIGN KEY (permiso_id) REFERENCES permisos(id)
) ENGINE=InnoDB;

/* Cuenta de acceso. Los datos de tutores y entrenadores viven en su perfil;
   nombre/apellido sólo existen para cuentas con rol de SEGURIDAD (personal sin perfil de dominio).
   Último acceso = MAX(sesiones.inicio_en). Baja = activo FALSE (nunca se borra). */
CREATE TABLE usuarios (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    rol_id BIGINT UNSIGNED NULL, /* NULL = cuenta sólo de tutor y/o entrenador */
    rol_tipo ENUM('SEGURIDAD','PERFIL') NOT NULL DEFAULT 'SEGURIDAD',
    nombre VARCHAR(100) NULL,
    apellido VARCHAR(100) NULL,
    email VARCHAR(150) NOT NULL UNIQUE, /* Identificador de login; la collation _ci lo hace único sin importar mayúsculas */
    password_hash VARCHAR(255) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_usuario_rol
        FOREIGN KEY (rol_id, rol_tipo) REFERENCES roles(id, tipo),
    CONSTRAINT chk_usuario_rol_seguridad CHECK (rol_tipo = 'SEGURIDAD'),
    CONSTRAINT chk_usuario_nombre_personal CHECK (
        (rol_id IS NULL AND nombre IS NULL AND apellido IS NULL) OR
        (rol_id IS NOT NULL AND nombre IS NOT NULL)
    ),
    INDEX idx_usuario_activo (activo)
) ENGINE=InnoDB;

CREATE TABLE sesiones (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    usuario_id BIGINT UNSIGNED NOT NULL,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    inicio_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expira_en DATETIME NOT NULL,
    ultimo_uso_en DATETIME NULL,
    cerrada_en DATETIME NULL,
    ip VARCHAR(45),
    user_agent VARCHAR(500),
    CONSTRAINT fk_sesion_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    CONSTRAINT chk_sesion_expira CHECK (expira_en > inicio_en),
    INDEX idx_sesion_usuario (usuario_id),
    INDEX idx_sesion_expira (expira_en)
) ENGINE=InnoDB;

CREATE TABLE tokens_recuperacion (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    usuario_id BIGINT UNSIGNED NOT NULL,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expira_en DATETIME NOT NULL,
    usado_en DATETIME NULL,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_token_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    CONSTRAINT chk_token_expira CHECK (expira_en > creado_en),
    INDEX idx_token_usuario (usuario_id),
    INDEX idx_token_expira (expira_en)
) ENGINE=InnoDB;

-- ============================================================
-- JUGADORES Y TUTORES
-- ============================================================

DROP TABLE IF EXISTS tutor_jugador;
DROP TABLE IF EXISTS historial_estatus;
DROP TABLE IF EXISTS tutores;
DROP TABLE IF EXISTS jugadores;

CREATE TABLE jugadores (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    identificador VARCHAR(30) NOT NULL UNIQUE,
    nombre VARCHAR(100) NOT NULL,
    apellido_paterno VARCHAR(100) NOT NULL,
    apellido_materno VARCHAR(100),
    fecha_nacimiento DATE NOT NULL,
    sexo ENUM('F','M','OTRO','NO_ESPECIFICADO') NOT NULL DEFAULT 'NO_ESPECIFICADO',
    telefono VARCHAR(30), /* Contacto propio del jugador (HU-008); el de la familia sale de tutor_jugador */
    email VARCHAR(150),
    direccion VARCHAR(255),
    estatus ENUM('ACTIVO','BAJA_TEMPORAL','BAJA_DEFINITIVA') NOT NULL DEFAULT 'ACTIVO',
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_jugador_nombre (apellido_paterno, apellido_materno, nombre),
    INDEX idx_jugador_estatus (estatus),
    INDEX idx_jugador_fecha_nacimiento (fecha_nacimiento)
) ENGINE=InnoDB;

/* Perfil del tutor; existe con o sin cuenta. usuario_id ligado = acceso al portal.
   El parentesco es por jugador (tutor_jugador). Email/teléfono = contacto, no login. */
CREATE TABLE tutores (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    usuario_id BIGINT UNSIGNED NULL UNIQUE,
    nombre VARCHAR(100) NOT NULL,
    apellido_paterno VARCHAR(100) NOT NULL,
    apellido_materno VARCHAR(100),
    telefono VARCHAR(30),
    email VARCHAR(150),
    direccion VARCHAR(255),
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_tutor_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    INDEX idx_tutor_nombre (apellido_paterno, apellido_materno, nombre)
) ENGINE=InnoDB;

CREATE TABLE tutor_jugador (
    tutor_id BIGINT UNSIGNED NOT NULL,
    jugador_id BIGINT UNSIGNED NOT NULL,
    parentesco VARCHAR(50) NOT NULL, /* Ejemplo: 'Padre', 'Madre', 'Abuelo', 'Tío', etc. */
    es_contacto_principal BOOLEAN NOT NULL DEFAULT FALSE,
    /* Sin índices parciales en MariaDB: NULL salvo en el principal, y UNIQUE ignora los NULL */
    principal_de_jugador_id BIGINT UNSIGNED AS (IF(es_contacto_principal, jugador_id, NULL)) PERSISTENT,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tutor_id, jugador_id),
    UNIQUE KEY uq_tutor_jugador_un_principal (principal_de_jugador_id),
    INDEX idx_tutor_jugador_jugador (jugador_id),
    CONSTRAINT fk_tutor_jugador_tutor
        FOREIGN KEY (tutor_id) REFERENCES tutores(id),
    CONSTRAINT fk_tutor_jugador_jugador
        FOREIGN KEY (jugador_id) REFERENCES jugadores(id)
) ENGINE=InnoDB;

CREATE TABLE historial_estatus (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    jugador_id BIGINT UNSIGNED NOT NULL,
    estatus_anterior ENUM('ACTIVO','BAJA_TEMPORAL','BAJA_DEFINITIVA') NULL,
    estatus_nuevo ENUM('ACTIVO','BAJA_TEMPORAL','BAJA_DEFINITIVA') NOT NULL,
    motivo VARCHAR(255),
    cambiado_por BIGINT UNSIGNED NULL,
    cambiado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_hist_estatus_jugador
        FOREIGN KEY (jugador_id) REFERENCES jugadores(id),
    CONSTRAINT fk_hist_estatus_usuario
        FOREIGN KEY (cambiado_por) REFERENCES usuarios(id),
    CONSTRAINT chk_hist_estatus_cambio CHECK (estatus_anterior IS NULL OR estatus_anterior <> estatus_nuevo),
    INDEX idx_hist_estatus_jugador (jugador_id, cambiado_en)
) ENGINE=InnoDB;

-- ============================================================
-- CATÁLOGOS: TEMPORADAS, SEDES, CATEGORÍAS
-- ============================================================

DROP TABLE IF EXISTS temporadas;
DROP TABLE IF EXISTS sedes;
DROP TABLE IF EXISTS categorias;

CREATE TABLE temporadas (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    es_actual BOOLEAN NOT NULL DEFAULT FALSE,
    /* Sin índices parciales: 1 sólo en la actual, NULL en las demás (HU-070: "una temporada puede marcarse actual") */
    actual_unica TINYINT AS (IF(es_actual, 1, NULL)) PERSISTENT,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_temporada_fechas CHECK (fecha_fin >= fecha_inicio),
    CONSTRAINT chk_temporada_actual_activa CHECK (NOT es_actual OR activa),
    UNIQUE KEY uq_temporada_actual (actual_unica)
) ENGINE=InnoDB;

CREATE TABLE sedes (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    ubicacion VARCHAR(255),
    referencia VARCHAR(255),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE categorias (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    temporada_id BIGINT UNSIGNED NULL,
    nombre VARCHAR(100) NOT NULL,
    edad_minima TINYINT UNSIGNED NOT NULL,
    edad_maxima TINYINT UNSIGNED NOT NULL,
    cupo_maximo SMALLINT UNSIGNED NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_categoria_temporada
        FOREIGN KEY (temporada_id) REFERENCES temporadas(id),
    CONSTRAINT chk_categoria_edades CHECK (edad_maxima >= edad_minima),
    UNIQUE KEY uq_categoria_temporada_nombre (temporada_id, nombre)
) ENGINE=InnoDB;

-- ============================================================
-- INSCRIPCIONES Y CATEGORÍAS
-- ============================================================

DROP TABLE IF EXISTS historial_categoria;
DROP TABLE IF EXISTS jugador_categoria;
DROP TABLE IF EXISTS inscripciones;

CREATE TABLE inscripciones (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    jugador_id BIGINT UNSIGNED NOT NULL,
    temporada_id BIGINT UNSIGNED NOT NULL, /* HU-020: guarda ciclo/temporada y evita duplicar el mismo ciclo */
    fecha_inscripcion DATE NOT NULL,
    monto DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    estatus ENUM('PENDIENTE','ACTIVA','CANCELADA','FINALIZADA') NOT NULL DEFAULT 'PENDIENTE',
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_inscripcion_jugador
        FOREIGN KEY (jugador_id) REFERENCES jugadores(id),
    CONSTRAINT fk_inscripcion_temporada
        FOREIGN KEY (temporada_id) REFERENCES temporadas(id),
    CONSTRAINT chk_inscripcion_monto CHECK (monto >= 0),
    UNIQUE KEY uq_inscripcion_jugador_temporada (jugador_id, temporada_id)
) ENGINE=InnoDB;

CREATE TABLE jugador_categoria (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    jugador_id BIGINT UNSIGNED NOT NULL,
    categoria_id BIGINT UNSIGNED NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NULL,
    es_excepcion_edad BOOLEAN NOT NULL DEFAULT FALSE,
    motivo_excepcion VARCHAR(255),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    /* Vigente = fecha_fin NULL; una sola por jugador (HU-019, HU-061, HU-062). NULL en las cerradas */
    vigente_de_jugador_id BIGINT UNSIGNED AS (IF(fecha_fin IS NULL, jugador_id, NULL)) PERSISTENT,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_jugador_categoria_jugador
        FOREIGN KEY (jugador_id) REFERENCES jugadores(id),
    CONSTRAINT fk_jugador_categoria_categoria
        FOREIGN KEY (categoria_id) REFERENCES categorias(id),
    CONSTRAINT chk_jugador_categoria_fechas CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio),
    CONSTRAINT chk_jugador_categoria_activo CHECK (activo OR fecha_fin IS NOT NULL),
    UNIQUE KEY uq_jugador_categoria_vigente (vigente_de_jugador_id),
    INDEX idx_jugador_categoria_jugador (jugador_id),
    INDEX idx_jugador_categoria_categoria (categoria_id),
    INDEX idx_jugador_categoria_activo (activo)
) ENGINE=InnoDB;

CREATE TABLE historial_categoria (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    jugador_id BIGINT UNSIGNED NOT NULL,
    categoria_anterior_id BIGINT UNSIGNED NULL,
    categoria_nueva_id BIGINT UNSIGNED NOT NULL,
    motivo VARCHAR(255),
    cambiado_por BIGINT UNSIGNED NULL,
    cambiado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_hist_categoria_jugador
        FOREIGN KEY (jugador_id) REFERENCES jugadores(id),
    CONSTRAINT fk_hist_categoria_anterior
        FOREIGN KEY (categoria_anterior_id) REFERENCES categorias(id),
    CONSTRAINT fk_hist_categoria_nueva
        FOREIGN KEY (categoria_nueva_id) REFERENCES categorias(id),
    CONSTRAINT fk_hist_categoria_usuario
        FOREIGN KEY (cambiado_por) REFERENCES usuarios(id),
    CONSTRAINT chk_hist_categoria_cambio CHECK (
        categoria_anterior_id IS NULL OR categoria_anterior_id <> categoria_nueva_id
    )
) ENGINE=InnoDB;

-- ============================================================
-- ENTRENADORES
-- ============================================================

DROP TABLE IF EXISTS entrenador_categoria;
DROP TABLE IF EXISTS entrenadores;

/* Perfil del entrenador; existe con o sin cuenta. Puede compartir usuario_id con un tutor.
   activo = estatus deportivo (HU-022), distinto de usuarios.activo (puede iniciar sesión). */
CREATE TABLE entrenadores (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    usuario_id BIGINT UNSIGNED NULL UNIQUE,
    nombre VARCHAR(100) NOT NULL,
    apellido_paterno VARCHAR(100) NOT NULL,
    apellido_materno VARCHAR(100),
    telefono VARCHAR(30),
    email VARCHAR(150),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_entrenador_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    INDEX idx_entrenador_nombre (apellido_paterno, apellido_materno, nombre)
) ENGINE=InnoDB;

CREATE TABLE entrenador_categoria (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    entrenador_id BIGINT UNSIGNED NOT NULL,
    categoria_id BIGINT UNSIGNED NOT NULL,
    rol_responsabilidad VARCHAR(100),
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ent_cat_entrenador
        FOREIGN KEY (entrenador_id) REFERENCES entrenadores(id),
    CONSTRAINT fk_ent_cat_categoria
        FOREIGN KEY (categoria_id) REFERENCES categorias(id),
    CONSTRAINT chk_ent_cat_fechas CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio),
    CONSTRAINT chk_ent_cat_activo CHECK (activo OR fecha_fin IS NOT NULL),
    UNIQUE KEY uq_entrenador_categoria_inicio (entrenador_id, categoria_id, fecha_inicio),
    INDEX idx_ent_cat_categoria (categoria_id),
    INDEX idx_ent_cat_entrenador (entrenador_id)
) ENGINE=InnoDB;

-- ============================================================
-- HORARIOS Y ENTRENAMIENTOS
-- ============================================================

DROP TABLE IF EXISTS asistencias;
DROP TABLE IF EXISTS sesiones_entrenamiento;
DROP TABLE IF EXISTS horarios_entrenamiento;

CREATE TABLE horarios_entrenamiento (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    categoria_id BIGINT UNSIGNED NOT NULL,
    sede_id BIGINT UNSIGNED NOT NULL,
    dia_semana TINYINT UNSIGNED NOT NULL COMMENT '1=Lunes ... 7=Domingo',
    hora_inicio TIME NOT NULL,
    hora_fin TIME NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_horario_categoria
        FOREIGN KEY (categoria_id) REFERENCES categorias(id),
    CONSTRAINT fk_horario_sede
        FOREIGN KEY (sede_id) REFERENCES sedes(id),
    CONSTRAINT chk_horario_dia CHECK (dia_semana BETWEEN 1 AND 7),
    CONSTRAINT chk_horario_horas CHECK (hora_fin > hora_inicio),
    UNIQUE KEY uq_horario_id_categoria (id, categoria_id), /* Destino de la FK compuesta de sesiones_entrenamiento */
    INDEX idx_horario_categoria (categoria_id)
) ENGINE=InnoDB;

CREATE TABLE sesiones_entrenamiento (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    categoria_id BIGINT UNSIGNED NOT NULL,
    sede_id BIGINT UNSIGNED NOT NULL,
    entrenador_id BIGINT UNSIGNED NULL,
    horario_id BIGINT UNSIGNED NULL,
    fecha DATE NOT NULL,
    hora_inicio TIME NOT NULL,
    hora_fin TIME NOT NULL,
    estado ENUM('PROGRAMADO','REALIZADO','CANCELADO') NOT NULL DEFAULT 'PROGRAMADO',
    objetivo VARCHAR(255),
    observaciones TEXT,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_sesion_ent_categoria
        FOREIGN KEY (categoria_id) REFERENCES categorias(id),
    CONSTRAINT fk_sesion_ent_sede
        FOREIGN KEY (sede_id) REFERENCES sedes(id),
    CONSTRAINT fk_sesion_ent_entrenador
        FOREIGN KEY (entrenador_id) REFERENCES entrenadores(id),
    /* El horario debe ser de la misma categoría. Con horario_id NULL la FK no se evalúa. */
    CONSTRAINT fk_sesion_ent_horario
        FOREIGN KEY (horario_id, categoria_id) REFERENCES horarios_entrenamiento(id, categoria_id),
    CONSTRAINT chk_sesion_ent_horas CHECK (hora_fin > hora_inicio),
    INDEX idx_sesion_ent_fecha (fecha),
    INDEX idx_sesion_ent_categoria (categoria_id),
    INDEX idx_sesion_ent_entrenador (entrenador_id)
) ENGINE=InnoDB;

CREATE TABLE asistencias (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    sesion_entrenamiento_id BIGINT UNSIGNED NOT NULL,
    jugador_id BIGINT UNSIGNED NOT NULL,
    estado ENUM('PRESENTE','AUSENTE','JUSTIFICADO') NOT NULL,
    observaciones VARCHAR(255),
    registrado_por BIGINT UNSIGNED NULL,
    registrado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_asistencia_sesion
        FOREIGN KEY (sesion_entrenamiento_id) REFERENCES sesiones_entrenamiento(id),
    CONSTRAINT fk_asistencia_jugador
        FOREIGN KEY (jugador_id) REFERENCES jugadores(id),
    CONSTRAINT fk_asistencia_usuario
        FOREIGN KEY (registrado_por) REFERENCES usuarios(id),
    UNIQUE KEY uq_asistencia_sesion_jugador (sesion_entrenamiento_id, jugador_id),
    INDEX idx_asistencia_jugador (jugador_id)
) ENGINE=InnoDB;

-- ============================================================
-- COMPETENCIAS
-- ============================================================

DROP TABLE IF EXISTS entrenador_competencia_categoria;
DROP TABLE IF EXISTS jugador_competencia_categoria;
DROP TABLE IF EXISTS partidos;
DROP TABLE IF EXISTS competencia_categoria;
DROP TABLE IF EXISTS rivales;
DROP TABLE IF EXISTS competencias;

CREATE TABLE competencias (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    temporada_id BIGINT UNSIGNED NULL,
    nombre VARCHAR(150) NOT NULL,
    tipo ENUM('TORNEO','LIGA','OTRO') NOT NULL DEFAULT 'TORNEO',
    organizador VARCHAR(150),
    contacto VARCHAR(150),
    fecha_inicio DATE,
    fecha_fin DATE,
    estado ENUM('PLANIFICADA','ACTIVA','FINALIZADA','CANCELADA') NOT NULL DEFAULT 'PLANIFICADA',
    observaciones TEXT,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_competencia_temporada
        FOREIGN KEY (temporada_id) REFERENCES temporadas(id),
    CONSTRAINT chk_competencia_fechas CHECK (
        fecha_fin IS NULL OR fecha_inicio IS NULL OR fecha_fin >= fecha_inicio
    )
) ENGINE=InnoDB;

CREATE TABLE competencia_categoria (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    competencia_id BIGINT UNSIGNED NOT NULL,
    categoria_id BIGINT UNSIGNED NOT NULL,
    fecha_inscripcion DATE NOT NULL,
    costo DECIMAL(12,2) NULL,
    estatus ENUM('PENDIENTE','INSCRITA','BAJA','FINALIZADA') NOT NULL DEFAULT 'INSCRITA',
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_comp_cat_competencia
        FOREIGN KEY (competencia_id) REFERENCES competencias(id),
    CONSTRAINT fk_comp_cat_categoria
        FOREIGN KEY (categoria_id) REFERENCES categorias(id),
    CONSTRAINT chk_comp_cat_costo CHECK (costo IS NULL OR costo >= 0),
    UNIQUE KEY uq_competencia_categoria (competencia_id, categoria_id)
) ENGINE=InnoDB;

CREATE TABLE jugador_competencia_categoria (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    jugador_id BIGINT UNSIGNED NOT NULL,
    competencia_categoria_id BIGINT UNSIGNED NOT NULL,
    fecha_alta DATE NOT NULL,
    fecha_baja DATE NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_jcc_jugador
        FOREIGN KEY (jugador_id) REFERENCES jugadores(id),
    CONSTRAINT fk_jcc_comp_cat
        FOREIGN KEY (competencia_categoria_id) REFERENCES competencia_categoria(id),
    CONSTRAINT chk_jcc_fechas CHECK (fecha_baja IS NULL OR fecha_baja >= fecha_alta),
    CONSTRAINT chk_jcc_activo CHECK (activo OR fecha_baja IS NOT NULL),
    UNIQUE KEY uq_jugador_competencia_categoria (jugador_id, competencia_categoria_id),
    INDEX idx_jcc_competencia_categoria (competencia_categoria_id)
) ENGINE=InnoDB;

CREATE TABLE entrenador_competencia_categoria (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    entrenador_id BIGINT UNSIGNED NOT NULL,
    competencia_categoria_id BIGINT UNSIGNED NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ecc_entrenador
        FOREIGN KEY (entrenador_id) REFERENCES entrenadores(id),
    CONSTRAINT fk_ecc_comp_cat
        FOREIGN KEY (competencia_categoria_id) REFERENCES competencia_categoria(id),
    CONSTRAINT chk_ecc_fechas CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio),
    CONSTRAINT chk_ecc_activo CHECK (activo OR fecha_fin IS NOT NULL),
    UNIQUE KEY uq_entrenador_comp_cat (entrenador_id, competencia_categoria_id),
    INDEX idx_ecc_entrenador (entrenador_id)
) ENGINE=InnoDB;

CREATE TABLE rivales (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL UNIQUE,
    contacto VARCHAR(150),
    observaciones VARCHAR(255),
    activo BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE partidos (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    competencia_categoria_id BIGINT UNSIGNED NOT NULL,
    rival_id BIGINT UNSIGNED NULL,
    sede_id BIGINT UNSIGNED NULL,
    fecha DATE NOT NULL,
    hora TIME NOT NULL,
    local_visitante ENUM('LOCAL','VISITANTE') NOT NULL DEFAULT 'LOCAL',
    goles_favor SMALLINT UNSIGNED NULL,
    goles_contra SMALLINT UNSIGNED NULL,
    estado ENUM('PROGRAMADO','JUGADO','CANCELADO','REPROGRAMADO') NOT NULL DEFAULT 'PROGRAMADO',
    motivo_reprogramacion VARCHAR(255),
    observaciones TEXT,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_partido_comp_cat
        FOREIGN KEY (competencia_categoria_id) REFERENCES competencia_categoria(id),
    CONSTRAINT fk_partido_rival
        FOREIGN KEY (rival_id) REFERENCES rivales(id),
    CONSTRAINT fk_partido_sede
        FOREIGN KEY (sede_id) REFERENCES sedes(id),
    /* Marcador completo o vacío, y sólo en partidos jugados (UNSIGNED ya impide negativos) */
    CONSTRAINT chk_partido_goles CHECK (
        (goles_favor IS NULL) = (goles_contra IS NULL) AND
        (goles_favor IS NULL OR estado = 'JUGADO')
    ),
    INDEX idx_partido_fecha (fecha),
    INDEX idx_partido_comp_cat (competencia_categoria_id)
) ENGINE=InnoDB;

-- ============================================================
-- PAGOS Y COBRANZA
-- ============================================================

DROP TABLE IF EXISTS descuentos;
DROP TABLE IF EXISTS pago_aplicacion;
DROP TABLE IF EXISTS pagos;
DROP TABLE IF EXISTS cargos;
DROP TABLE IF EXISTS conceptos_cobro;

CREATE TABLE conceptos_cobro (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    importe_sugerido DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    recurrente BOOLEAN NOT NULL DEFAULT FALSE,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_concepto_importe CHECK (importe_sugerido >= 0)
) ENGINE=InnoDB;

CREATE TABLE cargos (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    jugador_id BIGINT UNSIGNED NOT NULL,
    concepto_id BIGINT UNSIGNED NOT NULL,
    temporada_id BIGINT UNSIGNED NULL,
    periodo VARCHAR(20),
    fecha_cargo DATE NOT NULL,
    fecha_vencimiento DATE NULL,
    monto_original DECIMAL(12,2) NOT NULL,
    estado ENUM('PENDIENTE','PARCIAL','PAGADO','VENCIDO','CANCELADO') NOT NULL DEFAULT 'PENDIENTE',
    referencia VARCHAR(100),
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_cargo_jugador
        FOREIGN KEY (jugador_id) REFERENCES jugadores(id),
    CONSTRAINT fk_cargo_concepto
        FOREIGN KEY (concepto_id) REFERENCES conceptos_cobro(id),
    CONSTRAINT fk_cargo_temporada
        FOREIGN KEY (temporada_id) REFERENCES temporadas(id),
    CONSTRAINT chk_cargo_monto CHECK (monto_original >= 0),
    CONSTRAINT chk_cargo_periodo CHECK (periodo IS NULL OR periodo REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])$'), /* 'YYYY-MM' (HU-044) */
    UNIQUE KEY uq_cargo_id_jugador (id, jugador_id), /* Destino de FKs compuestas: mismo jugador */
    INDEX idx_cargo_jugador (jugador_id),
    INDEX idx_cargo_vencimiento (fecha_vencimiento),
    INDEX idx_cargo_estado (estado),
    UNIQUE KEY uq_cargo_periodo_concepto (jugador_id, concepto_id, periodo)
) ENGINE=InnoDB;

CREATE TABLE pagos (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    folio VARCHAR(50) NOT NULL UNIQUE,
    jugador_id BIGINT UNSIGNED NOT NULL,
    tutor_id BIGINT UNSIGNED NULL,
    fecha_pago DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    importe DECIMAL(12,2) NOT NULL,
    forma_pago ENUM('EFECTIVO','TRANSFERENCIA','TARJETA','OTRO') NOT NULL,
    estado ENUM('APLICADO','CANCELADO') NOT NULL DEFAULT 'APLICADO',
    motivo_cancelacion VARCHAR(255),
    registrado_por BIGINT UNSIGNED NULL,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pago_jugador
        FOREIGN KEY (jugador_id) REFERENCES jugadores(id),
    /* Quien paga debe ser tutor de ESE jugador. Con tutor_id NULL la FK no se evalúa. */
    CONSTRAINT fk_pago_tutor_jugador
        FOREIGN KEY (tutor_id, jugador_id) REFERENCES tutor_jugador(tutor_id, jugador_id),
    CONSTRAINT fk_pago_usuario
        FOREIGN KEY (registrado_por) REFERENCES usuarios(id),
    CONSTRAINT chk_pago_importe CHECK (importe > 0),
    CONSTRAINT chk_pago_cancelacion CHECK ((estado = 'CANCELADO') = (motivo_cancelacion IS NOT NULL)),
    UNIQUE KEY uq_pago_id_jugador (id, jugador_id), /* Destino de la FK compuesta de pago_aplicacion */
    INDEX idx_pago_jugador_fecha (jugador_id, fecha_pago),
    INDEX idx_pago_estado (estado)
) ENGINE=InnoDB;

CREATE TABLE pago_aplicacion (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    pago_id BIGINT UNSIGNED NOT NULL,
    cargo_id BIGINT UNSIGNED NOT NULL,
    jugador_id BIGINT UNSIGNED NOT NULL, /* Sólo para que ambas FKs exijan el mismo jugador */
    importe_aplicado DECIMAL(12,2) NOT NULL,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pago_aplicacion_pago
        FOREIGN KEY (pago_id, jugador_id) REFERENCES pagos(id, jugador_id),
    CONSTRAINT fk_pago_aplicacion_cargo
        FOREIGN KEY (cargo_id, jugador_id) REFERENCES cargos(id, jugador_id),
    CONSTRAINT chk_pago_aplicacion_importe CHECK (importe_aplicado > 0),
    UNIQUE KEY uq_pago_cargo (pago_id, cargo_id),
    INDEX idx_aplicacion_cargo (cargo_id)
) ENGINE=InnoDB;

CREATE TABLE descuentos (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cargo_id BIGINT UNSIGNED NOT NULL,
    tipo ENUM('DESCUENTO','BECA') NOT NULL,
    motivo VARCHAR(255) NOT NULL,
    monto_original DECIMAL(12,2) NOT NULL,
    monto_ajuste DECIMAL(12,2) NOT NULL,
    monto_final DECIMAL(12,2) AS (monto_original - monto_ajuste) PERSISTENT,
    autorizado_por BIGINT UNSIGNED NULL,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_descuento_cargo
        FOREIGN KEY (cargo_id) REFERENCES cargos(id),
    CONSTRAINT fk_descuento_usuario
        FOREIGN KEY (autorizado_por) REFERENCES usuarios(id),
    CONSTRAINT chk_descuento_montos CHECK (
        monto_ajuste >= 0 AND
        monto_ajuste <= monto_original
    )
) ENGINE=InnoDB;

-- ============================================================
-- UNIFORMES
-- ============================================================

DROP TABLE IF EXISTS detalle_uniforme;
DROP TABLE IF EXISTS pedidos_uniforme;
DROP TABLE IF EXISTS variantes_uniforme;
DROP TABLE IF EXISTS productos_uniforme;

CREATE TABLE productos_uniforme (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL UNIQUE,
    descripcion VARCHAR(255),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE variantes_uniforme (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    producto_id BIGINT UNSIGNED NOT NULL,
    talla VARCHAR(30) NOT NULL,
    precio DECIMAL(12,2) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_variante_producto
        FOREIGN KEY (producto_id) REFERENCES productos_uniforme(id),
    CONSTRAINT chk_variante_precio CHECK (precio >= 0),
    UNIQUE KEY uq_producto_talla (producto_id, talla)
) ENGINE=InnoDB;

CREATE TABLE pedidos_uniforme (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    jugador_id BIGINT UNSIGNED NOT NULL,
    fecha_solicitud DATE NOT NULL,
    estado ENUM('SOLICITADO','PAGADO','ENTREGADO','CANCELADO') NOT NULL DEFAULT 'SOLICITADO',
    cargo_id BIGINT UNSIGNED NULL,
    fecha_entrega DATE NULL,
    recibido_por VARCHAR(150),
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_pedido_uniforme_jugador
        FOREIGN KEY (jugador_id) REFERENCES jugadores(id),
    /* Un cargo por pedido y del mismo jugador. Con cargo_id NULL no se evalúan. */
    CONSTRAINT fk_pedido_uniforme_cargo
        FOREIGN KEY (cargo_id, jugador_id) REFERENCES cargos(id, jugador_id),
    CONSTRAINT chk_pedido_uniforme_entrega CHECK ((estado = 'ENTREGADO') = (fecha_entrega IS NOT NULL)),
    UNIQUE KEY uq_pedido_uniforme_cargo (cargo_id),
    INDEX idx_pedido_uniforme_jugador (jugador_id),
    INDEX idx_pedido_uniforme_estado (estado)
) ENGINE=InnoDB;

CREATE TABLE detalle_uniforme (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    pedido_id BIGINT UNSIGNED NOT NULL,
    variante_id BIGINT UNSIGNED NOT NULL,
    cantidad SMALLINT UNSIGNED NOT NULL,
    precio_unitario DECIMAL(12,2) NOT NULL,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_detalle_uniforme_pedido
        FOREIGN KEY (pedido_id) REFERENCES pedidos_uniforme(id),
    CONSTRAINT fk_detalle_uniforme_variante
        FOREIGN KEY (variante_id) REFERENCES variantes_uniforme(id),
    CONSTRAINT chk_detalle_uniforme_cantidad CHECK (cantidad > 0),
    CONSTRAINT chk_detalle_uniforme_precio CHECK (precio_unitario >= 0)
) ENGINE=InnoDB;

-- ============================================================
-- AVISOS
-- ============================================================

DROP TABLE IF EXISTS aviso_destinatario;
DROP TABLE IF EXISTS avisos;

CREATE TABLE avisos (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    creado_por BIGINT UNSIGNED NOT NULL,
    titulo VARCHAR(200) NOT NULL,
    mensaje TEXT NOT NULL,
    fecha_publicacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_inicio DATETIME NULL,
    fecha_fin DATETIME NULL,
    publicado BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_aviso_usuario
        FOREIGN KEY (creado_por) REFERENCES usuarios(id),
    CONSTRAINT chk_aviso_vigencia CHECK (
        fecha_fin IS NULL OR fecha_inicio IS NULL OR fecha_fin >= fecha_inicio
    ),
    INDEX idx_aviso_vigencia (publicado, fecha_inicio, fecha_fin)
) ENGINE=InnoDB;

CREATE TABLE aviso_destinatario (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    aviso_id BIGINT UNSIGNED NOT NULL,
    categoria_id BIGINT UNSIGNED NULL,
    tutor_id BIGINT UNSIGNED NULL,
    entrenador_id BIGINT UNSIGNED NULL,
    tipo_audiencia ENUM('GENERAL','CATEGORIA','TUTOR','ENTRENADOR') NOT NULL,
    CONSTRAINT fk_aviso_dest_aviso
        FOREIGN KEY (aviso_id) REFERENCES avisos(id),
    CONSTRAINT fk_aviso_dest_categoria
        FOREIGN KEY (categoria_id) REFERENCES categorias(id),
    CONSTRAINT fk_aviso_dest_tutor
        FOREIGN KEY (tutor_id) REFERENCES tutores(id),
    CONSTRAINT fk_aviso_dest_entrenador
        FOREIGN KEY (entrenador_id) REFERENCES entrenadores(id),
    /* Cada audiencia lleva exactamente su FK; GENERAL ninguna */
    CONSTRAINT chk_aviso_dest_audiencia CHECK (
        (categoria_id IS NOT NULL) = (tipo_audiencia = 'CATEGORIA') AND
        (tutor_id IS NOT NULL) = (tipo_audiencia = 'TUTOR') AND
        (entrenador_id IS NOT NULL) = (tipo_audiencia = 'ENTRENADOR')
    ),
    INDEX idx_aviso_dest_aviso (aviso_id),
    INDEX idx_aviso_dest_categoria (categoria_id)
) ENGINE=InnoDB;

-- ============================================================
-- AUDITORÍA
-- ============================================================

CREATE TABLE auditoria (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    usuario_id BIGINT UNSIGNED NULL,
    accion ENUM('CREAR','EDITAR','ELIMINAR','CANCELAR','LOGIN','LOGOUT','OTRO') NOT NULL,
    modulo VARCHAR(80),
    entidad VARCHAR(100),
    entidad_id BIGINT UNSIGNED NULL,
    descripcion TEXT,
    datos_anteriores JSON NULL,
    datos_nuevos JSON NULL,
    ip VARCHAR(45),
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_auditoria_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    INDEX idx_auditoria_usuario_fecha (usuario_id, creado_en),
    INDEX idx_auditoria_entidad (entidad, entidad_id),
    INDEX idx_auditoria_modulo_fecha (modulo, creado_en)
) ENGINE=InnoDB;

-- ============================================================
-- DATOS INICIALES MÍNIMOS
-- ============================================================

INSERT INTO roles (nombre, tipo, descripcion) VALUES
('ADMINISTRADOR', 'SEGURIDAD', 'Acceso completo al sistema'),
('SECRETARIA', 'SEGURIDAD', 'Gestión administrativa y cobranza'),
('ENTRENADOR', 'PERFIL', 'Gestión y consulta deportiva; lo otorga entrenadores.usuario_id con activo = TRUE'),
('TUTOR', 'PERFIL', 'Consulta de información de sus hijos; lo otorga tutores.usuario_id');

INSERT INTO permisos (modulo, accion) VALUES
('usuarios','consultar'),
('usuarios','crear'),
('usuarios','editar'),
('usuarios','cancelar'),
('jugadores','consultar'),
('jugadores','crear'),
('jugadores','editar'),
('categorias','consultar'),
('categorias','crear'),
('categorias','editar'),
('inscripciones','consultar'),
('inscripciones','crear'),
('inscripciones','editar'),
('entrenamientos','consultar'),
('entrenamientos','crear'),
('entrenamientos','editar'),
('asistencias','consultar'),
('asistencias','crear'),
('asistencias','editar'),
('competencias','consultar'),
('competencias','crear'),
('competencias','editar'),
('partidos','consultar'),
('partidos','crear'),
('partidos','editar'),
('pagos','consultar'),
('pagos','crear'),
('pagos','cancelar'),
('uniformes','consultar'),
('uniformes','crear'),
('uniformes','editar'),
('avisos','consultar'),
('avisos','crear'),
('avisos','editar'),
('auditoria','consultar');

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- FIN DEL SCRIPT
-- ============================================================

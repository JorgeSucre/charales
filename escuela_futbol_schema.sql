/*M!999999\- enable the sandbox mode */ 

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*M!100616 SET @OLD_NOTE_VERBOSITY=@@NOTE_VERBOSITY, NOTE_VERBOSITY=0 */;
DROP TABLE IF EXISTS `asistencias`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `asistencias` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `sesion_entrenamiento_id` bigint(20) unsigned NOT NULL,
  `jugador_id` bigint(20) unsigned NOT NULL,
  `estado` enum('PRESENTE','AUSENTE','JUSTIFICADO') NOT NULL,
  `observaciones` varchar(255) DEFAULT NULL,
  `registrado_por` bigint(20) unsigned DEFAULT NULL,
  `registrado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_asistencia_sesion_jugador` (`sesion_entrenamiento_id`,`jugador_id`),
  KEY `fk_asistencia_usuario` (`registrado_por`),
  KEY `idx_asistencia_jugador` (`jugador_id`),
  CONSTRAINT `fk_asistencia_jugador` FOREIGN KEY (`jugador_id`) REFERENCES `jugadores` (`id`),
  CONSTRAINT `fk_asistencia_sesion` FOREIGN KEY (`sesion_entrenamiento_id`) REFERENCES `sesiones_entrenamiento` (`id`),
  CONSTRAINT `fk_asistencia_usuario` FOREIGN KEY (`registrado_por`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `auditoria`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `auditoria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `usuario_id` bigint(20) unsigned DEFAULT NULL,
  `accion` enum('CREAR','EDITAR','ELIMINAR','CANCELAR','LOGIN','LOGOUT','OTRO') NOT NULL,
  `modulo` varchar(80) DEFAULT NULL,
  `entidad` varchar(100) DEFAULT NULL,
  `entidad_id` bigint(20) unsigned DEFAULT NULL,
  `descripcion` text DEFAULT NULL,
  `datos_anteriores` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`datos_anteriores`)),
  `datos_nuevos` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`datos_nuevos`)),
  `ip` varchar(45) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_auditoria_usuario_fecha` (`usuario_id`,`creado_en`),
  KEY `idx_auditoria_entidad` (`entidad`,`entidad_id`),
  KEY `idx_auditoria_modulo_fecha` (`modulo`,`creado_en`),
  CONSTRAINT `fk_auditoria_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=187 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `aviso_destinatario`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `aviso_destinatario` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `aviso_id` bigint(20) unsigned NOT NULL,
  `categoria_id` bigint(20) unsigned DEFAULT NULL,
  `tutor_id` bigint(20) unsigned DEFAULT NULL,
  `entrenador_id` bigint(20) unsigned DEFAULT NULL,
  `tipo_audiencia` enum('GENERAL','CATEGORIA','TUTOR','ENTRENADOR') NOT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_aviso_dest_tutor` (`tutor_id`),
  KEY `fk_aviso_dest_entrenador` (`entrenador_id`),
  KEY `idx_aviso_dest_aviso` (`aviso_id`),
  KEY `idx_aviso_dest_categoria` (`categoria_id`),
  CONSTRAINT `fk_aviso_dest_aviso` FOREIGN KEY (`aviso_id`) REFERENCES `avisos` (`id`),
  CONSTRAINT `fk_aviso_dest_categoria` FOREIGN KEY (`categoria_id`) REFERENCES `categorias` (`id`),
  CONSTRAINT `fk_aviso_dest_entrenador` FOREIGN KEY (`entrenador_id`) REFERENCES `entrenadores` (`id`),
  CONSTRAINT `fk_aviso_dest_tutor` FOREIGN KEY (`tutor_id`) REFERENCES `tutores` (`id`),
  CONSTRAINT `chk_aviso_dest_audiencia` CHECK (`categoria_id` is not null = (`tipo_audiencia` = 'CATEGORIA') and `tutor_id` is not null = (`tipo_audiencia` = 'TUTOR') and `entrenador_id` is not null = (`tipo_audiencia` = 'ENTRENADOR'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `avisos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `avisos` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `creado_por` bigint(20) unsigned NOT NULL,
  `titulo` varchar(200) NOT NULL,
  `mensaje` text NOT NULL,
  `fecha_publicacion` datetime NOT NULL DEFAULT current_timestamp(),
  `fecha_inicio` datetime DEFAULT NULL,
  `fecha_fin` datetime DEFAULT NULL,
  `publicado` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_aviso_usuario` (`creado_por`),
  KEY `idx_aviso_vigencia` (`publicado`,`fecha_inicio`,`fecha_fin`),
  CONSTRAINT `fk_aviso_usuario` FOREIGN KEY (`creado_por`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `chk_aviso_vigencia` CHECK (`fecha_fin` is null or `fecha_inicio` is null or `fecha_fin` >= `fecha_inicio`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `cargos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cargos` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `jugador_id` bigint(20) unsigned NOT NULL,
  `concepto_id` bigint(20) unsigned NOT NULL,
  `temporada_id` bigint(20) unsigned DEFAULT NULL,
  `periodo` varchar(20) DEFAULT NULL,
  `fecha_cargo` date NOT NULL,
  `fecha_vencimiento` date DEFAULT NULL,
  `monto_original` decimal(12,2) NOT NULL,
  `estado` enum('PENDIENTE','PARCIAL','PAGADO','VENCIDO','CANCELADO') NOT NULL DEFAULT 'PENDIENTE',
  `referencia` varchar(100) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cargo_id_jugador` (`id`,`jugador_id`),
  UNIQUE KEY `uq_cargo_periodo_concepto` (`jugador_id`,`concepto_id`,`periodo`),
  KEY `fk_cargo_concepto` (`concepto_id`),
  KEY `fk_cargo_temporada` (`temporada_id`),
  KEY `idx_cargo_jugador` (`jugador_id`),
  KEY `idx_cargo_vencimiento` (`fecha_vencimiento`),
  KEY `idx_cargo_estado` (`estado`),
  CONSTRAINT `fk_cargo_concepto` FOREIGN KEY (`concepto_id`) REFERENCES `conceptos_cobro` (`id`),
  CONSTRAINT `fk_cargo_jugador` FOREIGN KEY (`jugador_id`) REFERENCES `jugadores` (`id`),
  CONSTRAINT `fk_cargo_temporada` FOREIGN KEY (`temporada_id`) REFERENCES `temporadas` (`id`),
  CONSTRAINT `chk_cargo_monto` CHECK (`monto_original` >= 0),
  CONSTRAINT `chk_cargo_periodo` CHECK (`periodo` is null or `periodo` regexp '^[0-9]{4}-(0[1-9]|1[0-2])$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `categorias`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `categorias` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `temporada_id` bigint(20) unsigned DEFAULT NULL,
  `nombre` varchar(100) NOT NULL,
  `edad_minima` tinyint(3) unsigned NOT NULL,
  `edad_maxima` tinyint(3) unsigned NOT NULL,
  `cupo_maximo` smallint(5) unsigned DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_categoria_temporada_nombre` (`temporada_id`,`nombre`),
  CONSTRAINT `fk_categoria_temporada` FOREIGN KEY (`temporada_id`) REFERENCES `temporadas` (`id`),
  CONSTRAINT `chk_categoria_edades` CHECK (`edad_maxima` >= `edad_minima`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `competencia_categoria`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `competencia_categoria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `competencia_id` bigint(20) unsigned NOT NULL,
  `categoria_id` bigint(20) unsigned NOT NULL,
  `fecha_inscripcion` date NOT NULL,
  `costo` decimal(12,2) DEFAULT NULL,
  `estatus` enum('PENDIENTE','INSCRITA','BAJA','FINALIZADA') NOT NULL DEFAULT 'INSCRITA',
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_competencia_categoria` (`competencia_id`,`categoria_id`),
  KEY `fk_comp_cat_categoria` (`categoria_id`),
  CONSTRAINT `fk_comp_cat_categoria` FOREIGN KEY (`categoria_id`) REFERENCES `categorias` (`id`),
  CONSTRAINT `fk_comp_cat_competencia` FOREIGN KEY (`competencia_id`) REFERENCES `competencias` (`id`),
  CONSTRAINT `chk_comp_cat_costo` CHECK (`costo` is null or `costo` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `competencias`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `competencias` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `temporada_id` bigint(20) unsigned DEFAULT NULL,
  `nombre` varchar(150) NOT NULL,
  `tipo` enum('TORNEO','LIGA','OTRO') NOT NULL DEFAULT 'TORNEO',
  `organizador` varchar(150) DEFAULT NULL,
  `contacto` varchar(150) DEFAULT NULL,
  `fecha_inicio` date DEFAULT NULL,
  `fecha_fin` date DEFAULT NULL,
  `estado` enum('PLANIFICADA','ACTIVA','FINALIZADA','CANCELADA') NOT NULL DEFAULT 'PLANIFICADA',
  `observaciones` text DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_competencia_temporada` (`temporada_id`),
  CONSTRAINT `fk_competencia_temporada` FOREIGN KEY (`temporada_id`) REFERENCES `temporadas` (`id`),
  CONSTRAINT `chk_competencia_fechas` CHECK (`fecha_fin` is null or `fecha_inicio` is null or `fecha_fin` >= `fecha_inicio`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `conceptos_cobro`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `conceptos_cobro` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) NOT NULL,
  `importe_sugerido` decimal(12,2) NOT NULL DEFAULT 0.00,
  `recurrente` tinyint(1) NOT NULL DEFAULT 0,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`),
  CONSTRAINT `chk_concepto_importe` CHECK (`importe_sugerido` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `descuentos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `descuentos` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `cargo_id` bigint(20) unsigned NOT NULL,
  `tipo` enum('DESCUENTO','BECA') NOT NULL,
  `motivo` varchar(255) NOT NULL,
  `monto_original` decimal(12,2) NOT NULL,
  `monto_ajuste` decimal(12,2) NOT NULL,
  `monto_final` decimal(12,2) GENERATED ALWAYS AS (`monto_original` - `monto_ajuste`) STORED,
  `autorizado_por` bigint(20) unsigned DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_descuento_cargo` (`cargo_id`),
  KEY `fk_descuento_usuario` (`autorizado_por`),
  CONSTRAINT `fk_descuento_cargo` FOREIGN KEY (`cargo_id`) REFERENCES `cargos` (`id`),
  CONSTRAINT `fk_descuento_usuario` FOREIGN KEY (`autorizado_por`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `chk_descuento_montos` CHECK (`monto_ajuste` >= 0 and `monto_ajuste` <= `monto_original`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `detalle_uniforme`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `detalle_uniforme` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `pedido_id` bigint(20) unsigned NOT NULL,
  `variante_id` bigint(20) unsigned NOT NULL,
  `cantidad` smallint(5) unsigned NOT NULL,
  `precio_unitario` decimal(12,2) NOT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_detalle_uniforme_pedido` (`pedido_id`),
  KEY `fk_detalle_uniforme_variante` (`variante_id`),
  CONSTRAINT `fk_detalle_uniforme_pedido` FOREIGN KEY (`pedido_id`) REFERENCES `pedidos_uniforme` (`id`),
  CONSTRAINT `fk_detalle_uniforme_variante` FOREIGN KEY (`variante_id`) REFERENCES `variantes_uniforme` (`id`),
  CONSTRAINT `chk_detalle_uniforme_cantidad` CHECK (`cantidad` > 0),
  CONSTRAINT `chk_detalle_uniforme_precio` CHECK (`precio_unitario` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `entrenador_categoria`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `entrenador_categoria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `entrenador_id` bigint(20) unsigned NOT NULL,
  `categoria_id` bigint(20) unsigned NOT NULL,
  `rol_responsabilidad` varchar(100) DEFAULT NULL,
  `fecha_inicio` date NOT NULL,
  `fecha_fin` date DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_entrenador_categoria_inicio` (`entrenador_id`,`categoria_id`,`fecha_inicio`),
  KEY `idx_ent_cat_categoria` (`categoria_id`),
  KEY `idx_ent_cat_entrenador` (`entrenador_id`),
  CONSTRAINT `fk_ent_cat_categoria` FOREIGN KEY (`categoria_id`) REFERENCES `categorias` (`id`),
  CONSTRAINT `fk_ent_cat_entrenador` FOREIGN KEY (`entrenador_id`) REFERENCES `entrenadores` (`id`),
  CONSTRAINT `chk_ent_cat_fechas` CHECK (`fecha_fin` is null or `fecha_fin` >= `fecha_inicio`),
  CONSTRAINT `chk_ent_cat_activo` CHECK (`activo` <> 0 or `fecha_fin` is not null)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `entrenador_competencia_categoria`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `entrenador_competencia_categoria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `entrenador_id` bigint(20) unsigned NOT NULL,
  `competencia_categoria_id` bigint(20) unsigned NOT NULL,
  `fecha_inicio` date NOT NULL,
  `fecha_fin` date DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_entrenador_comp_cat` (`entrenador_id`,`competencia_categoria_id`),
  KEY `fk_ecc_comp_cat` (`competencia_categoria_id`),
  KEY `idx_ecc_entrenador` (`entrenador_id`),
  CONSTRAINT `fk_ecc_comp_cat` FOREIGN KEY (`competencia_categoria_id`) REFERENCES `competencia_categoria` (`id`),
  CONSTRAINT `fk_ecc_entrenador` FOREIGN KEY (`entrenador_id`) REFERENCES `entrenadores` (`id`),
  CONSTRAINT `chk_ecc_fechas` CHECK (`fecha_fin` is null or `fecha_fin` >= `fecha_inicio`),
  CONSTRAINT `chk_ecc_activo` CHECK (`activo` <> 0 or `fecha_fin` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `entrenadores`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `entrenadores` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `usuario_id` bigint(20) unsigned DEFAULT NULL,
  `nombre` varchar(100) NOT NULL,
  `apellido_paterno` varchar(100) NOT NULL,
  `apellido_materno` varchar(100) DEFAULT NULL,
  `telefono` varchar(30) DEFAULT NULL,
  `email` varchar(150) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `usuario_id` (`usuario_id`),
  KEY `idx_entrenador_nombre` (`apellido_paterno`,`apellido_materno`,`nombre`),
  CONSTRAINT `fk_entrenador_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `historial_categoria`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `historial_categoria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `jugador_id` bigint(20) unsigned NOT NULL,
  `categoria_anterior_id` bigint(20) unsigned DEFAULT NULL,
  `categoria_nueva_id` bigint(20) unsigned NOT NULL,
  `motivo` varchar(255) DEFAULT NULL,
  `cambiado_por` bigint(20) unsigned DEFAULT NULL,
  `cambiado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_hist_categoria_jugador` (`jugador_id`),
  KEY `fk_hist_categoria_anterior` (`categoria_anterior_id`),
  KEY `fk_hist_categoria_nueva` (`categoria_nueva_id`),
  KEY `fk_hist_categoria_usuario` (`cambiado_por`),
  CONSTRAINT `fk_hist_categoria_anterior` FOREIGN KEY (`categoria_anterior_id`) REFERENCES `categorias` (`id`),
  CONSTRAINT `fk_hist_categoria_jugador` FOREIGN KEY (`jugador_id`) REFERENCES `jugadores` (`id`),
  CONSTRAINT `fk_hist_categoria_nueva` FOREIGN KEY (`categoria_nueva_id`) REFERENCES `categorias` (`id`),
  CONSTRAINT `fk_hist_categoria_usuario` FOREIGN KEY (`cambiado_por`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `chk_hist_categoria_cambio` CHECK (`categoria_anterior_id` is null or `categoria_anterior_id` <> `categoria_nueva_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `historial_estatus`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `historial_estatus` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `jugador_id` bigint(20) unsigned NOT NULL,
  `estatus_anterior` enum('ACTIVO','BAJA_TEMPORAL','BAJA_DEFINITIVA') DEFAULT NULL,
  `estatus_nuevo` enum('ACTIVO','BAJA_TEMPORAL','BAJA_DEFINITIVA') NOT NULL,
  `motivo` varchar(255) DEFAULT NULL,
  `cambiado_por` bigint(20) unsigned DEFAULT NULL,
  `cambiado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_hist_estatus_usuario` (`cambiado_por`),
  KEY `idx_hist_estatus_jugador` (`jugador_id`,`cambiado_en`),
  CONSTRAINT `fk_hist_estatus_jugador` FOREIGN KEY (`jugador_id`) REFERENCES `jugadores` (`id`),
  CONSTRAINT `fk_hist_estatus_usuario` FOREIGN KEY (`cambiado_por`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `chk_hist_estatus_cambio` CHECK (`estatus_anterior` is null or `estatus_anterior` <> `estatus_nuevo`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `horarios_entrenamiento`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `horarios_entrenamiento` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `categoria_id` bigint(20) unsigned NOT NULL,
  `sede_id` bigint(20) unsigned NOT NULL,
  `dia_semana` tinyint(3) unsigned NOT NULL COMMENT '1=Lunes ... 7=Domingo',
  `hora_inicio` time NOT NULL,
  `hora_fin` time NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_horario_id_categoria` (`id`,`categoria_id`),
  KEY `fk_horario_sede` (`sede_id`),
  KEY `idx_horario_categoria` (`categoria_id`),
  CONSTRAINT `fk_horario_categoria` FOREIGN KEY (`categoria_id`) REFERENCES `categorias` (`id`),
  CONSTRAINT `fk_horario_sede` FOREIGN KEY (`sede_id`) REFERENCES `sedes` (`id`),
  CONSTRAINT `chk_horario_dia` CHECK (`dia_semana` between 1 and 7),
  CONSTRAINT `chk_horario_horas` CHECK (`hora_fin` > `hora_inicio`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `inscripciones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `inscripciones` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `jugador_id` bigint(20) unsigned NOT NULL,
  `temporada_id` bigint(20) unsigned NOT NULL,
  `fecha_inscripcion` date NOT NULL,
  `monto` decimal(12,2) NOT NULL DEFAULT 0.00,
  `estatus` enum('PENDIENTE','ACTIVA','CANCELADA','FINALIZADA') NOT NULL DEFAULT 'PENDIENTE',
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_inscripcion_jugador_temporada` (`jugador_id`,`temporada_id`),
  KEY `fk_inscripcion_temporada` (`temporada_id`),
  CONSTRAINT `fk_inscripcion_jugador` FOREIGN KEY (`jugador_id`) REFERENCES `jugadores` (`id`),
  CONSTRAINT `fk_inscripcion_temporada` FOREIGN KEY (`temporada_id`) REFERENCES `temporadas` (`id`),
  CONSTRAINT `chk_inscripcion_monto` CHECK (`monto` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `jugador_categoria`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `jugador_categoria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `jugador_id` bigint(20) unsigned NOT NULL,
  `categoria_id` bigint(20) unsigned NOT NULL,
  `fecha_inicio` date NOT NULL,
  `fecha_fin` date DEFAULT NULL,
  `es_excepcion_edad` tinyint(1) NOT NULL DEFAULT 0,
  `motivo_excepcion` varchar(255) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `vigente_de_jugador_id` bigint(20) unsigned GENERATED ALWAYS AS (if(`fecha_fin` is null,`jugador_id`,NULL)) STORED,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_jugador_categoria_vigente` (`vigente_de_jugador_id`),
  KEY `idx_jugador_categoria_jugador` (`jugador_id`),
  KEY `idx_jugador_categoria_categoria` (`categoria_id`),
  KEY `idx_jugador_categoria_activo` (`activo`),
  CONSTRAINT `fk_jugador_categoria_categoria` FOREIGN KEY (`categoria_id`) REFERENCES `categorias` (`id`),
  CONSTRAINT `fk_jugador_categoria_jugador` FOREIGN KEY (`jugador_id`) REFERENCES `jugadores` (`id`),
  CONSTRAINT `chk_jugador_categoria_fechas` CHECK (`fecha_fin` is null or `fecha_fin` >= `fecha_inicio`),
  CONSTRAINT `chk_jugador_categoria_activo` CHECK (`activo` <> 0 or `fecha_fin` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `jugador_competencia_categoria`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `jugador_competencia_categoria` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `jugador_id` bigint(20) unsigned NOT NULL,
  `competencia_categoria_id` bigint(20) unsigned NOT NULL,
  `fecha_alta` date NOT NULL,
  `fecha_baja` date DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_jugador_competencia_categoria` (`jugador_id`,`competencia_categoria_id`),
  KEY `idx_jcc_competencia_categoria` (`competencia_categoria_id`),
  CONSTRAINT `fk_jcc_comp_cat` FOREIGN KEY (`competencia_categoria_id`) REFERENCES `competencia_categoria` (`id`),
  CONSTRAINT `fk_jcc_jugador` FOREIGN KEY (`jugador_id`) REFERENCES `jugadores` (`id`),
  CONSTRAINT `chk_jcc_fechas` CHECK (`fecha_baja` is null or `fecha_baja` >= `fecha_alta`),
  CONSTRAINT `chk_jcc_activo` CHECK (`activo` <> 0 or `fecha_baja` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `jugadores`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `jugadores` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `identificador` varchar(30) NOT NULL,
  `nombre` varchar(100) NOT NULL,
  `apellido_paterno` varchar(100) NOT NULL,
  `apellido_materno` varchar(100) DEFAULT NULL,
  `fecha_nacimiento` date NOT NULL,
  `sexo` enum('F','M','OTRO','NO_ESPECIFICADO') NOT NULL DEFAULT 'NO_ESPECIFICADO',
  `telefono` varchar(30) DEFAULT NULL,
  `email` varchar(150) DEFAULT NULL,
  `direccion` varchar(255) DEFAULT NULL,
  `estatus` enum('ACTIVO','BAJA_TEMPORAL','BAJA_DEFINITIVA') NOT NULL DEFAULT 'ACTIVO',
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `identificador` (`identificador`),
  KEY `idx_jugador_nombre` (`apellido_paterno`,`apellido_materno`,`nombre`),
  KEY `idx_jugador_estatus` (`estatus`),
  KEY `idx_jugador_fecha_nacimiento` (`fecha_nacimiento`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pago_aplicacion`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `pago_aplicacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `pago_id` bigint(20) unsigned NOT NULL,
  `cargo_id` bigint(20) unsigned NOT NULL,
  `jugador_id` bigint(20) unsigned NOT NULL,
  `importe_aplicado` decimal(12,2) NOT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pago_cargo` (`pago_id`,`cargo_id`),
  KEY `fk_pago_aplicacion_pago` (`pago_id`,`jugador_id`),
  KEY `fk_pago_aplicacion_cargo` (`cargo_id`,`jugador_id`),
  KEY `idx_aplicacion_cargo` (`cargo_id`),
  CONSTRAINT `fk_pago_aplicacion_cargo` FOREIGN KEY (`cargo_id`, `jugador_id`) REFERENCES `cargos` (`id`, `jugador_id`),
  CONSTRAINT `fk_pago_aplicacion_pago` FOREIGN KEY (`pago_id`, `jugador_id`) REFERENCES `pagos` (`id`, `jugador_id`),
  CONSTRAINT `chk_pago_aplicacion_importe` CHECK (`importe_aplicado` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pagos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `pagos` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `folio` varchar(50) NOT NULL,
  `jugador_id` bigint(20) unsigned NOT NULL,
  `tutor_id` bigint(20) unsigned DEFAULT NULL,
  `fecha_pago` datetime NOT NULL DEFAULT current_timestamp(),
  `importe` decimal(12,2) NOT NULL,
  `forma_pago` enum('EFECTIVO','TRANSFERENCIA','TARJETA','OTRO') NOT NULL,
  `estado` enum('APLICADO','CANCELADO') NOT NULL DEFAULT 'APLICADO',
  `motivo_cancelacion` varchar(255) DEFAULT NULL,
  `registrado_por` bigint(20) unsigned DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `folio` (`folio`),
  UNIQUE KEY `uq_pago_id_jugador` (`id`,`jugador_id`),
  KEY `fk_pago_tutor_jugador` (`tutor_id`,`jugador_id`),
  KEY `fk_pago_usuario` (`registrado_por`),
  KEY `idx_pago_jugador_fecha` (`jugador_id`,`fecha_pago`),
  KEY `idx_pago_estado` (`estado`),
  CONSTRAINT `fk_pago_jugador` FOREIGN KEY (`jugador_id`) REFERENCES `jugadores` (`id`),
  CONSTRAINT `fk_pago_tutor_jugador` FOREIGN KEY (`tutor_id`, `jugador_id`) REFERENCES `tutor_jugador` (`tutor_id`, `jugador_id`),
  CONSTRAINT `fk_pago_usuario` FOREIGN KEY (`registrado_por`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `chk_pago_importe` CHECK (`importe` > 0),
  CONSTRAINT `chk_pago_cancelacion` CHECK (`estado` = 'CANCELADO' = (`motivo_cancelacion` is not null))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `partidos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `partidos` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `competencia_categoria_id` bigint(20) unsigned NOT NULL,
  `rival_id` bigint(20) unsigned DEFAULT NULL,
  `sede_id` bigint(20) unsigned DEFAULT NULL,
  `fecha` date NOT NULL,
  `hora` time NOT NULL,
  `local_visitante` enum('LOCAL','VISITANTE') NOT NULL DEFAULT 'LOCAL',
  `goles_favor` smallint(5) unsigned DEFAULT NULL,
  `goles_contra` smallint(5) unsigned DEFAULT NULL,
  `estado` enum('PROGRAMADO','JUGADO','CANCELADO','REPROGRAMADO') NOT NULL DEFAULT 'PROGRAMADO',
  `motivo_reprogramacion` varchar(255) DEFAULT NULL,
  `observaciones` text DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_partido_rival` (`rival_id`),
  KEY `fk_partido_sede` (`sede_id`),
  KEY `idx_partido_fecha` (`fecha`),
  KEY `idx_partido_comp_cat` (`competencia_categoria_id`),
  CONSTRAINT `fk_partido_comp_cat` FOREIGN KEY (`competencia_categoria_id`) REFERENCES `competencia_categoria` (`id`),
  CONSTRAINT `fk_partido_rival` FOREIGN KEY (`rival_id`) REFERENCES `rivales` (`id`),
  CONSTRAINT `fk_partido_sede` FOREIGN KEY (`sede_id`) REFERENCES `sedes` (`id`),
  CONSTRAINT `chk_partido_goles` CHECK (`goles_favor` is null = (`goles_contra` is null) and (`goles_favor` is null or `estado` = 'JUGADO'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pedidos_uniforme`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `pedidos_uniforme` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `jugador_id` bigint(20) unsigned NOT NULL,
  `fecha_solicitud` date NOT NULL,
  `estado` enum('SOLICITADO','PAGADO','ENTREGADO','CANCELADO') NOT NULL DEFAULT 'SOLICITADO',
  `cargo_id` bigint(20) unsigned DEFAULT NULL,
  `fecha_entrega` date DEFAULT NULL,
  `recibido_por` varchar(150) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pedido_uniforme_cargo` (`cargo_id`),
  KEY `fk_pedido_uniforme_cargo` (`cargo_id`,`jugador_id`),
  KEY `idx_pedido_uniforme_jugador` (`jugador_id`),
  KEY `idx_pedido_uniforme_estado` (`estado`),
  CONSTRAINT `fk_pedido_uniforme_cargo` FOREIGN KEY (`cargo_id`, `jugador_id`) REFERENCES `cargos` (`id`, `jugador_id`),
  CONSTRAINT `fk_pedido_uniforme_jugador` FOREIGN KEY (`jugador_id`) REFERENCES `jugadores` (`id`),
  CONSTRAINT `chk_pedido_uniforme_entrega` CHECK (`estado` = 'ENTREGADO' = (`fecha_entrega` is not null))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `permisos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `permisos` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `modulo` varchar(80) NOT NULL,
  `accion` enum('consultar','crear','editar','cancelar') NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_permiso_modulo_accion` (`modulo`,`accion`)
) ENGINE=InnoDB AUTO_INCREMENT=62 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `productos_uniforme`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `productos_uniforme` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(150) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `rivales`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `rivales` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(150) NOT NULL,
  `contacto` varchar(150) DEFAULT NULL,
  `observaciones` varchar(255) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `rol_permiso`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `rol_permiso` (
  `rol_id` bigint(20) unsigned NOT NULL,
  `permiso_id` bigint(20) unsigned NOT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`rol_id`,`permiso_id`),
  KEY `fk_rol_permiso_permiso` (`permiso_id`),
  CONSTRAINT `fk_rol_permiso_permiso` FOREIGN KEY (`permiso_id`) REFERENCES `permisos` (`id`),
  CONSTRAINT `fk_rol_permiso_rol` FOREIGN KEY (`rol_id`) REFERENCES `roles` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `roles` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(50) NOT NULL,
  `tipo` enum('SEGURIDAD','PERFIL') NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`),
  UNIQUE KEY `uq_rol_id_tipo` (`id`,`tipo`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `sedes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `sedes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) NOT NULL,
  `ubicacion` varchar(255) DEFAULT NULL,
  `referencia` varchar(255) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `sesiones`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `sesiones` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `usuario_id` bigint(20) unsigned NOT NULL,
  `token_hash` varchar(255) NOT NULL,
  `inicio_en` datetime NOT NULL DEFAULT current_timestamp(),
  `expira_en` datetime NOT NULL,
  `ultimo_uso_en` datetime DEFAULT NULL,
  `cerrada_en` datetime DEFAULT NULL,
  `ip` varchar(45) DEFAULT NULL,
  `user_agent` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token_hash` (`token_hash`),
  KEY `idx_sesion_usuario` (`usuario_id`),
  KEY `idx_sesion_expira` (`expira_en`),
  CONSTRAINT `fk_sesion_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `chk_sesion_expira` CHECK (`expira_en` > `inicio_en`)
) ENGINE=InnoDB AUTO_INCREMENT=82 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `sesiones_entrenamiento`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `sesiones_entrenamiento` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `categoria_id` bigint(20) unsigned NOT NULL,
  `sede_id` bigint(20) unsigned NOT NULL,
  `entrenador_id` bigint(20) unsigned DEFAULT NULL,
  `horario_id` bigint(20) unsigned DEFAULT NULL,
  `fecha` date NOT NULL,
  `hora_inicio` time NOT NULL,
  `hora_fin` time NOT NULL,
  `estado` enum('PROGRAMADO','REALIZADO','CANCELADO') NOT NULL DEFAULT 'PROGRAMADO',
  `objetivo` varchar(255) DEFAULT NULL,
  `observaciones` text DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_sesion_ent_sede` (`sede_id`),
  KEY `fk_sesion_ent_horario` (`horario_id`,`categoria_id`),
  KEY `idx_sesion_ent_fecha` (`fecha`),
  KEY `idx_sesion_ent_categoria` (`categoria_id`),
  KEY `idx_sesion_ent_entrenador` (`entrenador_id`),
  CONSTRAINT `fk_sesion_ent_categoria` FOREIGN KEY (`categoria_id`) REFERENCES `categorias` (`id`),
  CONSTRAINT `fk_sesion_ent_entrenador` FOREIGN KEY (`entrenador_id`) REFERENCES `entrenadores` (`id`),
  CONSTRAINT `fk_sesion_ent_horario` FOREIGN KEY (`horario_id`, `categoria_id`) REFERENCES `horarios_entrenamiento` (`id`, `categoria_id`),
  CONSTRAINT `fk_sesion_ent_sede` FOREIGN KEY (`sede_id`) REFERENCES `sedes` (`id`),
  CONSTRAINT `chk_sesion_ent_horas` CHECK (`hora_fin` > `hora_inicio`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `temporadas`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `temporadas` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) NOT NULL,
  `fecha_inicio` date NOT NULL,
  `fecha_fin` date NOT NULL,
  `activa` tinyint(1) NOT NULL DEFAULT 1,
  `es_actual` tinyint(1) NOT NULL DEFAULT 0,
  `actual_unica` tinyint(4) GENERATED ALWAYS AS (if(`es_actual`,1,NULL)) STORED,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`),
  UNIQUE KEY `uq_temporada_actual` (`actual_unica`),
  CONSTRAINT `chk_temporada_fechas` CHECK (`fecha_fin` >= `fecha_inicio`),
  CONSTRAINT `chk_temporada_actual_activa` CHECK (`es_actual` = 0 or `activa` <> 0)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `tokens_recuperacion`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tokens_recuperacion` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `usuario_id` bigint(20) unsigned NOT NULL,
  `finalidad` enum('RECUPERACION','INVITACION') NOT NULL DEFAULT 'RECUPERACION',
  `token_hash` varchar(255) NOT NULL,
  `expira_en` datetime NOT NULL,
  `usado_en` datetime DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `token_hash` (`token_hash`),
  KEY `idx_token_usuario` (`usuario_id`),
  KEY `idx_token_expira` (`expira_en`),
  CONSTRAINT `fk_token_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`),
  CONSTRAINT `chk_token_expira` CHECK (`expira_en` > `creado_en`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `tutor_jugador`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tutor_jugador` (
  `tutor_id` bigint(20) unsigned NOT NULL,
  `jugador_id` bigint(20) unsigned NOT NULL,
  `parentesco` varchar(50) NOT NULL,
  `es_contacto_principal` tinyint(1) NOT NULL DEFAULT 0,
  `principal_de_jugador_id` bigint(20) unsigned GENERATED ALWAYS AS (if(`es_contacto_principal`,`jugador_id`,NULL)) STORED,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`tutor_id`,`jugador_id`),
  UNIQUE KEY `uq_tutor_jugador_un_principal` (`principal_de_jugador_id`),
  KEY `idx_tutor_jugador_jugador` (`jugador_id`),
  CONSTRAINT `fk_tutor_jugador_jugador` FOREIGN KEY (`jugador_id`) REFERENCES `jugadores` (`id`),
  CONSTRAINT `fk_tutor_jugador_tutor` FOREIGN KEY (`tutor_id`) REFERENCES `tutores` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `tutores`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tutores` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `usuario_id` bigint(20) unsigned DEFAULT NULL,
  `nombre` varchar(100) NOT NULL,
  `apellido_paterno` varchar(100) NOT NULL,
  `apellido_materno` varchar(100) DEFAULT NULL,
  `telefono` varchar(30) DEFAULT NULL,
  `email` varchar(150) DEFAULT NULL,
  `direccion` varchar(255) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `usuario_id` (`usuario_id`),
  KEY `idx_tutor_nombre` (`apellido_paterno`,`apellido_materno`,`nombre`),
  CONSTRAINT `fk_tutor_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `usuarios`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuarios` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `rol_id` bigint(20) unsigned DEFAULT NULL,
  `rol_tipo` enum('SEGURIDAD','PERFIL') NOT NULL DEFAULT 'SEGURIDAD',
  `nombre` varchar(100) DEFAULT NULL,
  `apellido` varchar(100) DEFAULT NULL,
  `email` varchar(150) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `fk_usuario_rol` (`rol_id`,`rol_tipo`),
  KEY `idx_usuario_activo` (`activo`),
  CONSTRAINT `fk_usuario_rol` FOREIGN KEY (`rol_id`, `rol_tipo`) REFERENCES `roles` (`id`, `tipo`),
  CONSTRAINT `chk_usuario_rol_seguridad` CHECK (`rol_tipo` = 'SEGURIDAD'),
  CONSTRAINT `chk_usuario_nombre_personal` CHECK (`rol_id` is null and `nombre` is null and `apellido` is null or `rol_id` is not null and `nombre` is not null)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `variantes_uniforme`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `variantes_uniforme` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `producto_id` bigint(20) unsigned NOT NULL,
  `talla` varchar(30) NOT NULL,
  `precio` decimal(12,2) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_producto_talla` (`producto_id`,`talla`),
  CONSTRAINT `fk_variante_producto` FOREIGN KEY (`producto_id`) REFERENCES `productos_uniforme` (`id`),
  CONSTRAINT `chk_variante_precio` CHECK (`precio` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `version_datos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `version_datos` (
  `id` tinyint(3) unsigned NOT NULL,
  `version` bigint(20) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_version_datos_una_fila` CHECK (`id` = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 DROP PROCEDURE IF EXISTS `marcar_cargos_vencidos` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
DELIMITER ;;
CREATE DEFINER=`jorgesucre`@`localhost` PROCEDURE `marcar_cargos_vencidos`()
BEGIN
    UPDATE cargos SET estado = 'VENCIDO'
     WHERE estado IN ('PENDIENTE', 'PARCIAL') AND fecha_vencimiento IS NOT NULL AND fecha_vencimiento < CURDATE();
    IF ROW_COUNT() > 0 THEN
        UPDATE version_datos SET version = version + 1 WHERE id = 1;
    END IF;
END
;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*M!100616 SET NOTE_VERBOSITY=@OLD_NOTE_VERBOSITY */;


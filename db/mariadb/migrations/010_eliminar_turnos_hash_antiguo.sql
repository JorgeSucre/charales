-- 010 · Retira las tablas de turnos de hash de contraseña que dejó el diseño previo.
-- Sólo guardaban plazas temporales; la API ya no las lee ni escribe. Seguro de repetir.
DROP TABLE IF EXISTS turnos_argon2;
DROP TABLE IF EXISTS turnos_argon2_guarda;

-- Mantenimiento opcional: tablas sin lectores ni escritores del diseño distribuido descartado.
-- No forma parte de las migraciones automáticas: no es necesario para scrypt.
-- Verificar respaldo y que ningún binario antiguo las use antes de ejecutarla manualmente.
-- Auditar el DDL histórico en migrations/006_turnos_argon2.sql. No hay claves foráneas definidas.
DROP TABLE IF EXISTS turnos_argon2;
DROP TABLE IF EXISTS turnos_argon2_guarda;

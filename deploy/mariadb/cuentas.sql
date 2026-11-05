-- Propuesta de cuentas de MariaDB para producción (F5-13). PLANTILLA: no se ha ejecutado; se revisa y se aplica a mano, una
-- vez, por quien administre el servidor. Sustituye CAMBIAR_* por contraseñas generadas y guardadas fuera del repositorio.
-- Pendiente de verificar en un entorno de prueba: que la API completa funciona con charales_app (F5-13).

-- Migraciones y mantenimiento: la usa una persona, no el servicio.
CREATE USER IF NOT EXISTS 'charales_admin'@'localhost' IDENTIFIED BY 'CAMBIAR_ADMIN';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES, CREATE ROUTINE, ALTER ROUTINE, EXECUTE,
      EVENT, TRIGGER, LOCK TABLES, SHOW VIEW ON escuela_futbol.* TO 'charales_admin'@'localhost';

-- Ejecución de la API: sólo datos. Una inyección SQL no podría cambiar el esquema.
CREATE USER IF NOT EXISTS 'charales_app'@'localhost' IDENTIFIED BY 'CAMBIAR_APP';
GRANT SELECT, INSERT, UPDATE, DELETE ON escuela_futbol.* TO 'charales_app'@'localhost';

-- Respaldos: lectura y lo que mariadb-dump necesita.
CREATE USER IF NOT EXISTS 'charales_backup'@'localhost' IDENTIFIED BY 'CAMBIAR_BACKUP';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES ON escuela_futbol.* TO 'charales_backup'@'localhost';

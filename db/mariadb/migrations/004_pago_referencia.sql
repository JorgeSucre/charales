-- 004 · pagos.referencia (HU-045, regla agregada el 2026-10-29, pendiente de ratificar por el equipo): número de
-- referencia o comprobante de un pago por transferencia o tarjeta. Lo exige la API (BillingService.registerPayment)
-- para TRANSFERENCIA y TARJETA; en efectivo u otro es opcional. NULL en todos los pagos anteriores: no se inventan
-- referencias, y por eso no hay CHECK (las filas históricas por transferencia/tarjeta lo incumplirían).
-- Aditiva e idempotente. Se aplica después de docs/escuela_futbol_mariadb.sql con db/mariadb/scripts/migrate.sh.
ALTER TABLE pagos
    ADD COLUMN IF NOT EXISTS referencia VARCHAR(100) NULL
    AFTER forma_pago;

-- 010 · Retira el semáforo distribuido del diseño Argon2 abandonado.
-- El DDL 006 sólo almacenaba turnos temporales (vence_en) y una fila centinela; no contiene
-- credenciales ni datos personales, no tiene claves foráneas y ya no tiene lectores/escritores.
-- Se elimina también en instalaciones existentes para mantener el esquema igual al de una instalación nueva.
DROP TABLE IF EXISTS turnos_argon2;
DROP TABLE IF EXISTS turnos_argon2_guarda;

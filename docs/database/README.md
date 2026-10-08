# Base de datos — Charales

> **Esquema PostgreSQL anterior (historial).** Desde 2026-10-07 el modelo vigente es MariaDB:
> [`MARIADB.md`](MARIADB.md). Este documento describe `db/migrations` y ya no es la fuente de verdad.

Base común para todos los módulos. **PostgreSQL 16.**

> **Antes de trabajar con datos lee [`DATA_CONTRACT.md`](DATA_CONTRACT.md)** (reglas congeladas) y
> [`OWNERSHIP.md`](OWNERSHIP.md) (quién escribe cada tabla).

| Documento                              | Para qué                                                     |
| -------------------------------------- | ------------------------------------------------------------ |
| [`relationships.md`](relationships.md) | Las relaciones explicadas en lenguaje sencillo + diagrama ER |
| [`schema.md`](schema.md)               | Cada tabla: propósito, PK, FK, campos y restricciones        |
| [`api-contract.md`](api-contract.md)   | Modelo Angular → API → tabla                                 |
| [`queries.md`](queries.md)             | Las 21 consultas críticas y lo que responden                 |
| [`decisions.md`](decisions.md)         | Por qué está así y qué falta acordar                         |

## Levantar la BD (local)

Requisitos: PostgreSQL 16 con `psql`, `createdb` y `dropdb` en el `PATH`. Los scripts son `sh`; en Windows se usan con
Git Bash o WSL.

```bash
npm run db:reset             # borra y crea charales_dev + migraciones + seed (SÓLO desarrollo)
npm run db:migrate           # aplica migraciones pendientes a $DATABASE_URL (por defecto charales_dev)
npm run db:test              # crea charales_test desde cero, corre pruebas de integridad y consultas críticas
psql postgresql:///charales_dev -f db/queries/critical.sql   # ver las consultas con datos
```

Para otra base: `DATABASE_URL=postgresql://usuario@host:5432/nombre npm run db:migrate`.

## Estructura

```text
db/
  migrations/  001_…009_*.sql   se aplican en orden; cada una en su transacción; registro en schema_migrations
  seed/        dev_seed.sql      datos ficticios · sid.sql (UUIDs legibles)
  tests/       integrity.sql     57 pruebas (transacción revertida)
  queries/     critical.sql      21 consultas del sistema
  scripts/     migrate.sh · reset.sh · test.sh
```

**Nueva migración:** crear `db/migrations/009_descripcion.sql` (siguiente número; proceso completo en `DATA_CONTRACT.md`). Nunca editar una migración ya aplicada en una BD
compartida.

## Convenciones

- **Nombres:** tablas en plural y `snake_case`. FKs `<entidad>_id`. Dinero `*_cents`. Fechas `*_date`/`*_on`
  (`date`) e instantes `*_at` (`timestamptz`).
- **IDs:** `uuid` generado por la BD (`gen_random_uuid()`). Las tablas puente usan PK compuesta.
  El folio de recibo (`receipt_number`) es un `bigint` consecutivo.
- **Dinero:** `integer` en centavos, igual que `amountCents` en Angular; no hay conversión. Nunca `float`.
  Se muestra con `MoneyPipe` (`cents / 100`).
- **Fechas:**
  - `date` = día de negocio local, se intercambia como `YYYY-MM-DD` y no se convierte a UTC.
  - `timestamptz` = instante, se intercambia en ISO 8601 con zona.
  - Para saber «qué día fue» en México se usa `business_date(ts)`; es el único lugar con `America/Mexico_City`.
- **Nada se borra en cobranza:** los pagos se cancelan; las aplicaciones sólo se insertan. Los usuarios se desactivan.
- **Saldo:** nunca se guarda. Se consulta en la vista `charge_balances`.
- **Integridad:** la BD es la última línea de defensa: FKs (incluidas compuestas), `CHECK`, índices únicos parciales
  y triggers de cuadre. El backend debe validar igual y dar mensajes claros; la BD evita estados imposibles aunque
  alguien se equivoque.

## Seed

Datos 100 % ficticios, sin contraseñas (`password_hash NULL`).

- **Usuarios:** 6, uno por rol, más uno inactivo y un segundo tutor con cuenta.
- **Personas:**
  - 4 jugadores, uno inactivo.
  - 3 tutores: Diego tiene dos; uno de los tutores no tiene cuenta.
  - 2 entrenadores, uno sin cuenta.
- **Temporadas y categorías:**
  - 2 temporadas: la pasada y la activa.
  - 3 categorías; Lucía tiene historial Sub-10 → Sub-12.
  - Una inscripción cancelada.
- **Competencias y agenda:** 2 competencias con sus asignaciones, 2 partidos y 2 entrenamientos.
- **Uniformes:** un pedido con 2 líneas (una entregada). El precio de la variante subió después y el pedido conserva el
  anterior.
- **Cobranza:** 6 cargos y 4 pagos: parciales, uno aplicado al uniforme y uno cancelado.

UUID legible: `00000000-0000-4000-8000-TTTNNNNNNNNN`, donde `TTT` es el código de tabla (ver `db/seed/sid.sql`).
Ejemplo: jugador 1 = `…-8000-002000000001`.

/**
 * Scalar conventions shared by every model. The physical model is docs/escuela_futbol_mariadb.sql.
 *
 * | MariaDB                          | TypeScript |
 * | -------------------------------- | ---------- |
 * | BIGINT UNSIGNED AUTO_INCREMENT   | Id         |
 * | DECIMAL(12,2)                    | Cents (integer); the API sends a decimal string, see shared/money.ts |
 * | DATE                             | ISODate 'YYYY-MM-DD' |
 * | TIME                             | Time 'HH:MM' |
 * | DATETIME                         | DateTime 'YYYY-MM-DDTHH:MM:SS', school local time, no offset |
 * | NULL-able column                 | `T | null` (the API returns null, never omits) |
 * | ENUM                             | string union with the SQL values verbatim |
 */
export type Id = number;
export type Cents = number;
export type ISODate = string;
export type Time = string;
export type DateTime = string;

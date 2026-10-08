# Pruebas

Estado de `main` en `18178ba`: **138/138** pruebas Angular en verde, typecheck y build sin errores, formato correcto,
MariaDB 42/42 checks y respaldo/restauración idéntico en 39 tablas. No se ha medido cobertura porcentual.

## Cómo correrlas

| Qué                           | Comando                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| Pruebas Angular (una corrida) | `npx ng test --watch=false` (`npm test` entra en modo watch y no termina)          |
| Una sola suite                | `npx ng test --watch=false --include src/app/authorization.spec.ts`                |
| Salida detallada              | `npx ng test --watch=false --reporters=verbose`                                    |
| Typecheck                     | `npx tsc -p tsconfig.app.json --noEmit` y `npx tsc -p tsconfig.spec.json --noEmit` |
| Formato                       | `npx prettier --check .`                                                           |
| Build                         | `npm run build`                                                                    |
| Esquema MariaDB + respaldo    | `npm run db:mariadb:test-backup` (requiere un servidor MariaDB local)              |

Las pruebas Angular corren con Vitest y jsdom vía `@angular/build:unit-test`, sobre `MockDb`. No hay ESLint.

## Qué tipo de prueba es cada archivo

| Archivo                                  | Pruebas | Tipo                                            | Qué cubre                                                                                                                                                                      |
| ---------------------------------------- | ------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shared/shared.spec.ts`                  | 6       | Unitaria (funciones puras)                      | Dinero (`DECIMAL` ↔ centavos, sin flotantes), fechas, paginación, validación                                                                                                   |
| `features/billing/billing.rules.spec.ts` | 8       | Unitaria (funciones puras)                      | Saldos, estados de cargo, aplicación de pagos, adeudos, ingresos, folios                                                                                                       |
| `core/data/mock-db.integrity.spec.ts`    | 25      | Unitaria del verificador                        | 21 violaciones inyectadas (FK, UNIQUE, CHECK, relaciones) detectadas + rollback y commit de transacciones                                                                      |
| `core/auth/auth.spec.ts`                 | 9       | Integración de servicio + guard                 | Login, sesión y expiración, roles por perfil, permisos como snapshot, contraseñas y tokens                                                                                     |
| `critical-flows.spec.ts`                 | 6       | Integración de servicios (TestBed + MockDb)     | Los 6 flujos de HU-074, con verificación de integridad después de cada uno                                                                                                     |
| `domain-rules.spec.ts`                   | 29      | Integración de servicios                        | Reglas de negocio por fase y HU                                                                                                                                                |
| `services.spec.ts`                       | 16      | Integración de servicios                        | Reglas de servicios sin cobertura previa (cobranza, usuarios, sedes, sesiones, uniformes, portal, panel)                                                                       |
| `authorization.spec.ts`                  | 22      | Integración de servicios + ruteo                | Expectativas de seguridad **escritas a mano** (ver abajo)                                                                                                                      |
| `app.routes.spec.ts`                     | 16      | Ruteo e integración de componentes en **jsdom** | Las 50 rutas protegidas con las 5 cuentas (guards reales vía `RouterTestingHarness`), render de cada página del menú sin errores y toda tabla dentro de `.table-wrap` (HU-071) |
| `performance.spec.ts`                    | 1       | Medición (HU-075)                               | 6 consultas principales sobre 5 000 jugadores / 20 000 cargos / 10 000 pagos, < 300 ms cada una sin la latencia simulada                                                       |

### Autorización (`authorization.spec.ts`)

No deriva lo permitido de `auth.can()`: una matriz o una verificación de servicio equivocadas la hacen fallar.

- Tabla explícita de rutas permitidas/denegadas por cuenta.
- Aislamiento del tutor (hijos ajenos denegados en portal, estado de cuenta, expediente, asistencia, uniformes y
  partidos) y alcance del entrenador (categorías, sesiones, asistencia, planteles y partidos ajenos denegados).
- Bloque **«role matrix (D12)»**: los 45 permisos exactos de Secretaría (permitidos y denegados), temporadas,
  descuentos en consulta, cancelar cargo sin pagos (y rechazo con pagos), control total del Administrador (56),
  entrenador sólo en sus sesiones y sin catálogos de oficina, tutor sin pedidos ni listados globales, y la **escalada
  lateral** (SECRETARIA + perfil ENTRENADOR captura sólo en sus sesiones). Estas pruebas fallaron antes de `18178ba`.

### MariaDB (`npm run db:mariadb:test-backup`)

En bases temporales propias (`ef_bktest_*`, se borran al final): carga el esquema, `010_permisos_app.sql` y los 42
casos de `docs/escuela_futbol_mariadb_checks.sql`; respalda, restaura en una base nueva y compara filas y
`CHECKSUM TABLE` de las 39 tablas. Detalle: [`database/MARIADB.md` § 6](database/MARIADB.md).

Los scripts `npm run db:test` / `db:reset` son del esquema PostgreSQL **histórico**.

## Lo que NO existe todavía

- **E2E en navegador real**: ninguna prueba abre la aplicación en un navegador (jsdom no aplica CSS ni layout). Para
  agregarlas: instalar Playwright (`npm i -D @playwright/test` + `npx playwright install chromium`, descarga ~150 MB),
  levantar `ng serve` en la prueba y repetir los 6 flujos críticos como recorridos de UI, más capturas por viewport
  (360 px, 768 px, 1280 px) para HU-071. No se instaló en esta fase para no cambiar la infraestructura sin acuerdo del
  equipo.
- **Validación visual responsive**: no realizada. Ver HU-071 en [`TRACEABILITY.md`](TRACEABILITY.md).
- **Pruebas de API**: no hay API. `performance.spec.ts` mide el dominio, no la red ni la base; los tiempos de la API y
  de MariaDB se medirán con la API.
- **Cobertura porcentual**: no se ha medido.

## Evidencia

- Salida detallada de `npx ng test --watch=false --reporters=verbose` (138/138):
  [`database/evidence/tests-2026-10-08.txt`](database/evidence/tests-2026-10-08.txt).
- Respaldo/restauración: [`database/evidence/backup-restore-2026-10-07.txt`](database/evidence/backup-restore-2026-10-07.txt).

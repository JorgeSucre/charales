# Pruebas

Ejecutar: `npx ng test --watch=false` (Vitest con jsdom, vía `@angular/build:unit-test`). Pruebas del esquema MariaDB y
del respaldo: `npm run db:mariadb:test-backup` (requiere un servidor MariaDB local).

## Qué tipo de prueba es cada archivo

| Archivo                                  | Tipo                                            | Qué cubre                                                                                                                                                                      |
| ---------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shared/shared.spec.ts`                  | Unitaria (funciones puras)                      | Dinero (`DECIMAL` ↔ centavos, sin flotantes), fechas, paginación, validación                                                                                                   |
| `features/billing/billing.rules.spec.ts` | Unitaria (funciones puras)                      | Saldos, estados de cargo, aplicación de pagos, adeudos, ingresos, folios                                                                                                       |
| `core/data/mock-db.integrity.spec.ts`    | Unitaria del verificador                        | 21 violaciones inyectadas (FK, UNIQUE, CHECK, relaciones) detectadas + rollback y commit de transacciones                                                                      |
| `core/auth/auth.spec.ts`                 | Integración de servicio + guard                 | Login, sesión y expiración, roles por perfil, permisos como snapshot, contraseñas y tokens                                                                                     |
| `critical-flows.spec.ts`                 | Integración de servicios (TestBed + MockDb)     | Los 6 flujos de HU-074, con verificación de integridad después de cada uno                                                                                                     |
| `domain-rules.spec.ts`                   | Integración de servicios                        | Reglas de negocio por fase y HU                                                                                                                                                |
| `services.spec.ts`                       | Integración de servicios                        | Reglas de servicios sin cobertura previa (cobranza, usuarios, sedes, sesiones, uniformes, portal, panel)                                                                       |
| `authorization.spec.ts`                  | Integración de servicios + ruteo                | Expectativas de seguridad **escritas a mano**: rutas permitidas/denegadas y llamadas directas a servicios con ids ajenos                                                       |
| `app.routes.spec.ts`                     | Ruteo e integración de componentes en **jsdom** | Las 50 rutas protegidas con las 5 cuentas (guards reales vía `RouterTestingHarness`), render de cada página del menú sin errores y toda tabla dentro de `.table-wrap` (HU-071) |
| `performance.spec.ts`                    | Medición (HU-075)                               | 6 consultas principales sobre 5 000 jugadores / 20 000 cargos / 10 000 pagos, < 300 ms cada una sin la latencia simulada                                                       |

## Lo que NO existe todavía

- **E2E en navegador real**: ninguna prueba abre la aplicación en un navegador (jsdom no aplica CSS ni layout). Para
  agregarlas: instalar Playwright (`npm i -D @playwright/test` + `npx playwright install chromium`, descarga ~150 MB),
  levantar `ng serve` en la prueba y repetir los 6 flujos críticos como recorridos de UI, más capturas por viewport
  (360 px, 768 px, 1280 px) para HU-071. No se instaló en esta fase para no cambiar la infraestructura sin acuerdo del
  equipo.
- **Validación visual responsive**: no realizada (la extensión de navegador no estaba disponible). Ver HU-071 en
  [`TRACEABILITY.md`](TRACEABILITY.md).
- **Tiempos de la API / MariaDB**: `performance.spec.ts` mide el dominio, no la red ni la base; se medirán con la API.

## Evidencia

- Salida detallada de `npx ng test --watch=false --reporters=verbose` (131/131):
  [`database/evidence/tests-2026-10-08.txt`](database/evidence/tests-2026-10-08.txt).
- Respaldo/restauración: [`database/evidence/backup-restore-2026-10-07.txt`](database/evidence/backup-restore-2026-10-07.txt).

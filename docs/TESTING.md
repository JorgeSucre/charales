# Pruebas

Estado al 2026-10-15 (auditoría integral, rama `jorgesucre/api-express`): **156/156** pruebas Angular, **125/125** de
la API sobre MariaDB (autenticación, puente de dominio y una suite por fase con los criterios de cada HU), **13/13** E2E en Chrome
headless, colección Postman 37 requests / 42 aserciones, MariaDB 42/42 checks y respaldo/restauración idéntico;
typecheck, build y formato sin errores. Evidencia:
[`database/evidence/tests-2026-10-15.txt`](database/evidence/tests-2026-10-15.txt). No se ha medido cobertura
porcentual.

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
| API (Node)                    | `npm run api:test` y `npm run api:typecheck` ([`API.md`](API.md))                  |
| E2E en navegador              | `npm run e2e` (build + MariaDB + Google Chrome; `E2E_SHOTS=<dir>` guarda capturas) |

Las pruebas Angular corren con Vitest y jsdom vía `@angular/build:unit-test`, con `baseProviders` (sin la API): los
servicios de dominio corren sobre `MockDb`. Es el mismo código que ejecuta la API (D13); su lado servidor —MariaDB,
autorización por HTTP, transacciones— lo prueban `api/*.test.ts` sobre una base real. No hay ESLint.

| Archivo de la API                           | Pruebas | Qué cubre                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/api.test.ts`                           | 31      | Salud, login, sesión, inactividad, límite de intentos, endpoints de práctica, cambio y recuperación de contraseña (concurrencia incluida), finalidad de tokens (D3e)                                                                                                                                                                                                                                                                            |
| `api/hu-fase2.test.ts` … `hu-fase6.test.ts` | 55      | Criterios de aceptación de cada HU de las fases 2 a 6 sobre MariaDB: jugadores, tutores, categorías, inscripciones, entrenadores, sedes, temporadas, sesiones, asistencia, competencias, partidos, cobranza (con el trabajo diario de VENCIDO), uniformes, avisos, portales, reportes, los flujos críticos de HU-074, caché por versión y rendimiento de HU-075 (5 000 jugadores, 20 000 cargos, 10 000 pagos: < 300 ms)                        |
| `e2e/app.e2e.ts`                            | 13      | Build de producción en el mismo origen que la API, Chrome headless: cada rol inicia sesión por el formulario y abre todas sus páginas (menú y detalle) a 375/768/1280 px — sin errores, sin excepciones, sin scroll horizontal, sin texto en inglés, menú colapsable —; URL directa, cierre de sesión, cuenta desactivada; alta de jugador y cambio de estatus con confirmación por la UI                                                       |
| `api/hu-criterios.test.ts`                  | 10      | Criterios que las suites por fase sólo veían sobre `MockDb` o con un 200: excepción en categoría llena, traslapes, competencias y calendario del entrenador (orden y filtros), porcentajes de asistencia, vistas de la familia (fecha, sede, rival, cancelados y reprogramados), filtros de la bitácora sin operaciones de edición, orden de avisos                                                                                             |
| `api/setup.test.ts`                         | 7       | `npm run db:setup` y `db:admin`: base nueva e idempotencia, datos y matriz de permisos conservados al repetir, base ajena rechazada sin tocarla, errores claros, esquema sin `DROP`, sólo se borran bases `ef_*`, administrador argon2id que nunca sobrescribe una cuenta                                                                                                                                                                       |
| `api/rpc.test.ts`                           | 22      | Mapa de columnas (toda la semilla ida y vuelta); regresiones de la auditoría 2026-10-15 (asignación masiva, nombres de prototipo, CSRF/CORS, cookie, doble cancelación, pagos simultáneos, caché igual a la BD, reloj fijo), sincronía `permissions.ts` ↔ 010, 401/404/400, persistencia + auditoría, autorización por rol/tutor/entrenador, pago y cancelación, rollback por FK, sin hashes, invitaciones, desactivación, HU-006, concurrencia |

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
| `core/api/charales-api.service.spec.ts`  | 8       | Unitaria HTTP (`HttpTestingController`)         | `CharalesApi`: GET de jugadores y categorías, conversión de filas reales a `Player`/`Category`, 401, 403, sin conexión (0/502), login y logout                                 |
| `app.routes.spec.ts`                     | 16      | Ruteo e integración de componentes en **jsdom** | Las 51 rutas protegidas con las 5 cuentas (guards reales vía `RouterTestingHarness`), render de cada página del menú sin errores y toda tabla dentro de `.table-wrap` (HU-071) |
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

## Reloj de las pruebas

Las pruebas de la API corren con un reloj fijo, **2026-10-13 12:00** (hora de la escuela), igual que las del frontend
(`vi.setSystemTime`): la semilla tiene fechas fijas. `api/test-db.ts` simula `Date` en Node (`mock.timers`) y fija el
mismo instante en cada conexión de MariaDB (`SET timestamp`), así que `NOW()`/`CURDATE()` coinciden con los servicios.
El E2E usa el reloj real (el navegador tiene el suyo).

## E2E en navegador

`npm run e2e` (`e2e/app.e2e.ts`): sin dependencias nuevas, conduce el Google Chrome instalado en modo headless por el
protocolo DevTools (`e2e/browser.ts`, perfil temporal propio; `CHROME_PATH` cambia el binario). Sirve el build de
producción en el mismo origen que la API —con un proxy inverso de `/api`, `/auth` y `/health`, como en producción—
sobre una base temporal con los datos de demostración.

- Cada rol (administrador, secretaría, entrenador, tutor, perfil doble) inicia sesión por el formulario y abre todas
  las páginas de su menú y las de detalle a **375, 768 y 1280 px**. Falla si una página redirige, muestra un error,
  lanza una excepción en consola, tiene scroll horizontal, una tarjeta desborda su texto, aparece texto en inglés o el
  menú no se colapsa en teléfono.
- Además: URL directa sin sesión y de tutor a oficina, cierre de sesión, cuenta desactivada en el servidor, alta de
  jugador por formulario (verificada en MariaDB) y cambio de estatus con confirmación (cancelar no cambia nada).
- `E2E_SHOTS=<dir> npm run e2e` guarda una captura por página y ancho para revisarlas a mano.
- La prueba con `confirm()` abre su propio Chrome: una pestaña headless con muchas navegaciones descarta los diálogos por
  su cuenta antes de que la prueba los conteste.

## Lo que NO existe todavía

- **Cobertura porcentual**: no se ha medido.
- **Navegadores distintos de Chrome**: el E2E corre sólo en Chrome.

## Evidencia

- **2026-10-15, auditoría integral (vigente):** todas las suites —Angular, API sobre MariaDB, E2E, respaldo, Postman lint,
  typecheck y formato— en [`database/evidence/tests-2026-10-15.txt`](database/evidence/tests-2026-10-15.txt). La
  colección Postman se ejecutó además contra una API aislada (base temporal con `020_dev_seed.sql`): 37 requests,
  42/42 aserciones.
- 2026-10-13 (anterior a la auditoría): salida de todas las suites —Angular, API sobre MariaDB, E2E, respaldo—
  en [`database/evidence/tests-2026-10-13.txt`](database/evidence/tests-2026-10-13.txt).
- Anterior, sólo Angular (138/138): [`database/evidence/tests-2026-10-08.txt`](database/evidence/tests-2026-10-08.txt).
- Respaldo/restauración: [`database/evidence/backup-restore-2026-10-07.txt`](database/evidence/backup-restore-2026-10-07.txt).

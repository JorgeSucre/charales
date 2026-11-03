# Verificación final — S-01 Hardening Cleanup

| Dato             | Valor                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fecha            | 2026-11-03                                                                                                                                           |
| Commit auditado  | `52f75b6b553fddf9a75c2c2d27b19971c2c5e105` (rama local `fix/s01-hardening-cleanup`)                                                                  |
| Base             | `e84a3a1c230aa46b75f529386caba6e8615b6560` (PR #26)                                                                                                  |
| Estado de `main` | `58555a0`: la PR #26 se fusionó el 2026-11-03 a las 15:36 UTC (por JorgeSucre). La rama auditada va 1 commit por delante y se fusiona sin conflictos |
| Tipo             | Auditoría de sólo lectura. Experimento de bloqueos en una base temporal `ef_auditrc_*`, creada y borrada dentro del mismo experimento                |
| Dictamen         | **APPROVED WITH CONDITIONS** (§ 8)                                                                                                                   |

## 1. Alcance y método

- Se revisó el código del commit desde Git, sin cambiar de rama: `api/login-limit.ts`, `api/auth.ts`, `api/server.ts`, `api/password.ts`, las pruebas `api/login-limit*.test.ts`, la migración 005, `login.page.ts` y la documentación.
- **Experimentos sobre MariaDB 13.0.2** (`REPEATABLE-READ` por defecto, `innodb_snapshot_isolation=1`), con dos conexiones reales a una base temporal, conectadas por el socket local sin `.env`.
- **Medición de conexiones simultáneas por el socket**, sólo con `SELECT 1`.
- No se repitieron las suites completas: se toman como evidencia los resultados reportados en la implementación y se contrastan en § 6.

## 2. Defectos confirmados

| ID  | Sev.                | Hallazgo                                                                                                                                                                                                                                                                                                                                                                                                  | Evidencia                                                                 | Recomendación                                                                                                                        |
| --- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| A-1 | MEDIUM (de proceso) | La rama reescribe la migración `005_limite_acceso.sql` después de que la PR #26 la llevó a `main`: el `ENUM` pasa de tener `'CUENTA'` a no tenerlo. Una base migrada desde `main` conserva el valor viejo, porque `CREATE TABLE IF NOT EXISTS` no la altera, así que el esquema dependería del momento en que se migró cada base. Hoy no hay impacto funcional: el código sólo escribe `IP` y `CUENTA_IP` | `git diff e84a3a1 52f75b6 -- db/mariadb/migrations/005_limite_acceso.sql` | Dejar la 005 igual que en `main`. Si se quiere quitar `'CUENTA'`, hacerlo con una migración 006 idempotente (`ALTER TABLE … MODIFY`) |
| A-2 | MEDIUM (de proceso) | `main` contiene la versión con H-1, H-2 y M-1 sin corregir, porque la PR #26 se fusionó antes que la corrección. No está desplegada                                                                                                                                                                                                                                                                       | `gh pr view 26` → MERGED, `58555a0`                                       | Integrar la corrección antes de cualquier despliegue; no desplegar `main` mientras tanto                                             |

## 3. Riesgos teóricos

| ID  | Sev.   | Riesgo                                                                                                                                                                                                                                                                                                                                                 | Recomendación                                                                                                   |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| R-1 | MEDIUM | **Fuerza bruta distribuida.** Es la contrapartida de H-2: sin contador por cuenta, un atacante con _k_ direcciones obtiene 5·_k_ intentos por cuenta cada 15 min. Con IPv6, un solo equipo con un /64 tiene direcciones prácticamente ilimitadas, y no hay límite global de Argon2id (S-02). No bloquea la fusión, pero **sí la puesta en producción** | Agrupar IPv6 por /64; S-02; un control por cuenta que no bloquee (alerta, ralentización o un desafío adicional) |
| R-2 | LOW    | **Disponibilidad del login.** El pool del limitador tiene 2 conexiones con 3 s de espera, y cada login admitido las usa 4 veces seguidas (peso, reserva, purga, devolución). Una avalancha desde muchas IP sin rechazos recordados puede dejar el login en 503: falla cerrado, y el resto de la API sigue bien                                         | Ajustar el tamaño al despliegue y vigilarlo                                                                     |
| R-3 | LOW    | **Relojes:** las ventanas y la purga usan el reloj de cada instancia. Una instancia adelantada borra antes de tiempo filas que para las demás siguen activas                                                                                                                                                                                           | Usar `NOW()` de MariaDB para ventanas y purga                                                                   |
| R-4 | LOW    | **Colación:** `EMAIL_COLLATION` está fija en el código. La prueba detecta un cambio en el esquema, pero un cambio manual en producción no se detecta al arrancar                                                                                                                                                                                       | Comprobar la colación de `usuarios.email` al arrancar                                                           |
| R-5 | LOW    | **SHA-256 sin clave:** los hashes se revierten enumerando las IPv4 o con un diccionario de correos                                                                                                                                                                                                                                                     | Aceptable; documentado                                                                                          |
| R-6 | INFO   | **Casos marginales de las devoluciones** (como máximo, un intento de más): un éxito pone en 0 el contador cuenta + IP, incluidas las reservas en curso de esa misma pareja; y una devolución puede caer en una ventana nueva                                                                                                                           | Aceptable                                                                                                       |
| R-7 | INFO   | **Esperas por bloqueo:** con `READ COMMITTED` ya no hay esperas por bloqueo de huecos, pero el peor caso sigue siendo 5 reintentos × `innodb_lock_wait_timeout` de 50 s                                                                                                                                                                                | Acotar la espera en la transacción del limitador                                                                |

## 4. Verificación por hallazgo original

### H-1 · Identidad del correo: resuelto

- **Cálculo:** `WEIGHT_STRING(CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci)`, con parámetro; sólo se interpola la constante de la colación, nunca la entrada.
- **Espacios finales:** se quitan los pesos `0209` (espacio) del final, alineados a unidades de 2 bytes, que es la regla PAD SPACE de la colación.
- **Coherencia con el login:** tanto la consulta del usuario como el peso parten de `email.trim()`, y la comparación `usuarios.email = ?` usa la colación de la columna, que prevalece sobre la del parámetro.
- **Entre instancias:** es determinista, porque la calcula el servidor.
- **Claves:** SHA-256 en hex de 64 caracteres; no hay truncamiento ni colisiones nuevas.
- **Enumeración:** las cuentas inexistentes siguen el mismo camino.
- **Cambio de colación:** si cambia en el esquema, la prueba de H-1 falla.

### H-2 · Bloqueo remoto: resuelto

- No queda ningún ámbito «sólo cuenta» en el código.
- Una IP sólo agota su propia pareja cuenta + IP y su propio límite por IP.
- No se encontró otra vía de bloqueo permanente. Dentro de una NAT compartida, el bloqueo dura una ventana.
- Contrapartida: R-1.

### M-1 · Atomicidad y rechazos sin escrituras: resuelto y demostrado

| Caso                                                      | Mecanismo                                                                                                                                                                                                                                                                        | Evidencia                                                                      |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Primer intento de una pareja inexistente, en dos procesos | Con `READ COMMITTED`, `SELECT … FOR UPDATE` sobre una fila inexistente **no bloquea**. La exclusión la da la **clave primaria**: el segundo `INSERT` espera al `COMMIT` del primero, recibe el error 1062 (clave duplicada), hace ROLLBACK y reintenta, ya con la fila bloqueada | Experimento: el `SELECT` de B esperó 0 ms; su `INSERT` dio 1062 tras 505 ms    |
| Último cupo                                               | El `FOR UPDATE` sobre la fila existente obliga a esperar                                                                                                                                                                                                                         | B esperó 505 ms y vio 5 (A había visto 4)                                      |
| Bloqueo de huecos                                         | `READ COMMITTED` no los bloquea; `REPEATABLE READ` sí (de ahí la elección)                                                                                                                                                                                                       | Con RC, el `INSERT` vecino entró en 0 ms; con RR, dio 1205 (timeout) a los 3 s |
| Bloqueos mutuos y reintentos                              | Siempre se bloquea primero la fila de la IP; cada reintento hace ROLLBACK, así que no duplica reservas                                                                                                                                                                           | `login-limit.ts`, líneas 97–136                                                |
| Error durante el `COMMIT`                                 | No se reintenta: 503. Si el servidor sí confirmó, el intento queda contado (el lado seguro)                                                                                                                                                                                      | Código                                                                         |
| Rechazo sin escrituras                                    | Un rechazo sólo lee con bloqueo                                                                                                                                                                                                                                                  | Prueba con checksum de todas las tablas                                        |
| Correos al azar                                           | No crean filas cuando la IP está en su límite                                                                                                                                                                                                                                    | Prueba M-1                                                                     |
| Devolución tras un éxito                                  | El contador cuenta + IP vuelve a 0 y la IP recupera su intento                                                                                                                                                                                                                   | Prueba de contadores                                                           |

### Rechazos recordados (10 s en memoria)

- Sólo rechazan: se registran únicamente desde una decisión de MariaDB, y un error no se registra (termina en 503).
- Un rechazo obsoleto dura como máximo 10 s más que la ventana: afecta a la disponibilidad, no a la seguridad.
- Otra instancia no puede liberar una pareja que está en su límite.
- La memoria está acotada a 10 000 entradas; llenarla sólo genera más consultas a la base.

### Pool propio

- 2 conexiones, 3 s de espera máxima, en un pool distinto del principal; las conexiones se liberan en `finally`.
- Agotado, responde 503 sin ejecutar Argon2id; lo prueba la suite con reloj real.
- Un 429 no usa el pool principal.

## 5. Login y limpieza

- **Login:** `login.page.ts` ya no muestra `demo1234` ni las cuentas `@example.com`.
- **No se borró nada:** `git diff --name-status e84a3a1 52f75b6` sólo muestra modificaciones. Sin cambios en fixtures, `api/demo.ts`, `020_dev_seed.sql`, el esquema PostgreSQL histórico ni `api-demo.page.ts`.
- **`/admin/api`:** conserva `demo1234` en la página de práctica, que exige sesión de personal con `jugadores.consultar`. Está documentado como caso ambiguo.

## 6. Pruebas

- **Verificadas:** las 25 pruebas nuevas cuentan las ejecuciones reales de Argon2id y leen los contadores en MariaDB, y el comportamiento entre procesos usa procesos reales. Resultados reportados: Angular 247/247, API 223/223 en serie, E2E 19/19 y respaldo con 41 tablas idénticas.
- **Fallos paralelos de `api:test` (118):** son del entorno, no funcionales.
  - Sin carga, 80 conexiones simultáneas por el socket abren sin fallos (máximo 12 ms).
  - Los timeouts (error 45012) aparecieron con unos 14 procesos creando bases y esquemas a la vez, cuando el driver se rinde a 1 s de intentar conectar (`connectTimeout` por defecto, que también usa la API).
- **Pendientes:**
  - repetir `npm run api:test` en paralelo con la configuración habitual del equipo, después de integrar con `main`;
  - agotamiento de los reintentos;
  - fallo al devolver una reserva;
  - purga concurrente con una reserva;
  - IPv6;
  - comprobar la colación al arrancar;
  - una prueba automática de que el login no muestra credenciales.

## 7. Comparación con la auditoría anterior de la PR #26

| Hallazgo                                                | Estado                                                            |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| H-1 Variantes del correo                                | Resuelto                                                          |
| H-2 Bloqueo remoto                                      | Resuelto, con la contrapartida R-1                                |
| M-1 Escrituras en 429 y pool                            | Resuelto, con la contrapartida R-2                                |
| M-2 IPv6                                                | Abierto (parte de R-1)                                            |
| L-1 Relojes                                             | Abierto (R-3)                                                     |
| L-2 Ventanas fijas · L-3 Intentos en curso · L-5 Hashes | Abiertos, aceptables                                              |
| L-4 `X-Forwarded-For` mal formado sin registro          | Abierto                                                           |
| I-2 Espera por bloqueo                                  | Mejorado (sin bloqueos de huecos); el peor caso sigue igual (R-7) |

## 8. Dictamen y condiciones

**APPROVED WITH CONDITIONS.** La reserva es atómica, también para filas que no existen, y H-1, H-2 y M-1 quedan resueltos. Antes de fusionar:

1. Dejar `005_limite_acceso.sql` igual que en `main` y, si se quiere, quitar `'CUENTA'` con una migración 006 idempotente (A-1).
2. Integrar con el `main` actual (`58555a0`) y repetir la suite completa, incluido `npm run api:test` en paralelo con la configuración del equipo.
3. Registrar R-1 como pendiente explícito antes de producción (IPv6 por /64, S-02 y un control por cuenta que no bloquee), y no desplegar `main` hasta integrar esta corrección (A-2).

# Auditoría independiente del commit 93a16d2

- SHA revisado: `93a16d26f7a75c2f24160eced0eb0ba958b2458e` (padre `b6cc8bdf5e96887148f6bca4e09b588cd2bba244`).
- Copia usada: `charales-wt/auditoria-independiente`, HEAD detached. Al terminar, `git status` sigue limpio. Solo se generó `api/.build`, que Git ignora.
- Leyenda: **[E]** demostrado ejecutando; **[L]** deducido leyendo el código.
- Auxiliares en `.../scratchpad/funcional/indep4/`: `sig.sh`, `probes.ts`, `probeE.ts`, `bin/` (envoltorios de `mariadb-dump`, `gpg` y `mktemp`), `old/` y `new/` (`deploy` y `db` de cada versión), `mut/` (copia desechable para las mutaciones), registros `*.log`.

## 1. Arreglos que contiene el commit

| Arreglo | Archivo y líneas | Problema que pretende resolver |
| --- | --- | --- |
| IND3-01 | `deploy/mariadb/respaldo-programado.sh:17` | `grep -q 'marcar_cargos_vencidos'` también encontraba el nombre en el `CREATE EVENT` (`DO CALL marcar_cargos_vencidos()`). Un volcado sin el procedimiento salía con exit 0. |
| IND3-02 | `deploy/mariadb/respaldo-programado.sh:14` | Con `dash`, una señal no ejecuta el `trap … EXIT`, así que el volcado `.sql.gz` sin cifrar se quedaba en `mktemp -d`. |
| IND3-03 | `api/login-limit.ts:341` | `RECUP_IP` contaba por /24 o /48 (`wideBucket`): un vecino de la misma asignación bloqueaba la recuperación de todos. Ahora cuenta por red (`limitBucket`: una IPv4 o un /64). |
| IND3-06 | `api/password.ts:125-129` | Cambiar la contraseña con sesión no revocaba los enlaces vivos (`tokens_recuperacion`). Ahora los marca con `usado_en` dentro de la misma transacción. |
| IND3-04 e IND3-05 | `docs/API.md:147-150` | Solo se documentan, sin cambiar código. |
| Pruebas | `api/auditoria-independiente.test.ts:704-761` | Un ayudante `extraLink` y tres pruebas: «IND2-08 (isolated)», «IND3-06» e «IND3-03». |
| Informe | `docs/audits/AUDITORIA_INDEPENDIENTE_CIERRE_2026_REVISION3.md` | Copia literal del tercer informe. |

## 2. Comportamiento esperado y resultado

| Arreglo | Comportamiento esperado | En `b6cc8bd` | En `93a16d2` |
| --- | --- | --- | --- |
| IND3-01 | Un volcado sin el procedimiento debe acabar con exit ≠ 0 y no dejar ningún `.gpg`. | [E] Con `mariadb-dump --skip-routines`: exit 0 y 1 archivo, con `sh`, `dash` y `bash`. | [E] Exit 1, 0 archivos y el mensaje esperado, en los tres shells. Con rutinas sigue dando exit 0. **Corregido**, con la salvedad de IND4-03. |
| IND3-02 | Con TERM o INT no debe quedar ningún volcado sin cifrar. | [E] Con `dash`, TERM o INT durante `gpg`: queda 1 `.sql.gz` en claro. Con TERM durante el volcado (solo al PID): también queda. | [E] TERM o INT, al PID o al grupo, durante el volcado o durante `gpg`, con `sh`, `dash` y `bash`: exit 1 y 0 archivos temporales. **Corregido** para TERM e INT. HUP y KILL siguen dejando el volcado (IND4-05). |
| IND3-03 | Que un vecino de otra IP del mismo /24 pueda pedir la recuperación. | [E] La prueba IND3-03 falla: el vecino recibe 429. | [E] El vecino recibe 204. **Corregido.** Efectos secundarios en IND4-01 e IND4-02. |
| IND3-06 | Un enlace emitido antes del cambio de contraseña debe dar 400 después del cambio. | [E] La prueba IND3-06 falla: el enlace da 204. | [E] El enlace da 400, y también una INVITACION viva (sonda PROBE-C: 204 / 400). **Corregido.** |

Concurrencia del cambio de contraseña:

- [L] La transacción bloquea primero `usuarios` (`FOR UPDATE`), igual que `confirm`, `issueRecovery` y `mail.reissue`, así que las operaciones sobre una misma cuenta se ejecutan una tras otra.
- [L] El `UPDATE` nuevo usa `idx_token_usuario` y no inserta en `tokens_recuperacion`. No veo un ciclo de bloqueos con otras cuentas: puede esperar por los bloqueos de hueco, pero no causar un interbloqueo. La misma sentencia ya existía en `confirm`.
- [E] Sonda PROBE-D: 6 rondas con 5 cuentas. En cada una, en paralelo, un cambio de contraseña, una solicitud de recuperación y una confirmación por cuenta, 90 peticiones en total. Resultado: 60×204, 26×400, 4×401 y **ningún 5xx**. Es una evidencia limitada: no es una prueba de carga.

## 3. Riesgos

- Con la recuperación contada otra vez por /64, un solo /48 vuelve a permitir solicitudes sin límite práctico para cuentas distintas (IND4-01).
- La comprobación del respaldo se puede satisfacer con datos (IND4-03), y ningún script del respaldo programado tiene prueba automática (IND4-04).
- La documentación no refleja con exactitud el alcance real de algunos cambios (IND4-06).

## 4. Hallazgos

### IND4-01 · MEDIO · Volver a contar `RECUP_IP` por /64 reabre IND-12: un solo /48 envía solicitudes de recuperación sin límite práctico

- Archivo: `api/login-limit.ts:341`. Documentación: `docs/API.md:151`.
- Reproducción [E, PROBE-A en `mut/`]: 200 /64 de `2001:db8:dd::/48` piden la recuperación de 200 correos distintos.
  - Con el código de `b6cc8bd`: 20×204 y 180×429.
  - Con `93a16d2`: **200×204**.
- Impacto:
  - Vuelve exactamente el caso que REVISION2 había medido para IND-12. Con un /48, que se consigue gratis, se pueden pedir correos para todas las cuentas: el tope por cuenta sigue siendo de 29 al día, pero no hay tope global. Eso permite gastar la cuota del proveedor, lo que también cerraría la recuperación.
  - REVISION3 dejaba esta decisión al responsable («El responsable debe decidir IND3-03»). El commit no deja constancia de que el responsable la aceptara.
  - `API.md:151` sigue diciendo «muchas asignaciones», cuando basta una.
- Prueba: [E] La mutación que devuelve `wideBucket` hace fallar IND3-03, y la prueba IND-12 sigue pasando. Ninguna prueba protege el sentido contrario (muchos /64 de un mismo /48).
- Recomendación:
  - Usar dos contadores: el de /64 (20) más uno por /48 o /24 bastante más alto (por ejemplo 100-200). Y añadir un tope global diario de correos.
  - Si se acepta el riesgo, que lo apruebe el responsable y corregir `API.md:151`.
  - Añadir una prueba con N /64 de un mismo /48.

### IND4-02 · BAJO · La oficina tras un NAT sigue bloqueable por una sola persona; la prueba y el commit dicen más de lo que se demuestra

- Archivos: `api/login-limit.ts:341` y `api/auditoria-independiente.test.ts:747` («one neighbour can not block an office»).
- Reproducción [E, PROBE-B]: 20 solicitudes desde `203.0.113.50`, y después un compañero con la misma IP pública pide la de `tutor@example.com`: **429**, igual en `b6cc8bd` que en `93a16d2`.
- Impacto:
  - Una oficina tras un NAT tiene una sola IPv4 pública. IND3-03 citaba precisamente «la oficina de la escuela tras un NAT».
  - La prueba solo cubre vecinos con IPs públicas distintas (`.10` y `.11`).
  - Es un riesgo residual previo, pero el mensaje del commit lo presenta como resuelto.
- Recomendación:
  - Renombrar la prueba y documentar el caso del NAT.
  - Valorar la alternativa de IND3: no aplicar el 429 de red a una cuenta cuya petición llega desde uno de sus navegadores de confianza.

### IND4-03 · BAJO · La comprobación del procedimiento en el respaldo se satisface con texto de los datos

- Archivo: `deploy/mariadb/respaldo-programado.sh:17`.
- Reproducción [E]:
  1. En mi base `ef_indep4_8ad28fa1` inserté en `auditoria.descripcion` el texto ficticio ``PROCEDURE `marcar_cargos_vencidos` ``.
  2. Ejecuté `respaldo-programado.sh` con `dash`, `--skip-routines` y `gpg` simulado.
  3. Resultado: **exit 0** y el volcado tiene 0 `CREATE … PROCEDURE`. Después borré la fila.
- Otras comprobaciones [E]:
  - El volcado real con rutinas tiene dos líneas que coinciden: `/*!50003 DROP PROCEDURE IF EXISTS …*/` y `CREATE DEFINER=… PROCEDURE …`.
  - Con la cuenta `charales_backup` de `cuentas.sql` sin `SELECT ON mysql.proc`, en una instancia privada, el volcado omite el procedimiento sin avisar y el grep nuevo lo detecta.
  - Con `EXECUTE` y sin `SHOW CREATE`, `mariadb-dump` escribe `-- insufficient privileges to SHOW CREATE PROCEDURE \`marcar_cargos_vencidos\`` (que coincidiría con el grep), pero sale con exit 2, así que `backup.sh` ya falla antes.
- Impacto: hace falta que coincidan dos cosas, que falten las rutinas y que algún campo de texto contenga esa cadena. Las comillas invertidas no se escapan dentro de las cadenas de un volcado.
- Recomendación: anclar el patrón a inicio de línea (`grep -q '^CREATE DEFINER=.* PROCEDURE `marcar_cargos_vencidos`'`), o comprobarlo restaurando el volcado y usando `information_schema` (`verify-backup.sh`).

### IND4-04 · BAJO · No hay pruebas automáticas para `respaldo-programado.sh` (IND3-01 e IND3-02)

- Archivo: ningún archivo de `api/*.test.ts`, `e2e` ni `db/mariadb/scripts` cita `respaldo-programado.sh`.
- Comprobación:
  - [E] `grep` no encuentra ninguna referencia.
  - [E] `npm run db:mariadb:test-backup` pasa, pero solo prueba `backup.sh`, `restore.sh` y `verify-backup.sh`.
  - [L] Una regresión del patrón o del `trap` no la detectaría ninguna suite. IND3-01 pedía expresamente «una prueba con un volcado sin rutinas».
- Recomendación: una prueba con un `mariadb-dump` envoltorio (`--skip-routines`) y un `gpg` simulado, más una prueba de señal con `dash`, como `sig.sh`.

### IND4-05 · BAJO · Con HUP (y KILL) el volcado sin cifrar sigue quedando en el directorio temporal

- Archivo: `deploy/mariadb/respaldo-programado.sh:12-14`.
- Reproducción [E, `sig.sh`]:
  - Con `dash` y HUP al PID durante `gpg`: exit 129 y 1 `.sql.gz` en claro en el directorio de `mktemp -d`.
  - Con KILL: lo mismo, exit 137.
  - Con `bash` y HUP no queda nada.
- Impacto:
  - Un HUP llega, por ejemplo, al ejecutarlo a mano por SSH y cortarse la conexión. [L] Un temporizador de systemd envía TERM, que ya está cubierto, salvo con `SendSIGHUP=yes`. Después del tiempo de espera envía KILL.
  - El archivo tiene modo 0600 y contiene datos de menores.
  - No se aplicó la otra recomendación de IND3-02: crear `WORK` dentro de `$BACKUP_DIR`.
- Recomendación: `trap 'exit 1' HUP INT TERM` (también en `backup.sh`) y `WORK=$(mktemp -d "$BACKUP_DIR/.tmp.XXXXXX")`, con una limpieza de restos al arrancar.

### IND4-06 · BAJO · Documentación que no coincide con el código

- `docs/API.md:147-148` (IND3-04) dice «también para otros navegadores nuevos de esa misma red». En ese mismo documento (línea 117), «red» significa una IPv4 o un /64. El bloqueo, sin embargo, afecta a todo el /24.
  - [E] PROBE-E: tras 8 errores desde `187.190.1.10`, la contraseña correcta desde `187.190.1.99` da 429 y desde `187.190.2.99` da 200.
- `docs/API.md:232-233` y la cabecera de `api/password.ts:4` describen lo que hace el cambio de contraseña y no mencionan que ahora revoca los enlaces y las invitaciones vivas. [L]
- `docs/API.md:149-150` (IND3-05) omite el 503 al corregir el correo sin servicio de correo y que la invitación reenviada vale 24 h. [L]
- `docs/API.md:151`: ver IND4-01.
- Recomendación: decir «/24 o /48» en IND3-04, añadir la revocación de enlaces al apartado del cambio de contraseña y completar IND3-05.

### IND4-07 · BAJO · Las pruebas nuevas no cubren las invitaciones y no limpian si fallan

- Archivo: `api/auditoria-independiente.test.ts:704-745`.
- Cobertura [E, mutaciones en `mut/`]:
  - M2: quitar el `UPDATE` de `changePassword` hace fallar IND3-06. Bien.
  - M3: limitar la revocación a `finalidad = 'RECUPERACION'` hace que **todas las pruebas pasen**, aunque una INVITACION viva vuelve a confirmar con 204 (PROBE-C). El ayudante `extraLink` solo crea enlaces de recuperación, pese a que el nombre de la prueba aislada dice «whatever made it».
- Limpieza [E]: las pruebas IND3-06 e «IND2-08 (isolated)» restauran `password_hash` solo si pasan.
  - Con el código de `b6cc8bd`, el fallo de IND3-06 dejó la contraseña de `marta@example.com` cambiada.
  - Por eso falló también la siguiente sonda, PROBE-C, al no poder iniciar sesión. Un fallo arrastra a otros en cascada.
- Recomendación: un caso con `INVITACION` y la restauración en `try/finally`.

### IND4-08 · INFORMATIVO · El alcance real de IND3-06 frente a un buzón comprometido es limitado

- [L] Quien controla el buzón puede pedir un enlace nuevo después del cambio de contraseña: `RECUP_CUENTA` permite 5.
- [L] Además, `issueRecovery` se ejecuta después de responder 204. Si una solicitud hecha justo antes del cambio se confirma (COMMIT) después de él, su enlace sobrevive. No lo reproduje: depende del momento exacto.
- El arreglo cierra el caso descrito, el de los enlaces emitidos antes del cambio, pero no protege una cuenta cuyo buzón está comprometido. Conviene decirlo en `API.md`.

### IND4-09 · INFORMATIVO · Anterior al commit: la prueba original «IND2-08» falla si se ejecuta sola

- Reproducción [E, 4 de 4 veces]: `node --test --test-name-pattern='^IND2-08: setting'` falla con `CONSTRAINT chk_token_expira failed` en `operatorLink`.
  - `operatorLink` crea el token con el reloj real (`creado_en` del 5-11) y la prueba fija `expira_en` con el reloj de las pruebas (13-10).
  - En la suite completa pasa porque las pruebas anteriores adelantan el reloj.
- No lo introduce `93a16d2`, que añade la variante aislada para rodearlo, pero el problema de fondo sigue ahí.

### IND4-10 · INFORMATIVO · Recomendaciones de REVISION3 sin aplicar

- IND3-07: 9 archivos siguen remitiendo a `docs/audits/CIERRE_FINAL_REMEDIACION_2026.md`, que no existe [E: `git grep`]. Entre ellos está `docs/deployment/PROCEDIMIENTO_PRODUCCION.md`. El commit no dice haberlo corregido.
- Tampoco se aplicaron:
  - la prueba de IND3-01 (IND4-04);
  - `WORK` dentro de `$BACKUP_DIR` (IND4-05);
  - el tope global de correos (IND4-01).

## 5. Pruebas revisadas y ejecutadas

Todas desde la copia aislada, con `DB_SOCKET=/tmp/mysql.sock DB_USER=jorgesucre` y sin `DB_PASSWORD`, `DB_HOST`, `DB_PORT` ni `DB_NAME`.

- `npm run api:typecheck` → exit 0 [E].
- `npm run api:test` → 395 pruebas: 395 pasan y 0 fallan; exit 0 [E]. Incluye las tres nuevas.
- `npm run db:mariadb:test-backup` → exit 0, «RESULTADO: OK, el respaldo es idéntico» (45 tablas) [E].
- Reproducción contra el padre: en la copia `mut/` sustituí `password.ts` y `login-limit.ts` por los de `b6cc8bd`. IND3-06 e IND3-03 fallan; la «IND2-08 (isolated)» pasa [E].
- Mutaciones en `mut/`, fuera del repositorio:
  - M1 (`wideBucket`): IND3-03 falla.
  - M2 (sin revocación): IND3-06 falla.
  - M3 (solo `RECUPERACION`): no falla ninguna prueba.
  - M5 (filtro que no revoca nada): IND3-06 falla.
- Sondas propias, PROBE-A a PROBE-E, en `indep4/probes.ts` y `indep4/probeE.ts`. Solo se ejecutaron en `mut/`.
- Scripts del respaldo con `sh` (bash 3.2 de macOS), `dash` y `bash`, con TERM, INT, HUP y KILL, enviados al PID o al grupo de procesos, durante el volcado y durante `gpg` [E, `sig.sh`].
- No comprobado:
  - El comportamiento de `gpg` real al recibir una señal: solo usé un `gpg` simulado.
  - systemd real, porque esto es macOS.
  - La carrera de IND4-08.

## 6. Bases creadas

- `ef_indep4_8ad28fa1`, en el servidor compartido. Comprobé antes que no existía. Contiene el esquema, las migraciones y datos ficticios. **Se conserva.** La fila de prueba de `auditoria` se borró después de usarla.
- Instancia MariaDB privada en `indep4/priv/data`, en el puerto 33987, con el socket en `/tmp/ind4.sock`. La ruta del scratchpad era demasiado larga para un socket. Contiene la base `escuela_futbol` y el usuario ficticio `charales_backup` solo dentro de esa instancia. **Detenida**; el datadir se conserva.
- Las suites del proyecto crearon y borraron sus propias bases `ef_*` y `ef_bktest_*`.
- No se escribió en `escuela_futbol`, en `escuela_futbol_demo` ni en ninguna otra base `ef_*` ya existente.
- Incidencia: el `mktemp` de macOS ignoró `TMPDIR` en mi primera tanda de señales. Quedaron 4 volcados ficticios (de `ef_indep4_8ad28fa1`) en `/var/folders/…/T/tmp.*`. Los localicé y borré, y repetí la tanda con un `mktemp` envoltorio.

## 7. Dictamen

**Aceptable con reservas.** Los cuatro arreglos de código hacen lo que dicen en el caso concreto que describe REVISION3, y lo he comprobado ejecutándolos contra el padre y contra el commit. Las suites pasan y no aparecieron 5xx ni interbloqueos en la sonda de concurrencia.

Reservas:

- IND4-01 (MEDIO): el arreglo de IND3-03 reabre IND-12 para un /48 completo, y esa decisión le correspondía al responsable. Debe aprobarse explícitamente o mitigarse con un segundo contador o un tope global antes de producción.
- El resto son de severidad BAJA: la comprobación del respaldo es mejorable y no tiene pruebas, el HUP no está cubierto, hay documentación inexacta y las pruebas no cubren las invitaciones ni limpian si fallan.

# Auditoría de seguridad independiente 3 — Charales

## 1. Datos

- SHA revisado: `b6cc8bdf5e96887148f6bca4e09b588cd2bba244` (HEAD detached, copia `charales-wt/auditoria-independiente`).
- Informes de partida: `AUDITORIA_INDEPENDIENTE_CIERRE_2026.md` (IND-01 a 15) y `..._REVISION2.md` (IND2-01 a 11).
- Fecha: 2026-11-05. macOS, Node 26, MariaDB 13.0.2 (`innodb_snapshot_isolation=1`, modo estricto por defecto).
- No modifiqué el repositorio: `git status --short` da 0 líneas y HEAD sigue igual.

Marcas: **[E]** demostrado por ejecución; **[L]** deducido por lectura; **[NC]** no comprobado.

## 2. Dictamen independiente

**Integración en `main` local (sin push ni despliegue): APTA, con reservas.**

- No encontré nada CRÍTICO ni ALTO.
- Las correcciones de IND2-01, 02, 03, 06 y 07 funcionan en mis sondeos.
- Antes o justo después de integrar conviene corregir IND3-01 (la comprobación del respaldo programado no comprueba nada) e IND3-07 (enlaces rotos al «dictamen vigente»). Ambos arreglos son pequeños.
- El responsable debe decidir IND3-03: la última corrección convirtió el límite de recuperación en un límite por /24 o /48, y eso permite a un vecino cerrar la recuperación de toda su red.

**Producción: NO APTA.** Siguen sin probar el servidor, TLS, el correo real, nginx, systemd, MariaDB 11.8 y la CI. Falta la política de datos de menores (F5-25). Además:

- IND-03 sigue abierto: 10 redes dejan fuera al dueño en un navegador nuevo durante 72 h, y 6 redes durante el primer día [E].
- IND3-01, IND3-02 e IND3-03.

Recuento de hallazgos nuevos:

| Severidad | N |
| --- | --- |
| CRÍTICO | 0 |
| ALTO | 0 |
| MEDIO | 1 |
| BAJO | 6 |
| INFORMATIVO | 1 |

## 3. Alcance

Leídos por completo:

- `api/auth.ts` (login, sesión, `currentSession`), `api/password.ts`, `api/login-limit.ts`, `api/device-trust.ts`, `api/access-link.ts`
- `api/rpc.ts` líneas 1-330 y `applyChanges`
- `api/mail.ts` (cola, `reissue`), `api/schema.ts` (`missingSchema`)
- `db/mariadb/scripts/backup.sh`, `migrate.sh`, `deploy/mariadb/respaldo-programado.sh`, `deploy/nginx/charales.conf`

Leídos en parte: `UserService` (`save`, `afterEmailChange`, `setActive`), `AuthService` (`issueResetToken`, `revokeAccessTokens`) y `docs/API.md` (límites).

Diffs: `git diff d61ab7b b6cc8bd` completo en código, migraciones, `deploy` y pruebas; de `9e08b11..b6cc8bd`, solo lo que afecta a estas áreas.

## 4. Metodología y resultados reales

Conexión: `DB_SOCKET=/tmp/mysql.sock DB_USER=$(whoami)`, sin `.env` y sin contraseña.

| Comando | Resultado |
| --- | --- |
| `npm run api:typecheck` | exit 0 |
| `npm run build` | exit 0 |
| `npm run api:test` (1.ª) | 391/392. Falló `F5-06` en `endurecimiento.test.ts:254` por agotar 10 s, con mis sondeos en marcha a la vez |
| `npm run api:test` (2.ª, sin carga) | **392/392**, 65 s |
| `npx ng test --watch=false` (1.ª, con carga) | 242/251, 9 fallos, todos por tiempo agotado; tardó 1 427 s |
| `npx ng test --watch=false` (2.ª, sin carga) | **251/251**, 121 s |
| `npm run e2e` | 23/23 |
| `npm run db:mariadb:test-backup` | exit 0, «el respaldo es idéntico» |
| `npm audit` | 0 vulnerabilidades |
| `npx prettier --check .` | OK |
| `git diff --check 9e08b11 HEAD` | exit 0, sin salida |

Los fallos de las primeras ejecuciones son de tiempo bajo carga y desaparecen sin ella. Lo anoto como fragilidad de las pruebas, no como defecto del código (IND3-08).

Sondeos propios en `cierre/indep3/`: API real en proceso con `createApp`, bases nuevas `ef_indep3_*` y correo capturado en memoria.

| Sondeo | Qué cubre |
| --- | --- |
| `q1b.mjs` | Carreras de IND2-03 (recuperación y login contra cambio de correo) y desactivar contra login, con barrido de 0 a 29 ms, 60 rondas cada una |
| `q2.mjs` | Error 1020: 8 bucles martillean `/auth/session` de la víctima mientras se cambia el correo, se desactiva, se cambia la contraseña o se confirma |
| `q3.mjs` | `access-link` (IND2-04, IND2-08), cambio de contraseña frente a enlaces vivos, acentos, `RECUP_IP` por /24 o /48, oficina tras NAT, purga de `CUENTA_RED` |
| `q4.mjs` | Avalanchas de cookies contra el pool de 2 conexiones, 150 clientes concurrentes durante 10 s |
| `q5.mjs` | IND2-06, IND2-07, IND-10, IND-12, IND-15 y logins en paralelo con una misma cookie |
| `q6.mjs` | IND-03: 72 h simuladas con N redes, desplazando `ventana_inicio` |
| `q7.mjs` | Editar la propia cuenta, editar otros campos, corregir una invitación pendiente |
| `mig.sh` | Migraciones: reejecución, bases creadas con `9e08b11`, `f8e26ec` y `d61ab7b`, sin modo estricto, `missingSchema` |
| `bk/sig.sh` | Respaldos con `mariadb-dump` y `gpg` simulados, y señales con `dash` |
| `mut.sh` | 15 mutaciones sobre una copia desechable en `indep3/mut/w` |

Límites:

- El tiempo se simula moviendo hacia atrás `ventana_inicio`, no el reloj.
- `gpg` está simulado: la clave real no se pudo crear porque la ruta del socket es demasiado larga.
- No tenía `dash` para Linux, solo `/bin/dash` de macOS.
- No probé nginx, systemd ni la instancia MariaDB privada.

## 5. Estado de IND2-01 a IND2-11

| ID | Estado | Comprobación |
| --- | --- | --- |
| IND2-01 | **CORREGIDO** | [E] Base con filas de los 7 ámbitos (`CUENTA_RED` incluido): `setup` ×2 y `migrate.sh` dan exit 0 y conservan todas las filas con sus intentos. Desde `9e08b11`, `f8e26ec` y `d61ab7b` con filas: setup de HEAD ×2 da exit 0, conserva filas y el esquema difiere en 0 líneas del de una base nueva. Con `sql_mode=''` las filas siguen intactas. Hay prueba nueva. |
| IND2-02 | **CORREGIDO** | [E] Con el `ENUM` sin `CUENTA_RED`, `missingSchema` devuelve `["limite_acceso.ambito (CUENTA_RED)"]`. [L] En producción el arranque sale con exit 1 por esa lista. No llegué a verlo: el entorno de prueba se rechazó antes por la configuración. |
| IND2-03 | **CORREGIDO** | [E, 60 rondas cada caso] Recuperación contra cambio de correo: 0 tokens vivos para la dirección antigua y 60×200. Login contra cambio de correo: 0 sesiones abiertas; las 24 sesiones que llegaron a crearse dan 401. Residuo informativo en IND3-08. |
| IND2-04 | **CORREGIDO** | [E] Enlace del operador, solicitud de recuperación del atacante (204) y el enlace sigue confirmando (204). Efectos secundarios de emitirlo como INVITACION: IND3-05. |
| IND2-05 | **ACEPTADO (documentado), agravado** | [E] Sigue existiendo. Se documenta en `docs/API.md:124-126`. La recarga pasó de 3 h a 6 h: ahora bastan 4 solicitudes al día para mantenerlo. No consta aceptación firmada. |
| IND2-06 | **CORREGIDO** | [E] Red agotada, 40 cookies inventadas y luego la válida desde la misma IP: 200. Con 7 095 cookies inventadas por segundo, el dueño sigue entrando: 12×200, mediana de 94 ms. |
| IND2-07 | **CORREGIDO** | [E] Con la fila de `usuarios` retenida: 503 a los 2,09 s, `/health` en 4 ms, los 4 contadores vuelven a 0, y con cookie `fallos` vuelve a 0. |
| IND2-08 | **PARCIAL** | [E] Al confirmar se revocan los demás enlaces: la invitación da 400 tras usar el enlace del operador. [E] **El cambio de contraseña autenticado no revoca nada:** IND3-06. |
| IND2-09 | **PARCIAL** | [E] `backup.sh` con `dash` y TERM durante el volcado: exit 1 y nada en el directorio. [L] El `.gz` parcial ya se escribe en un temporal. **Pero la comprobación nueva de rutinas no detecta su ausencia (IND3-01)** y `respaldo-programado.sh` deja el volcado en claro con TERM (IND3-02). |
| IND2-10 | **CORREGIDO (documentado)** | [L] `real_ip` explicado en `charales.conf:6-7` y en el procedimiento, § 3 paso 4. [NC] nginx real. |
| IND2-11 | **PARCIAL** | [E] Sin correo, corregir el correo de una invitación pendiente sigue dando 503, y ahora también en cuentas con enlace del operador (IND3-05). [L] Se añadió el aviso de `APP_URL`; `HOST` vacío sigue sin aviso (`server.ts:307`). [E] Error 1020: 0 respuestas 500 en `q2`. [L] `issueDevice` ya va dentro de la transacción y un fallo la revierte entera. |

## 6. Estado de los IND que quedaron PARCIAL

| ID | Estado | Comprobación |
| --- | --- | --- |
| IND-01 | **CORREGIDO** | [E] Ver IND2-03. Corregir el correo propio o ajeno revoca enlaces y navegadores y cierra las demás sesiones (`q7`). |
| IND-03 | **PARCIAL** | [E, `q6`, el dueño intenta cada 30 min durante 72 h desde redes nuevas]. Días con acceso, de 48 intentos posibles: 4 redes: 20, 48, 48. 6 redes: 0, 39, 48. 8 redes: 0, 1, 47. **10, 12 y 13 redes: 0, 0, 0.** `docs/API.md` dice «unas 12»: a largo plazo es cierto, pero 10 bastan para 3 días y 6 para el primer día. Mejora frente a 5 redes en la revisión 2. Las contraseñas probadas siguen acotadas a 153 en 72 h. |
| IND-10 | **CORREGIDO** | [E] Ver IND2-06. |
| IND-12 | **PARCIAL** | [E] 200 /64 de un mismo /48 dan 20×204 y 180×429. 200 /48 distintos dan 199×204. Sigue sin tope global de correos y los /48 se consiguen gratis. |
| IND-13 | **PARCIAL** | [L] El procedimiento sigue sin ensayarse. Ahora remite a un dictamen que no existe (IND3-07). |
| IND-14 | **PARCIAL** | [E] Las cifras de pruebas (392, 251, 23) coinciden con la ejecución. Siguen los documentos históricos marcados como tales. Nuevo: 7 enlaces rotos (IND3-07), y la cifra de redes de IND-03 en `API.md` es optimista. |
| IND-15 | **PARCIAL** | [E] 6 logins en paralelo con la misma cookie válida: 5×200 y 1×429, y quedan **5 filas** de navegador de confianza. La cookie de navegador sigue valiendo tras `logout` (200). Sin aceptación explícita. |

## 7. Hallazgos nuevos

### IND3-01 · BAJO · La comprobación de rutinas del respaldo programado se satisface con el evento: un respaldo sin el procedimiento sale con exit 0

Archivo: `deploy/mariadb/respaldo-programado.sh:15-19`, añadido en `b6cc8bd` para IND2-09.

Causa: `grep -q 'marcar_cargos_vencidos'` busca el nombre en todo el volcado. El evento `ev_cargos_vencidos` (migración 002) contiene `CALL marcar_cargos_vencidos()`, y `--events` lo vuelca aunque falte el procedimiento.

Reproducción [E, `bk/sig.sh`]:

1. Un `mariadb-dump` envoltorio añade `--skip-routines`, lo mismo que produce una cuenta sin `SELECT` en `mysql.proc`.
2. El volcado tiene 0 `CREATE PROCEDURE` y 1 mención del nombre: la línea 1854, que es el `CREATE EVENT`.
3. `respaldo-programado.sh` con `gpg` simulado da **exit 0**.

Impacto: el arreglo declarado de IND2-09 no detecta el caso para el que se escribió. Un restaurado necesitaría reejecutar las migraciones para recuperar el procedimiento, que son idempotentes y lo recrean, así que el daño es limitado. Lo grave es la falsa seguridad.

Recomendación: buscar `CREATE.*PROCEDURE.*marcar_cargos_vencidos`, o mejor ejecutar `verify-backup.sh` en el flujo. Añadir una prueba con un volcado sin rutinas.

### IND3-02 · BAJO · `respaldo-programado.sh` deja el volcado sin cifrar si recibe TERM con `dash`

Archivo: `deploy/mariadb/respaldo-programado.sh:11` (`trap 'rm -rf "$WORK"' EXIT`, sin `INT TERM`).

Reproducción [E]: `dash respaldo-programado.sh` con un `gpg` lento y TERM al script a los 4 s: exit 143. Queda `…/T/tmp.UdYe27IFUd/<base>_….sql.gz` de 8 870 bytes, **sin cifrar**, con datos ficticios. Lo borré después. Con un script mínimo se confirma que `dash` no ejecuta el `trap EXIT` con TERM. `backup.sh` sí se corrigió; este archivo no.

Impacto: `dash` es el `sh` de Debian y Ubuntu. Con modo 077, el volcado queda en el directorio temporal hasta que se limpie. Contiene datos de menores.

Recomendación: copiar `trap 'exit 1' INT TERM` de `backup.sh`, y crear `WORK` dentro de `$BACKUP_DIR`, en el mismo volumen y con permisos controlados.

### IND3-03 · MEDIO · `RECUP_IP` por /24 o /48: quien comparta red cierra la recuperación a todos sus vecinos

Archivos: `api/login-limit.ts`, en `reserveResetRequest` (`wideBucket(ip)`, cambiado en `b6cc8bd`), y `RESET_LIMITS`.

Reproducción [E, `q3` H]:

- 21 solicitudes desde `100.64.7.10-30`, con cuentas inexistentes: 20×204 y 1×429.
- **Un vecino de `100.64.7.200` pide la recuperación de su cuenta real: 429.**
- Lo mismo en IPv6: 21 /64 de `2001:db8:aa::/48` y el vecino `2001:db8:aa:ffff::5` recibe 429.
- 15 minutos después el vecino obtiene una solicitud (204) y el atacante vuelve a agotarla. Mantener el cierre cuesta unas 4 solicitudes por hora.

Impacto:

- Afecta a toda la red, no a una cuenta: la oficina de la escuela tras un NAT, CGNAT de móvil o una red de residencia.
- La recuperación es la vía de escape que el diseño ofrece cuando hay un ataque de IND-03. Combinado con IND2-05 e IND3-04, quien comparta red con el dueño puede quitarle a la vez el login en un navegador nuevo y la recuperación.
- `docs/API.md:144` afirma que el bloqueo «no afecta … a la recuperación», y no menciona este caso.
- Es el precio de cerrar IND-12 por /48, y no lo cierra: 200 /48 distintos siguen enviando 199 correos.

Recomendación: si el responsable lo acepta, documentarlo. Alternativas: un contador por /64 más uno por /24 o /48 más alto (por ejemplo 100), o que el 429 no se aplique a cuentas con un navegador de confianza. En cualquier caso, un tope global diario de correos.

### IND3-04 · BAJO · Con recarga de 6 h, los errores propios en la oficina bloquean 6 h a esa cuenta en navegadores nuevos

Archivo: `api/login-limit.ts:48` (`WIDE_NETWORK_REFILL_MS = 6 * 3_600_000`, antes 3 h).

Reproducción [E, `q3` I]: 5 errores, esperar 16 min y 3 errores más desde `187.190.1.10`. Después, con la contraseña correcta y un navegador nuevo:

| Desde | Resultado |
| --- | --- |
| La misma IP | 429 |
| Otro equipo del mismo /24 | 429 |
| La misma IP, +5 h | 429 |
| La misma IP, +6 h | 200 |

Impacto: una persona que se equivoca 8 veces en un navegador nuevo queda fuera desde toda su red durante 6 h, salvo por recuperación. Y la recuperación se puede cerrar en esa red (IND3-03). Un navegador de confianza no se ve afectado. La documentación habla de «quien comparta /24», no de los propios errores.

Recomendación: documentarlo para la oficina. Valorar que el éxito en otra red de la misma cuenta devuelva la parte de la red, o un límite de 8 más alto con una recarga menor.

Purga [E]: la fila agotada sigue a +47,9 h y desaparece a +48,1 h. No hay purga prematura.

### IND3-05 · BAJO · Emitir el enlace del operador como INVITACION hace que corregir el correo envíe una invitación de 24 h, o falle con 503 sin correo

Archivos: `api/access-link.ts:36-38`, `UserService.afterEmailChange` y `AuthService.revokeAccessTokens` (`invited ||= purpose === 'INVITACION'`).

Reproducción [E, `q3` D3 y D4]:

- Cuenta con contraseña, se genera un `access-link` y luego se cambia su correo: el sistema cree que había una invitación pendiente y envía «Tu cuenta en Charales» **válida 24 h** a la nueva dirección. Confirmarla da 204.
- Con `MAIL_PROVIDER=none`, que es justo el escenario de `access-link`, el mismo cambio de correo responde **503** («El envío de correo no está configurado») durante los 60 min del enlace. Sin enlace del operador, el mismo cambio da 200.

Impacto:

- Se reenvía una «invitación» que nunca existió. Dura 24 h en vez de 60 min, aunque a una dirección que fijó el administrador.
- Sin correo no se puede corregir la dirección hasta que caduque el enlace.
- Además, `access-link` revoca la invitación genuina de una cuenta pendiente y la reemplaza por 60 min [L].

Recomendación: una finalidad propia (por ejemplo `OPERADOR`) que la solicitud de recuperación no revoque y que `revokeAccessTokens` no cuente como invitación. Requiere ampliar el `ENUM` en 001, 007 y 008.

### IND3-06 · BAJO · Cambiar la contraseña con sesión no revoca los enlaces de recuperación ni las invitaciones vivas

Archivo: `api/password.ts`, `changePassword` (líneas 109-138): revoca navegadores y sesiones, no `tokens_recuperacion`.

Reproducción [E, `q3` E]: se pide la recuperación (enlace en el buzón), el dueño cambia la contraseña (204), y **el enlace previo confirma (204)** y fija otra contraseña.

Impacto: quien cambia la contraseña porque sospecha de una intrusión, por ejemplo con el buzón comprometido, deja vivo durante 60 min, o 24 h si es una invitación, un enlace que reabre la cuenta. IND2-08 se corrigió solo en `confirm`.

Recomendación: el mismo `UPDATE tokens_recuperacion SET usado_en = ? WHERE usuario_id = ? AND usado_en IS NULL` dentro de la transacción de `changePassword`, con su prueba.

### IND3-07 · BAJO · Siete documentos remiten a un «dictamen vigente» que no existe

Archivos:

- `docs/deployment/PROCEDIMIENTO_PRODUCCION.md:5` («lee el dictamen vigente en `CIERRE_FINAL_REMEDIACION_2026.md`»)
- `PROJECT_CONTEXT.md`, `docs/ROADMAP.md`, `docs/TRACEABILITY.md`
- `docs/audits/{PLAN_REMEDIACION,AUDITORIA_FINAL_CIERRE,INFORME_REMEDIACION,REPRODUCCION_HALLAZGOS}_*.md`

[E] `git log --all -- docs/audits/CIERRE_FINAL_REMEDIACION_2026.md` está vacío. Las referencias las introduce `b6cc8bd`.

Además, `docs/API.md:125` y `:143` dicen que hacen falta «unas 12 asignaciones». Medido: 10 bastan para 72 h y 6 para el primer día (§ 6, IND-03).

Impacto: el procedimiento de producción remite a un documento inexistente para decidir si se despliega. Incumple la regla 10 de AGENTS.md.

Recomendación: añadir el documento o corregir los enlaces, y ajustar las cifras.

### IND3-08 · INFORMATIVO · Observaciones menores

- [E] En la carrera recuperación contra cambio de correo, la dirección antigua **sí recibe correos** (5 por ronda en 54 de 60 rondas), con el enlace ya revocado. El enlace no sirve, pero esa dirección se entera de que la cuenta existe y de que se pidió una recuperación. `deliverMail` no vuelve a comprobar el destinatario tras el `COMMIT`.
- [E] Una solicitud con acento (`josé@…`) para la cuenta `jose@…` ya no envía nada: la comprobación bajo bloqueo usa `toLowerCase` y la búsqueda usa la colación. El login sí acepta la variante. No hay oráculo, porque el 204 es igual, pero quien escriba así no recibe el correo.
- [E] Las pruebas dependen del tiempo bajo carga: `F5-06` (10 s) y 9 pruebas de Angular fallaron con otra carga en la máquina y pasan sin ella.
- [L] `rpc.ts:145` reintenta 1020, 1213 y 1205 hasta 5 veces sin espera, con el bloqueo global retenido entre intentos. En `q2` no vi ningún 500 ni degradación, con 8 bucles martilleando. No lo considero defecto, pero un reintento con espera aleatoria sería más prudente.
- [L] `settleAccountChanges` no cierra sesiones al desactivar, solo al cambiar el correo. No es explotable: `currentSession` comprueba `activo` y [E] tras reactivar, la sesión creada en la carrera da 401 (25 de 25).

## 8. Falsos positivos descartados

| Riesgo | Por qué se descarta |
| --- | --- |
| Error 1020 que impida echar a un atacante con sesión | [E, `q2`] 8 bucles en `/auth/session` de la víctima. Cambio de correo 15×200, desactivación 15×200, cambio de contraseña con otra sesión activa 20×204, confirmación 20×204. 0 errores registrados. |
| Operación a medias tras 1020 | [L] Todo va en una transacción con `ROLLBACK`; el correo se envía tras el `COMMIT`; `deliverMail` no lanza. No vi ningún caso en ejecución. |
| `settleAccountChanges` revoca de más | [E, `q7`] Editar solo el nombre deja la sesión (200), el navegador (1 fila) y el enlace (204). Reactivar no revoca nada. Al editar la propia cuenta se mantiene la propia sesión (200), se cierra la otra (401) y se revocan navegadores y enlaces. Al corregir una invitación pendiente, la vieja da 400 y la nueva 204. |
| Avalancha de cookies que deje el login en 503 | [E, `q4`, 150 clientes, 10 s] Red agotada sin cookie: 20 641 solicitudes/s, dueño 12×200. Con cookies inventadas: 7 095/s, dueño 12×200, 94 ms. Con nombre de otra cuenta: 18 237/s, 12×200. **No es peor que sin cookies.** Lo que sí deja el login en 503 son IP rotativas sin cookie (dueño 2×200 y 10×503), por el semáforo de Argon2id: es anterior y está documentado. |
| La caché de cookies malas rechaza una válida | [E, `q5` G] Tras rotar, la última cookie emitida entra (200). [L] La clave es el hash del secreto, y un secreto nuevo nunca coincide con uno recordado. Solo rechaza en la misma ráfaga en que la fila llega a 5 `fallos`. |
| Interbloqueo login ↔ `rpc`/`changePassword`/`confirm` | [E] 0 errores 1213 ni 500 en `q1b`, `q2` y `q7`. [L] Orden `usuarios` → resto en todas. Login con `WAIT 2` (503 y devolución, IND2-07). |
| `issueDevice` dentro de la transacción | [L] Si falla, revierte la transacción: el login responde 503 y devuelve lo reservado; el cambio de contraseña y la confirmación dan 500 sin escribir nada. Es el lado seguro. |
| Purga prematura de `CUENTA_RED` | [E] La fila se va a las 48 h, no antes. |
| Migraciones | [E] Todas las combinaciones de § 5, IND2-01. |

## 9. Riesgos residuales

- IND-03: 6 a 10 redes dejan fuera al dueño en un navegador nuevo. Sin correo real, la recuperación no existe, y con IND3-03 se puede cerrar por red.
- Sin tope global de correos (IND-12).
- 48 contraseñas probadas al día por cuenta; la política de contraseñas es decisión de producto.
- Datos de menores sin política; los respaldos guardan direcciones.
- `innodb_snapshot_isolation` solo probado en 13.0.2. nginx, systemd, MariaDB 11.8 y `dash` de Linux sin probar.

## 10. Pruebas revisadas

Las pruebas nuevas de `api/auditoria-independiente.test.ts` (IND2-01, 02, 03, 04, 07, 08) pasan.

**Mutaciones [E, `mut.sh`]:** véase la tabla. Sobrevive la mutación si las pruebas no fallan con ella.

Resultado: 8 de 15 detectadas por la prueba que corresponde, 6 sobreviven y 1 no es concluyente. En X03, X05 y X07 hubo fallos, pero de pruebas ajenas y dependientes del tiempo (`HU-075 < 300 ms`, espera de bloqueo del limitador), que con el código original también fallan bajo carga. Las cuento como supervivientes.

| Mutación | Resultado | Prueba que la detecta / qué queda sin probar |
| --- | --- | --- |
| X01 `settleAccountChanges` sin revocar tokens con SQL | **Sobrevive** | La prueba de IND2-03 no fuerza un token confirmado después de la instantánea. El servicio revoca los visibles y la prueba pasa igual. |
| X02 `settleAccountChanges` sin cerrar sesiones con SQL | **Sobrevive** | Igual. El cierre de sesiones de la carrera lo cubre en la práctica `current.email !== row.email` del login (ver X04). |
| X03 `issueRecovery` sin comprobar el correo bajo bloqueo | **Sobrevive** | Solo falló HU-075 (rendimiento). La carrera de recuperación de IND2-03 no la detecta. |
| X04 login sin comprobar `email` bajo bloqueo | Detectada | IND2-03 |
| X05 `confirm` sin revocar los demás enlaces | **Sobrevive** | La prueba de IND2-08 usa invitación más `access-link`, y `access-link` ya revoca la invitación al emitirse: el caso no depende de la línea mutada. |
| X06 `access-link` como RECUPERACION | Detectada | IND2-04 |
| X07 `CUENTA_RED` con recarga de 30 min | **Sobrevive** | Solo falló una prueba de espera de bloqueo, ajena. Ninguna prueba fija el valor de 6 h, que sostiene IND-03 (igual que M17 en la revisión 2). |
| X08 `RECUP_IP` por `limitBucket` | No concluyente | 8 fallos con duraciones de unos 400 s en pruebas ajenas: la máquina se detuvo durante esa ejecución. No la repetí. |
| X09 `missingSchema` sin el `ENUM` | Detectada | IND2-02 y F5-12 |
| X10 007 sin `CUENTA_RED` | Detectada | IND2-01 |
| X11 `FOR UPDATE` sin `WAIT 2` | Detectada | IND2-07 (50 s) |
| X12 `catch` del login sin `settleLogin` | Detectada | IND2-07 |
| X13 corte por red antes de la cookie | Detectada | IND-10 y otras dos |
| X14 `rpc` sin reintentos de 1020/1213/1205 | **Sobrevive** | Ninguna prueba provoca un 1020 en el puente. |
| X15 `issueDevice` sin borrar el secreto anterior | Detectada | Rotación del navegador |

**Conclusión:** las pruebas nuevas de IND2-03 e IND2-08 aciertan el resultado, pero no aíslan el código que dicen probar. Se podrían quitar el SQL de `settleAccountChanges`, la comprobación bajo bloqueo de `issueRecovery` y la revocación en `confirm` sin que ninguna prueba fallase. Recomiendo:

- Una prueba de IND2-08 con un enlace de recuperación más una invitación, sin `access-link`.
- Una prueba de `settleAccountChanges` con un token o una sesión insertados por otra conexión después de la instantánea, por ejemplo con un gancho.
- Una prueba que fije `WIDE_NETWORK_REFILL_MS`.

**Lo que las pruebas no detectarían:** IND3-01 (no hay prueba del flujo programado), IND3-02, IND3-03 (ninguna prueba con vecinos de un mismo /24), IND3-05 e IND3-06.

## 11. Recursos creados

Bases en el servidor compartido: nombres comprobados como inexistentes y con sufijo aleatorio, solo datos ficticios, conservadas.

- Sondeos:
  - `ef_indep3_q0_4d39cd8b`, `ef_indep3_q0_a7e74f78`
  - `ef_indep3_q1_a4bee519`, `ef_indep3_q1b_afa92181`
  - `ef_indep3_q2_37506acb`
  - `ef_indep3_q3_31c84836`, `ef_indep3_q3n_5c4270f7`
  - `ef_indep3_q4_0c909673`
  - `ef_indep3_q5_198ae6b5`
  - `ef_indep3_q6_eb837b06`, `ef_indep3_q6_efacfe58`, `ef_indep3_q6_b5ff42cd`
  - `ef_indep3_q7_d91f47a8`
- Migraciones: `ef_indep3_{fresh,rerun,nostrict,oldenum,up_9e08b11,up_f8e26ec,up_d61ab7b}_{2e4baeaa,2329edeb,00cb7b57,83ce04d9}`, 28 bases. `2e4baeaa` es la primera pasada, sin el `domain.mjs` antiguo: la configuración antigua falló y las bases `up_*` de esa pasada quedaron creadas por HEAD. No uso sus resultados. Las cifras salen de las pasadas siguientes.

No creé usuarios ni detuve servicios, y no toqué la otra API. No se envió correo real; la única consulta externa fue `npm audit`. Borré mis propios volcados de prueba en `/var/folders/.../T/tmp.*`, generados por IND3-02.

Auxiliares en `cierre/indep3/`: sondeos, `c-*.log`, `old/` (fuentes de `9e08b11`, `f8e26ec` y `d61ab7b` con `git archive`), `bk/`, `mut/` y `mut.log`.

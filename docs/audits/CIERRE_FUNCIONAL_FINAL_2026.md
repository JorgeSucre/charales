# Cierre funcional y documental final — 2026-11-05

Rama `fix/cierre-funcional`, creada desde `main` local `226b361`. Fases anteriores: `CIERRE_FINAL_REMEDIACION_2026.md` y
los informes independientes `AUDITORIA_INDEPENDIENTE_CIERRE_2026*.md` y `AUDITORIA_INDEPENDIENTE_93a16d2_2026.md`. Este
documento no los reemplaza.

## 1. Estado de los cinco puntos

| #   | Punto                                | Estado                                                                                                                           |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Límite global de correos             | **Corregido y verificado** (migración 009, `api/cupo-correo.test.ts`, 10 pruebas)                                                |
| 2   | Auditoría independiente de `93a16d2` | **Hecha** por un agente separado, en copia aislada: 0 críticos, 0 altos, 1 medio, 6 bajos y 3 informativos. Todos tratados (§ 3) |
| 3   | IND-03, IND2-05, IND3-04, IND3-05    | IND3-05 **corregido y verificado**. Los otros tres, **aceptados con justificación** y fijados con pruebas (§ 4)                  |
| 4   | Política de conservación de datos    | **Propuesta documentada** (`docs/policies/POLITICA_CONSERVACION_DATOS.md`) e inventario de solo lectura. **Sin purgas**          |
| 5   | `PaymentsGatewayService`             | **Decisión A:** era código muerto y se eliminó (§ 6)                                                                             |

MFA queda fuera de alcance: no se tocaron cookies de confianza, tokens de dispositivo, límites de intentos, Argon2id, S-01,
S-02 ni el flujo de recuperación. Se registra como **mejora futura**: un segundo factor para las cuentas de oficina
reduciría el riesgo residual de IND-03 e IND2-05 sin depender de los límites por red.

## 2. Límite global de correos

**Problema.** Los límites por cuenta y por red frenan a una persona, pero no a muchas cuentas y redes a la vez (IND-12,
IND4-01: un solo /48 admitía 200 solicitudes para correos distintos). Además, cada envío gasta cuota del proveedor.

**Diseño:**

- Tabla nueva `correo_cupo`, creada por la migración `009_cupo_correo.sql`. Es aditiva e idempotente, y no toca el `ENUM`
  de `limite_acceso`, para no repetir IND2-01. Tiene dos cubos con recarga continua:
  - `TOTAL`: todo envío real al proveedor, sea primer envío o reintento;
  - `RECUPERACION`: además, las recuperaciones de contraseña.
- `takeMailSlot` bloquea las filas con `FOR UPDATE`, siempre en el orden `TOTAL` → `RECUPERACION`, y sólo escribe si hay
  sitio. Es atómico entre procesos y sobrevive a un reinicio.
- **Sin plaza**, el mensaje queda `PENDIENTE` hasta la hora en que vuelva una plaza y no gasta intento. El proceso de fondo lo
  envía entonces, con prioridad para las invitaciones. Nada se pierde ni se duplica, y la bandeja nunca queda bloqueada:
  el cupo se recarga solo.
- **Fallo de MariaDB al reservar:** no se envía; el mensaje espera un minuto.
- **Fallo del proveedor:** gasta su plaza, para que una caída no permita ráfagas, y se reintenta con la pauta de siempre.
- **Solicitudes, reintentos y envíos nuevos:**
  - la solicitud HTTP responde como antes;
  - sólo un intento real ante el proveedor gasta plaza;
  - un mensaje que espera no la gasta;
  - un reintento emite un enlace nuevo sólo cuando hay plaza, y nunca antes.

**Valores iniciales:**

- `CORREO_MAX_POR_HORA=60`: cubre las invitaciones de una temporada en pocas horas y deja margen en los planes habituales.
- `CORREO_MAX_RECUPERACION_POR_HORA=20`: muy por encima de lo que pide una escuela. Una avalancha de recuperaciones toma
  como mucho 20 de las 60, así que las invitaciones conservan al menos 40 por hora.

Ambos admiten de 1 a 10000, y el de recuperación no puede superar al total. Un valor inválido detiene el arranque
(`checkEnvironment`). Se documentan en `docs/API.md`, `.env.example` y `deploy/env.production.example`.

**Pruebas** (`api/cupo-correo.test.ts`). Usan un cupo de 4 por hora, de las que 2 pueden ser de recuperación:

- misma cuenta, varias cuentas, distintas IP y dos instancias de `createApp`: el cupo es uno solo;
- IND4-01: 25 /64 de un mismo /48 dan 25 respuestas 204, pero sólo 2 envíos;
- una avalancha de recuperaciones no deja sin envío a las invitaciones;
- recuperación tras alcanzar el límite: el proceso de fondo envía primero las invitaciones y cada mensaje una sola vez;
- fallo del proveedor: gasta su plaza y se reintenta sin duplicados;
- concurrencia: 24 reservas simultáneas desde dos pools toman exactamente 4 plazas;
- **varios procesos:** 3 procesos Node separados, con 5 reservas cada uno, toman 4 plazas en total;
- reinicio: con un pool y un servidor nuevos, el cupo gastado y los mensajes en espera siguen ahí;
- fallo de MariaDB: no se envía nada, el mensaje queda `PENDIENTE` y no gasta intento;
- configuración: valores por defecto, cambios y valores inválidos.

Tres pruebas antiguas acumulaban más de 20 recuperaciones en la misma base y empezaron a fallar, porque el cupo actuaba.
Esas pruebas validan límites por cuenta y por red, así que ahora reinician el cupo entre pruebas, igual que ya reiniciaban
`limite_acceso`. No se cambió ninguna expectativa.

## 3. Auditoría independiente de `93a16d2`

El informe se conserva sin cambios en `AUDITORIA_INDEPENDIENTE_93a16d2_2026.md`, excluido de Prettier.

**Cómo se hizo:**

- Agente separado, en el worktree aislado `charales-wt/auditoria-independiente`, en detached HEAD sobre `93a16d2`.
- Sin modificar el repositorio y sin indicaciones que anticiparan conclusiones.
- Comparó el comportamiento del commit con el de su padre `b6cc8bd` y ejecutó mutaciones.
- Bases propias: `ef_indep4_8ad28fa1` y una instancia privada, ya detenida. Ambas se conservan.

**Dictamen:** aceptable con reservas. Los cuatro arreglos de código cumplen lo que prometen.

| Hallazgo                                                                   | Tratamiento                                                                                                                                                                                                                                                             | Estado                              |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| IND4-01 · MEDIO: un /48 vuelve a admitir 200 solicitudes de recuperación   | El límite global acota los envíos (prueba IND4-01). No se volvió a contar por /24 porque eso reabriría IND3-03 y modificaría los límites de recuperación, que están fuera de alcance                                                                                    | **Mitigado**                        |
| IND4-02 · BAJO: oficina tras un NAT                                        | Se renombró la prueba y el caso se documentó en `docs/API.md`. La alternativa propuesta toca el flujo de recuperación                                                                                                                                                   | **Aceptado con justificación**      |
| IND4-03 · BAJO: el texto de los datos satisface la comprobación de rutinas | El patrón se ancló a la línea `CREATE … PROCEDURE`, comprobado con un volcado real. Se probó con datos que contienen el texto                                                                                                                                           | **Corregido y verificado**          |
| IND4-04 · BAJO: el respaldo programado no tenía prueba                     | Nueva `api/respaldo-programado.test.ts`: 10 casos, con `sh` y `dash`, sobre el script real y con dobles de `mariadb-dump` y `gpg`                                                                                                                                       | **Corregido y verificado**          |
| IND4-05 · BAJO: con HUP o KILL quedaba el volcado en claro                 | Trap de `HUP`. Directorio de trabajo dentro de `$BACKUP_DIR` (0700). La ejecución siguiente borra lo que dejó una ejecución matada con KILL. Mutación: sin `HUP`, falla `dash` + `SIGHUP`                                                                               | **Corregido y verificado**          |
| IND4-06 · BAJO: documentación inexacta                                     | `docs/API.md`: el alcance es el /24 o el /48; el cambio de contraseña revoca los enlaces; IND3-05 está corregido                                                                                                                                                        | **Corregido**                       |
| IND4-07 · BAJO: la prueba de IND3-06 no detectaba una revocación parcial   | La prueba comprueba también una INVITACION y restaura la contraseña en `finally`. Mutación (revocar sólo `RECUPERACION`): la prueba falla                                                                                                                               | **Corregido y verificado**          |
| IND4-08 · INFORMATIVO: IND3-06 protege poco contra un buzón comprometido   | Es una limitación inherente a recuperar la cuenta por correo; MFA es la mejora futura                                                                                                                                                                                   | **Aceptado**                        |
| IND4-09 · INFORMATIVO: la prueba IND2-08 depende del orden                 | `operatorLink` alinea `creado_en` y desaparece el error `chk_token_expira`. Si se ejecuta sola, sigue fallando por otra causa: `access-link` corre en un proceso aparte con el reloj real y no ve vigente la invitación del reloj simulado. Con la suite completa, pasa | **Mitigado** (artefacto de pruebas) |
| IND4-10 · INFORMATIVO: enlaces rotos (IND3-07)                             | En `main`, `CIERRE_FINAL_REMEDIACION_2026.md` existe. Se comprobaron todos los enlaces relativos de los `.md`: ninguno roto                                                                                                                                             | **No reproducido** en `main`        |

## 4. IND-03, IND2-05, IND3-04 e IND3-05

Descripciones completas en `AUDITORIA_INDEPENDIENTE_CIERRE_2026.md` y en sus revisiones 2 y 3.

**IND-03 · Aceptado con justificación.** Con suficientes redes, un navegador nuevo de una cuenta recibe 429 aunque la
contraseña sea correcta. Se reprodujo con la prueba «IND-03 (accepted)»:

- las vías de salida siguen funcionando: el navegador de confianza entra (200) y la recuperación responde 204 y envía el
  correo;
- quien administra el servidor tiene además `db:access-link`;
- la cifra documentada se corrigió con lo medido por el auditor: 10 redes bastan para 3 días y 6 para el primero.

Corregirlo exige cambiar los límites de intentos o añadir MFA, y ambas cosas están fuera de alcance. Severidad: la de los
informes, sin rebajarla.

**IND2-05 · Aceptado con justificación**, por el mismo motivo. Quien comparte /24 o /48 puede agotar la parte de esa red
para una cuenta durante 6 h. La prueba «IND2-05 / IND3-04 (accepted)» lo reproduce y muestra lo que sigue funcionando:

- el navegador de confianza en ese mismo /24;
- cualquier otra red;
- la recuperación;
- un intento nuevo a las 6 h.

**IND3-04 · Aceptado con justificación.** Es el mismo mecanismo, con errores propios de la persona. Lo cubre la misma
prueba.

**IND3-05 · Corregido y verificado.** Se reprodujo con una prueba que fallaba antes del arreglo: llegaba 1 «invitación» que
nunca existió.

- Causa: el enlace del operador se emite como INVITACION, y corregir el correo reinvitaba a cualquier cuenta con una
  INVITACION viva.
- Arreglo: `UserService.afterEmailChange` reinvita sólo si la cuenta nunca fijó contraseña. La API guarda como Argon2id toda
  contraseña que fija, y la cuenta recién creada tiene un hash `sha256$` inutilizable.
- Resultado:
  - una cuenta con contraseña ya no recibe nada y la corrección responde 200, también sin transporte de correo (antes, 503);
  - una cuenta pendiente sigue recibiendo su invitación en la dirección nueva (IND-01).
- No hizo falta ampliar el `ENUM`.

No apareció ningún crítico ni alto sin corregir.

## 5. Política de conservación de datos

Los detalles están en `docs/policies/POLITICA_CONSERVACION_DATOS.md`. Es una **propuesta pendiente de aprobación** por la
dirección, con revisión jurídica y fiscal, y no presenta requisitos legales como hechos.

**Mecanismos técnicos implementados:**

- `npm run db:datos-personales`, en `api/datos-personales.ts`. Es un inventario por categoría con indicadores (menores,
  bajas definitivas, sesiones y enlaces vencidos, auditoría antigua):
  - corre en una transacción `READ ONLY`;
  - sólo imprime cuentas.
- La prueba `api/datos-personales.test.ts` exige que toda tabla del esquema esté clasificada y comprueba que el inventario no
  escribe nada y no imprime valores.

**No se implementó** ninguna purga ni anonimización de jugadores, tutores, pagos ni historiales.

**Hallazgo para la dirección:** `sesiones` (con IP y navegador) y `tokens_recuperacion` no tienen purga y crecen sin límite.
Además, `auditoria` copia en JSON datos de menores. La política lo recoge como decisiones pendientes.

## 6. `PaymentsGatewayService`

**Decisión A.** Se eliminó `src/app/core/services/payments-gateway.service.ts`. Evidencia:

- `git grep` no encuentra ningún uso en componentes, servicios, `rpc-methods.ts`, pruebas ni documentos.
- Ninguna HU pide pagos en línea: HU-045 registra un pago ya hecho, también con tarjeta, como forma de pago.
- Su `validarReferencia` (al menos 8 caracteres) contradice R22, que admite cualquier referencia no vacía.
- Su comentario «hace pasar tus tests hu-fase4» es falso: ninguna prueba lo usa.

Historial:

- `25b0a2c`, 2026-11-04: lo creó DANIELGONZALEZ1418.
- `49bf211`: se excluyó del RPC.

Git lo conserva por si la escuela decide algún día cobrar en línea. Eso exigiría su propio análisis, porque no debe
procesar tarjetas ni exponerse por RPC sin autorización.

## 7. Verificación

Batería completa sobre el código `978d2b6`, con Node v26.13.0, el 2026-11-05 a las 18:19:

| Comando                                      | Resultado                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `sh scripts/check-sensitive-files.sh`        | OK                                                                                 |
| `npm run api:typecheck`                      | OK                                                                                 |
| `npm run build`                              | OK                                                                                 |
| `npm run api:test`                           | **421/421** (eran 395 en `226b361`)                                                |
| `npx ng test --watch=false`                  | **251/251**                                                                        |
| `npm run e2e`                                | **23/23**                                                                          |
| `git diff --check 226b361 HEAD`              | OK                                                                                 |
| `npm run db:mariadb:test-backup`             | OK: 46 tablas idénticas tras respaldar y restaurar (incluye `correo_cupo`)         |
| `npm audit` / `npm audit --omit=dev`         | 0 vulnerabilidades                                                                 |
| `postman collection lint` / `collection run` | OK: 37 peticiones y 42 aserciones, 0 fallos (base `ef_cfin_pm_4d8c6f`)             |
| `npx prettier --check .`                     | Falló sólo por este documento, aún sin formatear; se repitió tras el commit (§ 10) |

**Pruebas específicas:**

- `api/cupo-correo.test.ts` (10);
- `api/respaldo-programado.test.ts` (10);
- `api/datos-personales.test.ts` (3);
- en `api/auditoria-independiente.test.ts`: IND3-05, los tres aceptados e IND3-06 reforzada.

**Mutaciones comprobadas:**

- la prueba de IND3-05 falla antes del arreglo;
- las pruebas del respaldo fallan contra el script anterior (IND4-03 y restos de KILL) y sin el trap de `HUP` (`dash`);
- la prueba de IND3-06 falla si sólo se revoca `RECUPERACION`.

**Bases:**

- Todas las temporales son nuevas y con datos ficticios: `ef_cierre_dump_64a4600f`, `ef_cfin_pm_4d8c6f`, las `ef_*` de cada suite y `ef_indep4_8ad28fa1`, del
  auditor.
- Las suites borran al terminar las bases `ef_*` que ellas mismas crean, con su arnés; las demás se conservan.
- No se escribió en `escuela_futbol`, en `escuela_futbol_demo` ni en ninguna base preexistente (§ 10).

## 8. Riesgos residuales y pendientes externos

**Riesgos aceptados:**

- IND-03, IND2-05, IND3-04 e IND4-02 (§ 4);
- la cuota global puede **retrasar** correos legítimos durante una avalancha, pero no impedirlos para siempre;
- entrega «al menos una vez» si el proveedor acepta el correo pero se pierde su respuesta (ya documentado).

**Pendientes externos:**

- la dirección y la asesoría deben aprobar la política de datos;
- falta medir la cuota real del proveedor contratado para ajustar `CORREO_MAX_*`;
- nunca se ha enviado un correo real con Resend;
- MFA, como mejora futura;
- falta ensayar el procedimiento de producción (IND-13);
- falta probar el respaldo programado con un `gpg` y un systemd reales: aquí se usaron dobles, en macOS.

**Sin push, sin PR y sin despliegue.**

## 9. Commits de la rama

1. `ab88ffa` feat(mail): límite global de envíos compartido por todos los procesos de la API.
2. `3f465b5` fix(users): corregir el correo sólo reinvita a cuentas sin contraseña (IND3-05).
3. `dec3f44` chore(billing): eliminar el mock `PaymentsGatewayService`, que nadie usa.
4. `b41d18f` fix(backup,docs): hallazgos de la auditoría independiente de `93a16d2`.
5. `978d2b6` docs(policy): propuesta de conservación de datos e inventario de solo lectura.
6. Este documento.

## 10. Comprobación de bases y estado de la integración

- La batería terminó a las 18:24. **El equipo se reinició a las 19:58.** El reinicio:
  - vació `/tmp` y, con él, la instantánea previa de las bases y los registros de la batería, que estaban en el scratchpad;
  - dejó MariaDB detenida.
- Arrancar MariaDB sería alterar un servicio compartido, cosa que el encargo prohíbe. Por eso, después del reinicio **no se
  pudo comparar** la lista de bases con la instantánea previa (157 bases), ni repetir las pruebas que usan MariaDB.
- Evidencia de proceso, no comprobación posterior:
  - toda escritura de esta fase fue a bases temporales nuevas, con nombre único verificado: `ef_cierre_dump_*`, `ef_cfin_pm_*`
    y las `ef_*` de las suites;
  - ningún comando apuntó a `escuela_futbol`, a `escuela_futbol_demo` ni a otra base existente.
- Por lo tanto, **el merge a `main` queda en espera**: una de sus condiciones, «sin bases persistentes modificadas», está
  sin verificar después del reinicio.

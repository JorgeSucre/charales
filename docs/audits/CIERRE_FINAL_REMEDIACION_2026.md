# Cierre final de la remediación 2026

**Este es el documento vigente.** Los informes anteriores conservan su historial:

- [`AUDITORIA_FASE5_2026-11-05.md`](AUDITORIA_FASE5_2026-11-05.md): la auditoría de origen.
- [`PLAN_REMEDIACION_INTEGRAL_2026.md`](PLAN_REMEDIACION_INTEGRAL_2026.md), [`REPRODUCCION_HALLAZGOS_FASE5_2026.md`](REPRODUCCION_HALLAZGOS_FASE5_2026.md), [`INFORME_REMEDIACION_INTEGRAL_2026.md`](INFORME_REMEDIACION_INTEGRAL_2026.md) y [`AUDITORIA_FINAL_CIERRE_2026.md`](AUDITORIA_FINAL_CIERRE_2026.md): la primera remediación, sobre `42ba617`.
- Las tres auditorías independientes, conservadas literalmente: [`AUDITORIA_INDEPENDIENTE_CIERRE_2026.md`](AUDITORIA_INDEPENDIENTE_CIERRE_2026.md), [`…_REVISION2.md`](AUDITORIA_INDEPENDIENTE_CIERRE_2026_REVISION2.md) y [`…_REVISION3.md`](AUDITORIA_INDEPENDIENTE_CIERRE_2026_REVISION3.md).

| Dato                       | Valor                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| Fecha                      | 2026-11-05                                                                                     |
| Base de `origin/main`      | `9e08b111cc4180ebab89d56f5e99510c42f6e2cf`, sin cambios en todo el trabajo                     |
| Rama                       | `fix/auditoria-integral-cierre`, local, sin push                                               |
| Código verificado          | `93a16d2` (batería completa, § 5); lo posterior sólo añade este documento y cifras             |
| Dictamen para `main` local | **Apto**: tercera auditoría independiente sin hallazgos críticos ni altos; reservas corregidas |
| Dictamen para producción   | **NO APTO PARA PRODUCCIÓN** (§ 7)                                                              |

## 1. Los cuatro puntos de esta fase

| Punto                                | Estado                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| N-06: retención de `correo_saliente` | **Verificado**                                                                  |
| Fuerza bruta distribuida             | **Verificado**, con riesgo residual medido                                      |
| Bloqueo del dueño legítimo           | **Mitigado**: resuelto en navegadores conocidos; residual en navegadores nuevos |
| Auditoría independiente              | **Hecha, en tres rondas, con agentes separados** (§ 4)                          |

### N-06: retención de direcciones de correo

**Qué se conserva y cuánto:**

| Estado del mensaje                                           | Tratamiento                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Pendiente, o en reintento                                    | Nunca se toca                                                             |
| En proceso, con su concesión viva                            | Nunca se toca                                                             |
| Enviado, o fallido para siempre                              | A los 30 días pierde dirección, usuario, token y referencia del proveedor |
| Vencido sin procesar (no corre el proceso de envío)          | A los 7 días se cierra como `ABANDONADO` y sigue la retención             |
| Metadatos anonimizados (estado, finalidad, intentos, fechas) | Se borran al año                                                          |

**Por qué 30 días y no 90:** un enlace dura 24 h como máximo, y lo que le pasó a una cuenta queda en `auditoria`. 30 días bastan para atender un «no me llegó». **No es un plazo legal**: es configurable (`CORREO_RETENCION_DIAS`, de 1 a 365) hasta que la escuela fije su política (F5-25). Los registros de envío solo guardan el id del mensaje, nunca la dirección.

**Ejecución:** al arrancar la API y cada hora, o a mano con `npm run db:mail-purge`. Va por lotes de 500, cada uno en su propia transacción con `SKIP LOCKED`: nunca espera una fila en uso. Repetirla no cambia nada; si se interrumpe, los lotes ya hechos quedan hechos.

**Evidencia** (`api/retencion-correo.test.ts`, 14 pruebas): las 10 obligatorias, más abandonados, filas bloqueadas, ausencia de direcciones en los registros, configuración y migración. Con 3 000 filas aún no vencidas, la purga examina 0 o 1 filas (`ANALYZE`, `r_rows`).

**Límite:** no alcanza a `auditoria`, `sesiones` ni a los respaldos (F5-25).

### Fuerza bruta distribuida

**Cuatro controles en MariaDB, compartidos entre procesos, en un orden fijo de bloqueo:**

| Contador     | Qué cuenta                      | Límite                     |
| ------------ | ------------------------------- | -------------------------- |
| `IP`         | Una red                         | 50 cada 15 min             |
| `CUENTA`     | Una cuenta, desde cualquier red | 10, recupera 1 cada 30 min |
| `CUENTA_RED` | Una cuenta desde un /24 o /48   | 8, recupera 1 cada 6 h     |
| `CUENTA_IP`  | Una cuenta desde una red        | 5 cada 15 min              |

Una red es una IPv4 o un /64 de IPv6.

| Medido con el mismo arnés (`evidencia-2026/cierre-*.json`)             | `d7f8c9d`           | `93a16d2`           |
| ---------------------------------------------------------------------- | ------------------- | ------------------- |
| Adivinanzas verificadas en 24 h simuladas, una cuenta, redes distintas | **1 920**           | **57**              |
| 150 intentos desde 150 /48 distintos                                   | 20 × 401            | 10 × 401            |
| 150 intentos desde un solo /48                                         | 20 × 401            | 8 × 401             |
| 150 intentos desde un /64                                              | 5 × 401             | 5 × 401             |
| 60 intentos desde un /24 de IPv4                                       | 20 × 401            | 8 × 401             |
| 60 concurrentes · 2 procesos · tras reiniciar · tras cortar conexiones | Mismo límite        | Mismo límite        |
| Un origen que retoma cada recarga durante un día                       | 20, 2, 2, 2         | 8, 0, 0, 0          |
| Cuenta inexistente                                                     | Igual que existente | Igual que existente |
| Latencia de 401 / 429; pico de conexiones con 60 concurrentes          | 24 / 0,7 ms; 11     | 27 / 0,6 ms; 11     |

**Por qué estas cifras:**

- Un presupuesto que se recarga solo nunca bloquea para siempre. Con 10 de margen, una persona que se equivoca varias veces cabe.
- 48 al día cumple el criterio de NIST 800-63B de no más de 100 errores consecutivos.
- La parte por asignación hace que un solo origen no pueda vaciar el presupuesto.

**Argon2id y S-02 no cambian:** con el límite agotado no se verifica ninguna contraseña.

### El dueño legítimo

**Navegador de confianza** (`api/device-trust.ts`, migración 008). Es una cookie `HttpOnly; SameSite=Strict; Path=/auth`, `Secure` en producción, y MariaDB solo guarda su SHA-256 ligado a la cuenta.

| Propiedad  | Comportamiento                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Efecto     | No gasta los límites compartidos, en ninguna red                                               |
| Contraseña | **Nunca la evita**                                                                             |
| Tope       | Cada intento reserva 1 de 5 de forma atómica; 5 errores y deja de valer                        |
| Rotación   | Cada login correcto reemplaza el secreto; una copia robada muere                               |
| Duración   | 90 días, máximo 10 por cuenta                                                                  |
| Revocación | Al cambiar o recuperar la contraseña, desactivar la cuenta o cambiar el correo; a mano por SQL |

| Medido en `93a16d2`, durante un ataque                       | Resultado                              |
| ------------------------------------------------------------ | -------------------------------------- |
| Navegador conocido: misma red, red nueva, otro proceso       | 200                                    |
| Navegador conocido, con su red agotada por otros             | 200                                    |
| Navegador conocido, 15 logins durante un ataque concurrente  | 15 × 200, mediana 26 ms                |
| Navegador nuevo, red nueva, ataque desde muchas asignaciones | **429**, sin verificar                 |
| Navegador nuevo, ataque desde un solo origen                 | 200                                    |
| Tras terminar el ataque                                      | Entra en 30 min                        |
| Recuperación con la cuenta atacada                           | 204 y ese navegador queda de confianza |
| Cookie robada                                                | Como máximo 5 adivinanzas extra        |

**Sin correo:** quien administra el servidor puede generar un enlace de acceso de 60 min (`npm run db:access-link -- <correo>`), que queda en `auditoria` y que las solicitudes de un atacante no revocan.

**Riesgo residual:** con unas 6 a 10 asignaciones sostenidas, un navegador nuevo de esa cuenta no entra. Medición de la segunda revisión: 5 redes, 72 h. Los /48 pueden obtenerse gratis. Afecta a una cuenta cada vez, no a navegadores de confianza ni a la recuperación. Tras el despliegue, **todos** son navegador nuevo hasta su primer login.

**Decisión pendiente del responsable del producto:**

- Aceptar este riesgo con correo real.
- O añadir un segundo factor, que es el único que lo elimina.

## 2. Cambios de esta fase

**Commits:** `f8e26ec`, `d4c9fe2`, `d61ab7b`, `b6cc8bd`, `93a16d2` y este documento.

**Archivos nuevos:**

- `api/device-trust.ts`, `api/mail-purge.ts`, `api/access-link.ts`.
- Pruebas: `retencion-correo`, `dispositivo` y `auditoria-independiente` (`.test.ts`).
- La migración 008.

**Archivos modificados:**

- Límites, autenticación, contraseñas, correo y RPC.
- Dominio: `UserService` y `AuthService`.
- Respaldos, plantillas y documentación.

**Migración nueva:** `008_retencion_y_dispositivos.sql`.

- `correo_saliente`: `cerrado_en`, `anonimizado_en`, y destinatario y usuario admiten `NULL`.
- `dispositivo_confiable`.
- Ámbito `CUENTA_RED`.
- Elimina `origen_conocido`, que solo creó 007 y nunca salió de la rama.

**Se corrigió 007**, que tampoco salió de la rama, para que su `ENUM` coincida con el de 008. Si no, reejecutar las migraciones fallaba con filas `CUENTA_RED` (IND2-01, ALTO). Comprobado:

- Reejecutar con filas de todos los ámbitos no cambia nada.
- 008 sobre 007 con datos es idempotente.
- Una base actualizada queda igual que una nueva.
- La API de `9e08b11` funciona sobre una base con 008.

## 3. Hallazgos de la auditoría independiente y su estado

| Ronda, sobre | Hallazgos                                                       | Estado tras corregir                                                                            |
| ------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1, `f8e26ec` | IND-01 a IND-15: 1 alto, 5 medios, 8 bajos, 1 informativo       | Corregidos y revisados en la ronda 2, salvo IND-03 (residual, § 1) y los marcados abajo         |
| 2, `d61ab7b` | IND2-01 a IND2-11: 1 alto, 2 medios, 7 bajos, 1 informativo     | Corregidos y revisados en la ronda 3, salvo IND2-05 (aceptado y documentado)                    |
| 3, `b6cc8bd` | IND3-01 a IND3-08: **0 altos**, 1 medio, 6 bajos, 1 informativo | IND3-01, 02, 03, 06 y 07 corregidos en `93a16d2` y en este documento; IND3-04 y 05 documentados |

**Corrección a la ronda 3:** IND3-03, una regresión de la ronda 2, se deshizo. La recuperación vuelve a contarse por red, no por /24.

**Abiertos y documentados:**

| Hallazgo          | Qué queda                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| IND-03            | Riesgo residual de bloqueo en navegador nuevo                                                      |
| IND-12 / IND2-11  | Sin tope global de correos: lo acota el proxy                                                      |
| IND2-05 / IND3-04 | Quien comparte /24 o /48, o los errores propios, pueden agotar la parte de esa red para una cuenta |
| IND3-05           | El enlace del operador se trata como invitación si después se corrige el correo                    |
| IND-15            | Claves sin sal (seudónimos), cookie que sobrevive al `logout`, reparto RPC por sesión              |
| IND3-08           | Observaciones menores                                                                              |

**Mutaciones que sobrevivieron en la ronda 3:**

- X05, revocación en `confirm`: ahora la cubre una prueba aislada, por diseño; no se repitió la mutación.
- Siguen sin una prueba que las aísle: X01 y X02 (SQL de `settleAccountChanges`), X03, X07 y X14.

## 4. Independencia de la auditoría

- Cada ronda la hizo un **agente separado**, sin el contexto ni las conclusiones del implementador, sobre una copia aislada (worktree `charales-wt/auditoria-independiente`, en modo detached), con prohibición de modificar el repositorio.
- Los tres informes se conservan **sin cambios**: están excluidos de Prettier para que no se reformateen.
- **Límite:** los agentes son del mismo proveedor y modelo que el implementador. Es una revisión independiente en contexto y en instrucciones, **no una revisión humana**. Hace falta además una revisión humana antes de producción.
- Ningún auditor ejecutó nginx, systemd, MariaDB 11.8 ni la CI en GitHub.

## 5. Pruebas y resultados

**SHA `93a16d26f7a75c2f24160eced0eb0ba958b2458e`, 2026-11-05:**

| Comando                               | Resultado                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `sh scripts/check-sensitive-files.sh` | OK                                                                        |
| `npm run api:typecheck`               | OK                                                                        |
| `npm run build`                       | OK                                                                        |
| `npm run api:test`                    | **395/395**                                                               |
| `npx ng test --watch=false`           | **251/251**                                                               |
| `npm run e2e`                         | **23/23**, con la CSP de producción                                       |
| `npx prettier --check .`              | Falló por el JSON de evidencia recién generado; formateado y repetido: OK |
| `git diff --check 9e08b11 HEAD`       | OK                                                                        |
| `npm run db:mariadb:test-backup`      | OK                                                                        |
| `npm audit` (con y sin `--omit=dev`)  | 0 vulnerabilidades                                                        |
| Postman: `lint` y `run`               | 0 errores; 42/42 aserciones                                               |

**Rondas repetidas:** `api:test` 5 veces seguidas en dos momentos de esta fase, y una vez en cada batería completa (5 baterías), siempre sin fallos. Las pruebas nuevas, 5 veces seguidas.

**Pruebas que fallaron durante la fase**, todas corregidas y registradas en los commits:

- Una prueba de índice con plan inestable, que se reemplazó por la medida real de filas examinadas.
- Expectativas de los contratos cambiados.
- Un reloj de prueba desfasado con la herramienta de consola.
- Un import que faltaba (`d61ab7b`).

## 6. Riesgos residuales

1. **Bloqueo de navegadores nuevos** con 6 a 10 asignaciones sostenidas (§ 1). Requiere correo real o un segundo factor.
2. **48 adivinanzas al día por cuenta.** Depende de la calidad de las contraseñas: el mínimo de 8 es una decisión de producto.
3. **Sin tope global de correos;** el proxy no se ha probado.
4. **Datos de menores sin política de retención** en `auditoria`, `sesiones` y respaldos (F5-25).
5. **Mutaciones sin prueba que las aísle** (§ 3).
6. **Todo probado solo en macOS** con MariaDB 13.0.2.

## 7. Dictamen

**Para `main` local: APTO.** Las tres rondas de auditoría independiente terminaron. La última no tiene hallazgos críticos ni altos. Las pruebas integrales pasan y no hay cambios ajenos.

**Para producción: NO APTO PARA PRODUCCIÓN.** Siguen sin verificarse controles esenciales: servidor, TLS, proxy, correo real, CI en GitHub y protección de `main`. Además, el riesgo residual del § 1 y la política de datos de menores necesitan decisión del responsable.

**El merge local a `main` no cambia este dictamen.**

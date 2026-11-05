# Auditoría final de cierre 2026

> **Documento histórico.** Describe el código `42ba617` (2026-11-05). Después, `f8e26ec` y los commits siguientes cambiaron los límites por cuenta (ya no hay `origen_conocido` ni 20 intentos por ventana) y añadieron navegadores de confianza y retención de correo. El estado vigente está en [`CIERRE_FINAL_REMEDIACION_2026.md`](CIERRE_FINAL_REMEDIACION_2026.md).

| Dato            | Valor                                                                                  |
| --------------- | -------------------------------------------------------------------------------------- |
| Fecha           | 2026-11-05                                                                             |
| Base            | `9e08b111cc4180ebab89d56f5e99510c42f6e2cf`                                             |
| Código auditado | `42ba6175fe04934de9bade0ced1b04072c556d49`, rama local `fix/auditoria-integral-cierre` |
| Dictamen        | **NO APTO PARA PRODUCCIÓN**                                                            |

**Limitación de independencia:** esta auditoría la hizo el mismo agente que implementó las correcciones. Se contrastó cada hallazgo con repeticiones y con el diff completo, pero **no sustituye a una revisión humana o de otra persona**, que tampoco ha tenido este código.

## Resumen ejecutivo

**El dictamen no cambia, pero el motivo sí.** Los defectos de aplicación que se podían corregir aquí están corregidos o acotados, con medidas antes y después. Lo que impide producción ya no se resuelve en el repositorio: faltan un servidor, un proveedor de correo real y una barrera activa en GitHub.

| Estado de los 25 hallazgos        | N   |
| --------------------------------- | --- |
| Verificado                        | 10  |
| Mitigado                          | 6   |
| Bloqueado por dependencia externa | 6   |
| Aceptado con justificación        | 3   |

| Altos              | Estado                                                    |
| ------------------ | --------------------------------------------------------- |
| F5-03, R-1         | **Verificado**, con riesgo residual                       |
| F5-04, proxies     | **Verificado**; falta el valor real                       |
| F5-01, entorno     | **Bloqueado**: preparado, sin servidor                    |
| F5-02, correo      | **Bloqueado**: implementado con simulador, sin envío real |
| F5-05, CI y `main` | **Bloqueado**: preparado, sin ejecutar en GitHub          |

## Estado de cada hallazgo

| ID    | Sev.  | Reproducción inicial           | Causa raíz                     | Archivos                                       | Prueba                         | Resultado posterior       | Riesgo residual                                         | Estado                   |
| ----- | ----- | ------------------------------ | ------------------------------ | ---------------------------------------------- | ------------------------------ | ------------------------- | ------------------------------------------------------- | ------------------------ |
| F5-01 | ALTO  | Sin configuración; 2 cabeceras | Sin despliegue definido        | `deploy/`, `server.ts`, `angular.json`         | E2E bajo CSP                   | App correcta bajo CSP     | Proxy y TLS sin probar                                  | Bloqueado                |
| F5-02 | ALTO  | 503                            | Sin transporte                 | `mail.ts`                                      | Simulador                      | Listo para configurar     | **Sin envío real**                                      | Bloqueado                |
| F5-03 | ALTO  | 150×401                        | Dirección completa, sin cuenta | `client-ip.ts`, `login-limit.ts`, 007          | `r1-distribuido`               | 5 y 20 intentos           | ~1 920/día por cuenta; red nueva bloqueada en un ataque | Verificado               |
| F5-04 | ALTO  | 429 con contraseña correcta    | Vacío sin validar              | `config.ts`, `client-ip.ts`, `server.ts`       | `client-ip`, `endurecimiento`  | Producción no arranca     | Un valor real equivocado sólo se detecta en el entorno  | Verificado               |
| F5-05 | ALTO  | Sin CI ni protección           | Nunca configurado              | `ci.yml`, `branch-protection-main.json`        | `actionlint`, batería local    | Sin ejecutar              | `main` sigue sin protección                             | Bloqueado                |
| F5-06 | MEDIO | Login 503, sin aviso           | Sin comprobación               | `schema.ts`, `server.ts`                       | `endurecimiento`               | Lo dice o no arranca      | Bases reales sin migrar                                 | Mitigado                 |
| F5-07 | MEDIO | 40 000×204                     | `Map` sin límite               | `login-limit.ts`, `password.ts`                | `recuperacion-limites`         | 20×204 y 429              | Agotar 5 recuperaciones de una cuenta                   | Verificado               |
| F5-08 | MEDIO | 400 con texto interno          | Envío sin registro             | `mail.ts`, `rpc.ts`, 007                       | `correo-saliente`              | 200 con aviso y reintento | Duplicados posibles                                     | Verificado con simulador |
| F5-09 | MEDIO | Git los añadía                 | `.gitignore` incompleto        | `.gitignore`, scripts                          | Clon desechable, ciclo cifrado | Ignorados y cifrables     | Sin programar ni copia externa                          | Mitigado                 |
| F5-10 | MEDIO | p50 10 → 89 ms                 | Sin reparto                    | `rpc.ts`                                       | `endurecimiento`               | p50 7 → 15 ms             | Candado global; varias cuentas                          | Mitigado                 |
| F5-11 | MEDIO | Prueba M-1                     | Pool de 2                      | `charales.conf`                                | Sin probar                     | Sin verificar             | Login 503 en avalancha                                  | Bloqueado                |
| F5-12 | MEDIO | Arrancaba sin validar          | Sin validación                 | `config.ts`                                    | `client-ip`, `endurecimiento`  | Rechaza con mensaje       | Requiere `NODE_ENV=production`                          | Verificado               |
| F5-13 | MEDIO | Lectura                        | Una cuenta                     | `cuentas.sql`                                  | Sin ejecutar                   | Preparado                 | DDL en ejecución hasta aplicarlo                        | Bloqueado                |
| F5-14 | BAJO  | 403 frente a 400               | Búsqueda antes del alcance     | `training.service.ts`, `attendance.service.ts` | `authorization-order`          | Mismo 403                 | La PR #17 sigue abierta                                 | Verificado en la rama    |
| F5-15 | BAJO  | 2,07 / 0,54 ms                 | Trabajo antes de responder     | `password.ts`                                  | `correo-saliente`, medición    | 2,33 / 2,32 ms            | n = 20, local                                           | Verificado               |
| F5-16 | BAJO  | Comunes aceptadas              | Sin lista                      | `password.ts` ×2                               | `auth.spec`, `endurecimiento`  | Rechazadas                | Mínimo de 8; lista corta                                | Mitigado                 |
| F5-17 | BAJO  | Nombre de columna              | Error mal clasificado          | `rpc.ts`                                       | `endurecimiento`               | 500 genérico              | —                                                       | Verificado               |
| F5-18 | BAJO  | Rutas 200, `demo1234`          | Sin distinción                 | `server.ts`, `api-demo.page.ts`                | `endurecimiento`, `grep`       | 404, 0 archivos           | Semilla ficticia (N-07)                                 | Mitigado                 |
| F5-19 | BAJO  | Lectura                        | Sin barrera                    | `reset.sh`                                     | Negativa probada               | Se niega                  | SQL base con `DROP TABLE`                               | Mitigado                 |
| F5-20 | INFO  | 2 y 8 alertas                  | Versiones                      | `package*.json`                                | `npm audit`, batería           | 0                         | —                                                       | Verificado               |
| F5-21 | INFO  | Código muerto                  | PR #30                         | Ninguno                                        | 404                            | Sin cambios               | Inalcanzable                                            | Aceptado                 |
| F5-22 | INFO  | 20 sin 429                     | Sin canónica                   | `client-ip.ts`                                 | `client-ip`, `r1-distribuido`  | 5×401                     | —                                                       | Verificado               |
| F5-23 | INFO  | Lectura                        | Historial                      | `MARIADB.md`                                   | Migraciones                    | Sin cambios               | Inocuo                                                  | Aceptado                 |
| F5-24 | INFO  | `git`                          | Acumulación                    | Ninguno                                        | —                              | 1 worktree más            | Deuda local                                             | Aceptado                 |
| F5-25 | INFO  | `grep`                         | Sin decidir                    | Ninguno                                        | —                              | Sin cambios               | Datos de menores                                        | Bloqueado                |

## Nuevos hallazgos

En [`PLAN_REMEDIACION_INTEGRAL_2026.md`](PLAN_REMEDIACION_INTEGRAL_2026.md): N-01 a N-08. **Sigue abierto N-06,** introducido por esta remediación: `correo_saliente` guarda correos sin purga.

## Estado de S-01 a S-04

| Control | Estado                   | Detalle                                                                               |
| ------- | ------------------------ | ------------------------------------------------------------------------------------- |
| S-01    | **Reforzado**            | Orden de bloqueos, reintentos, rollback, pool y timeout intactos, con un contador más |
| S-02    | **Sin cambios**          | Argon2id, 3 operaciones, cola de 32, 2 s. Se reutiliza su semáforo en RPC             |
| S-03    | **Corregido en la rama** | La PR #17 sigue abierta en GitHub                                                     |
| S-04    | **Corregido en la rama** | `npm audit` → 0                                                                       |

## Historias de usuario

**HU-004, HU-012 y HU-022 siguen PARCIAL.** Su código está listo y probado con un simulador, pero sus criterios dependen de una entrega real que no se ha verificado. La clasificación del informe Fase 5 de las otras 46 no se rehízo: siguen sus límites, y sus pruebas pasan sobre este código.

## Preparación de producción

| Control                         | Preparado     | Verificado localmente          | Verificado en entorno equivalente |
| ------------------------------- | ------------- | ------------------------------ | --------------------------------- |
| HTTPS, TLS, proxy               | Sí            | No                             | **No**                            |
| Cabeceras y CSP                 | Sí            | **Sí, en Chrome**              | No                                |
| Proxies confiables              | Sí            | **Sí**                         | **No**                            |
| CORS                            | Sí            | **Sí**                         | No                                |
| Variables y secretos            | Sí            | Validación sí                  | **No**                            |
| Logs y monitoreo                | Procedimiento | No                             | **No**                            |
| Health checks                   | Sí            | **Sí**                         | No                                |
| Migraciones                     | Sí            | **Sí, con datos ficticios**    | **No**                            |
| Respaldo cifrado y restauración | Sí            | **Sí, con datos ficticios**    | **No**                            |
| Retención y copia externa       | Script        | Parcial                        | **No**                            |
| Marcha atrás de código          | Procedimiento | **Sí:** API anterior sobre 007 | **No**                            |
| Permisos del servidor           | Plantilla     | No                             | **No**                            |
| Seguridad de MariaDB            | Plantilla     | No                             | **No**                            |
| Separación de entornos          | Sí            | Parcial                        | **No**                            |
| Correo                          | Sí            | **Sólo simulador**             | **No**                            |
| CI y protección de `main`       | Sí            | `actionlint` y comandos        | **No**                            |

`nginx -t` no se ejecutó, porque nginx no está instalado aquí. Tampoco se ejecutó la CI en GitHub, MariaDB 11.8 ni una prueba de carga.

## Resultados de pruebas

Detalle en [`INFORME_REMEDIACION_INTEGRAL_2026.md`](INFORME_REMEDIACION_INTEGRAL_2026.md) § 5. API **338/338**, Angular **251/251**, E2E **23/23**, respaldo OK, Postman 42/42, typecheck, build, Prettier y `npm audit` OK. Reproducción en [`REPRODUCCION_HALLAZGOS_FASE5_2026.md`](REPRODUCCION_HALLAZGOS_FASE5_2026.md).

## Revisión del diff

| Comprobación                             | Resultado                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `.env`, respaldos, bases y claves en Git | `check-sensitive-files.sh` OK; `git ls-files` sin coincidencias                                        |
| Datos personales                         | Sólo datos ficticios: `@example.com`, y direcciones de documentación como `203.0.113.x` y `2001:db8::` |
| Valores con forma de secreto             | Sólo `re_SENTINEL`, de prueba, y una contraseña de CI para un MariaDB desechable                       |
| Migración 005 y sentencias de 006        | Sin cambios                                                                                            |
| Informe original                         | SHA-256 idéntico                                                                                       |
| Bases existentes                         | Lista y número de tablas iguales antes y después                                                       |

## Limitaciones

- Sin revisión independiente, ni visual manual, ni prueba de carga.
- Los límites 20, 5 y 90 días no se han contrastado con tráfico real.
- Probado sólo en macOS, con MariaDB 13.0.2.
- Las direcciones IP se simularon con un encabezado desde un proxy de confianza.
- El barrido de autorización usa una muestra pequeña.
- La causa del fallo histórico de persistencia sigue sin demostrar.

## Recomendaciones para producción

1. Revisar esta rama, y autorizar su push y su PR. Conviene dividirla en PR más pequeñas si así se prefiere.
2. Ver la CI en verde en GitHub y proteger `main`.
3. Contratar y configurar Resend; hacer una prueba real para cerrar HU-004, HU-012 y HU-022.
4. Preparar un servidor de pruebas equivalente: `nginx -t`, TLS, `TRUSTED_PROXIES` real, cuentas separadas, respaldos, prueba de carga.
5. Decidir el mínimo de contraseña, la retención de datos y el futuro de `PaymentsGatewayService`.
6. Migrar las bases existentes con autorización y un respaldo previo.
7. Repetir esta auditoría sobre ese entorno.

## Recursos creados

**Bases temporales: 40, todas `ef_rem26_*` y conservadas.** Sólo contienen datos ficticios.

| Propósito                                                                                                       | N   | Bases                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repeticiones intermedias                                                                                        | 10  | `ef_rem26_after_fl_cde4c1` `ef_rem26_after_ml_751c80` `ef_rem26_after_old_bd1baa` `ef_rem26_after_r1_8a5ded` `ef_rem26_after_r1_bcb447` `ef_rem26_after_rs_b8e11f` `ef_rem26_after_rs_fe5da7` `ef_rem26_after_sf_2b8c79` `ef_rem26_after_sw_5d85ab` `ef_rem26_after_tp_522f2f` |
| Recuperación con 200 000 solicitudes, sobre `9e08b11`                                                           | 1   | `ef_rem26_before2_rs_1dcada`                                                                                                                                                                                                                                                   |
| Reproducción antes, sobre `9e08b11`                                                                             | 8   | `ef_rem26_before_fl_78007c` `ef_rem26_before_ml_dc52a5` `ef_rem26_before_old_b50b7f` `ef_rem26_before_r1_db947d` `ef_rem26_before_rs_e5a3a3` `ef_rem26_before_sf_b58b62` `ef_rem26_before_sw_793d5e` `ef_rem26_before_tp_48dc19`                                               |
| Restauración del respaldo cifrado                                                                               | 1   | `ef_rem26_bk_2c415b`                                                                                                                                                                                                                                                           |
| Repetición final, sobre `6ab7056`                                                                               | 8   | `ef_rem26_final_fl_01150c` `ef_rem26_final_ml_ccbd36` `ef_rem26_final_old_1c99e7` `ef_rem26_final_r1_b3e907` `ef_rem26_final_rs_f0e9c2` `ef_rem26_final_sf_a29a1e` `ef_rem26_final_sw_6dab07` `ef_rem26_final_tp_0bae65`                                                       |
| Prueba de migraciones                                                                                           | 2   | `ef_rem26_mig_fr_d0b6eb` `ef_rem26_mig_up_2d6a80`                                                                                                                                                                                                                              |
| API de la colección de Postman                                                                                  | 2   | `ef_rem26_pm_57b0ac` `ef_rem26_pm_cfed03`                                                                                                                                                                                                                                      |
| **Accidental:** una invocación mía de `fase1.mjs --help` ejecutó el arnés completo. Datos ficticios, sin efecto | 8   | `ef_rem26_run_fl_2ef98e` `ef_rem26_run_ml_d25f4f` `ef_rem26_run_old_398ac7` `ef_rem26_run_r1_b05145` `ef_rem26_run_rs_7298b1` `ef_rem26_run_sf_0c4d4c` `ef_rem26_run_sw_a9b8aa` `ef_rem26_run_tp_42a182`                                                                       |

**Sobre las bases de las suites:** `api:test`, `e2e` y `db:mariadb:test-backup` crean y borran bases propias con nombre aleatorio, como documenta el proyecto, y no se conservaron. El encargo pedía conservar las bases creadas: interpreté que se refiere a las de este trabajo con evidencia, porque conservar cientos de bases de suite no aportaba nada. Si querías también esas, avísame y añado una opción. Tampoco se borró ninguna de las `ef_aud5*` de la Fase 5.

**Worktree nuevo:** `charales-wt/auditoria-integral-cierre`. **Rama nueva:** `fix/auditoria-integral-cierre`, local.

## Dictamen

**NO APTO PARA PRODUCCIÓN.**

Según los criterios acordados, no se ha podido demostrar un control esencial: TLS y proxy, correo real y barrera activa de integración siguen sin verificar. No corresponde **APTO CON RESTRICCIONES**, porque esas piezas no son condiciones de un despliegue que funcione, sino requisitos sin los que no hay altas, recuperación ni tráfico seguro. Ningún hallazgo rebajó su severidad para mejorar este resultado.

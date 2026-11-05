# Informe de remediación integral 2026

> **Documento histórico.** Describe el código `42ba617` (2026-11-05). Después, `f8e26ec` y los commits siguientes cambiaron los límites por cuenta (ya no hay `origen_conocido` ni 20 intentos por ventana) y añadieron navegadores de confianza y retención de correo. El estado vigente está en [`CIERRE_FINAL_REMEDIACION_2026.md`](CIERRE_FINAL_REMEDIACION_2026.md).

Causas raíz, decisiones, riesgos y evidencia de la rama `fix/auditoria-integral-cierre`. Resultados antes y después: [`REPRODUCCION_HALLAZGOS_FASE5_2026.md`](REPRODUCCION_HALLAZGOS_FASE5_2026.md). Seguimiento: [`PLAN_REMEDIACION_INTEGRAL_2026.md`](PLAN_REMEDIACION_INTEGRAL_2026.md).

## 1. Correcciones y decisiones

### R-1: fuerza bruta distribuida

**Causa raíz:** los límites contaban la dirección completa, y el contador por cuenta se había quitado para evitar que un atacante bloqueara al dueño (H-2).

**Decisión:** dos cambios en `api/client-ip.ts` y `api/login-limit.ts`.

- Se cuenta una IPv4 o un **/64** de IPv6, en forma canónica.
- Vuelve un contador por cuenta (20 cada 15 min), **sólo para redes desde las que esa cuenta no ha entrado** en 90 días (`origen_conocido`).

| Alternativa                                        | Por qué no                                 |
| -------------------------------------------------- | ------------------------------------------ |
| Contador simple por cuenta                         | Devuelve el bloqueo remoto de H-2          |
| Verificar la contraseña aunque se supere el límite | Sería un oráculo para el atacante          |
| CAPTCHA o 2FA                                      | Dependencia externa y decisión de producto |

**Por qué 20:** deja margen para errores reales en varias redes. Es una cifra razonada, sin datos de tráfico: revísala con uso real. **Precio:** durante un ataque, el dueño en una red nueva recibe 429 hasta que acabe la ventana o recupere la contraseña, lo que hace conocida esa red.

### `TRUSTED_PROXIES` y configuración de producción

**Causa raíz:** vacío significaba «sin proxy», aunque producción siempre tiene uno, porque la API no termina TLS.

**Decisión:** en producción es obligatorio (`none` lo declara explícito). Se admiten CIDR de /8 en adelante, con `BlockList` de la plataforma. `api/config.ts` también exige `APP_URL` con https y `MAIL_PROVIDER`, y rechaza `MAIL_CONSOLE` y `COOKIE_SECURE=false`.

| Entorno              | Vacío                                               | Valor inválido |
| -------------------- | --------------------------------------------------- | -------------- |
| Desarrollo y pruebas | Permitido; avisa una vez si llega `X-Forwarded-For` | No arranca     |
| Producción           | No arranca                                          | No arranca     |

### Recuperación y cambio de contraseña

**Causa raíz:** un `Map` en memoria por IP + correo, sin purga ni límite por red o por cuenta.

**Decisión:** pasan a `limite_acceso`, compartido entre procesos: 20 por red y 5 por cuenta sumando redes; 5 para el cambio. Un rechazo no escribe. El trabajo ocurre **después** de responder (S-06). **Precio:** un atacante puede agotar las 5 recuperaciones de una cuenta durante 15 min.

### Correo después del COMMIT

**Causa raíz:** el envío estaba dentro del manejo de errores de la operación, sin registro.

**Decisión:** bandeja de salida transaccional (`correo_saliente`), en la misma transacción que la operación. Sin cuerpo ni token: conservar el token crudo rompería la regla de guardar sólo hashes, así que un reintento emite uno nuevo y revoca el anterior.

| Propiedad       | Comportamiento                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| Entrega         | **Al menos una vez.** Si se pierde la respuesta del proveedor, pueden llegar dos correos, y sólo funciona el último |
| Reintentos      | 2, 4, 8… minutos, hasta 60; máximo 8 intentos, y nunca tras vencer el enlace                                        |
| Varios procesos | `FOR UPDATE SKIP LOCKED` con concesión de 5 min                                                                     |
| Cierre          | Error permanente, cuenta inactiva, enlace usado o vencido → `FALLIDO` con un código                                 |
| Proveedor       | Resend por `fetch`, sin dependencias nuevas; la clave sólo viaja en la cabecera                                     |

### Puente RPC

**Causa raíz:** cada operación toma un candado global y una conexión, sin reparto. **La prueba de la primera corrección demostró que era insuficiente:** una sesión ocupaba todas las conexiones antes de llegar al control.

**Decisión:** 3 operaciones a la vez por sesión y 32 en cola, antes de cualquier consulta; el resto recibe 429. Se reutiliza el semáforo de S-02. **No se quitó el candado global:** es la base de la coherencia de datos del puente, y cambiarlo no estaba justificado por este riesgo.

### Otros

| Hallazgo      | Cambio                                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| S-03          | Cherry-pick de la PR #17; pruebas con los mensajes actuales                                                            |
| S-04          | Angular 22.2.4, CLI 22.2.6. Se fijaron los rangos, porque `npm update` no resolvía los pares                           |
| F5-06, F5-17  | Comprobación del esquema al arrancar; `SchemaError` da un 500 genérico                                                 |
| F5-16         | Lista corta de contraseñas comunes en API y app. **No se subió el mínimo de 8:** es decisión de producto               |
| F5-18         | Rutas de práctica apagadas en producción; `demo1234` fuera del bundle                                                  |
| N-04          | `inlineCritical: false` en el build de producción, en lugar de debilitar la CSP                                        |
| Foco del menú | La navegación devuelve el foco al botón. Es un defecto real de accesibilidad, no un cambio para contentar a una prueba |
| N-01          | Bases de prueba con sufijo aleatorio, sin borrado previo                                                               |

**Sin cambios, a propósito:** Argon2id, S-02 (semáforo y parámetros), las tablas de la 006, la migración 005, y `PaymentsGatewayService`.

## 2. Migraciones

**Una nueva:** `007_correo_y_limites.sql`. Aditiva e idempotente: añade ámbitos a `limite_acceso` y crea `origen_conocido` y `correo_saliente`.

| Comprobación, en bases temporales            | Resultado                                                  |
| -------------------------------------------- | ---------------------------------------------------------- |
| Base en 003 con datos → 007, dos veces       | Checksums iguales; filas conservadas                       |
| Esa base frente a una nueva                  | Mismo esquema: `48c402f3bd642526`                          |
| API de `9e08b11` sobre una base con 007      | Login y RPC → 200: la marcha atrás de código funciona      |
| Totales                                      | 45 tablas, 63 FK, 41 `CHECK`, 32 `UNIQUE`; 0 FK sin índice |
| `git diff` de 005 y de las sentencias de 006 | Sin cambios                                                |

No hay migraciones de bajada. **Sólo probada en MariaDB 13.0.2**; la CI apunta a 11.8, sin ejecutar.

**Compatibilidad:** toda base existente necesita `db:setup` antes de usar este código. En desarrollo la API lo dice; en producción no arranca.

## 3. Cambios de contrato en pruebas existentes

No se cambió ninguna expectativa para hacerla pasar sin explicación. Estos cambios reflejan decisiones de arriba:

| Prueba                                                  | Antes                            | Ahora                                                | Motivo                                          |
| ------------------------------------------------------- | -------------------------------- | ---------------------------------------------------- | ----------------------------------------------- |
| Contadores en `login-limit*.test.ts`, `s01-s02.test.ts` | `IP`, `CUENTA_IP`                | También `CUENTA`                                     | Contador nuevo                                  |
| «one account from 10 IPs»                               | 50×401                           | 20×401, 30×429                                       | R-1                                             |
| H-2                                                     | 10 direcciones no impiden entrar | El dueño conocido entra; **la red nueva recibe 429** | Precio de R-1, ahora explícito                  |
| S-01 + S-02, desbordar el semáforo                      | Una cuenta                       | 10 cuentas                                           | Una sola ya no llega a desbordarlo              |
| `gate saturated`                                        | Espera de 100 ms                 | 1000 ms                                              | Era sensible al tiempo con la reserva más larga |
| `createApp` con `10.0.0.0/8`                            | Se rechazaba                     | Se rechaza `/99`                                     | CIDR admitido a petición                        |
| `abc12345` en `auth.spec.ts`                            | Válida                           | Rechazada                                            | Lista de comunes                                |

## 4. Riesgos residuales

| Riesgo                                                          | Impacto                                                              | Control                           | Para cerrarlo                    |
| --------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------- | -------------------------------- |
| Hasta 20 intentos por cuenta cada 15 min, unos **1 920 al día** | Una contraseña débil puede caer con el tiempo                        | Lista de comunes; aviso en el log | Mínimo más alto o 2FA (producto) |
| Red nueva bloqueada durante un ataque                           | La persona espera o recupera por correo. **Sin correo, sólo espera** | Documentado                       | Prueba real de correo            |
| Agotar las recuperaciones de una cuenta                         | Sin recuperación durante 15 min                                      | Ventana corta                     | Aceptable; revisar con uso       |
| Avalancha desde muchas redes (R-2)                              | Login 503                                                            | Falla cerrado; proxy sin probar   | Probar `limit_req`               |
| Varias cuentas a la vez en el RPC                               | Latencia                                                             | Reparto por sesión                | Prueba de carga                  |
| Relojes entre instancias (R-3)                                  | Ventanas algo distintas                                              | Una instancia hoy                 | NTP                              |
| Correos duplicados                                              | Dos mensajes; sólo vale el último                                    | Diseño                            | Aceptable                        |
| Purga concurrente de contadores                                 | Sin prueba específica; `SKIP LOCKED` por diseño                      | Lectura de código                 | Añadir prueba                    |
| Fallo histórico de persistencia                                 | Causa sin demostrar                                                  | 0 fallos en más rondas            | Conservar trazas si reaparece    |

## 5. Evidencia de pruebas

**SHA `42ba6175fe04934de9bade0ced1b04072c556d49`, 2026-11-05, 10:03–10:07, Node 26.13.0:**

| Comando                               | Duración | Resultado                             |
| ------------------------------------- | -------- | ------------------------------------- |
| `sh scripts/check-sensitive-files.sh` | 1 s      | OK                                    |
| `npm run api:typecheck`               | 3 s      | OK                                    |
| `npm run build`                       | 3 s      | OK                                    |
| `npm run api:test`                    | 53 s     | **338/338**                           |
| `npx ng test --watch=false`           | 119 s    | **251/251**                           |
| `npm run e2e`                         | 62 s     | **23/23**, con la CSP de producción   |
| `npx prettier --check .`              | 4 s      | OK                                    |
| `git diff --check 9e08b11 HEAD`       | 0 s      | OK                                    |
| `npm run db:mariadb:test-backup`      | 14 s     | OK: 42/42 checks, 45 tablas idénticas |
| `npm audit --omit=dev` y `npm audit`  | 1 s      | 0 vulnerabilidades                    |
| `postman collection lint postman/`    | 1 s      | 37 archivos, 0 errores                |
| `postman collection run`              | 2 s      | 37 solicitudes, 42/42 aserciones      |

**Falló durante el trabajo, y se corrigió:**

- Primera E2E con CSP: 17 fallos (N-04).
- La primera versión del reparto RPC no cumplía su prueba (N-05).
- Mi prueba de 200 conexiones falló una vez con `ECONNRESET`, por la cola de `listen` de macOS (`somaxconn` = 128). Se redujo a 60 y se comprobó: `api:test` 5/5 rondas con 338/338.
- `git diff --check` detectó espacios finales en un archivo de evidencia.

**Pruebas nuevas contra `9e08b11`:** `r1-distribuido` 11/14 fallan, `recuperacion-limites` 5/8 fallan y `authorization-order` 6/10 fallan. **Límite:** las que pasan cubren comportamientos que ya eran correctos, como la igualdad de estados. `correo-saliente`, `endurecimiento` y `client-ip` no cargan en esa versión porque importan módulos nuevos; su «antes» está en el arnés de reproducción.

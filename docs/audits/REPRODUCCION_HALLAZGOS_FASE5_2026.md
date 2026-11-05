# Reproducción de los hallazgos de la Fase 5

Se reprodujeron los hallazgos **antes de corregir**, sobre una copia exacta de `9e08b11`, y se repitieron después con el mismo arnés.

```sh
DB_SOCKET=/tmp/mysql.sock DB_USER=$(whoami) \
  node docs/audits/evidencia-2026/repro/fase1.mjs --code <directorio> --label <etiqueta> --out <archivo.json>
```

**Condiciones:** macOS, Node 26.13.0, MariaDB 13.0.2 por socket y Chrome 157, en un equipo de desarrollo. El arnés crea cada base con un nombre nuevo, se niega a usar una que exista y sólo emplea datos ficticios. La IP del cliente se simula con `X-Forwarded-For` desde `TRUSTED_PROXIES=127.0.0.1`.

**Datos en bruto:** [`fase1-antes.json`](evidencia-2026/fase1-antes.json), [`fase1-antes-recuperacion.json`](evidencia-2026/fase1-antes-recuperacion.json), [`fase1-despues.json`](evidencia-2026/fase1-despues.json) y [`verificaciones-locales.txt`](evidencia-2026/verificaciones-locales.txt). El JSON «después» es de `6ab7056`; entre ese commit y `42ba617` sólo cambian pruebas, evidencia y la plantilla de systemd.

## 4.1 Login y fuerza bruta (R-1)

| Escenario                                                            | Antes                   | Después                                       |
| -------------------------------------------------------------------- | ----------------------- | --------------------------------------------- |
| **150 intentos, una cuenta, 30 direcciones de un /64** (el original) | **150×401, ningún 429** | 5×401, 145×429; el primer 429 en el intento 6 |
| Contraseña correcta justo después, desde ese /64                     | 200                     | 429                                           |
| Contraseña correcta justo después, desde otro /64                    | 200                     | 200 (la cuenta sigue por debajo de 20)        |
| 150 intentos desde 150 /64 distintos                                 | 150×401                 | 20×401, 130×429                               |
| IPv4, una dirección, 7 intentos                                      | 5×401, 2×429            | Igual                                         |
| IPv4, 60 direcciones, una cuenta                                     | 60×401                  | 20×401, 40×429                                |
| IPv4 mapeado, 4 escrituras, 8 intentos                               | 7×401, 1×429            | 5×401, 3×429                                  |
| IPv6, 4 escrituras de una dirección, 20 intentos                     | 20×401                  | 5×401, 15×429                                 |
| 25 a la vez, misma pareja                                            | 5×401, 20×429           | Igual                                         |
| 25 a la vez, un /64 con direcciones rotando                          | 25×401                  | 5×401, 20×429                                 |
| Encabezado falsificado por un cliente no confiable, 7 intentos       | 5×401, 2×429            | Igual: se ignora                              |
| 60 fallos contra una cuenta; el dueño desde su red conocida          | 200                     | 200                                           |
| Lo mismo; el dueño desde una red **nueva**                           | 200                     | **429**: precio documentado de la corrección  |
| Cuenta existente frente a inexistente: estados, 30 intentos          | Iguales                 | Iguales (20×401, 10×429 en ambas)             |
| Cuenta existente frente a inexistente: mediana                       | 22,5 / 22,4 ms          | 28,4 / 27,7 ms                                |

**Límites por ámbito, antes:** pareja cuenta/IP e IP. **Después:** red, pareja cuenta/red y cuenta para redes desconocidas.

**Diferencia con la auditoría:** se reprodujo igual. El primer arnés comparó una cuenta fija con correos distintos y parecía mostrar enumeración; era un error de la prueba, corregido para comparar igual con igual.

## 4.2 `TRUSTED_PROXIES`

| Configuración                                       | Antes                                         | Después                                                              |
| --------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| Vacío, desarrollo                                   | Arranca, sin aviso                            | Arranca; avisa una vez al llegar `X-Forwarded-For`                   |
| Vacío, producción                                   | **Arranca**                                   | **No arranca**, y dice por qué                                       |
| `none`, producción                                  | No arranca                                    | Arranca, con aviso                                                   |
| IP válida                                           | Arranca                                       | Arranca                                                              |
| CIDR `10.0.0.0/8` o `fd00::/8`                      | No arranca                                    | Arranca                                                              |
| Nombre, `/99`, `0.0.0.0/0`                          | No arranca                                    | No arranca                                                           |
| **60 fallos con la configuración vacía**            | **50×401, 10×429; contraseña correcta → 429** | Igual en desarrollo, con aviso; en producción no se llega a arrancar |
| Lo mismo, con IP o CIDR configurado                 | IP: el otro cliente → 200. CIDR: no arrancaba | Ambos: el otro cliente → 200                                         |
| Saltos con el valor izquierdo falsificado y rotando | No aplicaba (CIDR rechazado)                  | 5×401, 2×429: el izquierdo no cuenta                                 |

**No se inventó ningún valor de proxy.** El real depende de un servidor que no existe.

## 4.3 Recuperación de contraseña: memoria

| Medida                                | Antes                                                      | Después                                   |
| ------------------------------------- | ---------------------------------------------------------- | ----------------------------------------- |
| 40 000 correos distintos desde una IP | 40 000×204, 0×429                                          | 20×204, 39 980×429                        |
| RSS inicial → máximo → final (40 000) | 170 → 200 → 190 MB                                         | 165 → 165 → 88 MB                         |
| RSS con 200 000 (sólo antes)          | 171 → 241 → 233 MB                                         | —                                         |
| Una cuenta desde 30 IP: correos       | **30**                                                     | **5**                                     |
| Concurrencia                          | 40 trabajadores                                            | Igual; 40 a la vez → 5 admitidos (prueba) |
| Expiración                            | Las claves del `Map` nunca se borraban (lectura de código) | Ventana de 15 min con purga (prueba)      |
| Mediana existente / inexistente       | 2,07 / 0,54 ms                                             | 2,33 / 2,32 ms                            |

**Diferencia con la auditoría:** dijo unos +30 MB con 40 000. Hoy salieron unos +20 MB, y unos +63 MB con 200 000: **el RSS es ruidoso y no crece de forma lineal**, así que los 0,75 KB por solicitud eran una extrapolación optimista de una sola medida. El defecto (crecimiento sin límite) se confirma por el código, no sólo por el RSS.

## 4.4 Fallo de correo después del COMMIT

Proveedor simulado en cuatro modos. Rechazo, tiempo de espera y conexión cortada dieron lo mismo:

| Comprobación                        | Antes                                                                     | Después                                                     |
| ----------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Respuesta                           | **400 con el texto interno** (`re_SENTINEL`, `smtp.internal`, `10.0.0.9`) | 200 con `mailPending: true`, sin texto interno              |
| ¿Cuenta creada?                     | Sí                                                                        | Sí                                                          |
| Repetir la operación                | 400 «ya existe»                                                           | Igual; una cuenta, un token                                 |
| ¿Se puede reintentar?               | **No**                                                                    | Sí, automático, con token nuevo; el anterior queda revocado |
| ¿Se conserva el aviso pendiente?    | **No**                                                                    | Sí, en `correo_saliente`, sin cuerpo ni token               |
| Fallo tras el COMMIT, proceso caído | Se perdía                                                                 | El proceso de fondo lo retoma (prueba)                      |

No se simula ninguna entrega: `ENVIADO` sólo se registra si el proveedor aceptó.

## 4.5 CI, Git y `main`

| Comprobación                                                         | Resultado                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------ |
| Workflows                                                            | Antes: ninguno. Ahora `ci.yml`, sin ejecutar en GitHub |
| Protección de `main`                                                 | `Branch not protected`, también hoy. No se cambió      |
| Revisiones                                                           | Ninguna de las últimas 12 PR registra una              |
| `git add -A` con `backups/x.sql.gz` y `.env.production` en `9e08b11` | **Los añade**                                          |
| Lo mismo en la rama                                                  | No añade nada                                          |
| Respaldo forzado con `-f`                                            | `check-sensitive-files.sh` → error, exit 1             |

Se usó un clon desechable con un archivo ficticio. No se tocó ningún respaldo existente.

## 4.6 Correo y HU-004, HU-012, HU-022

| Comprobación                            | Resultado                                        | Tipo                                              |
| --------------------------------------- | ------------------------------------------------ | ------------------------------------------------- |
| Alta o vinculación sin transporte       | 503 con rollback                                 | Falta proveedor                                   |
| Recuperación en producción              | 503                                              | Falta proveedor                                   |
| Vencimiento y un solo uso de los tokens | Correctos (pruebas)                              | —                                                 |
| Enumeración                             | Sin diferencia de estado ni de tiempo apreciable | Corregido                                         |
| Errores del proveedor                   | Revelaba texto interno                           | **Defecto de código, corregido**                  |
| Reintentos                              | No existían                                      | **Defecto de código, corregido**                  |
| Experiencia de usuario                  | Un error en una operación ya hecha               | **Defecto de código, corregido**: aviso en la app |
| Envío real                              | **No probado**                                   | Falta proveedor                                   |

No se envió correo a ningún destinatario real.

## 4.7 S-03 y S-04

**S-03.** La PR #17 sigue abierta y no se modificó; su commit se aplicó localmente con cherry-pick. Sus tres pruebas fallaban por mensajes antiguos:

| Esperaba                                 | Mensaje actual                                 | Fuente                        |
| ---------------------------------------- | ---------------------------------------------- | ----------------------------- |
| `Sesión no iniciada o expirada.`         | `Tu sesión no está iniciada o ya expiró…`      | `NO_SESSION` en `api/auth.ts` |
| `No tienes permiso para esta operación.` | `No tienes permiso para realizar esta acción.` | `ForbiddenError`              |
| `Jugador/Sesión no encontrado.`          | `… inexistente: actualiza la página…`          | `MockDb.get`                  |

Los mensajes actuales son el contrato de `DEVELOPMENT.md` § 5.1, posterior a la PR, por lo que el comportamiento es correcto y lo antiguo eran las pruebas. Se actualizaron los textos, no lo que comprueban: **antes del arreglo, 6 de esas 10 pruebas fallan por la fuga real.**

**S-04.** Antes: 2 paquetes altos en producción y 8 en total.

| Paquete           | ¿Alcanzable?                                              | Cómo se comprobó                                                  |
| ----------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| `@angular/router` | No en el flujo actual: sólo afecta a SSR                  | Sin `@angular/ssr` ni configuración de servidor en `angular.json` |
| `zod`             | No: 0 archivos del bundle y 0 apariciones en `domain.mjs` | `grep` en `dist/` y `api/.build`                                  |
| Desarrollo        | Sólo equipos de desarrollo                                | Árbol de dependencias                                             |

Aunque no sean alcanzables hoy, se actualizaron: `npm audit` → 0.

## 4.8 Revisión dirigida de seguridad

| Área              | Resultado antes y después                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| Endpoints         | Sin sesión: 126/126 → 401. Fuera de la lista blanca → 404                                                       |
| Roles             | Tutor y entrenador sólo reciben 200 en su portal, panel o alcance; 0 respuestas 500, con 6 formas de argumentos |
| Acceso horizontal | Sólo datos propios en la muestra (2 hijos de 6; 1 categoría de 3; 2 sesiones de 4)                              |
| Fuga 403/400      | Antes: 3 operaciones. Después: 0                                                                                |
| Inyección SQL     | Login → 401; búsqueda → 200 sin resultados; tablas intactas                                                     |
| XSS               | **Nuevo en E2E:** un aviso con `<img onerror>` y `<script>` se muestra como texto; nada se ejecuta              |
| CSRF y CORS       | `text/plain` → 400; preflight → 404 sin `Access-Control-Allow-Origin`                                           |
| Sesiones          | Tras cerrar sesión → 401; cookie falsa → 401                                                                    |
| Registros         | Sin contraseñas de prueba en stderr                                                                             |
| Archivos          | No hay subida ni descarga                                                                                       |
| Cabeceras         | Antes sólo 2. Ahora CSP, `Referrer-Policy` y CSP de la app probada en Chrome                                    |

**Límite:** formas de argumentos genéricas y datos de muestra. Reduce el riesgo; no demuestra que no haya fallos.

## Pruebas intermitentes

| Prueba, sin instrumentar                                | Antes                                              | Después         |
| ------------------------------------------------------- | -------------------------------------------------- | --------------- |
| Menú de usuario, 20 rondas                              | **19 pasan, 1 falla** («focus back on the button») | 20 pasan        |
| Tablero, 10                                             | 10                                                 | 10              |
| Menú lateral, 10                                        | 10                                                 | 10              |
| Persistencia tras reinicio, 20                          | 20                                                 | 20              |
| E2E completa, 10 rondas                                 | —                                                  | 10/10 con 23/23 |
| Carrera forzada: sesión retrasada 300 ms, foco devuelto | **0/10**                                           | **10/10**       |

| Fallo                  | Dónde estaba                                                                                       | Decisión                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Foco del menú          | **Prueba y aplicación:** la prueba no esperaba la redirección, y la app dejaba el foco en `<body>` | Ambas corregidas                         |
| Tablero y menú lateral | Prueba: misma espera. Sin fallos que comparar en estas rondas                                      | Corregida; evidencia de orden, no causal |
| Persistencia histórica | **Causa sin demostrar:** 0 fallos en 20 antes y 20 después                                         | Sigue abierta                            |
| Colisión de puertos    | Entorno y arnés                                                                                    | Corregida (abajo)                        |

**Colisión, simulada con un listener ajeno en `0.0.0.0:P`:** `listen(P)` en `::` no da error y `127.0.0.1:P` queda sin respuesta. `listen(P, '127.0.0.1')` responde el servidor propio en 23 ms. Todas las pruebas ahora escuchan en `127.0.0.1`. **Corrección al informe Fase 5:** allí se dijo que ese `listen` daría `EADDRINUSE`; hoy no lo da en esta simulación. El defecto se evita igualmente.

No se añadieron reintentos automáticos.

## Lo que no se pudo reproducir

| Hallazgo                        | Motivo                                          |
| ------------------------------- | ----------------------------------------------- |
| Fallo histórico de persistencia | No se repite; sin trazas del evento original    |
| F5-11 con proxy                 | No hay proxy; sólo la prueba M-1                |
| F5-13 con cuentas separadas     | Crear usuarios modifica un servidor compartido  |
| Colisión con Tailscale real     | El puerto 51444 ya no estaba ocupado; se simuló |

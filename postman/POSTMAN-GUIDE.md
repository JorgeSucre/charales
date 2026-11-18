# Guía de Postman — Charales API

La fuente de la colección son los YAML de `postman/collections/Charales` (formato v3, los usa Postman CLI). Los JSON
de `postman/export/` se **generan** a partir de ellos para importarlos en Postman Desktop: no los edites a mano.

```bash
npm run postman:export   # regenera postman/export/*.json desde los YAML (requiere Postman CLI)
```

| Archivo                                                  | Qué es                                 |
| -------------------------------------------------------- | -------------------------------------- |
| `postman/export/Charales API.postman_collection.json`    | Colección Postman v2.1 (51 peticiones) |
| `postman/export/Charales local.postman_environment.json` | Environment `Charales local`           |

## 1. Preparar la API y MariaDB

```bash
npm run api:start                       # API en http://localhost:3000 (lee .env; no lo versiones)
curl -s localhost:3000/health           # {"status":"ok","database":"ok"} → API y MariaDB conectadas
mariadb escuela_futbol -e "SELECT COUNT(*) FROM jugadores; SELECT email, activo FROM usuarios WHERE email LIKE '%@example.com';"
```

La colección usa las cuentas ficticias de desarrollo (`admin@`, `coach@` y `baja@example.com`, contraseña pública
`demo1234`), que carga `020_dev_seed.sql` sólo en una base nueva (`docs/API.md` § Ejecutar). Nunca la ejecutes contra
una base real o de producción: la carpeta Jugadores escribe.

## 2. Importar en Postman Desktop

Usa la aplicación de escritorio: la versión web no llega a `localhost` sin el agente de escritorio.

1. **Import** (arriba a la izquierda) → arrastra o elige los dos archivos de `postman/export/` → **Import**.
2. Aparece la colección **Charales API** con las carpetas Salud, Auth, Jugadores, Categorias, Contraseñas y Dominio.
   Si ya tenías una versión anterior importada, bórrala antes (o elige _Replace_) para no duplicar peticiones.
3. Selector de environments (arriba a la derecha) → **Charales local**.

## 3. Ejecutar todas las pruebas

1. Antes de cada ejecución, borra las cookies de `localhost`: **Cookies** (debajo de _Send_) → `localhost` → _Remove
   all_. La primera petición comprueba el acceso anónimo y fallaría si quedó una sesión de una prueba manual.
2. Clic derecho en **Charales API** → **Run collection** (Collection Runner).
3. Deja el orden tal cual (el orden importa: cada carpeta es una secuencia de sesiones), 1 iteración, sin retraso, y
   environment **Charales local** → **Run Charales API**.

La sesión es la cookie HttpOnly `charales_sid`: el login la recibe y el cookie jar de Postman la reenvía sola. No hay
tokens ni cabeceras `Authorization`.

Por CLI, lo mismo:

```bash
postman collection lint postman/collections/Charales
postman collection run postman/collections/Charales -e postman/environments/local.environment.yaml
```

## 4. Resultado esperado

**51 peticiones**, 51 scripts de prueba, 1 script previo, **57 aserciones aprobadas y 0 fallidas**.

| Carpeta     | Peticiones | Qué prueba                                                                                                   |
| ----------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| Salud       | 1          | `GET /health`                                                                                                |
| Auth        | 8          | Anónimo (401), faltan datos (400), contraseña incorrecta y cuenta deshabilitada (401), login, sesión, logout |
| Jugadores   | 17         | 401/403, `GET /api/jugadores` y la secuencia CRUD de `PlayerService` (abajo)                                 |
| Categorias  | 6          | `GET /api/categorias` con admin (200), sin sesión (401) y entrenador (403)                                   |
| Contraseñas | 10         | Cambio de contraseña (y restauración), errores, recuperación sin enumeración de cuentas                      |
| Dominio     | 9          | `POST /api/rpc`: lecturas, cuerpo inválido (400), fuera de la lista blanca (404), 403 y 401                  |

Secuencia de Jugadores (sesión de administrador; el id viaja en la variable de colección `playerId`):

| #   | Operación                                            | Esperado                                          |
| --- | ---------------------------------------------------- | ------------------------------------------------- |
| 1   | `PlayerService.create` (como entrenador)             | 403, no se escribe nada                           |
| 2   | `PlayerService.create`                               | 200, `J-NNNN`, `ACTIVO`; guarda `playerId`        |
| 3   | `PlayerService.get`                                  | 200 con los datos creados                         |
| 4   | `PlayerService.update` (teléfono, correo, dirección) | 200                                               |
| 5   | `PlayerService.get`                                  | 200 con los cambios                               |
| 6   | `PlayerService.changeStatus` → `BAJA_DEFINITIVA`     | 200                                               |
| 7   | `PlayerService.record`                               | Historial: Alta → baja, con motivo y usuario      |
| 8   | `GET /api/jugadores`                                 | La fila en MariaDB tiene los cambios y la baja    |
| 9   | `changeStatus` al mismo estatus                      | 400 «El jugador ya tiene ese estatus.»            |
| 10  | `changeStatus` a `ELIMINADO`                         | 400 «Estatus inválido.»                           |
| 11  | `create` duplicado (mismo nombre y nacimiento)       | 400 «Posible duplicado: …»                        |
| 12  | `create` con nacimiento futuro                       | 400 «La fecha de nacimiento no puede ser futura.» |

Comprobar en MariaDB (sólo lectura) lo que escribió la última ejecución:

```bash
mariadb escuela_futbol -e "
SELECT id, identificador, apellido_materno, telefono, direccion, estatus FROM jugadores WHERE apellido_paterno = 'Postman' ORDER BY id;
SELECT jugador_id, estatus_anterior, estatus_nuevo, motivo FROM historial_estatus
 WHERE jugador_id IN (SELECT id FROM jugadores WHERE apellido_paterno = 'Postman') ORDER BY id;
SELECT accion, entidad_id, descripcion FROM auditoria WHERE entidad = 'jugadores' ORDER BY id DESC LIMIT 3;"
```

## 5. Limitaciones de la API

- **No hay PUT, PATCH ni DELETE.** Los endpoints son `GET` (salud, sesión y los dos de la práctica) y `POST`
  (autenticación y `POST /api/rpc`). Las altas, ediciones y cambios de estatus son operaciones de dominio por
  `POST /api/rpc` (`docs/API.md` § Operaciones de dominio).
- **No se pueden eliminar jugadores.** `PlayerService` no tiene borrado físico. `changeStatus` es una baja **lógica**
  (`BAJA_TEMPORAL` o `BAJA_DEFINITIVA`): conserva el jugador, su historial y sus relaciones (pagos, categorías,
  partidos). No es un DELETE HTTP y la colección no lo presenta como tal.
- **Registros de prueba:** cada ejecución deja un jugador «Prueba Postman _etiqueta_» en `BAJA_DEFINITIVA`, con 2 filas
  en `historial_estatus` y 3 en `auditoria`. La etiqueta es única por ejecución, así que la colección se puede repetir.
  No se borran a mano: el historial y la auditoría deben quedar completos.
- **Límite de intentos:** cada ejecución hace un login con contraseña incorrecta y un cambio con la contraseña actual
  incorrecta. Tras 5 fallos en 15 minutos la API responde 429 (también al login correcto), así que la ejecución
  número 6 dentro de 15 minutos falla. Espera o reinicia la API, que guarda el límite en memoria.
- **Recuperación de contraseña:** sin transporte de correo la solicitud responde 503 (o 204 con `MAIL_CONSOLE=true`);
  la prueba acepta ambos y exige la misma respuesta para un correo existente y uno inexistente.
- `GET /api/jugadores` y `GET /api/categorias` devuelven las filas tal como están en MariaDB (`snake_case`);
  `POST /api/rpc` devuelve el modelo de la app (`camelCase`).

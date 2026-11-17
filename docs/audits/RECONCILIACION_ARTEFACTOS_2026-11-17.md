# Reconciliación de artefactos de despliegue — 17-nov-2026

Procedencia de los paquetes usados antes de la versión candidata y origen de la discrepancia de migraciones. Método:
cada archivo de cada ZIP se compara con `git hash-object` contra los objetos de Git del repositorio local
(`~/Projects/6A/ingenieria_software/charales/project`). Un ZIP «corresponde» a un commit sólo si **todos** sus
archivos son idénticos byte a byte a los de ese commit.

## 1. Backends

| ZIP                                                                                          | SHA-256                                                            | Archivos                        | Corresponde a                                                         |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------- |
| `project/BACKEND-ALMALINUX/backend-charales.zip` (10-nov 19:50)                              | `4cd5e97bb798c9aca2bfa2d73bef964b63f5e4f79fe96edf9e15a5e5802e78f9` | 267                             | **`becbbe3`** (`jorgesucre/refactor/scrypt-password-hashes`): 267/267 |
| `BACKEND-ALMALINUX/backend-charales.zip` (10-nov 12:22) = `~/Downloads/backend-charales.zip` | `e6a57f37cb77af7004476fba69f880b2f18727ed1d6965e6b5eabca0164e07dc` | 263 (+ `api/.build/domain.mjs`) | **`a2a7cc6`** (merge de `fix/cierre-funcional`, 6-nov): 263/263       |

- `a2a7cc6` es el padre de `686234b`, el primer commit del refactor a scrypt. El ZIP auditado en la simulación VPS
  anterior (`docs/AUDITORIA-DESPLIEGUE-ALMALINUX.md`, en otro clon) **no contiene ninguno de los 10 commits**
  `a2a7cc6..becbbe3`: usa Argon2id (`crypto.argon2`, `argon2-guard.ts`, `ARGON2_*`). Sus resultados (30/30, 8/8,
  respaldo de 46 tablas) **no son evidencia sobre `becbbe3`**.
- Ni `a2a7cc6` ni `becbbe3` están en `origin`: sólo existen en este repositorio local.
- El manifiesto del ZIP `4cd5e97b` declara `becbbe3`, y la comparación lo confirma. El ZIP `e6a57f37` no traía
  manifiesto; su procedencia queda demostrada por la comparación.

### Diferencias `a2a7cc6` → `becbbe3` (lo empaquetado)

| Área                  | Cambio                                                                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hash de contraseñas   | Argon2id → scrypt nativo (`api/passwords.ts`: `N=2^15, r=8, p=1`, 64 bytes, formato `$scrypt$v=1$…`). Los hashes `$argon2…` se reconocen y nunca se verifican                           |
| Gate de concurrencia  | `argon2-guard.ts` (semáforo distribuido en MariaDB) → `concurrency-gate.ts` + `scrypt-gate.ts` (por proceso: `SCRYPT_MAX_CONCURRENT=2`, `SCRYPT_MAX_WAITERS=32`, `SCRYPT_WAIT_MS=5000`) |
| Limitador de login    | `login-limit.ts`: se limpian las negativas en caché al devolver un intento (`becbbe3`)                                                                                                  |
| Entorno               | `deploy/env.production.example`: fuera `ARGON2_MAX_CONCURRENT`, `ARGON2_WAIT_MS`; dentro `SCRYPT_N/R/P/KEY_LENGTH/MAXMEM_MB`                                                            |
| Instalación           | `api/setup.ts`, `api/schema.ts` y `db/mariadb/scripts/` **sin cambios**                                                                                                                 |
| Migraciones           | Nueva `db/mariadb/migrations/010_eliminar_turnos_hash_antiguo.sql`; `020_dev_seed.sql` con hashes scrypt                                                                                |
| Documentación         | API, ARCHITECTURE, MARIADB, PROCEDIMIENTO_PRODUCCION (recuperación de cuentas heredadas), etc.                                                                                          |
| `package.json` / lock | Sin cambios                                                                                                                                                                             |
| Frontend (`src/`)     | 4 archivos: comentarios y `user.service.ts` (`$argon2id$` → `$scrypt$`, lógica de dominio que en producción se ejecuta en la API)                                                       |

## 2. Migración 010: dos archivos distintos con el mismo número

| Archivo                                                      | Qué es                                                                                                              | En `a2a7cc6` | En `becbbe3` |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------ | ------------ |
| `db/mariadb/010_permisos_app.sql`                            | Catálogo de permisos y matriz inicial de roles. **No** es una migración del directorio; `setup.ts` lo aplica aparte | Sí           | Sí (igual)   |
| `db/mariadb/migrations/010_eliminar_turnos_hash_antiguo.sql` | `DROP TABLE IF EXISTS turnos_argon2, turnos_argon2_guarda` (creadas en 006; sin datos personales ni FK)             | No           | Sí           |

Ninguno sustituye al otro. Historia de la segunda, todo en la rama scrypt:

1. `686234b`: se crea como migración automática.
2. `7de3e33`: se mueve a `db/mariadb/maintenance/` (limpieza opcional).
3. `f993369`: vuelve a `db/mariadb/migrations/` y queda como migración automática.

**Esquema resultante con `becbbe3`** (`setup.ts`: esquema base → `migrations/001…010` → `010_permisos_app.sql`):
44 tablas, procedimiento `marcar_cargos_vencidos` y evento `ev_cargos_vencidos`; con `a2a7cc6`, 46 tablas (las dos
de turnos). Comprobado: `db:mariadb:test-backup` sobre `becbbe3` compara 44 tablas.

**Cambios manuales:** no hay forma de saber desde el repositorio si se aplicó algo a mano en una base institucional (no
se accedió a ninguna). En las bases de prueba de la simulación no se aplicó nada fuera de `setup.ts`.

**Compatibilidad hacia atrás (probado):** una API `a2a7cc6` arranca y permite iniciar sesión sobre una base con la 010
aplicada. Por inspección, no reconoce los hashes `$scrypt$`: tras escribir contraseñas con la versión nueva, volver a
la anterior deja esas cuentas sin acceso.

## 3. Frontends

| ZIP                                                                                 | SHA-256 (abreviado)   | Origen                                                                                              |
| ----------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------- |
| `ARTEFACTOS-DESPLIEGUE/frontend-charales.zip` (auditoría, «no desplegar»)           | `4179d92b…258eddda`   | `src/` de `a2a7cc6` + `angular.json`, `tsconfig.app.json`, `public/` de `origin/main` `9e08b11`     |
| `ARTEFACTOS-DESPLIEGUE/frontend-charales-corregido.zip`                             | `3a15ff7c…3c060bcfd5` | Igual, con `angular.json` equivalente (mismo JSON) al de `a2a7cc6`: es una compilación de `a2a7cc6` |
| `CHARALES-ENTREGA/frontend/frontend-charales-build.zip` (6-nov)                     | `4ea705a6…`           | Sin manifiesto: commit no determinable                                                              |
| `CHARALES-ENTREGA-ALMALINUX-20261110/frontend/frontend-charales-build.zip` (10-nov) | `468d17c1…`           | Sin manifiesto: commit no determinable                                                              |

- **La corrección de CSP ya estaba en el repositorio** desde `bf489be` (5-nov): `inlineCritical: false` en la
  configuración `production`. El hallazgo F-01 de la auditoría anterior lo causó compilar con el `angular.json` de un
  clon desactualizado (`origin/main` `9e08b11`, sin `bf489be`), no el código.
- Los dos frontends de la auditoría difieren sólo en `index.html` (el script en línea): los JS y CSS tienen el mismo
  nombre con huella.
- Contrato con la API idéntico en `a2a7cc6` y `becbbe3`: `/auth/login`, `/auth/session`, `/auth/logout`,
  `/auth/password*`, `/api/rpc` (y las rutas de práctica, 404 en producción), mismo origen, cookie `HttpOnly`, sin
  CORS ni `withCredentials`.

## 4. Conclusión

- **Backend oficial:** `becbbe3`, ZIP `4cd5e97b…`. Su procedencia está demostrada.
- **No oficial:** `e6a57f37…`, que es `a2a7cc6`, una versión anterior a scrypt. Su procedencia también está
  demostrada.
- **Frontend:** ninguno de los ZIP existentes corresponde a `becbbe3`. La versión candidata se compila desde el mismo
  commit que el backend.

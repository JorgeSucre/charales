# Cómo contribuir

## 1. Rama

`main` está protegida: nadie trabaja ni hace push directo ahí. **Una rama por HU**, creada desde `main` actualizado:

```bash
git switch main && git pull
git switch -c <integrante>/<tipo>/<hu-descripcion>
# ej. borrayo/feature/hu-043-charge-concepts · joss/feature/hu-008-player-registration · dani/fix/hu-045-receipt-number
```

- `<integrante>`: `borrayo`, `joss`, `armando` o `dani`.
- `<tipo>`: `feature`, `fix`, `docs`, `refactor`, `test` o `chore`.
- `<hu-descripcion>`: el número de la HU que te asigna la
  [tabla oficial](docs/requirements/USER_STORIES.md) más dos o tres palabras.

Las ramas iniciales `borrayo/base-arquitectura` y `borrayo/database` son anteriores a esta convención y se integran
tal cual.

## 2. Commits

Formato: `tipo(ámbito): descripción`. La descripción puede ir en español.

| Tipo       | Para                                        |
| ---------- | ------------------------------------------- |
| `feat`     | Funcionalidad                               |
| `fix`      | Corrección                                  |
| `refactor` | Cambio interno sin cambio de comportamiento |
| `test`     | Pruebas                                     |
| `docs`     | Documentación                               |
| `style`    | Sólo formato                                |

Ejemplos: `feat(db): …`, `fix(billing): …`.

Commits pequeños y con un solo propósito. **Nunca** subas `.env`, credenciales ni datos reales de alumnos.

## 3. Pruebas (deben pasar antes del PR)

```bash
npm run build
npx ng test --watch=false
npx prettier --check .
npm run db:mariadb:test-backup   # si tocaste el modelo MariaDB o db/mariadb (requiere MariaDB local)
```

## 4. Cambios en la base de datos

El modelo vigente es MariaDB ([`MARIADB.md`](docs/database/MARIADB.md)). En corto:

- el esquema es `docs/escuela_futbol_mariadb.sql`; un cambio de esquema se acuerda con el equipo y se acompaña de su caso
  en `docs/escuela_futbol_mariadb_checks.sql`; los datos de la app (permisos) van en `db/mariadb/NNN_*.sql`;
- si cambia una tabla, actualiza su modelo en `core/models`, `MockDb` y `core/data/mock-db.integrity.ts`;
- documentación actualizada (`MARIADB.md`, `DOMAIN_RULES.md`, `AUTHORIZATION.md` si aplica);
- `npm run db:mariadb:test-backup` en verde.

`db/migrations` (PostgreSQL) es histórico: no se le agregan migraciones nuevas.

## 5. Documentación

Si cambias un contrato, actualiza su **fuente de verdad** en el mismo PR:

| Si cambia…        | Actualiza          |
| ----------------- | ------------------ |
| Reglas de datos   | `DATA_CONTRACT.md` |
| Quién escribe qué | `OWNERSHIP.md`     |
| Tablas            | `schema.md`        |
| Mapeo de API o TS | `api-contract.md`  |
| Fases             | `docs/ROADMAP.md`  |

No copies reglas a otros documentos: enlázalas.

## 6. Ownership

Revisa [`OWNERSHIP.md`](docs/database/OWNERSHIP.md) antes de escribir en una tabla.

- Si la tabla es de otro owner, **llama a su servicio**; no escribas directo.
- Si necesitas algo que no existe en su contrato, acuérdalo con el owner antes de programarlo.

## 7. Pull Request

Llena la plantilla (`.github/pull_request_template.md`): **HU vinculada(s)**, objetivo, cambios, pruebas, impacto en
BD y contratos, capturas si hay UI, y pendientes.

- Un PR = una HU (o un objetivo claro).
- Al menos **una revisión aprobada** antes del merge; si tocas una tabla o contrato de otro owner, la revisión es suya.
- El merge a `main` sólo ocurre por PR, con las pruebas en verde.

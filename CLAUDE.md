# CLAUDE.md

Lee [`AGENTS.md`](AGENTS.md) y [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) antes de cualquier tarea. Respeta
[`MARIADB.md`](docs/database/MARIADB.md) (modelo vigente), [`AUTHORIZATION.md`](docs/AUTHORIZATION.md),
[`DATA_CONTRACT.md`](docs/database/DATA_CONTRACT.md) y [`OWNERSHIP.md`](docs/database/OWNERSHIP.md).

## Específico de Claude Code

- Pruebas: usa `npx ng test --watch=false`. `npm test` entra en modo watch y no termina.
- El modelo vigente es **MariaDB** (`docs/database/MARIADB.md`). `npm run db:mariadb:test-backup` crea y borra sólo sus
  bases temporales `ef_bktest_*`. `npm run db:reset` y `npm run db:test` son del esquema PostgreSQL **histórico** y
  **borran y recrean** `charales_dev` y `charales_test`; nunca los apuntes a una BD compartida.
- Validación visual: si la extensión de Chrome no está conectada, dilo. No declares la UI validada sin haberla visto.
- Commits: sólo cuando te lo pidan, en una rama (`<persona>/<tema>`), nunca en `main`, sin push.

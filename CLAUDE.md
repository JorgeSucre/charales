# CLAUDE.md

Lee [`AGENTS.md`](AGENTS.md) y [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) antes de cualquier tarea. Respeta
[`DATA_CONTRACT.md`](docs/database/DATA_CONTRACT.md) y [`OWNERSHIP.md`](docs/database/OWNERSHIP.md).

## Específico de Claude Code

- Pruebas: usa `npx ng test --watch=false`. `npm test` entra en modo watch y no termina.
- `npm run db:reset` y `npm run db:test` **borran y recrean** bases locales (`charales_dev`, `charales_test`). Nunca los
  apuntes a una BD compartida; para esas usa `npm run db:migrate` con `DATABASE_URL`.
- Validación visual: si la extensión de Chrome no está conectada, dilo. No declares la UI validada sin haberla visto.
- Commits: sólo cuando te lo pidan, en una rama (`<persona>/<tema>`), nunca en `main`, sin push.

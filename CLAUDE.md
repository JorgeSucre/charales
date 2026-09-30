# CLAUDE.md

Angular 22 WebApp for a football school. Frontend only, mock data. Read `README.md` and `docs/PLAN.md` first.

## Commands
- `npx ng test --watch=false` — all tests (Vitest). Must pass before committing.
- `npm run build` — must compile without warnings.
- `npx prettier --write "src/**/*.{ts,css,html}"`

## Rules
- Pages → services → `core/data/mock-db.ts`. Pages never inject `MockDb`. Services return `Promise` (swap to HttpClient later).
- Models live in `core/models` (grouped by domain). Don't redeclare entity types in features.
- Money is integer **cents**. `Charge` ≠ `Payment`; linked by `PaymentApplication`. Never store balances.
- Authorization by **permission** (`core/auth/permissions.ts`), never `role === '...'` checks.
- Components: standalone, inline templates, signals, `resource()` for loading, reactive forms + `FieldError`, `Submission` for submit state. OnPush is the default in v22.
- Styles: global `src/styles.css` utility classes; no per-component CSS unless needed.
- Code in English, UI text in Spanish.
- Never put secrets, API keys or real passwords in the frontend.

## Ownership
Each user story has an owner (Borrayo, Joss, Armando, Dani). Only implement stories for the person you're working for;
for others, create shared contracts only (e.g. `PlayerService` is read-only because player CRUD is someone else's).
Borrayo's stories: HU-004, 005, 011, 018, 020, 022, 026, 043, 044, 048, 050, 052–056, 063, 067, 068, 070, 072, 074.

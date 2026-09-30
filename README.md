# Charales — WebApp Escuela de Fútbol

Proyecto escolar integrador: WebApp para administrar una escuela de fútbol (usuarios, tutores, inscripciones,
entrenadores, cobranza, uniformes, portal de padres, reportes). Las historias de usuario están organizadas por
**épicas** (EP01–EP12) y cada una tiene un **responsable** (Borrayo, Joss, Armando, Dani).

> Estado: **frontend con datos simulados**. No hay backend ni autenticación real todavía.

## Stack

Angular 22 (standalone, zoneless, signals) · TypeScript 6 · CSS plano · Vitest (vía `ng test`) · npm.

## Comandos

```bash
npm install
npm start            # http://localhost:4200
npm run build
npm test             # ng test (Vitest, modo watch)
npx ng test --watch=false   # una sola corrida (CI)
```

Usuarios demo (la contraseña **no se verifica**, cualquier valor sirve):
`admin@charales.mx`, `secretaria@charales.mx`, `coach@charales.mx`, `tutor@charales.mx`.

## Estructura

```
src/app/
  core/
    models/        contratos compartidos (people, sports, billing, uniforms)
    auth/          AuthService (mock), permisos por rol, guards
    data/mock-db.ts   ÚNICO lugar con datos simulados
    services/      lecturas compartidas (PlayerService, CategoryService, CompetitionService)
  shared/          MoneyPipe, LoadState, FieldError, Submission, today()
  layout/          Shell (menú por permisos), Home, nav.ts
  features/<dominio>/   <x>.service.ts + páginas (rutas lazy)
  app.routes.ts    todas las rutas con su permiso
```

Flujo: **página → servicio → MockDb** (mañana: **servicio → HttpClient → API**). Las páginas nunca tocan `MockDb`.

## Roles y áreas

| Rol           | Área                | Permisos (ver `core/auth/permissions.ts`)                                   |
| ------------- | ------------------- | --------------------------------------------------------------------------- |
| Administrador | `/admin`            | todo lo de oficina + usuarios + temporadas                                  |
| Secretaría    | `/admin`, `/sports` | tutores, inscripciones, entrenadores, cobranza, uniformes, reportes, agenda |
| Entrenador    | `/sports`           | categorías, agenda                                                          |
| Padre/Tutor   | `/portal`           | sólo sus hijos                                                              |

Rutas y menú verifican **permisos**, nunca roles. Para agregar uno: añádelo a `Permission` y a `ROLE_PERMISSIONS`.

## Alcance actual

Implementada la base de las historias de **Borrayo** (ver `docs/PLAN.md`). Las de Joss, Armando y Dani no están
implementadas; sólo existen los modelos compartidos que necesitan.

## Cómo continuar

1. Nueva funcionalidad: carpeta en `features/`, servicio + página, ruta en `app.routes.ts` con `canActivate: [can('permiso')]`, entrada en `layout/nav.ts`.
2. Conectar backend: añadir `provideHttpClient()`, reemplazar las llamadas a `MockDb` dentro de cada servicio por `firstValueFrom(http...)`, y borrar `mock-db.ts`. Las reglas de `billing.rules.ts` deben replicarse en el backend.

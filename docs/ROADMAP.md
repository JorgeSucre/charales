# Roadmap

Fuente de verdad de las fases. Última actualización: 2026-09-30.

| Fase                           | Estado     | Resultado                                                                                                            |
| ------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| 1 — Arquitectura frontend      | COMPLETADA | Angular por dominio, RBAC por permisos, UI de las historias de Borrayo con `MockDb`                                  |
| 2 — Auditoría                  | COMPLETADA | Separación Enrollment ≠ PlayerCategory, contrato de pagos, RBAC probado ruta por ruta, correcciones responsive       |
| 3 — Base de datos              | COMPLETADA | PostgreSQL 16: migraciones, seed, pruebas de integridad, consultas críticas                                          |
| 3.5 — Contrato de datos        | COMPLETADA | `DATA_CONTRACT.md`, `OWNERSHIP.md`, cuadre de uniformes en BD (migración 007)                                        |
| 4 — Preparación de integración | COMPLETADA | `INTEGRATION_MAP.md`: servicios, owners, dependencias                                                                |
| 5 — Documentación y onboarding | COMPLETADA | `PROJECT_CONTEXT`, `AGENTS`, `CONTRIBUTING`, plantilla de PR, auditoría de secretos                                  |
| 6 — Cierre para publicación    | **ACTUAL** | Tabla oficial de HU en el repo, C1–C6 resueltos, C2 implementado (migración 008), datos demo ficticios               |
| Publicación en GitHub          | PENDIENTE  | Requiere: licencia acordada, merge a `main`, limpieza de identidad Git; lo ejecuta Jorge                             |
| Backend                        | PENDIENTE  | Empezar por `AuthService` (Joss, C5) y cobranza                                                                      |
| API                            | PENDIENTE  | Según [`api-contract.md`](database/api-contract.md)                                                                  |
| Integración frontend ↔ API     | PENDIENTE  | Incluye los cambios de TS de `INTEGRATION_MAP.md` § 4 y borrar `MockDb`                                              |
| HU de Joss, Armando y Dani     | PENDIENTE  | Según [`USER_STORIES.md`](requirements/USER_STORIES.md); tablas faltantes en [`OWNERSHIP.md`](database/OWNERSHIP.md) |
| Pruebas E2E                    | PENDIENTE  | —                                                                                                                    |
| Deployment                     | PENDIENTE  | —                                                                                                                    |

## Decisiones no bloqueantes (se toman cuando toque)

- Folios de recibo con o sin huecos.
- Cancelación de cargos.
- C7: reglas de edad de categorías.
- **Licencia del repositorio:** se recomienda MIT, pero requiere acuerdo de los cuatro autores antes de agregar `LICENSE`.

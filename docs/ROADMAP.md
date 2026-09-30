# Roadmap

Fuente de verdad de las fases. Última actualización: 2026-09-30.

| Fase                                 | Estado     | Resultado                                                                                                      |
| ------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------- |
| 1 — Arquitectura frontend            | COMPLETADA | Angular por dominio, RBAC por permisos, UI de las historias de Borrayo con `MockDb`                            |
| 2 — Auditoría                        | COMPLETADA | Separación Enrollment ≠ PlayerCategory, contrato de pagos, RBAC probado ruta por ruta, correcciones responsive |
| 3 — Base de datos                    | COMPLETADA | PostgreSQL 16: migraciones, seed, pruebas de integridad, consultas críticas                                    |
| 3.5 — Contrato de datos              | COMPLETADA | `DATA_CONTRACT.md`, `OWNERSHIP.md`, cuadre de uniformes en BD (migración 007)                                  |
| 4 — Preparación de integración       | COMPLETADA | `INTEGRATION_MAP.md`: servicios, owners, dependencias, decisiones C1–C7                                        |
| 5 — Documentación y onboarding       | **ACTUAL** | `PROJECT_CONTEXT`, `AGENTS`, `CONTRIBUTING`, plantilla de PR, auditoría de secretos                            |
| Revisión del equipo y merge a `main` | PENDIENTE  | Hoy `main` sólo tiene el scaffold; el trabajo está en `borrayo/base-arquitectura` y `borrayo/database`         |
| Decisiones bloqueantes (C1–C6)       | PENDIENTE  | Ver [`INTEGRATION_MAP.md` § 1](INTEGRATION_MAP.md)                                                             |
| Backend                              | PENDIENTE  | Empezar por autenticación (C5) y cobranza                                                                      |
| API                                  | PENDIENTE  | Según [`api-contract.md`](database/api-contract.md)                                                            |
| Integración frontend ↔ API           | PENDIENTE  | Incluye los cambios de TS de `INTEGRATION_MAP.md` § 4 y borrar `MockDb`                                        |
| Módulos de los demás integrantes     | PENDIENTE  | Jugadores, categorías, competencias, agenda, captura de pagos                                                  |
| Pruebas E2E                          | PENDIENTE  | —                                                                                                              |
| Deployment                           | PENDIENTE  | —                                                                                                              |

## Decisiones no bloqueantes (se toman cuando toque)

- Folios de recibo con o sin huecos.
- Cancelación de cargos.
- C7: reglas de edad de categorías.
- **Licencia del repositorio:** se recomienda MIT, pero requiere acuerdo de los cuatro autores antes de agregar `LICENSE`.

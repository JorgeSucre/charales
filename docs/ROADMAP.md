# Roadmap

Fuente de verdad de las fases. Última actualización: 2026-10-07 (`main` local en `18178ba`).

| Fase                           | Estado     | Resultado                                                                                                                                                                                              |
| ------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 — Arquitectura frontend      | COMPLETADA | Angular por dominio, RBAC por permisos, UI de las historias de Borrayo con `MockDb`                                                                                                                    |
| 2 — Auditoría                  | COMPLETADA | Separación Enrollment ≠ PlayerCategory, contrato de pagos, RBAC probado ruta por ruta, correcciones responsive                                                                                         |
| 3 — Base de datos              | HISTÓRICA  | PostgreSQL 16 (diseño previo); reemplazado por el modelo MariaDB adoptado en la fase 7                                                                                                                 |
| 3.5 — Contrato de datos        | COMPLETADA | `DATA_CONTRACT.md`, `OWNERSHIP.md`, cuadre de uniformes en BD (migración 007)                                                                                                                          |
| 4 — Preparación de integración | COMPLETADA | `INTEGRATION_MAP.md`: servicios, owners, dependencias                                                                                                                                                  |
| 5 — Documentación y onboarding | COMPLETADA | `PROJECT_CONTEXT`, `AGENTS`, `CONTRIBUTING`, plantilla de PR, auditoría de secretos                                                                                                                    |
| 6 — Cierre para publicación    | COMPLETADA | Tabla oficial de HU en el repo, C1–C6 resueltos, C2 implementado (migración 008), datos demo ficticios                                                                                                 |
| 7 — Backlog sobre MariaDB      | COMPLETADA | 76 HU sobre `MockDb` con el modelo de `docs/escuela_futbol_mariadb.sql` ([`TRACEABILITY.md`](TRACEABILITY.md))                                                                                         |
| 8 — Auditoría de verificación  | COMPLETADA | Veredicto GO WITH FIXES: autorización sólo en rutas, verificador 14/21, estados de HU sobreestimados                                                                                                   |
| 9 — Correcciones de auditoría  | COMPLETADA | Autorización en servicios, integridad 21/21, HU parciales, rendimiento medido, respaldo reproducible                                                                                                   |
| 10 — Matriz de roles (D12)     | COMPLETADA | Administrador = sistema, Secretaría = operación; sin escalada por perfiles vinculados (`18178ba`, [`AUTHORIZATION.md`](AUTHORIZATION.md))                                                              |
| 11 — Documentación de handoff  | **ACTUAL** | [`DEVELOPMENT.md`](DEVELOPMENT.md), [`ARCHITECTURE.md`](ARCHITECTURE.md) y documentos sincronizados con el código                                                                                      |
| Publicación en GitHub          | PENDIENTE  | `LICENSE` (MIT) ya está en el repo (`69ac519`). `main` local en `18178ba` sin publicar (`origin/main` en `47b926c`); falta llevarlo a `origin` por PR y la limpieza de identidad Git; lo ejecuta Jorge |
| Backend / API MariaDB          | PENDIENTE  | Tras el GO: [`MARIADB.md`](database/MARIADB.md) § 8, [`AUTHORIZATION.md`](AUTHORIZATION.md), [`DOMAIN_RULES.md`](DOMAIN_RULES.md)                                                                      |
| Integración frontend ↔ API     | PENDIENTE  | Sustituir `MockDb` por `HttpClient` servicio por servicio; las páginas no cambian                                                                                                                      |
| Revisión de HU por responsable | PENDIENTE  | Implementación base hecha; cada integrante valida sus HU y las decisiones D2/D3 (`MARIADB.md` § 4)                                                                                                     |
| Pruebas E2E                    | PENDIENTE  | Playwright; plan en [`TESTING.md`](TESTING.md)                                                                                                                                                         |
| Deployment                     | PENDIENTE  | —                                                                                                                                                                                                      |

## Decisiones no bloqueantes (se toman cuando toque)

- Folios de recibo con o sin huecos.
- C7: reglas de edad de categorías.

(La cancelación de cargos quedó decidida en D12: Secretaría cancela cargos **sin pagos**; revertir pagos es del
Administrador.)

## Limitaciones conocidas y siguiente fase

Ninguna es un error crítico: son pendientes acordados para fases posteriores.

| Prioridad      | Pendiente                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Siguiente fase | **API/backend** sobre el modelo MariaDB e integración frontend ↔ API ([`database/MARIADB.md` § 8](database/MARIADB.md)). Hoy no existe             |
| P2             | `categorias.temporada_id` NOT NULL (HU-015; hoy la unicidad sin temporada la aplica la app, D4/R12)                                                |
| P2             | `autorizada_por` en la excepción de edad/cupo (HU-017; hoy queda en `historial_categoria.cambiado_por` y en `auditoria`)                           |
| P2             | Relación N:M `sesion_entrenador` (principal y auxiliares; hoy `sesiones_entrenamiento.entrenador_id` único)                                        |
| P2             | Sede obligatoria en partidos (HU-037; hoy `partidos.sede_id` es opcional)                                                                          |
| P2             | Validación visual del responsive en navegador (HU-071)                                                                                             |
| P2             | Pruebas E2E en navegador ([`TESTING.md`](TESTING.md))                                                                                              |
| P3             | `asistencias.crear` existe en el catálogo de permisos, pero ningún servicio lo verifica (la captura usa `asistencias.editar`)                      |
| Nota           | Una sesión abierta con una versión anterior a `18178ba` no tiene `officePermissions`: al recargar se descarta y el usuario vuelve a iniciar sesión |

## Notas de historial Git

- El commit `02d9e3f` («incorporate open fixes from PRs #1-#4») dice tener el mismo contenido que la unión de las cuatro
  ramas `borrayo/fix/*`; la auditoría del 2026-10-07 encontró 2 líneas de documentación distintas, venidas del working
  tree local: `PROJECT_CONTEXT.md` («35 pruebas» en vez de «32») y `docs/database/README.md` (`001_…008`, cuando
  también existe 009). El código es idéntico. No se reescribe la historia; el estado vigente está corregido en commits
  posteriores.
- Los commits de la fase 7 se separaron por dominio, pero no compilan individualmente; sólo la punta de la rama.

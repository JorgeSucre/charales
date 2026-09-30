# Plan — fase 1 (Borrayo)

## Qué existía (auditoría 2026-09-30)
- Scaffold limpio de Angular 22.2 (standalone, zoneless, `@angular/build`), TypeScript 6 (strict por defecto), CSS plano.
- Tests: Vitest 5 vía `ng test` (jsdom). 1 spec de ejemplo.
- Sin rutas, sin servicios, sin entornos, sin backend, sin configuración de agentes.
- Git: un solo commit `initial commit`.
- El Markdown de historias de usuario **no está en el repo**; se usó la lista de historias del encargo.

## Qué se construye
- `core/models`: contratos compartidos agrupados por dominio (personas, deportivo, cobranza, uniformes).
- `core/auth`: sesión mock, roles → permisos, guard por permiso.
- `core/data/mock-db.ts`: **único** lugar con datos simulados. Los servicios son la única capa que lo toca.
- `features/*`: una carpeta por dominio con servicio + páginas (lazy routes).
- Reglas de negocio puras (`billing.rules.ts`) con pruebas.
- Layout con navegación filtrada por permisos, responsive.

## Fuera de alcance (deliberado)
- Backend, BD, autenticación real, hashing de contraseñas (HU-072 se cumple en el backend; el front sólo nunca guarda/transmite contraseñas en claro fuera de HTTPS).
- Registro de pagos en caja, alta/edición de jugadores, asistencias, evaluaciones y demás historias de Joss, Armando y Dani.
  `PlayerService` es de sólo lectura y existe únicamente como contrato compartido.
- `environments/`: se agregan cuando exista una URL de API.
- E2E, CI/CD, Docker.

## Decisiones
- **Inscripción = asignación jugador–categoría por temporada.** No hay entidad `JugadorCategoría` separada: `Enrollment` ya la representa.
- **Dinero en centavos (`number` entero)** para evitar errores de coma flotante.
- **Cargo ≠ Pago.** Se relacionan por `PaymentApplication` (permite pagos parciales y trazabilidad). El saldo siempre se calcula, nunca se guarda.
- **Pedido de uniforme** guarda `unitPriceCents` por línea (precio histórico) y genera un `Charge` (HU-054).
- Servicios con métodos `async` (Promise): al conectar la API se cambian por `firstValueFrom(http.get(...))` sin tocar la UI.
- Código en inglés, UI en español.

## Estado de historias de Borrayo (fase 1)
| HU | Estado | Dónde |
|---|---|---|
| 004 Usuarios | Implementada (mock) | `features/users` |
| 005 Contraseñas | UI implementada; envío real de correo/cambio → backend | `features/auth/password.pages.ts` |
| 072 Seguridad | Preparada: guards + permisos; hashing/tokens → backend | `core/auth` |
| 011 Tutores | Implementada (alta; edición pendiente) | `features/tutors` |
| 018 Grupos | Implementada | `features/categories` |
| 020 Inscripción | Implementada (alta; cancelación pendiente) | `features/enrollments` |
| 022 Entrenadores | Implementada (alta) | `features/coaches` |
| 026 Asignación a torneos | Implementada | `features/coaches` |
| 043 Conceptos | Implementada | `features/billing` |
| 044 Mensualidades | Implementada (idempotente) | `features/billing` |
| 048 Recibos | Implementada (consulta + imprimir) | `features/billing` |
| 050 Adeudos | Implementada | `features/billing` |
| 052 Catálogo | Implementada (alta) | `features/uniforms` |
| 053 Pedidos | Implementada | `features/uniforms` |
| 054 Pago uniforme | Implementada: el pedido crea un `Charge` | `features/uniforms` |
| 055 Entrega | Implementada | `features/uniforms` |
| 056 Consulta tutor | Implementada | `features/parent-portal` |
| 063 Torneos (tutor) | Implementada | `features/parent-portal` |
| 067 Reporte ingresos | Implementada | `features/reports` |
| 068 Agenda global | Implementada (filtros tipo/categoría) | `features/reports` |
| 070 Temporadas | Implementada | `features/seasons` |
| 074 Pruebas | 21 pruebas: RBAC, reglas de cobro, flujos de servicio, smoke de rutas | `*.spec.ts` |

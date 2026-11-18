# Verificación posterior a la integración — PR #24 y PR #25

| Dato              | Valor                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Fecha             | 2026-11-02                                                                                                                            |
| Commit verificado | `0e6a1d3146371a9309de2c42e63798db5e469388` (`origin/main`, merge de la PR #25)                                                        |
| Entorno           | Worktree aislado (detached) `charales-wt/verificacion-post-merge`; MariaDB local; las pruebas crean y borran sus propias bases `ef_*` |
| Tipo              | Sólo lectura. El único archivo creado es este informe; no se hicieron commits, push, ramas ni migraciones                             |

## A. Dictamen ejecutivo

| Pregunta                                | Respuesta                                                                                                                                                                                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ¿La PR #24 está bien integrada?         | **Sí.** El merge `a15383d` contiene exactamente su head `c864cf3` (`git diff a15383d^2 a15383d` vacío) y sólo cambia la aserción de `e2e/app.e2e.ts`                                                                                                                                  |
| ¿La PR #25 está bien integrada?         | **Sí.** El merge `0e6a1d3` es la unión de `12f2173` y la #24. La única diferencia entre `12f2173` y `0e6a1d3` es `e2e/app.e2e.ts`, que aporta la #24                                                                                                                                  |
| ¿`main` está sincronizado?              | **`origin/main` sí; el `main` local no.** Está en `71e7d1d`, 32 commits atrás y 0 adelante. No está activo en ningún worktree y no se actualizó (auditoría de sólo lectura). El repositorio principal está en `backup/wip-2026-10-27`, limpio                                         |
| ¿La documentación y el Excel coinciden? | **Sí, con la copia externa.** El Excel **no está versionado en el repositorio**. La copia de `~/Downloads` (SHA-256 `a4ae154f…`) coincide con `USER_STORIES.md` en las 76 HU (criterios, estado y responsable). No se puede afirmar que sea la copia que el equipo tiene sincronizada |
| ¿Las pruebas están verdes?              | **Sí.** Typecheck, build, Prettier, `git diff --check`, pantalla 247/247, API 198/198 y E2E 19/19                                                                                                                                                                                     |

No hay hallazgos bloqueantes. Las observaciones están en la § F.

## B. Resultados por PR

### PR #24 — D-01 (E2E del Tablero)

- **Commit de integración:** `a15383decb5e3695b97da7c02f79c9042e138044` (2026-11-02T17:01:59Z), con el head `c864cf3`. Es ancestro de `origin/main`.
- **Archivos:** `e2e/app.e2e.ts`, +2 / −1: un comentario y la expresión regular. No se tocó código del Tablero ni la lógica de fechas (`git diff b7cc137 a15383d --stat` sólo muestra ese archivo).
- **Aserciones:** se conservan todas las de la prueba (barras, sin «Otros módulos», 7 accesos rápidos, monto que cabe). Sólo cambia la expresión del texto del periodo.
- **Expresiones:** se extrajeron de Git (`b7cc137` y `0e6a1d3`) y se compararon con la salida real de `dateRangeLabel` (`src/app/shared/dates.ts` en `0e6a1d3`), para cada día de 2026 con el periodo «del día 1 del mes a hoy»:

  | Comprobación                                                                                                                                                    | Resultado                                                                    |
  | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
  | Expresión anterior                                                                                                                                              | Falla 12 de 365 días: exactamente los días 1, de `2026-01-01` a `2026-12-01` |
  | Expresión nueva                                                                                                                                                 | 0 fallos                                                                     |
  | Formatos de intervalo (`del 15 de septiembre al 21 de octubre de 2026`, `del 15 de diciembre de 2025 al 21 de enero de 2026`, `del 1 al 13 de octubre de 2026`) | Aceptados                                                                    |
  | Textos ajenos («Ingresos del periodo $0.00», «No disponible», «Temporada 2026-2027»)                                                                            | No coinciden                                                                 |

  No se cambió la fecha del sistema ni la lógica de la aplicación.

- **Problemas:** ninguno bloqueante. Hay un debilitamiento mínimo e informativo (§ F, N-01).

### PR #25 — Documentación del cierre condicionado

- **Commit de integración:** `0e6a1d3146371a9309de2c42e63798db5e469388` (2026-11-02T17:02:13Z), con el head `12f2173`.
- **Archivos (11):**
  - `docs/requirements/USER_STORIES.md`
  - `docs/DOMAIN_RULES.md`
  - `docs/TRACEABILITY.md`
  - `docs/ROADMAP.md`
  - `docs/API.md`
  - `docs/DEVELOPMENT.md`
  - `docs/database/DATA_CONTRACT.md`
  - `docs/database/MARIADB.md`
  - `docs/audits/AUDITORIA_FINAL_JORGE_LUIS_BORRAYO.md` (nuevo)
  - `api/hu-045.test.ts` y `db/mariadb/migrations/004_pago_referencia.sql`, sólo en comentarios
- **Comportamiento:** no cambia código. Los dos comentarios no alteran la ejecución: `db:setup` vuelve a aplicar las migraciones (que se pueden aplicar varias veces) y no guarda checksum, y la prueba de la migración 004 descarta las líneas `--`.
- **Problemas:** la PR afirma que ninguna prueba fija que un jugador en baja temporal conserva su cupo (HU-021), y eso **no es exacto** (§ E, M-01). Hay además otras observaciones menores (§ F).

**Nota:** el encargo cita `ROADMAP.md` en la raíz. En el repositorio el archivo es `docs/ROADMAP.md`; en la raíz no existe.

## C. Matriz documental

| Archivo                                                                                       | Estado            | Evidencia                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Contradicciones                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/requirements/USER_STORIES.md`                                                           | ✔                 | Hay 76 HU, 49 de ellas de Jorge Luis Borrayo De Anda, todas en «Terminado»; las otras 27 siguen en «Pendiente». HU-045 tiene 5 criterios. La nota del 2026-11-02 cita el respaldo del Excel. Ya no existe la sección «Cambios propuestos pendientes de ratificación»                                                                                                                                                                                                                                                                | Ninguna                                                                                                                                                                              |
| Excel (`~/Downloads/Product_Backlog_Escuela_Futbol_Infantil.xlsx`, **fuera del repositorio**) | ✔ copia externa   | 76 HU; 49 en «Terminado»; el criterio 5 de HU-045 presente; coincide celda por celda con `USER_STORIES.md`. Respaldo `…_respaldo-2026-11-02.xlsx` (SHA-256 `4d6ea395…`) presente. No se modificó                                                                                                                                                                                                                                                                                                                                    | No versionado (§ F, I-01)                                                                                                                                                            |
| `docs/DOMAIN_RULES.md`                                                                        | ✔ con observación | R22 «ratificado el 2026-11-02: DP-01». R23 recoge DP-02 como decisión aprobada                                                                                                                                                                                                                                                                                                                                                                                                                                                      | La columna «Prueba» de R23 dice «Sin prueba que fije el caso de la baja temporal», y es inexacto (M-01)                                                                              |
| `docs/TRACEABILITY.md`                                                                        | ✔ con observación | Hay una sección «Cierre condicionado 2026-11-02» con DP-01 a DP-05. HU-021 está «Completa» con DP-02, sin «Decisión pendiente». HU-032 dice «Completa; C4 diferido» y «Exportación diferida como mejora futura (DP-03)». HU-045 tiene los criterios 1–5. HU-076 indica 40/40 tablas. Dice «No autoriza producción» y lista S-01 a S-04 y P-01 a P-07. La sección del 29 de octubre se conserva como historia, con su evidencia (`database/evidence/tests-2026-10-29.txt`, presente), y sus totales apuntan al cierre del 2026-11-02 | La fila de HU-021 dice «Falta una prueba que fije el caso…» (M-01)                                                                                                                   |
| `docs/ROADMAP.md`                                                                             | ✔ con observación | Ya no afirma el cierre del 29 de octubre: dice «cierre condicionado» y «No autoriza producción». Lista explícitamente B-2/PR #17, S-01, S-02, S-04, Resend sin configurar y HU-032.4 diferido. Remite a la auditoría § 5 y § 10                                                                                                                                                                                                                                                                                                     | P-01, P-03, P-05, P-06 y P-07 sólo aparecen por referencia (M-02)                                                                                                                    |
| `docs/API.md`                                                                                 | ✔                 | Resend aparece como elegido y «sin implementar»: dominio, DNS, clave como variable de entorno del servidor y prueba real son tareas de despliegue. No hay credenciales. La tabla de «Producción» mantiene HTTPS y cookie, IP real tras el proxy, `event_scheduler`, instancias y respaldo                                                                                                                                                                                                                                           | Ninguna                                                                                                                                                                              |
| `docs/DEVELOPMENT.md`                                                                         | ✔                 | La nota de ocupación del Tablero recoge DP-02 y R23                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Ninguna                                                                                                                                                                              |
| `docs/database/DATA_CONTRACT.md`, `docs/database/MARIADB.md`                                  | ✔                 | HU-045, criterio 5, «ratificado el 2026-11-02»                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Ninguna                                                                                                                                                                              |
| `docs/audits/AUDITORIA_FINAL_JORGE_LUIS_BORRAYO.md`                                           | ✔ con observación | El cuerpo del 2026-11-01 está intacto y hay una «Adenda 2026-11-02» con 49 HU completas y 0 parciales                                                                                                                                                                                                                                                                                                                                                                                                                               | El cuerpo conserva el dictamen anterior (HU-021 PARCIAL, criterio 5 sin ratificar) sin aviso al inicio de que la adenda lo actualiza (M-03). La adenda repite la inexactitud de M-01 |

**Comprobaciones transversales:**

- No queda ningún «pendiente de ratificación» ni «pending ratification» fuera del cuerpo histórico del informe de auditoría (`git grep`).
- **Enlaces:** 244 enlaces relativos de `docs/` y la raíz, anclas incluidas, resuelven (script de comprobación en la carpeta temporal de la sesión).
- **Credenciales:** `git grep` de claves (`re_…`, `RESEND_API_KEY=`, `api_key=`) no encuentra nada. Resend sólo aparece en la documentación.

## D. Resultados de pruebas

Commit `0e6a1d3`, 2026-11-02, macOS, Node 26, MariaDB local.

| Comando                                           | Hora              | Resultado                                  | Anterior (auditoría del 2026-11-01, `b7cc137`) |
| ------------------------------------------------- | ----------------- | ------------------------------------------ | ---------------------------------------------- |
| `npm ci`                                          | 11:05:49–11:05:53 | OK                                         | OK                                             |
| `npm run api:typecheck`                           | 11:05:53–11:05:55 | OK                                         | OK                                             |
| `npm run build`                                   | 11:05:55–11:06:00 | OK                                         | OK                                             |
| `npx prettier --check .`                          | 11:06:00–11:06:04 | OK                                         | OK                                             |
| `npx prettier --check e2e/app.e2e.ts`             | 11:06:04          | OK                                         | —                                              |
| `git diff --check b7cc137 a15383d` (PR #24)       | 11:06:04          | OK                                         | —                                              |
| `git diff --check b7cc137 0e6a1d3` (PR #24 y #25) | 11:06:04          | OK                                         | —                                              |
| `npx ng test --watch=false`                       | 11:06:04–11:08:04 | **247/247** (20 archivos)                  | 247/247                                        |
| `npm run api:test`                                | 11:08:04–11:08:28 | **198/198**                                | 198/198                                        |
| `npm run e2e`                                     | 11:08:28–11:09:24 | **19/19**                                  | 18/19 (D-01)                                   |
| Comprobación día por día de las expresiones (§ B) | 11:12 aprox.      | Anterior: 12 fallos (los días 1); nueva: 0 | —                                              |

**Limitaciones:**

- Hoy es día 2, así que la E2E no ejerce el caso del día 1 con el reloj real. La comprobación día por día con el formateador real sí lo cubre.
- No se hizo inspección visual manual.
- No se ejecutaron `db:mariadb:test-backup` ni Postman, porque no estaban en el encargo y la PR #25 no toca código ni esquema.
- **Bases:** la lista de bases es idéntica antes y después de la auditoría; las pruebas borraron las `ef_*` temporales que crearon. Los checksums de `escuela_futbol.pagos`, `jugadores` y `usuarios` no cambiaron.

## E. HU-021 — prueba de regresión de la baja temporal

**La prueba no falta del todo.** La documentación, la auditoría anterior y la PR #25 dicen que no existe ninguna, y eso es inexacto.

**Cobertura existente:** `api/hu-criterios.test.ts:576`, «HU-018.1/4: the group lists only active players, and its total is the number listed». Pasó hoy, sobre la API y MariaDB:

1. Inscribe a un jugador nuevo en la categoría 3 y comprueba que es integrante.
2. Lo pasa a `BAJA_TEMPORAL` y comprueba que ya no aparece en el grupo (HU-018).
3. Comprueba que `CategoryService.list` da `occupancy = integrantes activos + 1`: **el jugador en baja temporal sigue ocupando cupo.**

Su comentario (línea 594) todavía dice «whether a temporary leave keeps its slot is a pending decision». Quedó desactualizado con DP-02.

**El código:** `CategoryService.occupancy()` (`src/app/core/services/category.service.ts:196`) cuenta las inscripciones sin `endDate`. Cambiar el estatus a baja temporal no cierra la inscripción, según la prueba anterior.

**Lo que falta, frente a los cuatro puntos pedidos:**

| Punto                                  | Cubierto hoy                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| 1. Una inscripción vigente ocupa plaza | Sí, de forma indirecta (`members` la incluye)                                       |
| 2. En baja temporal sigue ocupándola   | Sí, de forma indirecta (`occupancy = activos + 1`)                                  |
| 3. La ocupación no disminuye           | No se compara la ocupación antes y después                                          |
| 4. El límite de cupo sigue funcionando | **No** hay ninguna prueba con un jugador en baja temporal que ocupe la última plaza |

**Prueba recomendada** (no escrita): en `api/hu-fase2.test.ts`, junto a la prueba de HU-017/021 que ya usa `full`, `occupancy` y `capacity` (alrededor de la línea 600), un caso «HU-021 (DP-02): a player on temporary leave keeps their slot» que:

1. llene una categoría de cupo N con jugadores activos y lea `occupancy = N`, `full = true`;
2. pase a uno a `BAJA_TEMPORAL` y compruebe que `occupancy` sigue en N y `full` sigue en `true`;
3. compruebe que asignar un jugador nuevo sin `exceptionReason` se rechaza por cupo y que, con una excepción autorizada, se acepta.

Además, conviene actualizar el comentario de `api/hu-criterios.test.ts:594` y las menciones «sin prueba» de R23, de `TRACEABILITY.md` y de la adenda.

## F. Hallazgos

### Bloqueantes

Ninguno.

### Importantes

- **I-01 · El Excel oficial no está versionado.**
  - **Situación:** la fuente formal del cierre (49 HU en «Terminado») vive fuera del repositorio. La única copia disponible es la de `~/Downloads`, que coincide con `USER_STORIES.md`, pero desde el repositorio no se puede comprobar que sea la que comparte el equipo.
  - **Recomendación:** acordar dónde vive la copia oficial (unidad compartida, o versionarla en `docs/requirements/` si el equipo lo acepta) y guardar su hash junto a la transcripción.

### Menores

- **M-01 · La prueba de HU-021 está mal documentada.**
  - **Situación:** R23 (`DOMAIN_RULES.md`), la fila de HU-021 en `TRACEABILITY.md`, la adenda de la auditoría y la descripción de la PR #25 dicen que no hay prueba, pero `api/hu-criterios.test.ts:576` cubre los puntos 1 y 2 (§ E). Su comentario de la línea 594 sigue diciendo «pending decision».
  - **Impacto:** se subestima la cobertura; no tiene efecto funcional.
- **M-02 · El ROADMAP no enumera todas las dependencias de producción.**
  - **Situación:** `docs/ROADMAP.md` lista S-01, S-02, S-04, B-2 y Resend, pero P-01 (migrar las bases existentes), P-03 (TLS, CSP, HSTS, `frame-ancestors`, proxy de confianza), P-05 (`event_scheduler`), P-06 (respaldos programados) y P-07 (una sola instancia) sólo aparecen por referencia a la auditoría § 10.
  - **Parcialmente cubierto:** `API.md` § Producción cubre HTTPS y cookie, IP real, `event_scheduler`, instancias y respaldo. **CSP, HSTS y `frame-ancestors` sólo constan en la auditoría.**
  - **Lo que no se afirma:** nada de esto figura como resuelto, y ninguna configuración externa aparece como activa.
- **M-03 · El informe de auditoría no avisa de su adenda al inicio.**
  - **Situación:** el cuerpo de `AUDITORIA_FINAL_JORGE_LUIS_BORRAYO.md` (§ 1 y § 12) sigue diciendo «HU-021 PARCIAL» y «criterio 5 no ratificado». La adenda que lo actualiza está al final, sin una nota al principio.
  - **Riesgo:** quien lea sólo el resumen ejecutivo puede quedarse con el dictamen superado.
- **M-04 · El `main` local está desactualizado.**
  - **Situación:** `71e7d1d`, 32 commits por detrás de `origin/main`, sin commits propios y sin uso en ningún worktree.
  - **Riesgo:** confusión si alguien crea una rama desde `main` en lugar de desde `origin/main`.

### Informativos

- **N-01 · La expresión de la PR #24 admite «el N de …» cualquier día.** Con la nueva expresión, un formateador defectuoso que escribiera «el 15 de …» el día 15 también pasaría. El riesgo es bajo: `dateRangeLabel` sólo produce esa forma con `from === to`, y su lógica tiene sus propias pruebas. Si se quisiera una aserción exacta, la prueba podría calcular el texto esperado con la fecha del día.
- **N-02 · Estado técnico frente a estado formal.** La tabla «Resumen» de `TRACEABILITY.md` dice «Completada: 76» (estado técnico, con evidencia del 2026-10-15), mientras que el Excel tiene 27 HU en «Pendiente». El documento lo explica: son las HU sin responsable, pendientes de su propia verificación. No es una contradicción del cierre de las 49.
- **N-03 · Seguridad y producción, sin cambios.** S-01 a S-04 y P-01 a P-07 siguen abiertos y visibles: `TRACEABILITY.md` dice «No autoriza producción», `ROADMAP.md` lo dice en la fila de la siguiente fase, y la auditoría tiene las § 5, § 10 y § 12. **Ningún documento los marca como resueltos.** La PR #17 sigue abierta.
- **N-04 · Resend no está implementado.** `password.mailerFromEnv` sigue teniendo sólo el transporte de consola de desarrollo.

## G. Estado final del proyecto

1. **Cierre de las 49 HU: correcto con observaciones.**
   - Las 49 están en «Terminado» en el Excel disponible y en `USER_STORIES.md`.
   - Las decisiones DP-01 a DP-05 aparecen de forma coherente en todos los documentos revisados.
   - HU-021 ya no aparece a la vez como completa y pendiente; HU-032 tiene la exportación diferida; HU-045 tiene 5 criterios; HU-076 indica 40 tablas.
   - Las pruebas están verdes (E2E 19/19).
   - Observaciones: I-01, M-01, M-03.
2. **Preparación para producción: no preparado.**
   - Siguen abiertos S-01 (fuerza bruta en el login), S-02 (Argon2id), S-03 (PR #17) y S-04 (dependencias).
   - Siguen abiertas las dependencias P-01 a P-07, entre ellas Resend sin configurar, TLS y encabezados, y la migración 004 en las bases existentes.

## H. Próximos pasos (no ejecutados)

1. Decidir dónde vive la copia oficial del Excel y registrar su hash (I-01).
2. **PR menor de documentación y pruebas:**
   - agregar la prueba de HU-021 de la § E en `api/hu-fase2.test.ts`;
   - actualizar el comentario de `api/hu-criterios.test.ts:594`;
   - corregir «sin prueba» en R23, en `TRACEABILITY.md` y en la adenda (M-01);
   - agregar una nota al inicio del informe de auditoría que remita a la adenda (M-03);
   - enumerar P-01, P-03 y P-05 a P-07 en `ROADMAP.md` (M-02).
3. Actualizar el `main` local con `git fetch` + `git branch -f main origin/main`, que no toca ningún árbol de trabajo, o crear siempre las ramas desde `origin/main` (M-04).
4. Seguir el plan de cierre:
   - PR de seguridad S-01, S-02 y S-03, que incluye actualizar las expresiones de la PR #17 a los mensajes de la § 5.1;
   - PR de dependencias S-04;
   - infraestructura P-01 a P-07, con validación independiente.
5. Antes de cualquier despliegue, respaldar y luego ejecutar `npm run db:setup` en cada base existente (P-01).

# Auditoría de despliegue y simulación VPS AlmaLinux — Charales

**Fecha:** 17-nov-2026 · **Entorno:** AlmaLinux 9.9 limpio en contenedor con systemd (Docker/Colima, macOS arm64),
datos ficticios · **Manual resultante:** [`DEPLOY-ALMALINUX.md`](DEPLOY-ALMALINUX.md) · **Artefactos y evidencias:**
`ARTEFACTOS-DESPLIEGUE/` (sin seguimiento en Git; no versionar los ZIP).

## Dictamen

**APROBADO CON LIMITACIONES** para un ensayo en el servidor institucional, con el frontend **corregido**
(`3a15ff7c…`). El frontend compilado tal cual (`4179d92b…`) **no** debe desplegarse (F-01).

Limitaciones que deben cerrarse en ese ensayo o antes de producción: HTTPS con certificado real (G.3), SELinux en
`Enforcing` (F-07), correo real con Resend (F-08), trazabilidad del paquete a un commit (F-03) y la etiqueta «DEMO»
(F-04).

## 1. Identificación de los paquetes

| Paquete                     | Ruta / origen                                                                            | Fecha                          | Tamaño      | SHA-256                                                            | Commit de origen                 |
| --------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------ | ----------- | ------------------------------------------------------------------ | -------------------------------- |
| Backend                     | `~/Downloads/backend-charales.zip` (idéntico byte a byte a `backend-charales1.zip`)      | Descarga 17-nov 07:36; contenido 6–10-nov | 1 032 214 B | `e6a57f37cb77af7004476fba69f880b2f18727ed1d6965e6b5eabca0164e07dc` | **No determinable** (F-03)       |
| Frontend (tal cual)         | Compilado en este ensayo desde `src/` del backend + `angular.json`, `tsconfig.app.json`, `public/` de `origin/main` (`9e08b11`) | 17-nov 07:43 | 299 715 B | `4179d92b57c91dab72d6afcaf683c135c8efed0c26ae9d6e7d1afabe258eddda` | El del backend + `origin/main` |
| Frontend (corregido)        | Igual, con `inlineCritical: false` (`ARTEFACTOS-DESPLIEGUE/angular.json.corregido`)       | 17-nov 07:45                   | 299 157 B   | `3a15ff7c5b4d2001c2b19808db9255cb7e7a9236fb8a70d92e6c79c3060bcfd5` | Igual                     |

- **No existía ningún ZIP compilado del frontend** en el proyecto ni en `~/Downloads` (`Interface_charales_1.3.zip`
  es código fuente de una maqueta). Por decisión del responsable se compiló desde el paquete del backend.
- El SHA-256 del backend **no coincide** con el indicado en el encargo (`4cd5e97b…`), y el commit `becbbe39…` y la
  rama `jorgesucre/refactor/scrypt-password-hashes` no existen ni en el clon local ni en `origin`. Por decisión del
  responsable se auditó el paquete `e6a57f37…`.
- Compilación: Node 26.13.1, `npm ci` + `ng build` (producción). Bundle inicial 483,55 kB (presupuesto 500 kB).

## 2–4. Hallazgos

| ID   | Nivel           | Área            | Hallazgo                                                                                                                                                                                                                                                                                                                                                       | Evidencia                                                       | Estado                                                 |
| ---- | --------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| F-01 | **ALTO**        | Compatibilidad  | El `index.html` de producción lleva un `<script>` en línea (carga diferida del CSS crítico de Angular, *beasties*). La CSP del paquete (`script-src 'self'`) lo bloquea: la hoja de estilos se queda en `media="print"` y la app se ve **sin estilos**. Causa: `optimization.styles.inlineCritical` está activo por defecto en `ng build`.                         | Captura en Chrome: `evidencias/original-login.png`              | **Corregido** en el frontend `3a15ff7c…` (`evidencias/corregido-login.png`); falta llevar el cambio a `angular.json` en el repositorio |
| F-02 | **ALTO**        | Reproducibilidad | El paquete no trae `angular.json`, `tsconfig.app.json` ni `public/`: con él no se puede compilar el frontend, aunque `PROCEDIMIENTO_PRODUCCION.md` § 5 indica `npm run build`. El frontend auditado mezcla el `src/` del paquete con la configuración de `origin/main`.                                                                                        | `unzip -l backend-charales.zip`                                  | Pendiente: incluir esos archivos o entregar el frontend ya compilado junto al backend |
| F-03 | MEDIO           | Trazabilidad    | No se puede ligar el paquete a un commit: ningún archivo de control (`api/server.ts`, `package.json`, migración 009) coincide con un objeto de Git conocido, el ZIP no trae manifiesto de versión y su SHA-256 difiere del declarado.                                                                                                                             | `git log --all --find-object=<blob>` vacío                       | Pendiente: publicar la rama/commit y generar el ZIP con un manifiesto (`commit`, fecha, SHA-256) |
| F-04 | MEDIO           | Interfaz        | La etiqueta «DEMO» («Entorno de desarrollo con datos de demostración») aparece **siempre**, también en producción con datos reales (`src/app/layout/shell.ts:94`, sin condición).                                                                                                                                                                                  | `evidencias/ui-3-ruta-interna.png`                               | Pendiente (cambio de código fuera del alcance de esta auditoría) |
| F-05 | MEDIO           | Instalación     | En AlmaLinux 9 los paquetes por defecto no sirven: MariaDB 10.5 (< 10.6), Node 16 (< 24.15) y nginx 1.20 (la plantilla usa `http2 on`, ≥ 1.25.1). El procedimiento del proyecto no dice cómo obtener versiones válidas.                                                                                                                                         | `dnf module list`                                                | Resuelto en el manual: módulos `mariadb:11.8`, `nodejs:24`, `nginx:1.26` (repos oficiales) |
| F-06 | MEDIO           | Instalación     | `curl` choca con `curl-minimal`; `dnf needs-restarting` no está en la imagen mínima. Una primera versión del manual habría reiniciado siempre el servidor: detectado al reejecutarlo.                                                                                                                                                                              | `evidencias/replay-manual.log`                                   | Resuelto en el manual                                   |
| F-07 | MEDIO           | Seguridad       | **SELinux sin probar.** El procedimiento del proyecto no lo menciona; en AlmaLinux `Enforcing` nginx necesita `httpd_can_network_connect` (proxy a :3000) y la etiqueta `httpd_sys_content_t` en `/srv/charales`, o dará 502/403.                                                                                                                                  | `getenforce` = Disabled en el contenedor                          | Documentado en el manual (§ G.4); **validar en el ensayo institucional** |
| F-08 | MEDIO           | Operación       | Sin `RESEND_API_KEY` la API arranca con `MAIL_PROVIDER=none` y las invitaciones y la recuperación de contraseña responden 503. Requiere cuenta y dominio verificado.                                                                                                                                                                                              | Log: `Aviso: MAIL_PROVIDER=none…`                                | Pendiente de decisión institucional                     |
| F-09 | BAJO            | Mantenimiento   | Tras `npm prune --omit=dev` (necesario), `npm run db:setup` y `npm run db:admin` fallan porque recompilan con esbuild.                                                                                                                                                                                                                                         | Ensayo                                                            | Rodeado en el manual: `node api/setup.ts`, `node api/create-admin.ts` |
| F-10 | BAJO            | Interfaz        | La página `/admin/api` (sólo por URL) llama a `/api/jugadores` y `/api/categorias`, que la API desactiva en producción (404).                                                                                                                                                                                                                                       | `curl` → 404                                                      | Pendiente: ocultar la ruta en producción                |
| F-11 | BAJO            | Seguridad       | El bundle incluye el simulador `MockDb` con cuentas `@example.com` y un hash `sha256$charales-demo$…`. No son credenciales válidas contra la API (Argon2id) ni secretos reales, pero es código muerto en producción.                                                                                                                                              | `grep` en `chunk-*.js`                                            | Pendiente (bajo impacto)                                |
| F-12 | BAJO            | Compatibilidad  | Un 429 generado por `limit_req` de nginx tiene cuerpo HTML, no `{ error }`: el frontend mostraría el mensaje genérico en vez de «Demasiados intentos». **Sólo por inspección de código** (el 429 de la API sí se probó y es JSON).                                                                                                                              | `charales-api.service.ts` `ApiError`                               | Pendiente                                               |
| F-13 | BAJO            | Instalación     | `skip-name-resolve` (endurecimiento habitual) rompe las cuentas `@'localhost'` cuando la API conecta a `127.0.0.1`.                                                                                                                                                                                                                                              | Error 1130 en el ensayo                                           | Advertido en el manual                                  |
| F-14 | BAJO            | Respaldos       | El paquete trae el script de respaldo, pero no el temporizador; GPG busca la clave en el `HOME` del trabajo (error `No name`).                                                                                                                                                                                                                                    | Ensayo                                                            | Manual § G.5: unidad + temporizador systemd, probados    |
| F-15 | INFORMATIVO     | BD              | «Migraciones 001–010» = `db/mariadb/migrations/001`–`009` + `db/mariadb/010_permisos_app.sql` (catálogo de permisos). No falta ningún archivo.                                                                                                                                                                                                                  | `api/schema.ts`                                                   | —                                                      |
| F-16 | INFORMATIVO     | Seguridad       | El límite de intentos por cuenta se guarda en MariaDB y **sobrevive a reinicios**; tras 6 fallos, un navegador nuevo recibe 429 hasta que se recupera el cupo. Es el diseño, pero soporte debe conocerlo.                                                                                                                                                        | `limite_acceso` tras reinicio                                     | Documentado en el manual (§ J)                          |
| F-17 | INFORMATIVO     | Empaquetado     | El ZIP incluye `api/.build/` ya compilado (se regenera en la instalación). La rama se llama *scrypt*, pero el código usa Argon2id (`crypto.argon2`).                                                                                                                                                                                                             | `unzip -l`, `api/auth.ts`                                        | —                                                      |
| F-18 | INFORMATIVO     | Documentación   | `CLAUDE.md` dice que `db:mariadb:test-backup` «crea y borra» sus bases; el script las conserva («decisión del 2026-11-05»).                                                                                                                                                                                                                                       | `test-backup-restore.sh`                                          | —                                                      |

### Controles de seguridad verificados (sin hallazgo)

- La API escucha sólo en `127.0.0.1:3000` y MariaDB sólo en `127.0.0.1:3306`; desde otra máquina de la red, ambos
  puertos están cerrados (control: 80 y 443 abiertos).
- El cortafuegos expone sólo `ssh`, `http` y `https`.
- La API corre como `charales` (sin shell), con `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome` y
  `MemoryMax=1G`; `api.env` en modo 640 `root:charales`.
- Cuentas de MariaDB con privilegio mínimo; la API sólo tiene DML (`charales_app`). `root` sólo por socket Unix.
- Cookie `charales_sid`: `HttpOnly; Secure; SameSite=Strict; Path=/`, y no es visible para JavaScript.
- Sin CORS: el frontend usa rutas relativas (`/auth/*`, `/api/rpc`) en el mismo origen; ni `localhost`, ni IP
  privadas, ni URL de API en el bundle.
- Cabeceras CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options` y `Referrer-Policy` en las respuestas.
- `/health` responde 403 desde fuera; `/api/jugadores` responde 404 en producción; un método RPC no expuesto
  responde 404.
- Auditoría con la IP real del cliente (`TRUSTED_PROXIES` correcto), no la del proxy.
- Sin contraseñas en los logs (`/var/log` y `journalctl`) ni en el frontend. Los respaldos se cifran con una clave
  pública y la privada queda fuera del servidor.

## 5. Simulación VPS

| Paso                          | Resultado                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| Sistema                       | AlmaLinux 9.9, imagen `almalinux/9-init`, systemd como PID 1, `dnf update` aplicado             |
| Node.js                       | 24.22.1 (módulo `nodejs:24`)                                                                    |
| MariaDB                       | 11.8.8 (módulo `mariadb:11.8`)                                                                  |
| nginx                         | 1.26.3 (módulo `nginx:1.26`); `nginx -t` correcto con la plantilla del paquete                  |
| firewalld                     | Activo; `http https ssh`                                                                        |
| systemd                       | `charales-api`, `mariadb`, `nginx`, `firewalld`, `charales-respaldo.timer`: activos y habilitados |
| Reejecución literal del manual | En un **segundo** contenedor limpio: completa y sin errores, y 30/30 pruebas E2E (`evidencias/replay-manual.log`) |

**Diferencias con un VPS AlmaLinux real:** contenedor privilegiado en lugar de VM; kernel del host (Linux 6.8,
**aarch64**, mientras que un VPS suele ser x86_64: los paquetes son los mismos, pero los binarios no); **SELinux
deshabilitado**; **sin `sshd`** (el puerto 22 no se probó); TLS con certificado autofirmado y dominio `charales.test`
sin DNS; el reinicio fue `docker restart`, no un arranque de firmware.

## 6. Instalación de MariaDB y base de datos

- Base `charalesdb` (utf8mb4) y cuentas `charales_admin`, `charales_app` y `charales_backup` desde
  `deploy/mariadb/cuentas.sql`, con contraseñas aleatorias generadas dentro del servidor (nunca mostradas).
- `node api/setup.ts` (como `charales_admin`): esquema base, migraciones 001–009 y permisos 010 (106 filas en
  `rol_permiso`). El resultado tiene 46 tablas, el procedimiento `marcar_cargos_vencidos` y el evento
  `ev_cargos_vencidos` en `ENABLED`. **Idempotente:** una segunda ejecución conserva los datos y la matriz.
- Administrador ficticio con `api/create-admin.ts` (como `charales_app`): hash Argon2id; un correo repetido se
  rechaza sin cambiar nada.
- `test-backup-restore.sh`: OK, 46 tablas idénticas.
- Circuito de producción: `respaldo-programado.sh` con `charales_backup` y GPG → descifrado con la clave privada
  «fuera del servidor» → `restore.sh` en una base nueva → `verify-backup.sh`: **idéntico**. `restore.sh` se niega a
  sobrescribir una base existente. El temporizador systemd se ejecutó con `Result=success`.

## 7. Pruebas frontend/API (ejecutadas, no inspeccionadas)

Desde un cliente en otra máquina de la red (`pruebas/e2e-cliente.sh`): **30/30 OK** en el VPS de la auditoría y
**30/30 OK** en el VPS montado con el manual. Incluye: HTTP→HTTPS, `index.html`, *fallback* de rutas de Angular,
404 para un recurso inexistente, cabeceras, `/health` 403, 401 sin sesión, login correcto e incorrecto, atributos de
la cookie, sesión, escritura y lectura por RPC, 404 para métodos no expuestos y para la ruta de laboratorio, logout,
401 tras el logout, y puertos 3000 y 3306 cerrados.

En navegador (Chrome headless por CDP, `pruebas/ui-e2e.mjs`), **8/8 OK** con el frontend corregido:

- una ruta protegida sin sesión lleva a `/login?returnUrl=…`;
- el login desde el formulario funciona;
- la cookie no es accesible desde JavaScript;
- `/admin/players` se abre con sesión;
- una ruta interna recargada conserva la sesión y muestra la sede creada por la API;
- «Salir» devuelve a `/login`, y después la ruta protegida vuelve a pedir sesión;
- la consola no muestra bloqueos de CSP. Sólo aparecen dos 401 esperados de `/auth/session` sin sesión.

Más pruebas ejecutadas:

| Prueba                     | Resultado                                                                 |
| -------------------------- | ------------------------------------------------------------------------- |
| Límite de intentos         | 401 ×5 → 429 al sexto, con mensaje JSON                                    |
| `kill -9` de la API        | systemd la relanza (`NRestarts=1`) y `/health` vuelve a OK                |
| MariaDB detenida           | `/health` responde 503; al arrancarla, se recupera sola                   |
| Reinicio del servidor      | Todos los servicios arrancan solos; la sede creada antes persiste         |
| Actualizar sólo el frontend | Funciona (§ I.3 del manual)                                              |
| Volver atrás de versión    | Funciona (§ I.4 del manual)                                               |

## 8. Pruebas no ejecutadas y motivo

| Prueba                                              | Motivo                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| HTTPS con certificado real y `certbot renew`        | Sin dominio ni DNS; probado con un certificado autofirmado en la misma ruta |
| SELinux `Enforcing`                                 | El contenedor no tiene SELinux                                           |
| Acceso y endurecimiento SSH                         | La imagen no trae `sshd`; fuera del alcance de la simulación             |
| Envío real de correo (invitación, recuperación)     | Sin cuenta de Resend; se probó con `MAIL_PROVIDER=none`                  |
| `create-admin.ts` interactivo (TTY)                 | Se usó la variante no interactiva del mismo código                       |
| Carga real y dimensionamiento                       | Fuera del alcance; sólo hay memoria en reposo                            |
| Arquitectura x86_64                                 | El host del ensayo es arm64                                              |
| Pruebas unitarias del proyecto (`ng test`, `api:test`) | No se pidieron; el encargo indica que `api:build` y `api:typecheck` ya pasaron |

## 9. Archivos creados o modificados

| Archivo                                                    | Acción                                         |
| ---------------------------------------------------------- | ---------------------------------------------- |
| `docs/DEPLOY-ALMALINUX.md`                                  | Creado (manual)                                 |
| `docs/AUDITORIA-DESPLIEGUE-ALMALINUX.md`                    | Creado (este informe)                           |
| `ARTEFACTOS-DESPLIEGUE/frontend-charales.zip`               | Creado: frontend tal cual (**no desplegar**)    |
| `ARTEFACTOS-DESPLIEGUE/frontend-charales-corregido.zip`     | Creado: frontend para despliegue                |
| `ARTEFACTOS-DESPLIEGUE/SHA256SUMS`, `angular.json.corregido` | Creados                                        |
| `ARTEFACTOS-DESPLIEGUE/pruebas/*`, `evidencias/*`           | Guiones de prueba, capturas y log de la reejecución |

No se modificó ningún archivo versionado, ni los ZIP originales (`~/Downloads`), ni la rama (`main`). No hubo
commits ni push. Fuera del proyecto, con aprobación: se instalaron `colima` y `docker` (Homebrew), y existen los
contenedores `vps`, `vps2` y la red `vpsnet`.

## 10. Riesgos pendientes

1. El código desplegable no está ligado a un commit (F-03): si hay un incidente, no se puede saber qué fuente corre.
2. La corrección de F-01 sólo vive en `angular.json.corregido`: un frontend recompilado desde el repositorio actual
   volvería a salir sin estilos.
3. SELinux, TLS real y SSH quedan sin validar hasta el ensayo institucional.
4. Recuperación de contraseña e invitaciones inutilizables sin correo (F-08).
5. La clave privada GPG de los respaldos necesita custodia y copia fuera del servidor; sin ella, los respaldos no se
   pueden restaurar.
6. Rendimiento bajo carga no medido (Argon2id ≈ 19 MiB por login simultáneo).

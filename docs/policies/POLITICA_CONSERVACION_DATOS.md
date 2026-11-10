# Política de conservación de datos personales — PROPUESTA

> **Estado: propuesta técnica, pendiente de aprobación.** La redactó el equipo de desarrollo el 2026-11-05 a partir del
> esquema y del código vigentes (cierre funcional 2026). **No es un dictamen legal.** Los plazos son valores iniciales para
> discutir, no obligaciones. La dirección de la escuela debe decidirlos, y una asesoría jurídica debe revisar el marco
> aplicable (en México, por ejemplo, la ley de protección de datos personales en posesión de particulares) antes de
> aplicar cualquier plazo.
>
> Mientras no se apruebe, **el sistema no borra ni anonimiza datos de jugadores, tutores, entrenadores, pagos ni
> historiales**. Las únicas eliminaciones automáticas existentes son técnicas y no afectan a ese contenido (§ 4).

## 1. Alcance y cómo obtener el inventario

Cubre la base MariaDB (`docs/database/MARIADB.md`), sus respaldos, los registros de la API y el correo saliente.

`npm run db:datos-personales` muestra, de una base, cuántas filas hay por categoría y unos indicadores para revisar esta
política: menores, bajas definitivas, sesiones y enlaces vencidos, auditoría antigua. Funciona así:

- Sólo lee, dentro de una transacción `READ ONLY`, y únicamente imprime cuentas, nunca nombres ni contactos.
- La clasificación de cada tabla está en `api/datos-personales.ts` (`DATA_MAP`).
- La prueba `api/datos-personales.test.ts` falla si una migración añade una tabla sin clasificarla.

## 2. Inventario

| Categoría                                           | Tablas                                                                                                                                                      | Datos personales                                                                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Menores** (jugadores; casi todos menores de edad) | `jugadores`, `tutor_jugador`, `jugador_categoria`                                                                                                           | Identificador, nombre y apellidos, fecha de nacimiento, sexo, teléfono, correo, dirección, estatus, parentesco, motivo de excepción de edad |
| **Tutores**                                         | `tutores`                                                                                                                                                   | Nombre y apellidos, teléfono, correo, dirección                                                                                             |
| **Entrenadores**                                    | `entrenadores`, `entrenador_categoria`, `entrenador_competencia_categoria`                                                                                  | Nombre y apellidos, teléfono, correo; asignaciones                                                                                          |
| **Cuentas** (personal y portal)                     | `usuarios`                                                                                                                                                  | Nombre, apellido, correo, hash de contraseña (scrypt)                                                                                       |
| **Contacto de terceros**                            | `rivales`, `competencias`                                                                                                                                   | Contacto y organizador (texto libre)                                                                                                        |
| **Financieros**                                     | `cargos`, `pagos`, `pago_aplicacion`, `descuentos`, `inscripciones`, `pedidos_uniforme`, `detalle_uniforme`                                                 | Importes, forma de pago, referencia del comprobante, motivos, quién recibió un uniforme. **No se guardan datos de tarjetas.**               |
| **Deportivos e historiales**                        | `asistencias`, `historial_estatus`, `historial_categoria`, `jugador_competencia_categoria`, `sesiones_entrenamiento`                                        | Asistencia y observaciones, cambios de estatus y de categoría con su motivo, plantillas                                                     |
| **Comunicación**                                    | `avisos`, `aviso_destinatario`, `correo_saliente`                                                                                                           | Texto de avisos y destinatarios; dirección de correo de envíos de acceso                                                                    |
| **Auditoría**                                       | `auditoria`                                                                                                                                                 | Descripción, `datos_anteriores` y `datos_nuevos` (copias en JSON de filas con datos personales, **también de menores**) e IP                |
| **Autenticación**                                   | `sesiones`, `tokens_recuperacion`, `dispositivo_confiable`, `limite_acceso`                                                                                 | IP y navegador de cada sesión; hashes de enlaces y de navegadores de confianza; claves de los límites de acceso (derivadas de correo e IP)  |
| **Sin datos personales**                            | `categorias`, `competencia_categoria`, `conceptos_cobro`, `correo_cupo`, `horarios_entrenamiento`, `partidos`, `permisos`, `productos_uniforme`, `roles`, … | —                                                                                                                                           |

Además, fuera de la base:

- **Respaldos** (`deploy/mariadb/respaldo-programado.sh`): copia completa de todo lo anterior, cifrada con GPG.
- **Registros de la API:** no incluyen parámetros de SQL (`logParam: false`), contraseñas ni enlaces, pero sí ids de
  correo y códigos de error (`docs/API.md`).
- **Proveedor de correo:** conserva sus propios registros de entrega, según su contrato.

## 3. Propuesta por categoría

**Responsable propuesto:** la dirección de la escuela decide los plazos y autoriza las bajas. Quien administra el servidor
ejecuta los procedimientos técnicos y deja constancia en la auditoría.

| Categoría                 | Finalidad                                                   | Plazo propuesto (a decidir)                                                                                    | Al vencer                                                                                                                      |
| ------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Menores (jugador activo)  | Inscripción, categorías, asistencia, competencias, cobranza | Mientras esté activo                                                                                           | —                                                                                                                              |
| Menores (baja definitiva) | Consulta histórica, aclaraciones de pagos, reingreso        | Por ejemplo, 1 temporada completa tras la baja para el contacto; los registros financieros, según § 3, Pagos   | **Anonimizar** contacto (teléfono, correo, dirección) y, más adelante, nombre; conservar el registro deportivo sin identificar |
| Tutores                   | Contacto, portal y pagos                                    | Mientras tenga un jugador ligado; después, como el jugador                                                     | Anonimizar contacto; desactivar su cuenta                                                                                      |
| Entrenadores              | Asignación y contacto                                       | Mientras colabore; después, por ejemplo, 1 año                                                                 | Anonimizar contacto; conservar su nombre en sesiones pasadas sólo si la dirección lo decide                                    |
| Cuentas                   | Acceso                                                      | Desactivada: se conserva para la trazabilidad de la auditoría                                                  | Anonimizar nombre y correo cuando venza el plazo de la persona ligada                                                          |
| Pagos y cargos            | Contabilidad, comprobantes, aclaraciones                    | **El que fije la asesoría fiscal y contable**; no se propone un número                                         | Conservar; si el plazo lo permite, desligar del nombre del menor                                                               |
| Asistencias e historiales | Seguimiento deportivo                                       | Por ejemplo, 2 temporadas                                                                                      | Anonimizar (sin nombre) o agregar en estadísticas                                                                              |
| Avisos                    | Comunicación                                                | Por ejemplo, 1 temporada                                                                                       | Borrar o archivar                                                                                                              |
| Correo saliente           | Entrega y reintentos de enlaces de acceso                   | **Ya implementado:** dirección 30 días tras cerrarse, metadatos 1 año (`CORREO_RETENCION_DIAS`, `docs/API.md`) | Anonimizar y borrar (automático)                                                                                               |
| Auditoría                 | Trazabilidad de cambios                                     | Por ejemplo, 2 años                                                                                            | Requiere decisión: sus JSON copian datos de menores, así que anonimizar a un jugador sin tocar la auditoría no lo anonimiza    |
| Sesiones y enlaces        | Seguridad del acceso                                        | Por ejemplo, 90 días tras cerrarse o vencer                                                                    | Borrar (no afecta a nadie: ya no sirven)                                                                                       |
| Respaldos                 | Recuperación ante desastres                                 | **Ya implementado:** 7 diarios, 4 semanales y 12 mensuales                                                     | Rotación automática. Un dato anonimizado sigue en los respaldos hasta que rotan (hasta 12 meses)                               |

### Excepciones

Se suspende cualquier anonimización o borrado de una persona mientras haya:

- una aclaración o un adeudo de pagos abierto;
- una solicitud de autoridad o un litigio;
- una petición expresa de la dirección.

La excepción se registra con su motivo.

### Bajas

- El estatus `BAJA_TEMPORAL` / `BAJA_DEFINITIVA` (HU-013) **no borra nada**: el jugador sale de las operaciones y conserva
  su historial.
- La anonimización, cuando se apruebe, sólo se aplicaría a bajas definitivas que hayan cumplido el plazo y no tengan
  excepciones. Nunca sería automática al dar la baja.

### Solicitudes de las personas

La dirección debe definir quién atiende las solicitudes de acceso, rectificación, cancelación u oposición de un tutor
sobre los datos de su hijo, y en qué plazo. Hoy:

- la rectificación se hace con las pantallas de edición;
- la cancelación requeriría el procedimiento de anonimización, que **aún no existe**.

### Acceso histórico

Lo anonimizado deja de mostrarse con nombre en reportes e historiales. Los totales financieros y deportivos se conservan.

### Trazabilidad

- Toda anonimización o borrado de una persona debe quedar en `auditoria`, con quién lo autorizó, sin copiar de nuevo los
  datos borrados.
- Las purgas técnicas (§ 4) dejan cuentas, no datos.

## 4. Lo que ya existe y lo que no

**Eliminaciones automáticas vigentes.** Todas son técnicas:

- correo saliente: anonimiza a los 30 días y borra al año;
- `limite_acceso`: borra contadores inactivos;
- `dispositivo_confiable`: borra al revocar o al vencer;
- respaldos: rotación.

**No existe**, a propósito, hasta que esta política se apruebe:

- purga de jugadores, tutores, entrenadores, pagos, asistencias, historiales o auditoría;
- anonimización de personas;
- purga de `sesiones` y `tokens_recuperacion` vencidos, que crecen sin límite y guardan IP y navegador.

**Preparado en este cierre:**

- el inventario de solo lectura;
- la clasificación obligatoria de tablas nuevas;
- los indicadores para decidir.

## 5. Pasos para aprobarla e implementarla

1. La dirección revisa los plazos de § 3 y la asesoría jurídica y fiscal confirma el marco y el plazo de los pagos.
2. Se decide qué hacer con la auditoría (anonimizar sus JSON, o conservarla aparte con acceso restringido).
3. Después, y sólo después, se implementan los procedimientos:
   - anonimización de una baja definitiva, manual y con confirmación;
   - purga de sesiones y enlaces vencidos.
     Cada uno con sus pruebas sobre bases temporales, ensayado antes de usarlo y sin efecto sobre los respaldos ya hechos.
4. Revisión anual de esta política con `npm run db:datos-personales`.

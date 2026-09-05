# Definición del problema — CampusOps

## Problema

En el campus ficticio, los reportes de fallas eléctricas, daños en laboratorios,
fugas de agua, problemas de conectividad, equipos descompuestos, riesgos de
seguridad y necesidades de mantenimiento pueden quedar dispersos, duplicados o
sin una persona responsable. Esto dificulta conocer su prioridad, asignación,
estado e historial. CampusOps centralizará el registro y seguimiento de estas
incidencias con datos exclusivamente sintéticos para que reportantes, técnicos y
coordinadores compartan un flujo verificable de atención.

## Alcance

### Incluye

- Registrar incidencias con categoría, descripción, ubicación de prueba y, cuando
  corresponda, fotografías sintéticas.
- Consultar la lista y el detalle de incidencias según los permisos del perfil.
- Clasificar, priorizar, asignar y reasignar incidencias a técnicos.
- Gestionar el flujo `open` → `assigned` → `in_progress` → `resolved` → `closed`,
  conservando el historial de cambios.
- Permitir al coordinador reabrir una incidencia resuelta o cerrada hacia
  `assigned` cuando exista un técnico asignado.
- Conservar operaciones pendientes durante periodos sin conexión y mostrar
  conflictos de sincronización sin perder silenciosamente los cambios.

### No incluye

- Atención de emergencias o despliegue como servicio institucional real.
- Uso de personas, credenciales, ubicaciones, fotografías o planos reales.
- Pagos, chat en tiempo real, reconocimiento de imágenes mediante IA o un panel
  web administrativo completo.
- Navegación, seguimiento continuo, mapas offline completos o publicación
  obligatoria en tiendas.

## Actores y responsabilidades

- **Reportante:** crea incidencias con categoría, descripción y ubicación; consulta
  sus reportes y agrega posteriormente información permitida.
- **Técnico:** consulta únicamente las incidencias que tiene asignadas, inicia su
  atención, registra diagnóstico, notas y evidencias, y marca la resolución.
- **Coordinador:** consulta el conjunto de incidencias, define prioridad, asigna o
  reasigna técnicos, revisa el historial y las evidencias, cierra resoluciones o
  reabre casos.

## Flujo principal

1. Reportar: el reportante captura una incidencia con categoría, descripción y
   ubicación de prueba; el sistema le asigna un identificador y estado `open`.
2. Asignar: el coordinador revisa el reporte, establece su prioridad y lo asigna a
   un técnico; la incidencia cambia a `assigned` y el cambio queda en el historial.
3. Atender: el técnico asignado cambia la incidencia a `in_progress`, registra su
   diagnóstico, notas y evidencias y, al terminar, la marca como `resolved`.
4. Cerrar: el coordinador revisa la resolución y la cambia a `closed`; si la
   atención no es suficiente, la reabre hacia `assigned` conservando el historial.

## Criterios de aceptación verificables

1. Dado un reportante con datos de prueba, cuando registra una incidencia con
   categoría, descripción y ubicación válidas, entonces el sistema crea un
   identificador único, asigna el estado `open` y muestra el reporte en su lista.
2. Dada una incidencia abierta, cuando el coordinador asigna un técnico, entonces
   cambia a `assigned`, registra la asignación en el historial y sólo el técnico
   asignado puede iniciar su atención.
3. Dada una incidencia asignada al técnico correcto, cuando éste inicia la
   atención y después registra una resolución, entonces los estados cambian en
   orden a `in_progress` y `resolved`, conservando actor, estado anterior y estado
   nuevo en el historial.
4. Dada una incidencia `resolved`, cuando el coordinador aprueba el trabajo,
   entonces cambia a `closed`; si decide reabrirla y existe técnico asignado,
   entonces vuelve a `assigned` sin eliminar el historial anterior.

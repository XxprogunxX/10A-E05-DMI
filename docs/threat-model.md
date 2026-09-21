# Modelo de amenazas inicial de CampusOps

- Estado: inicial
- Fecha: 2026-09-19
- Alcance: Semana 03

## Alcance y supuestos

Este modelo cubre el manejo previsto de sesiones, incidencias, fotografías,
ubicaciones, asignaciones, historial, registros técnicos y el proceso de
integración continua de CampusOps. Todo ejemplo y toda prueba descrita aquí usa
datos completamente ficticios; no se deben utilizar credenciales, ubicaciones,
fotografías ni datos personales reales.

La aplicación todavía no implementa autenticación y autorización completas ni
los proveedores externos definitivos. Por ello, los controles que dependen del
backend se expresan como requisitos verificables para su implementación futura,
mientras que los controles del repositorio y de CI ya pueden comprobarse esta
semana.

## Activos

| ID | Activo | Motivo de protección |
|---|---|---|
| A-01 | Credenciales y tokens de sesión | Permiten actuar con la identidad y los permisos de una persona. |
| A-02 | Incidencias y sus descripciones | Pueden contener información operativa que sólo corresponde al reportante y al personal autorizado. |
| A-03 | Fotografías | Pueden revelar personas, infraestructura o detalles de una incidencia. |
| A-04 | Ubicaciones | Revelan el lugar de una incidencia y potencialmente la posición de usuarios o técnicos. |
| A-05 | Asignaciones de técnicos | Determinan quién atiende una incidencia y afectan la integridad de la operación. |
| A-06 | Estados e historial de incidencias | Sustentan el seguimiento, la responsabilidad y la auditoría. |
| A-07 | Registros técnicos | Ayudan al diagnóstico, pero pueden filtrar información sensible si se registran sin control. |
| A-08 | Código, workflows, reportes y artefactos de CI | Definen y evidencian las comprobaciones usadas para aceptar una versión. |

## Fronteras de confianza

| ID | Frontera | Cambio de confianza y riesgo principal |
|---|---|---|
| FT-01 | Usuario o dispositivo → interfaz móvil | La entrada procede de un dispositivo que puede estar manipulado; la interfaz no es una autoridad de seguridad. |
| FT-02 | Interfaz móvil → casos de uso | Una acción visible debe volver a validarse antes de acceder o modificar datos. |
| FT-03 | Aplicación → backend | Las solicitudes cruzan una frontera de red y requieren autenticación, autorización y validación del lado del servicio. |
| FT-04 | Aplicación → almacenamiento local | Los datos salen de la memoria de la aplicación y pueden permanecer en un dispositivo perdido o comprometido. |
| FT-05 | Aplicación → proveedores de fotografía y ubicación | Se entregan permisos y datos a componentes del sistema o proveedores externos. |
| FT-06 | Repositorio → GitHub Actions | Código y configuración no confiables se ejecutan en un entorno automatizado. |
| FT-07 | GitHub Actions → registros y artefactos | La salida persistente puede revelar datos aunque el proceso haya terminado. |

## Amenazas priorizadas, controles y verificación

La prioridad combina impacto y probabilidad. Una prioridad mayor exige atención
más temprana, pero no elimina la obligación de atender las demás amenazas.

| ID | Amenaza | Activo | Frontera de confianza | Impacto | Probabilidad | Prioridad | Control | Verificación | Riesgo residual |
|---|---|---|---|---|---|---|---|---|---|
| TM-01 | Consultar incidencias ajenas mediante identificadores o solicitudes manipuladas. | A-02, A-03, A-04 y A-06 | FT-01, FT-02 y FT-03 | Alto: expone información operativa, fotografías y ubicaciones a una persona no autorizada. | Media: los identificadores y solicitudes pueden alterarse desde un cliente controlado por el usuario. | Alta | El servicio autoriza cada lectura según el usuario autenticado, el propietario de la incidencia y su perfil; ocultar botones en la UI no cuenta como autorización. | Prueba de autorización con identidades ficticias: el propietario y el perfil permitido reciben la incidencia, mientras que otro usuario recibe una respuesta denegada sin contenido sensible. | Una regla de pertenencia mal configurada o un nuevo endpoint sin el control común todavía podría exponer datos. |
| TM-02 | Alterar asignaciones sin autorización o sobrescribir un cambio más reciente. | A-05 y A-06 | FT-01, FT-02 y FT-03 | Alto: desvía el trabajo, rompe la trazabilidad y puede impedir que una incidencia sea atendida. | Media: un cliente puede enviar directamente una operación aunque la UI no la muestre. | Alta | El backend exige un rol autorizado, valida la versión vigente de la asignación y registra actor, fecha y cambio en una auditoría inmutable para el cliente. | Pruebas con datos ficticios: un reportante y un técnico reciben denegación, un coordinador puede asignar, y una actualización con versión antigua produce conflicto sin sobrescribir el valor vigente. | Una cuenta autorizada comprometida puede realizar cambios indebidos; la auditoría permite investigarlos, pero no los evita por sí sola. |
| TM-03 | Filtrar tokens, ubicaciones, fotografías o datos de incidencias en registros y artefactos. | A-01, A-02, A-03, A-04 y A-07 | FT-03 y FT-07 | Alto: los registros suelen conservarse y estar disponibles para más personas que los datos originales. | Media: errores y objetos completos pueden registrarse accidentalmente durante el desarrollo. | Alta | Se usa una lista permitida de campos de diagnóstico, se sanitizan valores sensibles y se evita registrar cuerpos completos, cabeceras de autorización y datos personales. | Prueba automatizada que genera una solicitud ficticia con campos sensibles, captura el registro y comprueba que sólo aparecen identificadores técnicos permitidos y valores redactados. | Mensajes nuevos, dependencias externas o trazas anteriores al sanitizador podrían introducir campos no contemplados. |
| TM-04 | Exponer credenciales en el repositorio, la configuración, los registros o los artefactos de CI. | A-01 y A-08 | FT-06 y FT-07 | Crítico: una sola credencial puede permitir acceso a varios servicios y afectar confidencialidad e integridad. | Media-alta: copiar valores durante configuración o depuración es un error frecuente y el historial conserva archivos eliminados. | Crítica, primera en atender | GitHub Secrets conserva valores fuera del código; el workflow mantiene `contents: read`; un escaneo automático de secretos bloquea el proceso y los artefactos excluyen datos sensibles. | Con un valor sintético y desechable, ejecutar el verificador de Semana 3 y comprobar `secret_scan: fail`; retirar el archivo y repetir hasta obtener `secret_scan: pass`. Nunca se usa ni se confirma una credencial real. | El escaneo puede no reconocer formatos nuevos, valores fragmentados u otras filtraciones fuera del repositorio; siguen siendo necesarias la revisión, la rotación y permisos mínimos. |

## Decisión de prioridad

El equipo atiende primero **TM-04, exposición de credenciales**. Su impacto es
transversal: una credencial expuesta puede abrir acceso a más de un servicio y
permitir tanto lectura como modificación de datos. Además, el control puede
automatizarse y demostrarse desde esta semana con el escaneo de secretos, los
permisos mínimos del workflow y una prueba controlada que primero falla y luego
pasa al retirar el dato ficticio.

Esta prioridad no declara resueltas TM-01, TM-02 ni TM-03. Esas amenazas
conservan prioridad alta y sus controles deberán incorporarse con pruebas cuando
se implementen la sesión, el backend, la autorización y el registro técnico.

## Criterio de seguimiento

Una amenaza sólo se considerará reducida cuando el control esté implementado y
su verificación produzca un resultado observable y repetible. La documentación
por sí sola no demuestra que el control funciona. Los resultados reales de la
Semana 3 se conservarán en `reports/week-03/security.json` y la justificación
estructurada en `evidence/week-03/engineering.json`.

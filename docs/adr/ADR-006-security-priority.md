# ADR-006: Priorizar la detección automática de credenciales expuestas

- Estado: aceptada
- Fecha: 2026-09-19

## Contexto

CampusOps manejará sesiones, incidencias, fotografías, ubicaciones y
asignaciones. Una credencial incluida accidentalmente en el repositorio, en un
registro o en un artefacto de integración continua puede comprometer varios de
esos activos y conservarse en el historial aun después de borrar el archivo.

El modelo inicial identifica también el acceso a incidencias ajenas, la
alteración de asignaciones y la filtración de datos en registros. Es necesario
elegir qué amenaza atender primero sin presentar las demás como resueltas.

## Alternativas consideradas

### 1. Utilizar solamente revisión manual

Cada integrante revisaría los cambios antes de integrarlos. Tiene poco costo de
configuración, pero depende de la atención y experiencia de cada revisor, no es
uniforme y resulta difícil demostrar que todos los archivos fueron examinados.

### 2. Ejecutar un escaneo automático de secretos en CI

Cada versión se examina de manera repetible y una coincidencia hace fallar el
proceso. El resultado puede conservarse como evidencia y complementarse con
permisos mínimos y GitHub Secrets. Su costo es mantener los patrones y atender
falsos positivos o formatos que el escáner todavía no conoce.

### 3. Esperar hasta implementar autenticación completa

Evitaría decidir controles antes del backend definitivo, pero dejaría sin
protección las credenciales de herramientas, CI y futuros proveedores que pueden
aparecer durante el desarrollo. Autenticación y detección de secretos resuelven
problemas distintos.

## Decisión

Se adopta la alternativa 2: priorizar TM-04 y ejecutar el escaneo automático de
secretos como comprobación obligatoria de CI. Las credenciales de servicios se
mantendrán fuera del repositorio mediante GitHub Secrets, y el workflow
conservará solamente el permiso `contents: read` que necesita para evaluar el
código.

La comprobación no debe usar mecanismos que oculten errores, ignorar códigos de
salida ni aceptar la ausencia de pruebas como un resultado exitoso.

## Beneficios

- Revisa cada versión de manera consistente y temprana.
- Convierte una política de seguridad en un resultado verificable.
- Reduce la probabilidad de que una credencial conocida llegue a la rama final.
- Produce evidencia reproducible tanto del rechazo como del estado corregido.
- Complementa la revisión humana y el principio de privilegio mínimo.

## Costos y limitaciones

- Los patrones del escáner necesitan mantenimiento.
- Puede haber falsos positivos que requieran investigación.
- Un formato desconocido, fragmentado u ofuscado puede no ser detectado.
- Detectar una credencial después de confirmarla no elimina su presencia del
  historial ni sustituye su revocación.
- El control no implementa la autorización necesaria para TM-01 y TM-02 ni la
  sanitización de registros necesaria para TM-03.

## Riesgo residual

Permanece la posibilidad de credenciales no reconocidas o expuestas fuera del
repositorio. Si una credencial real llegara a publicarse, se debe detener la
integración, revocarla, sustituirla y revisar su uso; borrarla del archivo no es
suficiente. Las revisiones humanas, la rotación y los permisos mínimos siguen
siendo necesarios.

## Verificación

La estructura del workflow, el modelo y la calidad acumulada se comprueban con:

```powershell
npm run test:workflow
npm test -- --ci --runInBand course-tests/public/week-03.test.ts
npm run typecheck
npm run lint
```

La eficacia del escaneo se demostrará después con un valor completamente
sintético y desechable: el verificador debe fallar mientras exista y volver a
pasar al retirarlo. El archivo de prueba no se confirma en Git. Los comandos y
resultados observados se registrarán en `reports/week-03/security.json`.

## Consecuencias

El equipo obtiene un control ejecutable desde esta semana y una prioridad clara
para la evidencia de seguridad. A cambio, debe mantener el escaneo, investigar
sus alertas y conservar controles independientes para las demás amenazas. Esta
decisión establece el orden de atención; no afirma que el resto del modelo ya
esté implementado.

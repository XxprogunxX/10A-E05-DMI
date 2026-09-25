# Controles de seguridad y privacidad — Semana 4

## Alcance

Estos controles implementan la reducción de TM-03 y refuerzan TM-04 del modelo de amenazas de CampusOps. Se aplican a objetos destinados a telemetría, archivos de configuración local y vistas de consulta de incidencias.

## Clasificación mínima

| Categoría | Ejemplos | Tratamiento |
|---|---|---|
| Credenciales | `authorization`, contraseña, tokens, cookies, secretos y API keys | Sustituir el valor completo por `[REDACTED]`; nunca incluirlo en evidencia |
| Identidad | correo, nombre visible e identificadores de reportante o técnico | Redactar en telemetría |
| Datos de incidencia | ubicación, coordenadas, fotografías, evidencia, comentarios e historial de asignación | Redactar en telemetría y minimizar en vistas generales |
| Contexto técnico permitido | ID sintético de incidencia, correlación, estado, intento y duración | Conservar para diagnóstico |

## Control SC-04-01 — Sanitización antes de telemetría

- Punto común: `redactForTelemetry` en `src/course-evaluation/index.ts`.
- Profundidad: objetos y arreglos anidados.
- Variantes: las claves se comparan sin distinción de mayúsculas, guiones o guiones bajos.
- Integridad: se construye una copia y no se modifica el objeto recibido.
- Política: una clave sensible provoca la redacción de su valor completo, incluso si contiene un arreglo u objeto.
- Verificación: `course-tests/week-04-security.test.ts` y `course-tests/public/week-04.test.ts`.

## Control SC-04-02 — Exclusión de configuración privada

- `.env`, `.env.*`, keystores y llaves permanecen fuera de Git.
- La excepción `!.env.example` permite documentar únicamente nombres y valores públicos de demostración.
- Ningún nombre `EXPO_PUBLIC_*` debe contener secretos porque Expo incorpora esos valores en el cliente.
- Verificación: `git check-ignore --no-index` para variantes privadas y comprobación inversa para `.env.example`.

## Control SC-04-03 — Minimización de datos

- `IncidentSummary` contiene sólo los campos necesarios para reconocer y priorizar una incidencia.
- La ubicación no viaja al resumen ni se representa en la lista.
- El detalle conserva la ubicación, sujeto a la autorización del backend cuando se conecte la aplicación móvil al servicio.
- Verificación: prueba negativa que comprueba que el resultado de `ListIncidents` no tiene la propiedad `location`.

## Pruebas negativas

El comando `npm run test:security:week4` comprueba:

1. Redacción de autorización, correo, nombre, ubicación, fotografías y comentarios.
2. Redacción dentro de arreglos y variantes con guion bajo.
3. Conservación de campos técnicos permitidos.
4. Inmutabilidad de la entrada.
5. Ausencia de ubicación en resúmenes.
6. Exclusión de variantes privadas de `.env` y conservación de `.env.example`.

## Limitaciones

La lista de campos sensibles es un mínimo verificable, no autorización para registrar texto libre. La sesión completa y la autorización por perfil todavía no están conectadas a la interfaz móvil; no deben usarse datos institucionales reales hasta completar y verificar esos controles.

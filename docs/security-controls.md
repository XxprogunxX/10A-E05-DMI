# Controles de seguridad Semana 4

## Sanitización de telemetría

`redactForTelemetry` recorre objetos y arreglos sin modificar la entrada. Sustituye por `[REDACTED]` los valores asociados con autorización, contraseñas, tokens, claves de API, cookies, identidad personal, ubicación, fotografías, evidencias y comentarios internos. Conserva identificadores técnicos de incidencias, correlación, estado, intentos y duración para que los registros continúen siendo útiles.

La implementación se comprueba con la prueba pública de Semana 4 y con `course-tests/week-04-security.test.ts`.

## Restricción de orígenes web

El backend dejó de responder con el permiso CORS comodín. `COURSE_ALLOWED_ORIGINS` contiene una lista separada por comas y el servidor sólo devuelve el origen cuando existe una coincidencia exacta. Los orígenes desconocidos no reciben autorización CORS.

La prueba negativa `course-backend/security-self-test.mjs` inicia el backend con un origen permitido, intenta acceder desde un origen no confiable y comprueba ambos resultados.

## Protección de archivos de configuración

`.gitignore` excluye `.env` y archivos comunes de firma. `.env.example` documenta variables sin incluir credenciales reales. Los valores del backend del curso son públicos, sintéticos y exclusivos del simulador; no deben reutilizarse como autenticación institucional.

## Riesgo residual

La auditoría de dependencias reporta vulnerabilidades de severidad alta en versiones transitivas de `@xmldom/xmldom` y `js-yaml`. Su actualización queda pendiente de una revisión de compatibilidad con Expo, ESLint y Jest. Además, el simulador todavía usa un token compartido y recibe el actor en una cabecera controlada por el cliente; un backend de producción deberá vincular cada token con una identidad validada en el servidor.

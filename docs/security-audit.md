# Auditoría de seguridad Semana 4

## Objetivo

Esta auditoría revisa cómo CampusOps protege información sensible durante el registro de telemetría y cómo limita el acceso desde aplicaciones web. Se utilizaron únicamente identificadores, orígenes y credenciales ficticias. Se identificaron tres riesgos relacionados con el proyecto y se corrigieron los dos primeros mediante cambios verificables.

## Hallazgos

| # | Hallazgo | Riesgo | Solución aplicada | Evidencia |
|---|---|---|---|---|
| 1 | La función `redactForTelemetry` no estaba implementada | Los registros podían conservar cabeceras de autorización, correo, nombre, ubicación, fotografías o comentarios internos | Se implementó una copia recursiva que sustituye claves sensibles por `[REDACTED]` sin modificar la entrada | [Antes](evidence/hallazgo-1-antes.txt) y [después](evidence/hallazgo-1-despues.txt) |
| 2 | El backend respondía con `access-control-allow-origin: *` | Cualquier sitio web podía recibir autorización CORS para leer respuestas del backend desde un navegador | Se sustituyó el comodín por una lista de orígenes permitidos configurada con `COURSE_ALLOWED_ORIGINS` | [Antes](evidence/hallazgo-2-antes.txt) y [después](evidence/hallazgo-2-despues.txt) |
| 3 | La auditoría de dependencias reportó vulnerabilidades de severidad alta en `@xmldom/xmldom` y `js-yaml` | Entradas XML o YAML malformadas podrían causar inyección o consumo excesivo de CPU y memoria | Quedó pendiente porque las versiones llegan de forma transitiva por Expo, ESLint y Jest y requieren una actualización controlada con pruebas de compatibilidad | [Observación](evidence/hallazgo-3-observacion.txt) |

## Hallazgo 1 Sanitización de telemetría ausente

### Problema encontrado

El archivo `src/course-evaluation/index.ts` exponía la función `redactForTelemetry`, pero su única operación era lanzar el error `redactForTelemetry must be implemented in the assigned week`. Por lo tanto, no existía una ruta segura para preparar objetos antes de registrarlos como telemetría.

### Riesgo

CampusOps maneja tokens, identidad, correo, ubicación, fotografías y comentarios internos. Registrar objetos completos sin sanitizarlos puede copiar esos datos a consolas, archivos de diagnóstico o servicios de monitoreo accesibles para más personas que el sistema principal.

### Evidencia antes de la corrección

Se ejecutó:

```bash
npm test -- --ci --runInBand course-tests/public/week-04.test.ts
```

La prueba falló porque `redactForTelemetry` no estaba implementada. La salida resumida se guardó en `docs/evidence/hallazgo-1-antes.txt`.

### Solución aplicada

Se implementó un recorrido recursivo de objetos y arreglos. Las claves sensibles se normalizan a minúsculas y sin guiones, lo que permite reconocer variantes como `Authorization`, `access_token` y `x-api-key`. Sus valores se sustituyen por `[REDACTED]`. Los campos técnicos necesarios para diagnosticar un problema, como `incidentId`, `correlationId`, `status` y `durationMs`, se conservan.

La función crea un resultado nuevo y no modifica el objeto recibido. También se agregó una prueba para datos anidados, arreglos y variantes de nombres de claves.

### Evidencia después de la corrección

Se ejecutó:

```bash
npm test -- --ci --runInBand course-tests/public/week-04.test.ts course-tests/week-04-security.test.ts
```

Las dos suites y sus dos pruebas terminaron correctamente. El resultado se guardó en `docs/evidence/hallazgo-1-despues.txt`.

## Hallazgo 2 Política CORS demasiado abierta

### Problema encontrado

El archivo `course-backend/server.mjs` agregaba `access-control-allow-origin: *` a todas las respuestas. Una prueba negativa envió una solicitud con el origen ficticio `https://attacker.example` y comprobó que el servidor le concedía el permiso comodín.

### Riesgo

Una política CORS abierta permite que cualquier página web intente leer respuestas del backend desde el navegador de una persona usuaria. CORS no sustituye la autenticación, pero una configuración demasiado amplia elimina una barrera que limita qué aplicaciones web pueden interactuar con el servicio.

### Evidencia antes de la corrección

Se agregó una prueba reproducible y se ejecutó:

```bash
node course-backend/security-self-test.mjs
```

La prueba falló con el mensaje `an untrusted website must not receive wildcard CORS permission`. La salida se guardó en `docs/evidence/hallazgo-2-antes.txt`.

### Solución aplicada

El backend ahora construye una lista permitida desde `COURSE_ALLOWED_ORIGINS`. Sólo devuelve `access-control-allow-origin` cuando el origen recibido coincide exactamente con uno de los valores configurados. La respuesta autorizada incluye `Vary: Origin`. El archivo `.env.example` contiene únicamente orígenes locales de ejemplo y no incluye credenciales.

### Evidencia después de la corrección

Se repitió el mismo comando. La prueba confirmó que `https://attacker.example` no recibe permiso y que el origen configurado sí lo recibe. El resultado se guardó en `docs/evidence/hallazgo-2-despues.txt`.

## Hallazgo 3 Dependencias con vulnerabilidades conocidas

### Problema encontrado

El comando `npm audit --omit=dev --audit-level=critical` reportó vulnerabilidades de severidad alta en versiones transitivas de `@xmldom/xmldom` y `js-yaml`. El árbol de dependencias mostró que llegan por herramientas de Expo, ESLint y Jest.

### Riesgo

Las alertas de `@xmldom/xmldom` incluyen casos de inyección de XML y consumo cuadrático de tiempo o memoria. La alerta de `js-yaml` permite un consumo elevado de CPU con entradas YAML construidas para explotar claves merge. El impacto real depende de si una ruta ejecutable procesa entradas no confiables con esas bibliotecas, pero conservar versiones vulnerables aumenta el riesgo del proyecto y del proceso de construcción.

### Tratamiento

Este hallazgo quedó pendiente. `npm audit` propone ejecutar `npm audit fix`, pero las versiones son transitivas de herramientas centrales del proyecto. La corrección debe hacerse en una tarea separada: revisar el cambio propuesto, actualizar el archivo de bloqueo, ejecutar todas las pruebas y confirmar que Expo continúa generando la aplicación. La actividad exige corregir por lo menos dos hallazgos, requisito cubierto por las correcciones de sanitización y CORS. La salida resumida se encuentra en `docs/evidence/hallazgo-3-observacion.txt`.

## Comprobación final

Después de las correcciones se ejecutaron las pruebas de seguridad, la revisión de tipos, ESLint, la prueba del backend y las pruebas de humo. Todas terminaron correctamente. El resumen está en `docs/evidence/verificacion-final.txt`.

También se comprobó que `.gitignore` excluye `.env`, que Git no rastrea un archivo `.env` y que `.env.example` sólo contiene nombres o valores locales de configuración. Ninguna evidencia de esta actividad contiene contraseñas, tokens o datos personales reales.

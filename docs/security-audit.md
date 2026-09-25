# Auditoría de seguridad y privacidad — Semana 4

## 1. Objetivo

Realizar una revisión de seguridad y privacidad del proyecto CampusOps para identificar problemas reales relacionados con dependencias, información personal, secretos y archivos sensibles.

## 2. Hallazgos

| # | Hallazgo | Riesgo | Solución aplicada | Evidencia |
|---|---|---|---|---|
| 1 | Vulnerabilidades en @xmldom/xmldom | Una dependencia vulnerable puede provocar consumo excesivo de recursos y afectar la disponibilidad. | Se ejecutó npm audit fix y se actualizaron las versiones vulnerables. | docs/evidence/audit-after.png |
| 2 | Vulnerabilidades en js-yaml | Una versión vulnerable puede provocar consumo excesivo de CPU al procesar determinadas entradas. | Se ejecutó npm audit fix y se actualizaron las versiones vulnerables. | docs/evidence/audit-after.png |
| 3 | Identificadores numéricos de estudiantes en evidencias | La exposición innecesaria de identificadores personales aumenta el riesgo de exposición de datos. | Se sustituyeron por identificadores ficticios. | docs/evidence/student-ids-redacted.png |

## 3. Hallazgo 1 — @xmldom/xmldom

### Problema

La auditoría inicial de dependencias detectó versiones vulnerables de @xmldom/xmldom.

El problema podía provocar un consumo excesivo de memoria al procesar determinadas entradas XML.

### Riesgo

Una entrada especialmente construida podría provocar un consumo elevado de recursos y afectar la disponibilidad de la aplicación.

### Solución

Se ejecutó npm audit fix.

La dependencia vulnerable fue actualizada a versiones corregidas.

### Antes

La auditoría reportaba vulnerabilidades de severidad alta relacionadas con @xmldom/xmldom.

### Después

La dependencia quedó actualizada y npm audit actualmente reporta 0 vulnerabilidades.

También se verificó con npm audit --omit=dev y el resultado fue 0 vulnerabilidades.

### Evidencia

docs/evidence/audit-after.png

---

## 4. Hallazgo 2 — js-yaml

### Problema

La auditoría inicial detectó una vulnerabilidad de severidad alta en js-yaml.

La vulnerabilidad podía permitir un consumo elevado de CPU al procesar determinadas entradas con estructuras de combinación.

### Riesgo

El procesamiento de una entrada especialmente construida podría aumentar el consumo de CPU y afectar la disponibilidad del proceso.

### Solución

Se ejecutó npm audit fix.

Las versiones vulnerables de js-yaml fueron actualizadas a versiones corregidas.

### Antes

La auditoría reportaba una vulnerabilidad de severidad alta asociada a js-yaml.

### Después

Las versiones instaladas de js-yaml quedaron actualizadas y npm audit actualmente reporta 0 vulnerabilidades.

La auditoría de producción con npm audit --omit=dev también reporta 0 vulnerabilidades.

### Evidencia

docs/evidence/audit-after.png

---

## 5. Hallazgo 3 — Identificadores de estudiantes en evidencias

### Problema

Las evidencias individuales de semanas anteriores contenían identificadores numéricos de estudiantes.

Aunque no son contraseñas ni tokens, son datos que no son necesarios para demostrar el funcionamiento técnico de la aplicación.

### Riesgo

Mantener identificadores personales innecesarios en el repositorio aumenta la exposición de información de los estudiantes y dificulta aplicar el principio de minimización de datos.

### Solución

Se sustituyeron los identificadores numéricos por identificadores ficticios:

- STUDENT-001
- STUDENT-002
- STUDENT-003

La sustitución se realizó en las evidencias de las semanas 1, 2 y 3.

### Antes

Las evidencias contenían identificadores numéricos de estudiantes.

### Después

Las evidencias utilizan identificadores ficticios y no contienen los identificadores numéricos anteriores.

La búsqueda de los identificadores originales no devuelve resultados.

### Evidencia

docs/evidence/student-ids-redacted.png

---

## 6. Revisión de secretos y archivos sensibles

### Secretos o credenciales

Se revisaron los archivos de código fuente buscando referencias relacionadas con passwords, secrets, tokens y API keys.

No se encontraron valores reales de credenciales, contraseñas o tokens.

Las coincidencias encontradas corresponden a tipos o contratos de datos, no a secretos almacenados.

### Logs

Se revisó el código fuente en busca de console.log, console.error y console.warn.

No se encontraron registros de consola en src.

### Almacenamiento local

Se revisó el código buscando localStorage, sessionStorage, cookies y AsyncStorage.

No se encontraron usos de estos mecanismos dentro de src.

### Archivos de entorno

No existe un archivo .env local en el proyecto.

El repositorio contiene únicamente .env.example y .gitignore incluye .env.

También se revisaron los archivos rastreados por Git para detectar archivos de credenciales, certificados o secretos y no se encontró un archivo sensible rastreado.

### Mensajes de error

Se revisaron los mensajes de error del código.

Los mensajes encontrados son genéricos y no exponen contraseñas, tokens, datos personales ni contenido sensible.

---

## 7. Validaciones realizadas

Se ejecutaron las siguientes comprobaciones después de aplicar las correcciones:

- npm audit: 0 vulnerabilidades.
- npm audit --omit=dev: 0 vulnerabilidades.
- npm run typecheck: correcto.
- npm run lint: correcto.
- git diff --check: correcto.
- Búsqueda de los identificadores numéricos originales: sin resultados.
- Búsqueda de archivo .env: no existe.
- Revisión de .gitignore: incluye .env.
- Revisión de logs en src: sin console.log, console.error o console.warn.

La ejecución completa de npm test todavía presenta fallos relacionados con funcionalidades pendientes de otras semanas y una prueba pública de Semana 4 que requiere una implementación aún pendiente. Por ello, no se considera que la suite completa de pruebas esté totalmente aprobada.

---

## 8. Conclusión

La auditoría permitió identificar tres problemas reales relacionados con seguridad y privacidad:

1. Dependencias vulnerables en @xmldom/xmldom.
2. Dependencias vulnerables en js-yaml.
3. Exposición innecesaria de identificadores numéricos de estudiantes en evidencias.

Se aplicaron correcciones a los tres hallazgos.

Después de las correcciones, las auditorías de dependencias reportan 0 vulnerabilidades, los identificadores personales fueron sustituidos por valores ficticios y las revisiones de secretos, logs, almacenamiento local y archivos de entorno no detectaron exposición de información sensible.

Las evidencias visuales deben almacenarse en docs/evidence con los siguientes nombres:

- audit-after.png
- student-ids-redacted.png
- gitignore-env.png


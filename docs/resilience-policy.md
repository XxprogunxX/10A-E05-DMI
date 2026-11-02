# Política de Resiliencia, Geocodificación y Reintentos — CampusOps (Semana 09)

Este documento define la arquitectura de integración resiliente con servicios externos de geocodificación, la política de caché, la degradación elegante a ubicación manual y las reglas de reintento acotado e idempotencia ante respuestas perdidas (`timeout_after_commit`).

---

## 1. Proveedor de Geocodificación, Adaptador y Restricciones

### 1.1 Arquitectura de adaptadores (`GeocodingProviderPort`)

CampusOps desacopla la resolución de ubicaciones detrás del puerto de dominio [`GeocodingProviderPort`](../src/domain/location/IncidentLocationSelector.ts) con dos adaptadores complementarios en infraestructura:

1. **Adaptador externo real (`NominatimGeocodingAdapter`)**: consulta el servicio público **OpenStreetMap Nominatim Search API v2** (`GET https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=<consulta>`) sin requerir tarjetas de crédito, cuentas de facturación ni claves privadas embebidas en el cliente.
2. **Doble controlado de curso (`CourseGeocodingClient`)**: consulta `GET /v1/geocoding?q=<consulta>` en el backend didáctico local (`http://127.0.0.1:4310`) aceptando la cabecera `X-Course-Scenario` (`success`, `incomplete`, `invalid_coordinates`, `rate_limited`, `server_error`, `malformed`, `slow`) para reproducir fallas de manera determinista en pruebas automatizadas y CI sin depender de cuotas ni disponibilidad de terceros.

### 1.2 Restricciones operativas y de privacidad del proveedor externo

| Restricción | Regla aplicada en CampusOps |
|---|---|
| **Límite de tasa (Rate Limit)** | Máximo 1 solicitud por segundo según la política de uso de Nominatim; prohibido disparar búsquedas por cada pulsación de tecla (`onChangeText`). |
| **Identificación HTTP** | Se envía cabecera explícita `User-Agent: CampusOps-DMI-Academic/1.0` y `Accept-Language: es`. |
| **Caché obligatoria** | Toda consulta normalizada se verifica primero en `InMemoryGeocodingCache` antes de realizar tráfico de red. |
| **Sin secretos en cliente** | No se utilizan claves `EXPO_PUBLIC_*SECRET*` ni tokens privados de terceros. |
| **Privacidad y sanitización** | Sólo se consultan ubicaciones ficticias o de referencia académica. En telemetría, `redactForTelemetry` sustituye `location`, `latitude` y `longitude` por `[REDACTED]`, conservando únicamente metadatos técnicos (`incidentId`, `correlationId`, `status`, `attempt`, `durationMs`). |

### 1.3 Evidencia de ejecución real con datos sintéticos

Se verificó el adaptador externo contra `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=Universidad+Tecnologica+de+Tehuacan` empleando datos sintéticos de prueba:

- **Solicitud**: `GET https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=Universidad+Tecnologica+de+Tehuacan`
- **Estado HTTP observado**: `200 OK`
- **Carga útil transformada por el adaptador**:
  ```json
  {
    "label": "Universidad Tecnológica de Tehuacán, Prolongación de la 1 Sur, San Pablo Tepetzingo, Tehuacán, Puebla, 75859, México",
    "latitude": 18.4148421,
    "longitude": -97.3435432
  }
  ```
- **Resultado validado por `selectIncidentLocation`**:
  ```json
  {
    "source": "provider",
    "label": "Universidad Tecnológica de Tehuacán, Prolongación de la 1 Sur, San Pablo Tepetzingo, Tehuacán, Puebla, 75859, México",
    "latitude": 18.4148421,
    "longitude": -97.3435432
  }
  ```

---

## 2. Política de Caché (`InMemoryGeocodingCache`)

1. **Normalización de clave**: `normalizeQueryKey(query)` convierte el texto a minúsculas, elimina espacios iniciales/finales y colapsa espacios repetidos (`"  Edificio   de Prueba A "` → `"edificio de prueba a"`).
2. **Vigencia (TTL)**: cada entrada almacena su marca de tiempo y expira tras un `ttlMs` configurable (por defecto `300000 ms` / 5 minutos).
3. **No contaminación por fallos**: únicamente se guardan en caché resultados válidos que cumplen el contrato de coordenadas finitas (`latitude ∈ [-90, 90]`, `longitude ∈ [-180, 180]`). Las respuestas con error (`429`, `500`, `timeout`, `malformed`, `incomplete` o `invalid_coordinates`) no se almacenan en caché.

---

## 3. Alternativa Manual de Ubicación (`selectIncidentLocation`)

La función [`selectIncidentLocation(provider, manualLabel)`](../src/domain/location/IncidentLocationSelector.ts) garantiza que un fallo del proveedor externo nunca bloquee el reporte de una incidencia ni introduzca coordenadas falsas:

- **Criterio de aceptación del proveedor (`source: 'provider'`)**:
  - `provider` debe ser un objeto plano no nulo.
  - `provider.label` debe ser `string` con longitud útil (`label.trim().length > 0`).
  - `provider.latitude` debe ser `number` finito (`Number.isFinite`) dentro del intervalo `[-90, 90]`.
  - `provider.longitude` debe ser `number` finito (`Number.isFinite`) dentro del intervalo `[-180, 180]`.
- **Degradación segura a ubicación manual (`source: 'manual'`)**:
  - Si `provider` es `null`, `undefined`, un error representado como dato (`{ status: 429 }`), un objeto incompleto (`{ label: 'Incompleta' }`) o contiene coordenadas inválidas (`latitude: 91`, `latitude: 999`, `longitude: null`, `NaN`, `Infinity`), devuelve exactamente:
    ```json
    {
      "source": "manual",
      "label": "<manualLabel>"
    }
    ```
  - **Prohibición de inventar coordenadas**: cuando `source` es `'manual'`, las propiedades `latitude` y `longitude` no se incluyen ni se rellenan con `0, 0`.

---

## 4. Política de Reintentos, Backoff, `Retry-After` e Idempotencia (`planRetry`)

La función [`planRetry(input, config)`](../src/domain/resilience/RetryPolicy.ts) gobierna todos los reintentos de lectura (`GET`) y escritura (`POST`):

### 4.1 Límites y parámetros configurables

- **Máximo de intentos (`maxAttempts = 4`)**:
  - Se permite reintentar después de los intentos `1`, `2` y `3` (`attempt < 4`).
  - **Desde el intento `4` (`attempt >= 4`), no se reintenta**: devuelve `{ retry: false, delayMs: 0, requiresStableIdempotencyKey: false }`.
- **Backoff progresivo finito**:
  - `baseDelayMs = 250 ms`, `maxDelayMs = 8000 ms`.
  - Sin cabecera `Retry-After`, las demoras crecen exponencialmente:
    - Intento 1 → `250 ms`
    - Intento 2 → `500 ms`
    - Intento 3 → `1000 ms`
- **Respeto a `Retry-After`**:
  - Cuando el servicio responde `429 Too Many Requests` con `Retry-After` (o `retryAfterMs` positivo y finito, p. ej. `800 ms` o `1000 ms`), `planRetry` respeta dicha espera acotándola a `maxDelayMs`.
- **Requisito de identidad estable en `POST`**:
  - Ninguna operación `POST` se repite si carece de `idempotencyKey` estable no vacía: devuelve `{ retry: false, delayMs: 0, requiresStableIdempotencyKey: true }`.
  - Cuando el `POST` incluye una `idempotencyKey` estable (p. ej. `'resolve-campus-inc-001-op-1'`), `requiresStableIdempotencyKey` es `false` y se autoriza el reintento ante fallos transitorios (`timeout`, `network`, `429`, `500`, `502`, `503`, `504`).

### 4.2 Matriz de decisión: Reintentar vs. Alternativa Manual vs. Informar Fallo

| Escenario observado | Método | Decisión de CampusOps | Justificación técnica |
|---|---|---|---|
| `429` con `Retry-After`, `500/503` o `timeout` en intento `1..3` | `GET` | **Reintentar** con espera `Retry-After` o backoff progresivo | La lectura es idempotente y el fallo es transitorio. |
| Geocodificación devuelve `incomplete`, `invalid_coordinates` (`999`), `malformed` o agota los 3 reintentos | `GET` | **Continuar con alternativa manual (`source: 'manual'`)** | El proveedor no entregó coordenadas confiables, pero el usuario puede registrar el edificio o zona manualmente sin inventar coordenadas. |
| `timeout` tras guardar (`timeout_after_commit`) o `503` en intento `1..3` con `Idempotency-Key` estable | `POST` | **Reintentar conservando la misma `Idempotency-Key` y payload** | El servidor deduplica por huella canónica (`duplicate: true`) y devuelve el estado actualizado sin duplicar historial, evidencias ni notas. |
| `POST` sin `Idempotency-Key` estable | `POST` | **No reintentar e informar fallo (`requiresStableIdempotencyKey: true`)** | Repetir un `POST` sin clave estable puede duplicar incidencias o transiciones en el servidor. |
| Error `400`, `401`, `403`, `404`, `409` o `422`, o intento `>= 4` en escritura | `GET` / `POST` | **Detener reintentos e informar fallo** | Los errores `4xx` (salvo `408`/`429`) indican rechazo de contrato, permisos o conflicto de versión/clave que un reintento idéntico no resolverá. |

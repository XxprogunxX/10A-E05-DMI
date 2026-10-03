# Contrato del cliente cloud de CampusOps

## Propósito y límite de confianza

El backend didáctico es un proveedor externo al dominio de la aplicación. Todo
valor recibido por HTTP se trata como `unknown` hasta validarlo. Las pantallas
no consumen DTO ni ejecutan `fetch`; reciben objetos y resultados de aplicación
mediante casos de uso y puertos.

El flujo de datos previsto es:

```text
HTTP desconocido → DTO validado → mapeo explícito → modelo de aplicación → UI
```

Validar el sobre no valida automáticamente el dominio contenido en `payload`.
Ambas fronteras deben aprobarse antes de construir una incidencia utilizada por
la aplicación.

## Transporte común

La URL local predeterminada es `http://127.0.0.1:4310`. En el emulador Android
se utiliza `http://10.0.2.2:4310`. El simulador no se publica en Internet.

Las rutas de incidencias reciben exclusivamente fixtures académicos:

```http
Authorization: Bearer course-valid-token
X-Course-Actor: reporter-1
X-Course-Scenario: success
```

`X-Course-Scenario` sólo se usa para pruebas controladas. Los identificadores y
tokens anteriores son datos públicos del simulador, no credenciales reales.

## Sobre remoto compartido

Lista, detalle y creación contienen recursos con este sobre:

```ts
type RemoteResourceDto = {
  id: string;
  version: number;
  status: string;
  payload: Record<string, unknown> | null;
};
```

`parseRemoteResource` aplica estas reglas:

- `id` y `status` son textos no vacíos después de eliminar espacios para la
  comprobación.
- `version` es un entero mayor o igual que cero.
- `payload` es un objeto no-array o `null`.
- Los campos futuros del sobre se ignoran.
- La entrada no se modifica y el resultado sólo conserva campos publicados.
- Una violación devuelve `{ ok: false, error: "contract" }`; no lanza una
  excepción sin controlar.

Un `payload: null` es un recurso remoto válido sin datos de dominio. Se conserva
como ausencia explícita. No se transforma en una incidencia ficticia, no recibe
valores predeterminados y no se clasifica como sobre malformado.

## Consultar la lista

### Solicitud

```http
GET /v1/incidents
```

No envía cuerpo. El servidor responde:

```json
{
  "items": [
    {
      "id": "campus-inc-001",
      "version": 1,
      "status": "assigned",
      "payload": {
        "category": "connectivity",
        "description": "Incidencia ficticia",
        "location": "Edificio de prueba A",
        "reporterId": "reporter-1",
        "assignedTechnicianId": "technician-1",
        "priority": "medium"
      }
    }
  ]
}
```

El cliente valida primero que la raíz sea un objeto y que `items` sea una lista;
después valida cada sobre y cada payload. Una lista vacía es éxito sin
incidencias. Una raíz inválida, un elemento inválido o un payload de dominio
inválido produce un error de contrato identificable.

## Consultar el detalle

### Solicitud

```http
GET /v1/incidents/:id
```

El `id` se codifica como segmento de URL. La respuesta `200` es un solo
`RemoteResourceDto`. `404` representa una incidencia inexistente; no se trata
como respuesta malformada.

## Crear una incidencia

### Solicitud

```http
POST /v1/incidents
Content-Type: application/json
Idempotency-Key: operation-unique-001
```

```ts
type CreateIncidentRequestDto = {
  category:
    | 'electrical'
    | 'laboratory'
    | 'water'
    | 'connectivity'
    | 'equipment'
    | 'safety'
    | 'maintenance';
  description: string;
  location: string;
};
```

`description` y `location` no pueden estar vacíos. La clave de idempotencia debe
ser estable para repetir la misma operación sin duplicarla.

La respuesta `201` tiene la forma:

```ts
type CreateIncidentResponseDto = {
  incident: RemoteResourceDto;
  operationId: string;
  duplicate: boolean;
};
```

El sobre `incident` y su payload se validan antes de devolver un resultado de
aplicación.

## DTO remoto frente a datos de la aplicación

El DTO refleja el contrato del servidor: conserva `version`, nombres de campos
de transporte y datos que no necesariamente se muestran. El modelo de la
aplicación sólo conserva valores validados necesarios para los casos de uso.

El mapeo de payload exige, como mínimo:

- categoría perteneciente al catálogo publicado;
- descripción y ubicación como textos no vacíos;
- prioridad `low`, `medium` o `high`;
- estado perteneciente al flujo de CampusOps;
- identificadores opcionales con el tipo publicado.

No se convierten campos ausentes en título, fecha, ubicación, coordenadas o
identidades inventadas. Los textos de presentación se derivan en la UI de datos
existentes y no se guardan como si hubieran sido recibidos del servidor.

## Resultados y errores distinguibles

La capa cliente representa los resultados mediante uniones discriminadas, no
con mensajes libres provenientes del servidor:

```ts
type IncidentClientFailure =
  | { kind: 'timeout' }
  | { kind: 'network' }
  | { kind: 'http'; status: number }
  | { kind: 'invalid_json' }
  | { kind: 'contract' }
  | { kind: 'invalid_payload' };

type RemoteIncidentResult<T> =
  | { kind: 'available'; value: T }
  | { kind: 'empty_payload' }
  | { kind: 'failure'; error: IncidentClientFailure };
```

- `empty_payload` es un resultado válido y no contiene una incidencia.
- `contract` indica un sobre incompatible.
- `invalid_payload` indica un sobre correcto con dominio inválido.
- `timeout`, `network` y `http` permiten a la aplicación elegir mensajes y
  recuperación sin inspeccionar excepciones del proveedor.
- Un `500` se representa como `{ kind: "http", status: 500 }`.
- Los errores técnicos se sanitizan antes de telemetría; no se registran
  cabeceras, cuerpos libres, ubicación, descripción ni identidades.

## Pruebas sin Internet público

El contrato se reproduce con el backend local y dobles inyectables. Los casos
mínimos son `success`, `nullable`, `malformed`, `slow` con timeout del cliente y
`server_error`. Las pruebas de `parseRemoteResource` son puras y no requieren
red. Las pruebas posteriores del cliente sustituyen el transporte para que sus
resultados sean deterministas.

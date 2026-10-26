# Política de sincronización, conflictos e idempotencia (Semana 08)

## 1. Principio rector

CampusOps opera bajo una política de **integridad sin pérdida silenciosa y autoridad remota sobre asignaciones**:

1. **Qué se conserva siempre:** tanto el estado remoto actualizado en el servidor (por ejemplo, una reasignación ejecutada por coordinación) como la intención local registrada sin conexión en la cola persistente del dispositivo (`PersistentQueueOperation`). Ningún conflicto ni error de transporte autoriza a borrar una operación de la cola.
2. **Qué se combina automáticamente (`kind: 'merged'`):** cambios concurrentes sobre campos independientes respecto a la misma versión base (`base`), o cambios concurrentes sobre el mismo campo cuyo contenido JSON canónico sea idéntico.
3. **Qué requiere resolución explícita (`kind: 'conflict'`):** cambios concurrentes sobre el mismo campo con contenido JSON distinto respecto a `base`. En particular, el campo compuesto `work: { assignedTechnicianId, status }` agrupa asignación y estado operativo: si un técnico inicia atención (`status: 'in_progress'`) sin conexión desde `baseVersion: 1` mientras coordinación reasigna la incidencia a otro técnico (`assignedTechnicianId: 'technician-2'`) en el servidor (`version: 2`), ambos modifican `work` de manera incompatible.

---

## 2. Reglas de combinación y detección de conflictos (`resolveSync`)

La función pura `resolveSync(base, local, remote)` en `src/domain/sync/SyncResolver.ts` (expuesta también en `src/course-evaluation/index.ts`) compara los tres registros (`base`, `local`, `remote`) siguiendo estas reglas deterministas:

1. **Inmutabilidad estricta:** `base`, `local` y `remote` (incluyendo sus objetos y arreglos anidados) jamás se mutan. El resultado construye copias independientes.
2. **Comparación por contenido JSON canónico (`canonicalJsonContent`):** dos valores de un campo se consideran iguales si y sólo si su representación JSON con claves de objeto ordenadas alfabéticamente en todos los niveles es idéntica (`{ a: 1, b: 2 }` equivale a `{ b: 2, a: 1 }`), sin depender de la identidad de referencia en memoria.
3. **Evaluación por campo en orden alfabético:**
   - Sea $K = \text{keys}(base) \cup \text{keys}(local) \cup \text{keys}(remote)$ ordenado lexicográficamente.
   - Si sólo `local` modificó $k$ respecto a `base`, el resultado toma `local.fields[k]`.
   - Si sólo `remote` modificó $k$ respecto a `base`, el resultado toma `remote.fields[k]`.
   - Si ni `local` ni `remote` modificaron $k$, se conserva `base.fields[k]`.
   - Si ambos modificaron $k$ y `canonicalJsonContent(local.fields[k]) === canonicalJsonContent(remote.fields[k])`, convergen al mismo valor sin conflicto.
   - Si ambos modificaron $k$ con contenido JSON distinto, $k$ se agrega a la lista de campos incompatibles `fields`.
4. **Reporte determinista:** si existe al menos un campo incompatible, devuelve `{ kind: 'conflict', fields }` con los nombres de campo ordenados alfabéticamente (ej. `['priority', 'work']` o `['work']`). Si no hay campos incompatibles, devuelve `{ kind: 'merged', fields }`.

---

## 3. Reproducción y manejo de la reasignación conflictiva

### Escenario obligatorio

1. **Estado base común (`version: 1`):** `campus-inc-001` está asignada a `technician-1` con estado `assigned` (`work: { assignedTechnicianId: 'technician-1', status: 'assigned' }`).
2. **Trabajo local sin conexión:** `technician-1` inicia atención (`action: 'start'`, `baseVersion: 1`, `operationId: 'op-tech1-start-001'`) y registra nota/referencia a evidencia pendiente. Localmente su intención proyecta `work: { assignedTechnicianId: 'technician-1', status: 'in_progress' }`.
3. **Cambio concurrente remoto:** `coordinator-1` reasigna `campus-inc-001` a `technician-2` en el servidor (`action: 'assign'`, `baseVersion: 1`), avanzando el servidor a `version: 2` con `work: { assignedTechnicianId: 'technician-2', status: 'assigned' }`.
4. **Reconexión y detección:**
   - Al intentar sincronizar `op-tech1-start-001` con `baseVersion: 1`, el backend rechaza la escritura obsoleta/no autorizada (`409` / `403`) y el sincronizador consulta la versión remota actual (`version: 2`).
   - El servicio de sincronización ejecuta `resolveSync(baseRecord, localRecord, remoteRecord)` y obtiene `{ kind: 'conflict', fields: ['work'] }`.
   - **No se sobrescribe la asignación remota (`technician-2`)** ni se descarta la operación local: el almacén local actualiza la vista del recurso remoto a `version: 2` (`assignedTechnicianId: 'technician-2'`) y marca `op-tech1-start-001` en la cola persistente con `status: 'conflicted'` y `conflictFields: ['work']`.

### Preservación de la autorización por perfil (Semana 06)

- Se mantiene íntegramente `IncidentAuthorization` (`src/application/session/IncidentAuthorization.ts`) y `SessionManager` (`src/infrastructure/session/SessionManager.ts`).
- Una vez que `campus-inc-001` ha sido reasignada a `technician-2`, `IncidentAuthorization.can({ actorId: 'technician-1', role: 'technician', permission: 'start', incident: remoteIncidentV2 })` devuelve `false` (`forbidden`), impidiendo que `technician-1` fuerce su cambio sobre una incidencia que ya pertenece a `technician-2`.
- La resolución del conflicto requiere revisión explícita (reconocer la reasignación a `technician-2` conservando el registro auditable de la intención local, o intervención de `coordinator-1`).

---

## 4. Identidad estable, deduplicación, reintentos y retiro de la cola

1. **Identidad estable (`operationId` / `Idempotency-Key`):**
   - Cada operación creada en la cola recibe un `operationId` inmutable (mínimo 8 caracteres) que se conserva en disco al cerrar y reabrir la aplicación y se transmite en la cabecera HTTP `Idempotency-Key`.
2. **Deduplicación en cola (`deduplicateOperations`):**
   - Antes de procesar o persistir lotes de operaciones, `deduplicateOperations(operations)` conserva únicamente la **primera** aparición de cada `operationId`, respetando el orden original y sin mutar el arreglo de entrada.
3. **Idempotencia en el servidor al repetir la operación:**
   - Si una operación ya aplicada en el backend (por ejemplo, tras un `timeout_after_commit` o reconexión) se reenvía con el mismo `operationId` y el mismo payload, el backend devuelve `200 OK` con `{ incident, operationId, duplicate: true }` sin volver a incrementar `version` ni duplicar entradas en `history`, `notes` o `evidence`.
   - Si se reutiliza el mismo `operationId` con un payload distinto, el servidor responde `409 Conflict` (`idempotency_key_reused`).
4. **Momento exacto de retirar una operación de la cola:**
   - Una operación **sólo se retira de la cola persistente** cuando el servidor confirma su aplicación exitosa (`200` o `201` validado con `operationId` coincidente, sea `duplicate: false` o `duplicate: true`).
   - Ante `timeout`, falla de red (`network`), error `500`, `429` o conflicto (`409` / `status: 'conflicted'`), la operación **permanece en la cola persistente**.

---

## 5. Trazabilidad con las pruebas del repositorio

| Regla / Caso | Archivo de prueba | Qué verifica |
|---|---|---|
| Conflicto `work` (inicio offline vs reasignación remota), combinación de campos independientes y deduplicación pura | `course-tests/public/week-08.test.ts` y `course-tests/week-08-sync-domain.test.ts` | `resolveSync` detecta `{ kind: 'conflict', fields: ['work'] }`, combina cambios independientes, ordena conflictos por nombre, compara JSON canónico y `deduplicateOperations` conserva la primera operación sin mutar entradas. |
| Persistencia real en disco, supervivencia al reinicio, referencias a fotos pendientes y migración v1→v2 con rollback ante falla | `course-tests/week-08-persistence-migration.test.ts` | Cerrar y reabrir la tienda recupera el mismo `operationId` y contenido; las fotos pendientes conservan `uploadState: 'pending_upload'`; la falla inyectada revierte a `schemaVersion: 1` sin mezclar esquemas y la recuperación posterior completa `schemaVersion: 2`. |
| Flujo extremo a extremo contra backend CampusOps, autorización Semana 06, conflicto real e idempotencia al repetir operación | `course-tests/week-08-integration.test.ts` | Comprueba login/refresh/401/permisos de Semana 06, conflicto entre `technician-1` (offline) y `coordinator-1` (remoto), conservación de cola en conflicto/error y retiro exclusivo tras confirmación idempotente (`duplicate: true`). |

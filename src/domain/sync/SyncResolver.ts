import type {
  CloudIncident,
  IncidentActionInput,
} from '../incidents/CloudIncident';

export type SyncFieldsRecord = Readonly<Record<string, unknown>>;

export interface SyncRecordSnapshot {
  readonly id: string;
  readonly version: number;
  readonly fields: SyncFieldsRecord;
}

export type SyncResolutionResult =
  | Readonly<{ kind: 'merged'; fields: SyncFieldsRecord }>
  | Readonly<{ kind: 'conflict'; fields: readonly string[] }>;

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const sortedEntries = Object.keys(record)
      .sort()
      .map((key) => [key, canonicalizeValue(record[key])] as const);
    return Object.fromEntries(sortedEntries);
  }
  return value;
}

/**
 * Serializes a value into a deterministic JSON string with alphabetically
 * sorted object keys so structural equality is evaluated by JSON content rather
 * than reference identity or property insertion order.
 */
export function canonicalJsonContent(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value));
}

function cloneJsonValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item)) as unknown as T;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const cloned: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      cloned[key] = cloneJsonValue(record[key]);
    }
    return cloned as T;
  }
  return value;
}

function fieldStateSignature(fields: SyncFieldsRecord, key: string): string {
  if (!Object.hasOwn(fields, key) || fields[key] === undefined) {
    return '__ABSENT__';
  }
  return ` present:${canonicalJsonContent(fields[key])}`;
}

/**
 * Three-way deterministic sync resolver for CampusOps.
 *
 * Rules:
 * - Never mutates `base`, `local`, or `remote` records or their nested objects.
 * - Compares each field by canonical JSON content (`canonicalJsonContent`).
 * - Combines independent field modifications made by `local` and `remote`.
 * - If both `local` and `remote` modified the same field to identical JSON content,
 *   converges cleanly without reporting a false conflict.
 * - If `local` and `remote` modified the same field to different JSON content
 *   (such as `work: { assignedTechnicianId, status }` when a technician starts
 *   work offline while a coordinator reassigns the incident remotely), reports
 *   all conflicting field names sorted alphabetically.
 */
export function resolveSyncRecords(
  base: SyncRecordSnapshot,
  local: SyncRecordSnapshot,
  remote: SyncRecordSnapshot,
): SyncResolutionResult {
  const allKeys = new Set<string>([
    ...Object.keys(base.fields),
    ...Object.keys(local.fields),
    ...Object.keys(remote.fields),
  ]);
  const sortedKeys = [...allKeys].sort();

  const mergedFields: Record<string, unknown> = {};
  const conflictingFields: string[] = [];

  for (const key of sortedKeys) {
    const baseSig = fieldStateSignature(base.fields, key);
    const localSig = fieldStateSignature(local.fields, key);
    const remoteSig = fieldStateSignature(remote.fields, key);

    const localChanged = localSig !== baseSig;
    const remoteChanged = remoteSig !== baseSig;

    if (!localChanged && !remoteChanged) {
      if (Object.hasOwn(base.fields, key) && base.fields[key] !== undefined) {
        mergedFields[key] = cloneJsonValue(base.fields[key]);
      }
      continue;
    }

    if (localChanged && !remoteChanged) {
      if (Object.hasOwn(local.fields, key) && local.fields[key] !== undefined) {
        mergedFields[key] = cloneJsonValue(local.fields[key]);
      }
      continue;
    }

    if (!localChanged && remoteChanged) {
      if (Object.hasOwn(remote.fields, key) && remote.fields[key] !== undefined) {
        mergedFields[key] = cloneJsonValue(remote.fields[key]);
      }
      continue;
    }

    // Both local and remote changed this field relative to base.
    if (localSig === remoteSig) {
      if (Object.hasOwn(remote.fields, key) && remote.fields[key] !== undefined) {
        mergedFields[key] = cloneJsonValue(remote.fields[key]);
      }
      continue;
    }

    conflictingFields.push(key);
  }

  if (conflictingFields.length > 0) {
    return {
      kind: 'conflict',
      fields: conflictingFields,
    };
  }

  return {
    kind: 'merged',
    fields: mergedFields,
  };
}

/**
 * Deduplicates pending operations by stable `operationId`, preserving the first
 * occurrence of each `operationId` in original queue order without mutating the
 * input array or its operation items.
 */
export function deduplicatePendingOperations<
  T extends Readonly<{ operationId: string }>,
>(operations: readonly T[]): readonly T[] {
  const seenIds = new Set<string>();
  const uniqueOperations: T[] = [];

  for (const operation of operations) {
    if (seenIds.has(operation.operationId)) {
      continue;
    }
    seenIds.add(operation.operationId);
    uniqueOperations.push(operation);
  }

  return uniqueOperations;
}

/**
 * Projects a validated `CloudIncident` into a `SyncRecordSnapshot` where
 * `fields.work` groups `{ assignedTechnicianId, status }` as specified by the
 * CampusOps public contract, alongside independent fields (`priority`,
 * `description`, `location`, `category`, and optional `extraFields`).
 */
export function toIncidentSyncRecord(
  incident: CloudIncident,
  extraFields: SyncFieldsRecord = {},
): SyncRecordSnapshot {
  return {
    id: incident.id,
    version: incident.version,
    fields: {
      category: incident.category,
      description: incident.description,
      location: incident.location,
      priority: incident.priority,
      work: {
        assignedTechnicianId: incident.assignedTechnicianId ?? null,
        status: incident.status,
      },
      ...cloneJsonValue(extraFields),
    },
  };
}

/**
 * Computes the local target state of an incident after applying an offline
 * action against its base snapshot, without mutating `baseIncident`.
 */
export function projectLocalIncidentAction(
  baseIncident: CloudIncident,
  actionInput: IncidentActionInput,
): CloudIncident {
  const next: CloudIncident = {
    ...baseIncident,
  };

  switch (actionInput.action) {
    case 'assign':
      return {
        ...next,
        assignedTechnicianId: actionInput.technicianId,
        status: 'assigned',
      };
    case 'prioritize':
      return {
        ...next,
        priority: actionInput.priority,
      };
    case 'start':
      return {
        ...next,
        status: 'in_progress',
      };
    case 'resolve':
      return {
        ...next,
        status: 'resolved',
      };
    case 'close':
      return {
        ...next,
        status: 'closed',
      };
    case 'reopen':
      return {
        ...next,
        status: next.assignedTechnicianId ? 'assigned' : 'open',
      };
    case 'comment':
    case 'add_evidence':
      return next;
  }
}

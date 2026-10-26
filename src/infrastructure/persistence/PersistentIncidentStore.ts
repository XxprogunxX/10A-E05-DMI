import type {
  CloudIncident,
  IncidentActionInput,
} from '../../domain/incidents/CloudIncident';
import {
  CURRENT_SCHEMA_VERSION,
  LEGACY_SCHEMA_VERSION,
  type IncidentNoteEntry,
  type LocalStorageSchemaV1,
  type LocalStorageSchemaV2,
  type PendingEvidenceReference,
  type PersistedIncidentRecord,
  type PersistentQueueOperation,
} from '../../domain/sync/OfflineSyncTypes';
import {
  deduplicatePendingOperations,
  projectLocalIncidentAction,
} from '../../domain/sync/SyncResolver';

export interface KeyValuePersistenceDriver {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * In-memory test medium shared across store close/reopen cycles. It does not
 * survive process termination; runtime must inject a disk-backed driver.
 */
export class DurableKeyValueMedium {
  private readonly disk = new Map<string, string>();

  createDriver(): KeyValuePersistenceDriver {
    return {
      getItem: async (key: string): Promise<string | null> =>
        this.disk.get(key) ?? null,
      setItem: async (key: string, value: string): Promise<void> => {
        this.disk.set(key, value);
      },
      removeItem: async (key: string): Promise<void> => {
        this.disk.delete(key);
      },
    };
  }

  inspectRaw(key: string): unknown {
    const raw = this.disk.get(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  }
}

export interface MigrationFaultInjection {
  readonly failAfterStep?: 'incidents' | 'queue';
}

export interface MigrationAuditRecord {
  readonly before: unknown;
  readonly afterFailure: unknown;
  readonly afterRecovery: LocalStorageSchemaV2 | null;
}

const DEFAULT_STORAGE_KEY = 'campusops.offline.db.v2';
const DEFAULT_BACKUP_KEY = 'campusops.offline.db.backup';

function cloneDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSchemaV1(value: unknown): value is LocalStorageSchemaV1 {
  return (
    isObjectRecord(value) &&
    value.schemaVersion === LEGACY_SCHEMA_VERSION &&
    isObjectRecord(value.incidents) &&
    Array.isArray(value.pendingQueue)
  );
}

function isSchemaV2(value: unknown): value is LocalStorageSchemaV2 {
  return (
    isObjectRecord(value) &&
    value.schemaVersion === CURRENT_SCHEMA_VERSION &&
    isObjectRecord(value.incidents) &&
    Array.isArray(value.queue)
  );
}

export class PersistentIncidentStore {
  private closed = false;
  private state: LocalStorageSchemaV2 | null = null;

  constructor(
    private readonly driver: KeyValuePersistenceDriver,
    private readonly options: {
      readonly storageKey?: string;
      readonly backupKey?: string;
      readonly nowIso?: () => string;
    } = {},
  ) {}

  private get storageKey(): string {
    return this.options.storageKey ?? DEFAULT_STORAGE_KEY;
  }

  private get backupKey(): string {
    return this.options.backupKey ?? DEFAULT_BACKUP_KEY;
  }

  private now(): string {
    return (this.options.nowIso ?? (() => '2026-10-20T12:00:00.000Z'))();
  }

  private assertOpen(): LocalStorageSchemaV2 {
    if (this.closed || this.state === null) {
      throw new Error('PersistentIncidentStore is closed or not initialized.');
    }
    return this.state;
  }

  /**
   * Initializes the persistent store. If a v1 payload is detected, executes an
   * atomic migration to v2 with backup/rollback protection against mid-flight
   * failures so partial v2 state is never left mixed with v1.
   */
  async initialize(fault?: MigrationFaultInjection): Promise<LocalStorageSchemaV2> {
    this.closed = false;
    let raw = await this.driver.getItem(this.storageKey);
    const interruptedMigrationBackup = await this.driver.getItem(
      this.backupKey,
    );

    if (interruptedMigrationBackup !== null) {
      // A backup left across process reconstruction means the prior migration
      // never completed its commit/cleanup boundary. Restore v1 first and then
      // run the normal migration path; never inspect or expose partial v2 data.
      await this.driver.setItem(this.storageKey, interruptedMigrationBackup);
      await this.driver.removeItem(this.backupKey);
      raw = interruptedMigrationBackup;
    }

    if (raw === null) {
      const emptyState: LocalStorageSchemaV2 = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        migratedFromVersion: null,
        incidents: {},
        queue: [],
        updatedAt: this.now(),
      };
      await this.driver.setItem(this.storageKey, JSON.stringify(emptyState));
      this.state = emptyState;
      return cloneDeep(emptyState);
    }

    const parsed = JSON.parse(raw) as unknown;

    if (isSchemaV2(parsed)) {
      const deduplicated: LocalStorageSchemaV2 = {
        ...parsed,
        queue: deduplicatePendingOperations(parsed.queue),
      };
      this.state = deduplicated;
      return cloneDeep(deduplicated);
    }

    if (isSchemaV1(parsed)) {
      return this.migrateV1ToV2Transactionally(raw, parsed, fault);
    }

    throw new Error('Unsupported or corrupted local storage schema.');
  }

  private async migrateV1ToV2Transactionally(
    rawV1: string,
    v1: LocalStorageSchemaV1,
    fault?: MigrationFaultInjection,
  ): Promise<LocalStorageSchemaV2> {
    // Save untouched v1 snapshot before attempting any transformation.
    await this.driver.setItem(this.backupKey, rawV1);

    try {
      const migratedIncidents: Record<string, PersistedIncidentRecord> = {};
      for (const [id, legacy] of Object.entries(v1.incidents)) {
        migratedIncidents[id] = {
          incident: {
            id: legacy.id,
            version: legacy.version,
            status: legacy.status,
            category: legacy.category,
            description: legacy.description,
            location: legacy.location,
            priority: legacy.priority,
            ...(legacy.reporterId === undefined
              ? {}
              : { reporterId: legacy.reporterId }),
            assignedTechnicianId: legacy.assignedTo ?? null,
          },
          notes: [],
          evidence: [],
          lastSyncedVersion: legacy.version,
        };
      }

      if (fault?.failAfterStep === 'incidents') {
        // Simulate partial write attempt followed by crash mid-migration.
        await this.driver.setItem(
          this.storageKey,
          JSON.stringify({
            schemaVersion: CURRENT_SCHEMA_VERSION,
            corruptedPartialMigration: true,
            incidents: migratedIncidents,
          }),
        );
        throw new Error('Injected migration failure after incidents stage.');
      }

      const migratedQueue: PersistentQueueOperation[] = v1.pendingQueue.map(
        (item) => {
          const pendingEvidence: PendingEvidenceReference[] | undefined =
            item.evidenceIds && item.evidenceIds.length > 0
              ? item.evidenceIds.map((evidenceId) => ({
                  evidenceId,
                  localUri: `file:///local/pending/${evidenceId}.jpg`,
                  mimeType: 'image/jpeg',
                  uploadState: 'pending_upload',
                }))
              : undefined;

          return {
            operationId: item.opId,
            incidentId: item.incidentId,
            baseVersion: item.version,
            actorId: item.actor,
            action: item.action,
            payload: item.body,
            createdAt: item.createdAt ?? this.now(),
            status: 'pending',
            ...(pendingEvidence ? { pendingEvidence } : {}),
          };
        },
      );

      if (fault?.failAfterStep === 'queue') {
        await this.driver.setItem(
          this.storageKey,
          JSON.stringify({
            schemaVersion: CURRENT_SCHEMA_VERSION,
            corruptedPartialMigration: true,
            incidents: migratedIncidents,
            pendingQueue: v1.pendingQueue,
          }),
        );
        throw new Error('Injected migration failure after queue stage.');
      }

      const nextState: LocalStorageSchemaV2 = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        migratedFromVersion: LEGACY_SCHEMA_VERSION,
        incidents: migratedIncidents,
        queue: deduplicatePendingOperations(migratedQueue),
        updatedAt: this.now(),
      };

      await this.driver.setItem(this.storageKey, JSON.stringify(nextState));
      await this.driver.removeItem(this.backupKey);
      this.state = nextState;
      return cloneDeep(nextState);
    } catch (error: unknown) {
      // Atomic rollback: restore original v1 snapshot so v1 and v2 never mix.
      const backupRaw = await this.driver.getItem(this.backupKey);
      if (backupRaw !== null) {
        await this.driver.setItem(this.storageKey, backupRaw);
        await this.driver.removeItem(this.backupKey);
      }
      this.state = null;
      throw error;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.state = null;
  }

  async saveIncident(
    incident: CloudIncident,
    options: {
      readonly notes?: readonly IncidentNoteEntry[];
      readonly evidence?: readonly PendingEvidenceReference[];
      readonly lastSyncedVersion?: number;
    } = {},
  ): Promise<PersistedIncidentRecord> {
    const current = this.assertOpen();
    const existing = current.incidents[incident.id];
    const record: PersistedIncidentRecord = {
      incident: cloneDeep(incident),
      notes: cloneDeep(options.notes ?? existing?.notes ?? []),
      evidence: cloneDeep(options.evidence ?? existing?.evidence ?? []),
      lastSyncedVersion:
        options.lastSyncedVersion ??
        existing?.lastSyncedVersion ??
        incident.version,
    };

    const nextState: LocalStorageSchemaV2 = {
      ...current,
      incidents: {
        ...current.incidents,
        [incident.id]: record,
      },
      updatedAt: this.now(),
    };
    await this.persistState(nextState);
    return cloneDeep(record);
  }

  async getIncidentRecord(
    incidentId: string,
  ): Promise<PersistedIncidentRecord | null> {
    const current = this.assertOpen();
    const record = current.incidents[incidentId];
    return record ? cloneDeep(record) : null;
  }

  async enqueueOfflineOperation(input: {
    readonly operationId: string;
    readonly incidentId: string;
    readonly actorId: string;
    readonly payload: IncidentActionInput;
    readonly createdAt?: string;
    readonly pendingEvidence?: readonly PendingEvidenceReference[];
  }): Promise<PersistentQueueOperation> {
    const current = this.assertOpen();
    const existingOperation = current.queue.find(
      (item) => item.operationId === input.operationId,
    );
    if (existingOperation !== undefined) {
      return cloneDeep(existingOperation);
    }

    const record = current.incidents[input.incidentId];

    // Ensure pending evidence references are explicitly marked pending_upload.
    const normalizedEvidence: PendingEvidenceReference[] | undefined =
      input.pendingEvidence?.map((item) => ({
        ...item,
        uploadState: 'pending_upload',
      }));

    const operation: PersistentQueueOperation = {
      operationId: input.operationId,
      incidentId: input.incidentId,
      baseVersion: input.payload.baseVersion,
      actorId: input.actorId,
      action: input.payload.action,
      payload: cloneDeep(input.payload),
      createdAt: input.createdAt ?? this.now(),
      status: 'pending',
      ...(normalizedEvidence ? { pendingEvidence: normalizedEvidence } : {}),
    };

    const updatedQueue = deduplicatePendingOperations([
      ...current.queue,
      operation,
    ]);

    let updatedIncidents = current.incidents;
    if (record !== undefined) {
      const projectedIncident = projectLocalIncidentAction(
        record.incident,
        input.payload,
      );
      const nextNotes: IncidentNoteEntry[] =
        input.payload.action === 'comment'
          ? [
              ...record.notes,
              { actorId: input.actorId, text: input.payload.text },
            ]
          : [...record.notes];
      const nextEvidence: PendingEvidenceReference[] = normalizedEvidence
        ? [...record.evidence, ...normalizedEvidence]
        : [...record.evidence];

      updatedIncidents = {
        ...current.incidents,
        [input.incidentId]: {
          ...record,
          incident: projectedIncident,
          notes: nextNotes,
          evidence: nextEvidence,
        },
      };
    }

    await this.persistState({
      ...current,
      incidents: updatedIncidents,
      queue: updatedQueue,
      updatedAt: this.now(),
    });

    const stored = updatedQueue.find(
      (item) => item.operationId === input.operationId,
    );
    return cloneDeep(stored ?? operation);
  }

  async getQueue(): Promise<readonly PersistentQueueOperation[]> {
    const current = this.assertOpen();
    return cloneDeep(current.queue);
  }

  async markOperationConflicted(
    operationId: string,
    conflictFields: readonly string[],
    remoteIncident?: CloudIncident,
  ): Promise<void> {
    const current = this.assertOpen();
    const updatedQueue = current.queue.map((item) =>
      item.operationId === operationId
        ? {
            ...item,
            status: 'conflicted' as const,
            conflictFields: [...conflictFields],
          }
        : item,
    );

    const updatedIncidents =
      remoteIncident !== undefined
        ? {
            ...current.incidents,
            [remoteIncident.id]: {
              incident: cloneDeep(remoteIncident),
              notes: current.incidents[remoteIncident.id]?.notes ?? [],
              evidence: current.incidents[remoteIncident.id]?.evidence ?? [],
              lastSyncedVersion: remoteIncident.version,
            },
          }
        : current.incidents;

    await this.persistState({
      ...current,
      incidents: updatedIncidents,
      queue: updatedQueue,
      updatedAt: this.now(),
    });
  }

  async markOperationFailed(
    operationId: string,
    errorCode: string,
  ): Promise<void> {
    const current = this.assertOpen();
    const updatedQueue = current.queue.map((item) =>
      item.operationId === operationId
        ? {
            ...item,
            status: 'failed' as const,
            lastError: errorCode,
          }
        : item,
    );

    await this.persistState({
      ...current,
      queue: updatedQueue,
      updatedAt: this.now(),
    });
  }

  /**
   * Removes an operation from the persistent queue ONLY after the server has
   * confirmed its execution (200/201). Also marks any associated evidence
   * references as uploaded.
   */
  async confirmOperationSynced(
    operationId: string,
    confirmedIncident: CloudIncident,
  ): Promise<void> {
    const current = this.assertOpen();
    const targetOp = current.queue.find(
      (item) => item.operationId === operationId,
    );
    const remainingQueue = current.queue.filter(
      (item) => item.operationId !== operationId,
    );

    const existingRecord = current.incidents[confirmedIncident.id];
    const confirmedEvidenceIds = new Set(
      targetOp?.pendingEvidence?.map((ev) => ev.evidenceId) ?? [],
    );

    const updatedEvidence: PendingEvidenceReference[] = (
      existingRecord?.evidence ?? []
    ).map((ev) =>
      confirmedEvidenceIds.has(ev.evidenceId)
        ? { ...ev, uploadState: 'uploaded' }
        : ev,
    );

    await this.persistState({
      ...current,
      incidents: {
        ...current.incidents,
        [confirmedIncident.id]: {
          incident: cloneDeep(confirmedIncident),
          notes: existingRecord?.notes ?? [],
          evidence: updatedEvidence,
          lastSyncedVersion: confirmedIncident.version,
        },
      },
      queue: remainingQueue,
      updatedAt: this.now(),
    });
  }

  private async persistState(nextState: LocalStorageSchemaV2): Promise<void> {
    await this.driver.setItem(this.storageKey, JSON.stringify(nextState));
    this.state = nextState;
  }
}

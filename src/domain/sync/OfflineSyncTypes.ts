import type {
  CloudIncident,
  IncidentActionInput,
  IncidentActionName,
  IncidentCategory,
} from '../incidents/CloudIncident';
import type { IncidentPriority, IncidentStatus } from '../incidents/Incident';

export const LEGACY_SCHEMA_VERSION = 1 as const;
export const CURRENT_SCHEMA_VERSION = 2 as const;

export type QueueOperationStatus = 'pending' | 'conflicted' | 'failed';

/**
 * Represents a local reference to a photograph or attachment captured offline.
 * A pending reference (`pending_upload`) identifies a queued local resource and
 * never implies that the binary file has already been uploaded to the backend.
 */
export interface PendingEvidenceReference {
  readonly evidenceId: string;
  readonly localUri: string;
  readonly mimeType: 'image/jpeg' | 'image/png';
  readonly uploadState: 'pending_upload' | 'uploaded';
}

export interface IncidentNoteEntry {
  readonly actorId: string;
  readonly text: string;
}

/**
 * Persistent operation queue item required by Week 08.
 * Preserves stable `operationId`, target `incidentId`, `actorId`, `baseVersion`,
 * action content (`payload`), and conflict metadata across app restarts.
 */
export interface PersistentQueueOperation {
  readonly operationId: string;
  readonly incidentId: string;
  readonly baseVersion: number;
  readonly actorId: string;
  readonly action: IncidentActionName;
  readonly payload: IncidentActionInput;
  readonly createdAt: string;
  readonly status: QueueOperationStatus;
  readonly conflictFields?: readonly string[];
  readonly pendingEvidence?: readonly PendingEvidenceReference[];
  readonly lastError?: string;
}

export interface PersistedIncidentRecord {
  readonly incident: CloudIncident;
  readonly notes: readonly IncidentNoteEntry[];
  readonly evidence: readonly PendingEvidenceReference[];
  readonly lastSyncedVersion: number;
}

/** Legacy Schema v1 structure prior to Week 08 migration. */
export interface LegacyIncidentRecordV1 {
  readonly id: string;
  readonly version: number;
  readonly status: IncidentStatus;
  readonly category: IncidentCategory;
  readonly description: string;
  readonly location: string;
  readonly priority: IncidentPriority;
  readonly reporterId?: string;
  readonly assignedTo?: string | null;
}

export interface LegacyQueueOperationV1 {
  readonly opId: string;
  readonly incidentId: string;
  readonly version: number;
  readonly actor: string;
  readonly action: IncidentActionName;
  readonly body: IncidentActionInput;
  readonly createdAt?: string;
  readonly evidenceIds?: readonly string[];
}

export interface LocalStorageSchemaV1 {
  readonly schemaVersion: typeof LEGACY_SCHEMA_VERSION;
  readonly incidents: Readonly<Record<string, LegacyIncidentRecordV1>>;
  readonly pendingQueue: readonly LegacyQueueOperationV1[];
}

export interface LocalStorageSchemaV2 {
  readonly schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  readonly migratedFromVersion: number | null;
  readonly incidents: Readonly<Record<string, PersistedIncidentRecord>>;
  readonly queue: readonly PersistentQueueOperation[];
  readonly updatedAt: string;
}

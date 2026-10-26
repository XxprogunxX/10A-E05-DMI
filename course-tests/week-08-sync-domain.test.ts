import { deduplicateOperations, resolveSync } from '../src/course-evaluation';
import type { CloudIncident } from '../src/domain/incidents/CloudIncident';
import {
  CURRENT_SCHEMA_VERSION,
  LEGACY_SCHEMA_VERSION,
  type PersistentQueueOperation,
} from '../src/domain/sync/OfflineSyncTypes';
import {
  canonicalJsonContent,
  projectLocalIncidentAction,
  toIncidentSyncRecord,
} from '../src/domain/sync/SyncResolver';

describe('Week 08 — Sync Domain, Conflict Resolution and Deduplication (Javier)', () => {
  const baseIncident: CloudIncident = {
    id: 'campus-inc-001',
    version: 1,
    status: 'assigned',
    category: 'connectivity',
    description: 'Sin conexión en laboratorio ficticio',
    location: 'Edificio de prueba A',
    priority: 'medium',
    reporterId: 'reporter-1',
    assignedTechnicianId: 'technician-1',
  };

  it('detects conflict on work field when technician starts offline while coordinator reassigns remotely (nominal/conflict)', () => {
    const localStarted = projectLocalIncidentAction(baseIncident, {
      action: 'start',
      baseVersion: 1,
    });
    const remoteReassigned: CloudIncident = {
      ...projectLocalIncidentAction(baseIncident, {
        action: 'assign',
        baseVersion: 1,
        technicianId: 'technician-2',
      }),
      version: 2,
    };

    const baseRecord = toIncidentSyncRecord(baseIncident);
    const localRecord = toIncidentSyncRecord(localStarted);
    const remoteRecord = toIncidentSyncRecord(remoteReassigned);

    const snapshotBefore = JSON.stringify([baseRecord, localRecord, remoteRecord]);
    const resolution = resolveSync(baseRecord, localRecord, remoteRecord);

    expect(resolution).toEqual({
      kind: 'conflict',
      fields: ['work'],
    });
    expect(JSON.stringify([baseRecord, localRecord, remoteRecord])).toBe(
      snapshotBefore,
    );
  });

  it('merges independent changes from local technician start and remote coordinator prioritization without mutating inputs (nominal)', () => {
    const localStarted = projectLocalIncidentAction(baseIncident, {
      action: 'start',
      baseVersion: 1,
    });
    const remotePrioritized: CloudIncident = {
      ...projectLocalIncidentAction(baseIncident, {
        action: 'prioritize',
        baseVersion: 1,
        priority: 'high',
      }),
      version: 2,
    };

    const baseRecord = toIncidentSyncRecord(baseIncident);
    const localRecord = toIncidentSyncRecord(localStarted);
    const remoteRecord = toIncidentSyncRecord(remotePrioritized);

    const resolution = resolveSync(baseRecord, localRecord, remoteRecord);

    expect(resolution).toEqual({
      kind: 'merged',
      fields: {
        category: 'connectivity',
        description: 'Sin conexión en laboratorio ficticio',
        location: 'Edificio de prueba A',
        priority: 'high',
        work: {
          assignedTechnicianId: 'technician-1',
          status: 'in_progress',
        },
      },
    });
  });

  it('reports multiple conflicting field names sorted alphabetically and compares by canonical JSON content (boundary)', () => {
    const base = {
      id: 'campus-inc-001',
      version: 1,
      fields: {
        work: { assignedTechnicianId: 'technician-1', status: 'assigned' },
        priority: 'medium',
        diagnosis: null,
        metadata: { building: 'A', floor: 2 },
      },
    };
    const local = {
      id: 'campus-inc-001',
      version: 1,
      fields: {
        work: { assignedTechnicianId: 'technician-1', status: 'in_progress' },
        priority: 'low',
        diagnosis: 'Switch dañado en rack principal',
        // Reordered keys with identical JSON content to remote:
        metadata: { floor: 3, building: 'A' },
      },
    };
    const remote = {
      id: 'campus-inc-001',
      version: 2,
      fields: {
        work: { assignedTechnicianId: 'technician-2', status: 'assigned' },
        priority: 'high',
        diagnosis: 'Revisión preliminar por coordinación',
        metadata: { building: 'A', floor: 3 },
      },
    };

    expect(canonicalJsonContent(local.fields.metadata)).toBe(
      canonicalJsonContent(remote.fields.metadata),
    );

    const resolution = resolveSync(base, local, remote);
    expect(resolution).toEqual({
      kind: 'conflict',
      fields: ['diagnosis', 'priority', 'work'],
    });
  });

  it('deduplicates repeated operationIds keeping the first operation without mutating the input array (nominal/boundary)', () => {
    const queue: readonly PersistentQueueOperation[] = Object.freeze([
      {
        operationId: 'op-tech1-start-001',
        incidentId: 'campus-inc-001',
        baseVersion: 1,
        actorId: 'technician-1',
        action: 'start',
        payload: { action: 'start', baseVersion: 1 },
        createdAt: '2026-10-20T10:00:00.000Z',
        status: 'pending',
      },
      {
        operationId: 'op-tech1-start-001',
        incidentId: 'campus-inc-001',
        baseVersion: 1,
        actorId: 'technician-1',
        action: 'start',
        payload: { action: 'start', baseVersion: 1 },
        createdAt: '2026-10-20T10:05:00.000Z',
        status: 'pending',
      },
      {
        operationId: 'op-tech1-evidence-002',
        incidentId: 'campus-inc-001',
        baseVersion: 1,
        actorId: 'technician-1',
        action: 'add_evidence',
        payload: {
          action: 'add_evidence',
          baseVersion: 1,
          evidenceId: 'ev-campus-001-photo-1',
        },
        createdAt: '2026-10-20T10:02:00.000Z',
        status: 'pending',
        pendingEvidence: [
          {
            evidenceId: 'ev-campus-001-photo-1',
            localUri: 'file:///local/pending/ev-campus-001-photo-1.jpg',
            mimeType: 'image/jpeg',
            uploadState: 'pending_upload',
          },
        ],
      },
    ]);

    const snapshot = JSON.stringify(queue);
    const deduplicated = deduplicateOperations(queue);

    expect(deduplicated).toHaveLength(2);
    expect(deduplicated[0]).toBe(queue[0]);
    expect(deduplicated[1]).toBe(queue[2]);
    expect(deduplicated[1]?.pendingEvidence?.[0]?.uploadState).toBe(
      'pending_upload',
    );
    expect(JSON.stringify(queue)).toBe(snapshot);
    expect(LEGACY_SCHEMA_VERSION).toBe(1);
    expect(CURRENT_SCHEMA_VERSION).toBe(2);
  });
});

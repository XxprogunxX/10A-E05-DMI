import type { CloudIncident } from '../src/domain/incidents/CloudIncident';
import {
  CURRENT_SCHEMA_VERSION,
  LEGACY_SCHEMA_VERSION,
  type LocalStorageSchemaV1,
} from '../src/domain/sync/OfflineSyncTypes';
import {
  DurableKeyValueMedium,
  PersistentIncidentStore,
} from '../src/infrastructure/persistence/PersistentIncidentStore';

describe('Week 08 — Persistent Queue Restart and Atomic Schema Migration (Francisco)', () => {
  const initialIncident: CloudIncident = {
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

  it('preserves queued offline start, note and pending photo reference across app close and reopen (nominal)', async () => {
    const medium = new DurableKeyValueMedium();

    // First app session (offline technician-1)
    const storeSession1 = new PersistentIncidentStore(medium.createDriver());
    await storeSession1.initialize();
    await storeSession1.saveIncident(initialIncident);

    await storeSession1.enqueueOfflineOperation({
      operationId: 'op-tech1-start-001',
      incidentId: 'campus-inc-001',
      actorId: 'technician-1',
      payload: { action: 'start', baseVersion: 1 },
      createdAt: '2026-10-20T09:00:00.000Z',
    });

    await storeSession1.enqueueOfflineOperation({
      operationId: 'op-tech1-comment-002',
      incidentId: 'campus-inc-001',
      actorId: 'technician-1',
      payload: {
        action: 'comment',
        baseVersion: 1,
        text: 'Revisión física iniciada sin red en el rack A',
      },
      createdAt: '2026-10-20T09:01:00.000Z',
    });

    await storeSession1.enqueueOfflineOperation({
      operationId: 'op-tech1-evidence-003',
      incidentId: 'campus-inc-001',
      actorId: 'technician-1',
      payload: {
        action: 'add_evidence',
        baseVersion: 1,
        evidenceId: 'ev-campus-001-photo-1',
      },
      createdAt: '2026-10-20T09:02:00.000Z',
      pendingEvidence: [
        {
          evidenceId: 'ev-campus-001-photo-1',
          localUri: 'file:///local/pending/ev-campus-001-photo-1.jpg',
          mimeType: 'image/jpeg',
          uploadState: 'pending_upload',
        },
      ],
    });

    // Close the store; this test medium remains alive in the same process.
    await storeSession1.close();
    await expect(storeSession1.getQueue()).rejects.toThrow(
      /closed or not initialized/i,
    );

    // Reopen application with a new store instance over the same durable medium
    const storeSession2 = new PersistentIncidentStore(medium.createDriver());
    await storeSession2.initialize();

    const recoveredQueue = await storeSession2.getQueue();
    const recoveredRecord =
      await storeSession2.getIncidentRecord('campus-inc-001');

    expect(recoveredQueue).toHaveLength(3);
    expect(recoveredQueue.map((item) => item.operationId)).toEqual([
      'op-tech1-start-001',
      'op-tech1-comment-002',
      'op-tech1-evidence-003',
    ]);
    expect(recoveredQueue[0]?.payload).toEqual({
      action: 'start',
      baseVersion: 1,
    });
    expect(recoveredQueue[1]?.payload).toEqual({
      action: 'comment',
      baseVersion: 1,
      text: 'Revisión física iniciada sin red en el rack A',
    });
    // Pending photo reference identifies a queued resource, NOT an already uploaded image:
    expect(recoveredQueue[2]?.pendingEvidence).toEqual([
      {
        evidenceId: 'ev-campus-001-photo-1',
        localUri: 'file:///local/pending/ev-campus-001-photo-1.jpg',
        mimeType: 'image/jpeg',
        uploadState: 'pending_upload',
      },
    ]);
    expect(recoveredRecord?.incident.status).toBe('in_progress');
    expect(recoveredRecord?.notes).toEqual([
      {
        actorId: 'technician-1',
        text: 'Revisión física iniciada sin red en el rack A',
      },
    ]);
    expect(recoveredRecord?.evidence[0]?.uploadState).toBe('pending_upload');
  });

  it('migrates schema v1 data to schema v2 preserving incidents and pending operations (nominal)', async () => {
    const medium = new DurableKeyValueMedium();
    const driver = medium.createDriver();

    const legacyV1Data: LocalStorageSchemaV1 = {
      schemaVersion: LEGACY_SCHEMA_VERSION,
      incidents: {
        'campus-inc-001': {
          id: 'campus-inc-001',
          version: 1,
          status: 'assigned',
          category: 'connectivity',
          description: 'Sin conexión en laboratorio ficticio',
          location: 'Edificio de prueba A',
          priority: 'medium',
          reporterId: 'reporter-1',
          assignedTo: 'technician-1',
        },
      },
      pendingQueue: [
        {
          opId: 'op-legacy-start-001',
          incidentId: 'campus-inc-001',
          version: 1,
          actor: 'technician-1',
          action: 'start',
          body: { action: 'start', baseVersion: 1 },
          createdAt: '2026-10-20T08:30:00.000Z',
          evidenceIds: ['ev-legacy-photo-1'],
        },
      ],
    };

    await driver.setItem(
      'campusops.offline.db.v2',
      JSON.stringify(legacyV1Data),
    );

    const store = new PersistentIncidentStore(driver);
    const migrated = await store.initialize();

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.migratedFromVersion).toBe(LEGACY_SCHEMA_VERSION);
    expect(
      migrated.incidents['campus-inc-001']?.incident.assignedTechnicianId,
    ).toBe('technician-1');
    expect(migrated.queue).toHaveLength(1);
    expect(migrated.queue[0]?.operationId).toBe('op-legacy-start-001');
    expect(migrated.queue[0]?.baseVersion).toBe(1);
    expect(migrated.queue[0]?.actorId).toBe('technician-1');
    expect(migrated.queue[0]?.pendingEvidence?.[0]?.uploadState).toBe(
      'pending_upload',
    );
  });

  it.each(['incidents', 'queue'] as const)('rolls back after the %s stage and recovers without mixing schemas (failure/boundary)', async (failAfterStep) => {
    const medium = new DurableKeyValueMedium();
    const driver = medium.createDriver();
    const storageKey = 'campusops.offline.db.v2';

    const legacyV1Data: LocalStorageSchemaV1 = {
      schemaVersion: LEGACY_SCHEMA_VERSION,
      incidents: {
        'campus-inc-001': {
          id: 'campus-inc-001',
          version: 1,
          status: 'assigned',
          category: 'connectivity',
          description: 'Sin conexión en laboratorio ficticio',
          location: 'Edificio de prueba A',
          priority: 'medium',
          reporterId: 'reporter-1',
          assignedTo: 'technician-1',
        },
      },
      pendingQueue: [
        {
          opId: 'op-legacy-start-001',
          incidentId: 'campus-inc-001',
          version: 1,
          actor: 'technician-1',
          action: 'start',
          body: { action: 'start', baseVersion: 1 },
          createdAt: '2026-10-20T08:30:00.000Z',
        },
        {
          opId: 'op-legacy-evidence-002',
          incidentId: 'campus-inc-001',
          version: 1,
          actor: 'technician-1',
          action: 'add_evidence',
          body: {
            action: 'add_evidence',
            baseVersion: 1,
            evidenceId: 'ev-campus-001-photo-1',
          },
          createdAt: '2026-10-20T08:31:00.000Z',
          evidenceIds: ['ev-campus-001-photo-1'],
        },
      ],
    };

    await driver.setItem(storageKey, JSON.stringify(legacyV1Data));

    // 1. State BEFORE migration
    const stateBefore = medium.inspectRaw(storageKey);
    expect(stateBefore).toEqual(legacyV1Data);

    // 2. Inject failure during migration (after incidents stage, before queue completes)
    const failingStore = new PersistentIncidentStore(driver);
    await expect(
      failingStore.initialize({ failAfterStep }),
    ).rejects.toThrow(`Injected migration failure after ${failAfterStep} stage.`);

    // State AFTER FAILURE must be rolled back completely to v1, never half-v2
    const stateAfterFailure = medium.inspectRaw(storageKey) as Record<
      string,
      unknown
    >;
    expect(stateAfterFailure).toEqual(legacyV1Data);
    expect(stateAfterFailure.schemaVersion).toBe(LEGACY_SCHEMA_VERSION);
    expect(stateAfterFailure.corruptedPartialMigration).toBeUndefined();

    // 3. State AFTER RECOVERY (retry initialization without injected fault)
    const recoveredStore = new PersistentIncidentStore(driver);
    const stateAfterRecovery = await recoveredStore.initialize();

    expect(stateAfterRecovery.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(stateAfterRecovery.migratedFromVersion).toBe(LEGACY_SCHEMA_VERSION);
    expect(Object.keys(stateAfterRecovery.incidents)).toEqual([
      'campus-inc-001',
    ]);
    expect(stateAfterRecovery.queue.map((op) => op.operationId)).toEqual([
      'op-legacy-start-001',
      'op-legacy-evidence-002',
    ]);
  });

  it('migrates a legacy incident without an optional reporter identifier', async () => {
    const medium = new DurableKeyValueMedium();
    const driver = medium.createDriver();
    const { reporterId: _reporterId, ...withoutReporter } = initialIncident;
    const legacy: LocalStorageSchemaV1 = {
      schemaVersion: LEGACY_SCHEMA_VERSION,
      incidents: { [withoutReporter.id]: withoutReporter },
      pendingQueue: [],
    };
    await driver.setItem('campusops.offline.db.v2', JSON.stringify(legacy));
    const store = new PersistentIncidentStore(driver);

    const migrated = await store.initialize();

    expect(migrated.incidents[initialIncident.id]?.incident).not.toHaveProperty(
      'reporterId',
    );
    await store.close();
    const reopened = new PersistentIncidentStore(medium.createDriver());
    expect(await reopened.initialize()).toEqual(migrated);
  });
});

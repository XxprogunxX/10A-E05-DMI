import type {
  CloudIncident,
  IncidentActionInput,
} from '../../domain/incidents/CloudIncident';
import type { CloudIncidentRepository } from '../../domain/incidents/CloudIncidentRepository';
import type { SessionIdentityProvider } from '../../domain/session/SessionIdentity';
import type {
  OfflineIncidentStorePort,
  PendingEvidenceReference,
  PersistentQueueOperation,
} from '../../domain/sync/OfflineSyncTypes';
import {
  deduplicatePendingOperations,
  projectLocalIncidentAction,
  resolveSyncRecords,
  toIncidentSyncRecord,
  type SyncFieldsRecord,
} from '../../domain/sync/SyncResolver';
import {
  IncidentAuthorization,
  IncidentAuthorizationFailure,
} from '../session/IncidentAuthorization';

export type EnqueueOfflineResult =
  | Readonly<{ kind: 'queued'; operation: PersistentQueueOperation }>
  | Readonly<{
      kind: 'error';
      error: 'unauthenticated' | 'forbidden' | 'not_found';
    }>;

export type SyncOperationOutcome =
  | Readonly<{
      operationId: string;
      status: 'synced';
      duplicate: boolean;
      incident: CloudIncident;
    }>
  | Readonly<{
      operationId: string;
      status: 'merged_and_synced';
      mergedFields: SyncFieldsRecord;
      incident: CloudIncident;
    }>
  | Readonly<{
      operationId: string;
      status: 'conflict';
      conflictFields: readonly string[];
      remoteIncident: CloudIncident;
      authorizationStillValid: boolean;
    }>
  | Readonly<{
      operationId: string;
      status: 'pending_retry';
      error: string;
    }>;

export class OfflineIncidentSyncService {
  constructor(
    private readonly store: OfflineIncidentStorePort,
    private readonly repository: CloudIncidentRepository,
    private readonly authorization: IncidentAuthorization,
    private readonly session: SessionIdentityProvider,
  ) {}

  async cacheRemoteIncident(
    incidentId: string,
  ): Promise<
    | Readonly<{ kind: 'cached'; incident: CloudIncident }>
    | Readonly<{ kind: 'error'; error: string }>
  > {
    const remote = await this.repository.getById(incidentId);
    if (remote.kind !== 'available') {
      return {
        kind: 'error',
        error:
          remote.kind === 'empty_payload'
            ? 'empty_payload'
            : remote.error.kind,
      };
    }

    await this.store.saveIncident(remote.value, {
      lastSyncedVersion: remote.value.version,
    });
    return { kind: 'cached', incident: remote.value };
  }

  async enqueueOfflineAction(input: {
    readonly operationId: string;
    readonly incidentId: string;
    readonly payload: IncidentActionInput;
    readonly createdAt?: string;
    readonly pendingEvidence?: readonly PendingEvidenceReference[];
    readonly baseIncidentSnapshot?: CloudIncident;
  }): Promise<EnqueueOfflineResult> {
    const identity = this.session.getSessionSnapshot();
    if (identity === null || identity.role === null) {
      return { kind: 'error', error: 'unauthenticated' };
    }

    const storedRecord = await this.store.getIncidentRecord(input.incidentId);
    const baseIncident = input.baseIncidentSnapshot ?? storedRecord?.incident;
    if (baseIncident === undefined) {
      return { kind: 'error', error: 'not_found' };
    }

    try {
      this.authorization.assertAuthorized({
        actorId: identity.actorId,
        role: identity.role,
        permission: input.payload.action,
        incident: baseIncident,
      });
    } catch (error: unknown) {
      if (error instanceof IncidentAuthorizationFailure) {
        return { kind: 'error', error: error.kind };
      }
      throw error;
    }

    const operation = await this.store.enqueueOfflineOperation({
      operationId: input.operationId,
      incidentId: input.incidentId,
      actorId: identity.actorId,
      payload: input.payload,
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
      ...(input.pendingEvidence === undefined
        ? {}
        : { pendingEvidence: input.pendingEvidence }),
    });

    return { kind: 'queued', operation };
  }

  async syncPendingQueue(
    options: {
      readonly remoteStateInspector?: CloudIncidentRepository;
      readonly baseSnapshots?: Readonly<Record<string, CloudIncident>>;
    } = {},
  ): Promise<readonly SyncOperationOutcome[]> {
    const rawQueue = await this.store.getQueue();
    const queue = deduplicatePendingOperations(rawQueue).filter(
      (operation) => operation.status !== 'conflicted',
    );
    const outcomes: SyncOperationOutcome[] = [];

    for (const operation of queue) {
      const identity = this.session.getSessionSnapshot();
      if (identity === null || identity.role === null) {
        await this.recordPendingFailure(
          operation,
          'unauthenticated',
          outcomes,
        );
        continue;
      }
      if (identity.actorId !== operation.actorId) {
        await this.recordPendingFailure(operation, 'forbidden', outcomes);
        continue;
      }

      const attempt = await this.repository.performAction(
        operation.incidentId,
        operation.payload,
        operation.operationId,
      );

      if (attempt.kind === 'available') {
        await this.store.confirmOperationSynced(
          operation.operationId,
          attempt.value.incident,
        );
        outcomes.push({
          operationId: operation.operationId,
          status: 'synced',
          duplicate: attempt.value.duplicate,
          incident: attempt.value.incident,
        });
        continue;
      }

      if (
        attempt.kind === 'failure' &&
        attempt.error.kind === 'http' &&
        (attempt.error.status === 409 || attempt.error.status === 403)
      ) {
        const remoteIncident = await this.fetchRemoteIncidentForConflict(
          operation.incidentId,
          options.remoteStateInspector,
        );

        if (remoteIncident !== null) {
          const baseIncident =
            options.baseSnapshots?.[operation.incidentId] ??
            this.reconstructBaseIncident(operation, remoteIncident);
          const resolution = resolveSyncRecords(
            toIncidentSyncRecord(baseIncident),
            toIncidentSyncRecord(
              projectLocalIncidentAction(baseIncident, operation.payload),
            ),
            toIncidentSyncRecord(remoteIncident),
          );
          const authorizationStillValid = this.authorization.can({
            actorId: identity.actorId,
            role: identity.role,
            permission: operation.action,
            incident: remoteIncident,
          });

          if (resolution.kind === 'conflict' || !authorizationStillValid) {
            const conflictFields =
              resolution.kind === 'conflict' ? resolution.fields : ['work'];
            await this.store.markOperationConflicted(
              operation.operationId,
              conflictFields,
              remoteIncident,
            );
            outcomes.push({
              operationId: operation.operationId,
              status: 'conflict',
              conflictFields,
              remoteIncident,
              authorizationStillValid,
            });
            continue;
          }

          const rebasedAttempt = await this.repository.performAction(
            operation.incidentId,
            { ...operation.payload, baseVersion: remoteIncident.version },
            operation.operationId,
          );
          if (rebasedAttempt.kind === 'available') {
            await this.store.confirmOperationSynced(
              operation.operationId,
              rebasedAttempt.value.incident,
            );
            outcomes.push({
              operationId: operation.operationId,
              status: 'merged_and_synced',
              mergedFields: resolution.fields,
              incident: rebasedAttempt.value.incident,
            });
            continue;
          }

          await this.recordPendingFailure(
            operation,
            this.errorCode(rebasedAttempt),
            outcomes,
          );
          continue;
        }
      }

      await this.recordPendingFailure(
        operation,
        this.errorCode(attempt),
        outcomes,
      );
    }

    return outcomes;
  }

  private async fetchRemoteIncidentForConflict(
    incidentId: string,
    inspector?: CloudIncidentRepository,
  ): Promise<CloudIncident | null> {
    const direct = await this.repository.getById(incidentId);
    if (direct.kind === 'available') {
      return direct.value;
    }
    if (inspector !== undefined) {
      const inspected = await inspector.getById(incidentId);
      if (inspected.kind === 'available') {
        return inspected.value;
      }
    }
    return null;
  }

  private reconstructBaseIncident(
    operation: PersistentQueueOperation,
    remoteIncident: CloudIncident,
  ): CloudIncident {
    return {
      ...remoteIncident,
      version: operation.baseVersion,
      status: 'assigned',
      assignedTechnicianId: operation.actorId,
    };
  }

  private errorCode(
    result: Awaited<
      ReturnType<CloudIncidentRepository['performAction']>
    >,
  ): string {
    if (result.kind === 'failure') {
      return result.error.kind;
    }
    return result.kind === 'empty_payload' ? 'contract' : 'unknown';
  }

  private async recordPendingFailure(
    operation: PersistentQueueOperation,
    error: string,
    outcomes: SyncOperationOutcome[],
  ): Promise<void> {
    await this.store.markOperationFailed(operation.operationId, error);
    outcomes.push({
      operationId: operation.operationId,
      status: 'pending_retry',
      error,
    });
  }
}

import type {
  AuthEvent,
  JsonObject,
  ParseResult,
  PermissionEvent,
  RemoteResponse,
  SyncRecord,
} from './contracts';
import type { IncidentLocation } from '../campusops/contracts';
import { selectIncidentLocation as selectValidatedIncidentLocation } from '../domain/location/IncidentLocationSelector';
import { planRetry as planBoundedRetry } from '../domain/resilience/RetryPolicy';
import { coordinateSessionEvents } from '../domain/session/SessionCoordinator';
import {
  deduplicatePendingOperations,
  resolveSyncRecords,
} from '../domain/sync/SyncResolver';
import { redactTelemetry } from '../domain/telemetry/redactTelemetry';
import { parseRemoteResource as parseRemoteResourceAtBoundary } from '../infrastructure/remote/parseRemoteResource';

function pending(name: string): never {
  throw new Error(`${name} must be implemented in the assigned week`);
}

export function redactForTelemetry(input: unknown): unknown {
  return redactTelemetry(input);
}

export function parseRemoteResource(input: unknown): ParseResult {
  return parseRemoteResourceAtBoundary(input);
}

export function coordinateRefresh(events: readonly AuthEvent[]): Readonly<{
  status: 'anonymous' | 'authenticated';
  activeGeneration: number | null;
  refreshCalls: number;
  retriedRequestIds: readonly string[];
  persistedToken: string | null;
}> {
  return coordinateSessionEvents(events);
}

export function resolveSync(
  base: SyncRecord,
  local: SyncRecord,
  remote: SyncRecord,
): Readonly<{ kind: 'merged'; fields: JsonObject } | { kind: 'conflict'; fields: readonly string[] }> {
  return resolveSyncRecords(base, local, remote);
}

export function deduplicateOperations<T extends Readonly<{ operationId: string }>>(
  operations: readonly T[],
): readonly T[] {
  return deduplicatePendingOperations(operations);
}

export function planRetry(input: Readonly<{
  method: 'GET' | 'POST';
  status: number | 'timeout';
  attempt: number;
  retryAfterMs?: number;
  idempotencyKey?: string;
}>): Readonly<{ retry: boolean; delayMs: number; requiresStableIdempotencyKey: boolean }> {
  return planBoundedRetry(input);
}

export function reduceRemoteResponses(_input: Readonly<{
  activeRequestId: string;
  responses: readonly RemoteResponse[];
}>): Readonly<{ state: 'success' | 'error' | 'loading'; value?: unknown; error?: string }> {
  return pending('reduceRemoteResponses');
}

export function reducePermissionLifecycle(
  _events: readonly PermissionEvent[],
): Readonly<{ status: 'available' | 'denied' | 'blocked'; resourceActive: boolean }> {
  return pending('reducePermissionLifecycle');
}

/** Week 09: see docs/CAMPUSOPS_API.md; delegates to domain location selector. */
export function selectIncidentLocation(provider: unknown, manualLabel: string): IncidentLocation {
  return selectValidatedIncidentLocation(provider, manualLabel);
}

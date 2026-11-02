import type { IncidentLocation } from '../../campusops/contracts';
import type {
  CreatedIncident,
  CreateIncidentInput,
  IncidentActionInput,
  IncidentCategory,
  UpdatedIncident,
} from '../../domain/incidents/CloudIncident';
import type {
  CloudIncidentFailure,
  CloudIncidentRepository,
} from '../../domain/incidents/CloudIncidentRepository';
import {
  selectIncidentLocation,
  type GeocodingLookupOutcome,
  type GeocodingProviderPort,
} from '../../domain/location/IncidentLocationSelector';
import {
  DEFAULT_RETRY_POLICY_CONFIG,
  planRetry,
  type RetryAttemptObservation,
  type RetryPolicyConfig,
  type RetryStatus,
} from '../../domain/resilience/RetryPolicy';
import { redactTelemetry } from '../../domain/telemetry/redactTelemetry';

export interface ResilientActionOptions {
  readonly retryConfig?: RetryPolicyConfig;
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly now?: () => number;
  readonly onBeforeAttempt?: (attempt: number) => void;
}

export type ResilientActionOutcome =
  | Readonly<{
      kind: 'succeeded';
      result: UpdatedIncident;
      recoveredFromLostResponse: boolean;
      attempts: number;
      observations: readonly RetryAttemptObservation[];
      sanitizedTelemetry: unknown;
    }>
  | Readonly<{
      kind: 'failed';
      reason: CloudIncidentFailure | 'empty_payload' | 'missing_idempotency_key';
      requiresStableIdempotencyKey: boolean;
      attempts: number;
      observations: readonly RetryAttemptObservation[];
      sanitizedTelemetry: unknown;
    }>;

export type ResilientCreateWithLocationOutcome =
  | Readonly<{
      kind: 'created';
      created: CreatedIncident;
      selectedLocation: IncidentLocation;
      locationOutcome: GeocodingLookupOutcome;
      attempts: number;
      observations: readonly RetryAttemptObservation[];
    }>
  | Readonly<{
      kind: 'failed';
      reason: CloudIncidentFailure | 'empty_payload' | 'missing_idempotency_key';
      selectedLocation: IncidentLocation;
      locationOutcome: GeocodingLookupOutcome;
      requiresStableIdempotencyKey: boolean;
      attempts: number;
      observations: readonly RetryAttemptObservation[];
    }>;

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function mapFailureToRetryStatus(failure: CloudIncidentFailure): RetryStatus {
  switch (failure.kind) {
    case 'timeout':
      return 'timeout';
    case 'network':
      return 'network';
    case 'http':
      return failure.status;
    case 'invalid_json':
    case 'contract':
    case 'invalid_payload':
      return 422;
  }
}

function failureFromOutcome(
  outcome:
    | Readonly<{ kind: 'empty_payload' }>
    | Readonly<{ kind: 'failure'; error: CloudIncidentFailure }>,
): CloudIncidentFailure | 'empty_payload' {
  return outcome.kind === 'empty_payload' ? 'empty_payload' : outcome.error;
}

function statusFromFailure(
  failure: CloudIncidentFailure | 'empty_payload',
): RetryStatus {
  return failure === 'empty_payload' ? 422 : mapFailureToRetryStatus(failure);
}

export class ResilientIncidentActionService {
  private readonly retryConfig: RetryPolicyConfig;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly now: () => number;
  private readonly onBeforeAttempt: ((attempt: number) => void) | undefined;

  constructor(
    private readonly repository: CloudIncidentRepository,
    private readonly geocodingProvider: GeocodingProviderPort,
    options: ResilientActionOptions = {},
  ) {
    this.retryConfig = options.retryConfig ?? DEFAULT_RETRY_POLICY_CONFIG;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => Date.now());
    this.onBeforeAttempt = options.onBeforeAttempt;
  }

  async resolveIncidentLocation(
    query: string,
    manualLabel: string,
    scenario = 'success',
  ): Promise<GeocodingLookupOutcome> {
    try {
      return await this.geocodingProvider.resolveLocation(
        query,
        manualLabel,
        scenario,
      );
    } catch {
      return {
        kind: 'fallback_manual',
        location: selectIncidentLocation(null, manualLabel),
        reason: 'network',
        attempts: 1,
      };
    }
  }

  async createIncidentWithLocationFallback(
    input: Readonly<{
      category: IncidentCategory;
      description: string;
      providerQuery: string;
      manualLocationLabel: string;
      scenario?: string;
    }>,
    idempotencyKey: string,
    options: Pick<ResilientActionOptions, 'onBeforeAttempt'> = {},
  ): Promise<ResilientCreateWithLocationOutcome> {
    const locationOutcome = await this.resolveIncidentLocation(
      input.providerQuery,
      input.manualLocationLabel,
      input.scenario ?? 'success',
    );
    const selectedLocation = locationOutcome.location;
    const initialGuard = planRetry(
      {
        method: 'POST',
        status: 'timeout',
        attempt: 1,
        idempotencyKey,
      },
      this.retryConfig,
    );

    if (initialGuard.requiresStableIdempotencyKey) {
      return {
        kind: 'failed',
        reason: 'missing_idempotency_key',
        selectedLocation,
        locationOutcome,
        requiresStableIdempotencyKey: true,
        attempts: 0,
        observations: [],
      };
    }

    const createPayload: CreateIncidentInput = {
      category: input.category,
      description: input.description.trim(),
      location: selectedLocation.label,
    };
    const observations: RetryAttemptObservation[] = [];
    let attempt = 1;
    let lastFailure: CloudIncidentFailure | 'empty_payload' = {
      kind: 'network',
    };

    while (attempt <= this.retryConfig.maxAttempts) {
      this.onBeforeAttempt?.(attempt);
      options.onBeforeAttempt?.(attempt);
      const startedAt = this.now();
      const outcome = await this.repository.create(createPayload, idempotencyKey);
      const durationMs = Math.max(0, this.now() - startedAt);

      if (outcome.kind === 'available') {
        observations.push({
          attempt,
          status: outcome.value.duplicate ? 200 : 201,
          delayMs: 0,
          durationMs,
          retried: false,
        });
        return {
          kind: 'created',
          created: outcome.value,
          selectedLocation,
          locationOutcome,
          attempts: attempt,
          observations,
        };
      }

      lastFailure = failureFromOutcome(outcome);
      const status = statusFromFailure(lastFailure);
      const decision = planRetry(
        { method: 'POST', status, attempt, idempotencyKey },
        this.retryConfig,
      );
      observations.push({
        attempt,
        status,
        delayMs: decision.delayMs,
        durationMs,
        retried: decision.retry,
      });

      if (!decision.retry) break;
      await this.sleep(decision.delayMs);
      attempt += 1;
    }

    return {
      kind: 'failed',
      reason: lastFailure,
      selectedLocation,
      locationOutcome,
      requiresStableIdempotencyKey: false,
      attempts: attempt,
      observations,
    };
  }

  async performActionWithRetry(
    incidentId: string,
    action: IncidentActionInput,
    idempotencyKey: string,
    options: Pick<ResilientActionOptions, 'onBeforeAttempt'> = {},
  ): Promise<ResilientActionOutcome> {
    const initialGuard = planRetry(
      {
        method: 'POST',
        status: 'timeout',
        attempt: 1,
        idempotencyKey,
      },
      this.retryConfig,
    );

    if (initialGuard.requiresStableIdempotencyKey) {
      return {
        kind: 'failed',
        reason: 'missing_idempotency_key',
        requiresStableIdempotencyKey: true,
        attempts: 0,
        observations: [],
        sanitizedTelemetry: redactTelemetry({
          incidentId,
          correlationId: `resilient-${action.action}-rejected`,
          status: 'rejected_missing_idempotency_key',
          attempt: 0,
          durationMs: 0,
        }),
      };
    }

    const observations: RetryAttemptObservation[] = [];
    let attempt = 1;
    let lastFailure: CloudIncidentFailure | 'empty_payload' = {
      kind: 'network',
    };

    while (attempt <= this.retryConfig.maxAttempts) {
      this.onBeforeAttempt?.(attempt);
      options.onBeforeAttempt?.(attempt);
      const startedAt = this.now();
      const outcome = await this.repository.performAction(
        incidentId,
        action,
        idempotencyKey,
      );
      const durationMs = Math.max(0, this.now() - startedAt);

      if (outcome.kind === 'available') {
        const status = outcome.value.duplicate ? 200 : 201;
        observations.push({
          attempt,
          status,
          delayMs: 0,
          durationMs,
          retried: false,
        });
        return {
          kind: 'succeeded',
          result: outcome.value,
          recoveredFromLostResponse: attempt > 1 && outcome.value.duplicate,
          attempts: attempt,
          observations,
          sanitizedTelemetry: redactTelemetry({
            incidentId,
            correlationId: idempotencyKey,
            status,
            attempt,
            durationMs,
            location: outcome.value.incident.location,
            assignedTechnicianId:
              outcome.value.incident.assignedTechnicianId,
            reporterId: outcome.value.incident.reporterId,
            evidence: undefined,
          }),
        };
      }

      lastFailure = failureFromOutcome(outcome);
      const status = statusFromFailure(lastFailure);
      const decision = planRetry(
        { method: 'POST', status, attempt, idempotencyKey },
        this.retryConfig,
      );
      observations.push({
        attempt,
        status,
        delayMs: decision.delayMs,
        durationMs,
        retried: decision.retry,
      });

      if (!decision.retry) break;
      await this.sleep(decision.delayMs);
      attempt += 1;
    }

    return {
      kind: 'failed',
      reason: lastFailure,
      requiresStableIdempotencyKey: false,
      attempts: attempt,
      observations,
      sanitizedTelemetry: redactTelemetry({
        incidentId,
        correlationId: idempotencyKey,
        status: statusFromFailure(lastFailure),
        attempt,
        durationMs: observations.reduce(
          (sum, item) => sum + item.durationMs,
          0,
        ),
      }),
    };
  }
}

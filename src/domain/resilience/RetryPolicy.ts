export type RetryMethod = 'GET' | 'POST';

export type RetryStatus = number | 'timeout' | 'network';

export interface RetryPolicyConfig {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY_CONFIG: RetryPolicyConfig = {
  maxAttempts: 4,
  baseDelayMs: 250,
  maxDelayMs: 8_000,
};

export interface RetryPlanInput {
  readonly method: RetryMethod;
  readonly status: RetryStatus;
  readonly attempt: number;
  readonly retryAfterMs?: number;
  readonly idempotencyKey?: string;
}

export interface RetryPlanDecision {
  readonly retry: boolean;
  readonly delayMs: number;
  readonly requiresStableIdempotencyKey: boolean;
}

export interface RetryAttemptObservation {
  readonly attempt: number;
  readonly status: RetryStatus;
  readonly delayMs: number;
  readonly durationMs: number;
  readonly retried: boolean;
}

export function hasStableIdempotencyIdentity(idempotencyKey?: string): boolean {
  return typeof idempotencyKey === 'string' && idempotencyKey.trim().length > 0;
}

export function isRetryableStatus(status: RetryStatus): boolean {
  if (status === 'timeout' || status === 'network') {
    return true;
  }
  if (typeof status !== 'number' || !Number.isInteger(status)) {
    return false;
  }
  return (
    status === 408 ||
    status === 429 ||
    (status >= 500 && status <= 504)
  );
}

export function parseRetryAfterHeaderMs(
  headerValue: string | undefined,
): number | undefined {
  if (typeof headerValue !== 'string' || headerValue.trim().length === 0) {
    return undefined;
  }
  const parsedSeconds = Number(headerValue.trim());
  if (!Number.isFinite(parsedSeconds) || parsedSeconds <= 0) {
    return undefined;
  }
  return Math.max(1, Math.round(parsedSeconds * 1_000));
}

export function computeProgressiveDelayMs(
  attempt: number,
  retryAfterMs: number | undefined,
  config: RetryPolicyConfig = DEFAULT_RETRY_POLICY_CONFIG,
): number {
  if (
    typeof retryAfterMs === 'number' &&
    Number.isFinite(retryAfterMs) &&
    retryAfterMs > 0
  ) {
    return Math.min(Math.max(1, Math.trunc(retryAfterMs)), config.maxDelayMs);
  }
  const exponent = Math.max(0, attempt - 1);
  const progressiveDelay = config.baseDelayMs * Math.pow(2, exponent);
  if (!Number.isFinite(progressiveDelay) || progressiveDelay <= 0) {
    return config.baseDelayMs;
  }
  return Math.min(Math.max(1, Math.trunc(progressiveDelay)), config.maxDelayMs);
}

export function planRetry(
  input: RetryPlanInput,
  config: RetryPolicyConfig = DEFAULT_RETRY_POLICY_CONFIG,
): RetryPlanDecision {
  if (
    input.method === 'POST' &&
    !hasStableIdempotencyIdentity(input.idempotencyKey)
  ) {
    return {
      retry: false,
      delayMs: 0,
      requiresStableIdempotencyKey: true,
    };
  }

  if (
    !Number.isInteger(input.attempt) ||
    input.attempt < 1 ||
    input.attempt >= config.maxAttempts
  ) {
    return {
      retry: false,
      delayMs: 0,
      requiresStableIdempotencyKey: false,
    };
  }

  if (!isRetryableStatus(input.status)) {
    return {
      retry: false,
      delayMs: 0,
      requiresStableIdempotencyKey: false,
    };
  }

  const delayMs = computeProgressiveDelayMs(
    input.attempt,
    input.retryAfterMs,
    config,
  );

  return {
    retry: true,
    delayMs,
    requiresStableIdempotencyKey: false,
  };
}

import {
  isValidCoordinatePair,
  normalizeQueryKey,
  selectIncidentLocation,
  type GeocodingCachePort,
  type GeocodingFailureReason,
  type GeocodingLookupOutcome,
  type GeocodingProviderPort,
  type ProviderLocationCandidate,
} from '../../domain/location/IncidentLocationSelector';
import {
  DEFAULT_RETRY_POLICY_CONFIG,
  parseRetryAfterHeaderMs,
  planRetry,
  type RetryAttemptObservation,
  type RetryPolicyConfig,
} from '../../domain/resilience/RetryPolicy';
import {
  HttpTransportFailure,
  type HttpTransport,
} from '../http/HttpTransport';

interface CacheEntry {
  readonly value: ProviderLocationCandidate;
  readonly expiresAtMs: number;
}

export interface GeocodingCacheOptions {
  readonly ttlMs?: number;
  readonly maxEntries?: number;
}

const DEFAULT_CACHE_TTL_MS = 300_000;
const DEFAULT_CACHE_MAX_ENTRIES = 100;

export class InMemoryGeocodingCache implements GeocodingCachePort {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options: GeocodingCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_CACHE_MAX_ENTRIES;
  }

  get(query: string, nowMs: number = Date.now()): ProviderLocationCandidate | null {
    const key = normalizeQueryKey(query);
    if (!key) {
      return null;
    }
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }
    if (nowMs >= entry.expiresAtMs) {
      this.entries.delete(key);
      return null;
    }
    return { ...entry.value };
  }

  set(
    query: string,
    value: ProviderLocationCandidate,
    nowMs: number = Date.now(),
  ): void {
    const key = normalizeQueryKey(query);
    if (
      !key ||
      typeof value.label !== 'string' ||
      value.label.trim().length === 0 ||
      !isValidCoordinatePair(value.latitude, value.longitude)
    ) {
      return;
    }

    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }

    this.entries.set(key, {
      value: {
        label: value.label.trim(),
        latitude: value.latitude,
        longitude: value.longitude,
      },
      expiresAtMs: nowMs + this.ttlMs,
    });
  }

  clear(): void {
    this.entries.clear();
  }
}

export interface CourseGeocodingClientOptions {
  readonly baseUrl?: string;
  readonly accessToken?: string;
  readonly actorId?: string;
  readonly timeoutMs?: number;
  readonly cache?: GeocodingCachePort;
  readonly retryConfig?: RetryPolicyConfig;
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly now?: () => number;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:4310';
const DEFAULT_ACCESS_TOKEN = 'course-valid-token';
const DEFAULT_ACTOR_ID = 'reporter-1';
const DEFAULT_TIMEOUT_MS = 800;

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function parseJsonSafe(
  raw: string,
): Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false }> {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false };
  }
}

export class CourseGeocodingClient implements GeocodingProviderPort {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly actorId: string;
  private readonly timeoutMs: number;
  private readonly cache: GeocodingCachePort;
  private readonly retryConfig: RetryPolicyConfig;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly now: () => number;
  private readonly observations: RetryAttemptObservation[] = [];

  constructor(
    private readonly transport: HttpTransport,
    options: CourseGeocodingClientOptions = {},
  ) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.accessToken = options.accessToken ?? DEFAULT_ACCESS_TOKEN;
    this.actorId = options.actorId ?? DEFAULT_ACTOR_ID;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cache = options.cache ?? new InMemoryGeocodingCache();
    this.retryConfig = options.retryConfig ?? DEFAULT_RETRY_POLICY_CONFIG;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => Date.now());
  }

  getAttemptObservations(): readonly RetryAttemptObservation[] {
    return [...this.observations];
  }

  clearAttemptObservations(): void {
    this.observations.length = 0;
  }

  async resolveLocation(
    query: string,
    manualLabel: string,
    scenario = 'success',
  ): Promise<GeocodingLookupOutcome> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return {
        kind: 'fallback_manual',
        location: selectIncidentLocation(null, manualLabel),
        reason: 'empty_query',
        attempts: 0,
      };
    }

    if (scenario === 'success') {
      const cached = this.cache.get(normalizedQuery, this.now());
      if (cached !== null) {
        return {
          kind: 'resolved',
          location: selectIncidentLocation(cached, manualLabel),
          fromCache: true,
          attempts: 0,
        };
      }
    }

    let attempt = 1;
    let lastReason: GeocodingFailureReason = 'server_error';
    let lastRetryAfterMs: number | undefined;

    while (attempt <= this.retryConfig.maxAttempts) {
      const startedAt = this.now();
      let status: number | 'timeout' | 'network';
      let responseBody = '';
      let retryAfterMs: number | undefined;

      try {
        const response = await this.transport.request({
          url: `${this.baseUrl}/v1/geocoding?q=${encodeURIComponent(normalizedQuery)}`,
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'X-Course-Actor': this.actorId,
            'X-Course-Scenario': scenario,
          },
          timeoutMs: this.timeoutMs,
        });
        status = response.status;
        responseBody = response.body;
        retryAfterMs = parseRetryAfterHeaderMs(
          response.headers?.['retry-after'],
        );
      } catch (error: unknown) {
        status =
          error instanceof HttpTransportFailure ? error.kind : 'network';
      }

      const durationMs = Math.max(0, this.now() - startedAt);

      if (status === 200) {
        this.observations.push({
          attempt,
          status: 200,
          delayMs: 0,
          durationMs,
          retried: false,
        });

        const parsed = parseJsonSafe(responseBody);
        if (!parsed.ok) {
          return {
            kind: 'fallback_manual',
            location: selectIncidentLocation(null, manualLabel),
            reason: 'malformed',
            attempts: attempt,
          };
        }

        const selected = selectIncidentLocation(parsed.value, manualLabel);
        if (
          selected.source === 'provider' &&
          selected.latitude !== undefined &&
          selected.longitude !== undefined
        ) {
          this.cache.set(
            normalizedQuery,
            {
              label: selected.label,
              latitude: selected.latitude,
              longitude: selected.longitude,
            },
            this.now(),
          );
          return {
            kind: 'resolved',
            location: selected,
            fromCache: false,
            attempts: attempt,
          };
        }

        return {
          kind: 'fallback_manual',
          location: selected,
          reason: 'invalid_response',
          attempts: attempt,
        };
      }

      lastReason =
        status === 'timeout'
          ? 'timeout'
          : status === 'network'
            ? 'network'
            : status === 429
              ? 'rate_limited'
              : 'server_error';
      if (retryAfterMs !== undefined) {
        lastRetryAfterMs = retryAfterMs;
      }

      const decision = planRetry(
        {
          method: 'GET',
          status,
          attempt,
          ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        },
        this.retryConfig,
      );

      this.observations.push({
        attempt,
        status,
        delayMs: decision.delayMs,
        durationMs,
        retried: decision.retry,
      });

      if (!decision.retry) {
        break;
      }

      await this.sleep(decision.delayMs);
      attempt += 1;
    }

    return {
      kind: 'fallback_manual',
      location: selectIncidentLocation(null, manualLabel),
      reason: lastReason,
      attempts: attempt,
      ...(lastRetryAfterMs === undefined
        ? {}
        : { retryAfterMs: lastRetryAfterMs }),
    };
  }
}

export interface NominatimGeocodingAdapterOptions {
  readonly endpointUrl?: string;
  readonly timeoutMs?: number;
  readonly cache?: GeocodingCachePort;
  readonly now?: () => number;
}

const DEFAULT_NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

export class NominatimGeocodingAdapter implements GeocodingProviderPort {
  private readonly endpointUrl: string;
  private readonly timeoutMs: number;
  private readonly cache: GeocodingCachePort;
  private readonly now: () => number;

  constructor(
    private readonly transport: HttpTransport,
    options: NominatimGeocodingAdapterOptions = {},
  ) {
    this.endpointUrl = options.endpointUrl ?? DEFAULT_NOMINATIM_URL;
    this.timeoutMs = options.timeoutMs ?? 1_500;
    this.cache = options.cache ?? new InMemoryGeocodingCache();
    this.now = options.now ?? (() => Date.now());
  }

  async resolveLocation(
    query: string,
    manualLabel: string,
  ): Promise<GeocodingLookupOutcome> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return {
        kind: 'fallback_manual',
        location: selectIncidentLocation(null, manualLabel),
        reason: 'empty_query',
        attempts: 0,
      };
    }

    const cached = this.cache.get(normalizedQuery, this.now());
    if (cached !== null) {
      return {
        kind: 'resolved',
        location: selectIncidentLocation(cached, manualLabel),
        fromCache: true,
        attempts: 0,
      };
    }

    try {
      const response = await this.transport.request({
        url: `${this.endpointUrl}?format=jsonv2&limit=1&q=${encodeURIComponent(normalizedQuery)}`,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'es',
          'User-Agent': 'CampusOps-DMI-Academic/1.0',
        },
        timeoutMs: this.timeoutMs,
      });

      if (response.status !== 200) {
        return {
          kind: 'fallback_manual',
          location: selectIncidentLocation(null, manualLabel),
          reason: response.status === 429 ? 'rate_limited' : 'server_error',
          attempts: 1,
        };
      }

      const parsed = parseJsonSafe(response.body);
      if (!parsed.ok || !Array.isArray(parsed.value) || parsed.value.length === 0) {
        return {
          kind: 'fallback_manual',
          location: selectIncidentLocation(null, manualLabel),
          reason: parsed.ok ? 'invalid_response' : 'malformed',
          attempts: 1,
        };
      }

      const first = parsed.value[0];
      const record =
        typeof first === 'object' && first !== null && !Array.isArray(first)
          ? (first as Record<string, unknown>)
          : null;
      const candidate = {
        label: typeof record?.display_name === 'string' ? record.display_name : '',
        latitude: typeof record?.lat === 'string' && record.lat.trim() !== ''
          ? Number(record.lat) : NaN,
        longitude: typeof record?.lon === 'string' && record.lon.trim() !== ''
          ? Number(record.lon) : NaN,
      };

      const selected = selectIncidentLocation(candidate, manualLabel);
      if (
        selected.source === 'provider' &&
        selected.latitude !== undefined &&
        selected.longitude !== undefined
      ) {
        this.cache.set(
          normalizedQuery,
          {
            label: selected.label,
            latitude: selected.latitude,
            longitude: selected.longitude,
          },
          this.now(),
        );
        return {
          kind: 'resolved',
          location: selected,
          fromCache: false,
          attempts: 1,
        };
      }

      return {
        kind: 'fallback_manual',
        location: selected,
        reason: 'invalid_response',
        attempts: 1,
      };
    } catch (error: unknown) {
      return {
        kind: 'fallback_manual',
        location: selectIncidentLocation(null, manualLabel),
        reason:
          error instanceof HttpTransportFailure ? error.kind : 'network',
        attempts: 1,
      };
    }
  }
}

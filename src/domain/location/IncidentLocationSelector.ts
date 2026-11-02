import type { IncidentLocation } from '../../campusops/contracts';

export interface ProviderLocationCandidate {
  readonly label: string;
  readonly latitude: number;
  readonly longitude: number;
}

export type GeocodingFailureReason =
  | 'timeout'
  | 'rate_limited'
  | 'network'
  | 'server_error'
  | 'malformed'
  | 'invalid_response'
  | 'empty_query';

export type GeocodingLookupOutcome =
  | Readonly<{
      kind: 'resolved';
      location: IncidentLocation;
      fromCache: boolean;
      attempts: number;
    }>
  | Readonly<{
      kind: 'fallback_manual';
      location: IncidentLocation;
      reason: GeocodingFailureReason;
      attempts: number;
      retryAfterMs?: number;
    }>;

export interface GeocodingCachePort {
  get(query: string, nowMs?: number): ProviderLocationCandidate | null;
  set(query: string, value: ProviderLocationCandidate, nowMs?: number): void;
  clear(): void;
}

export interface GeocodingProviderPort {
  resolveLocation(
    query: string,
    manualLabel: string,
    scenario?: string,
  ): Promise<GeocodingLookupOutcome>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isValidCoordinatePair(
  latitude: unknown,
  longitude: unknown,
): boolean {
  return (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function normalizeQueryKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function selectIncidentLocation(
  provider: unknown,
  manualLabel: string,
): IncidentLocation {
  const safeManualLabel =
    typeof manualLabel === 'string' && manualLabel.trim().length > 0
      ? manualLabel.trim()
      : 'Ubicación manual pendiente';

  if (!isPlainRecord(provider)) {
    return {
      source: 'manual',
      label: safeManualLabel,
    };
  }

  const rawLabel = provider.label;
  const rawLatitude = provider.latitude;
  const rawLongitude = provider.longitude;

  if (
    typeof rawLabel !== 'string' ||
    rawLabel.trim().length === 0 ||
    !isValidCoordinatePair(rawLatitude, rawLongitude)
  ) {
    return {
      source: 'manual',
      label: safeManualLabel,
    };
  }

  return {
    source: 'provider',
    label: rawLabel.trim(),
    latitude: rawLatitude as number,
    longitude: rawLongitude as number,
  };
}

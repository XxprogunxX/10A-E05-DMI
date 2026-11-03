import {
  planRetry as planRetryFromCourseEvaluation,
  selectIncidentLocation as selectIncidentLocationFromCourseEvaluation,
} from '../src/course-evaluation';
import {
  isValidCoordinatePair,
  normalizeQueryKey,
  selectIncidentLocation,
} from '../src/domain/location/IncidentLocationSelector';
import {
  computeProgressiveDelayMs,
  parseRetryAfterHeaderMs,
  planRetry,
} from '../src/domain/resilience/RetryPolicy';

describe('Week 09 — Domain Resilience & Location Fallback (Javier)', () => {
  test('selectIncidentLocation accepts valid coordinates at exact boundaries and trims label', () => {
    expect(
      selectIncidentLocation(
        {
          label: '  Edificio de Laboratorios B  ',
          latitude: 18.4148421,
          longitude: -97.3435432,
        },
        'Edificio manual',
      ),
    ).toEqual({
      source: 'provider',
      label: 'Edificio de Laboratorios B',
      latitude: 18.4148421,
      longitude: -97.3435432,
    });

    expect(
      selectIncidentLocation(
        { label: 'Polo Sur Sintético', latitude: -90, longitude: -180 },
        'Manual',
      ),
    ).toEqual({
      source: 'provider',
      label: 'Polo Sur Sintético',
      latitude: -90,
      longitude: -180,
    });

    expect(
      selectIncidentLocation(
        { label: 'Polo Norte Sintético', latitude: 90, longitude: 180 },
        'Manual',
      ),
    ).toEqual({
      source: 'provider',
      label: 'Polo Norte Sintético',
      latitude: 90,
      longitude: 180,
    });
  });

  test('selectIncidentLocation falls back to manual location without inventing coordinates on invalid, incomplete or error values', () => {
    const invalidInputs: readonly unknown[] = [
      null,
      undefined,
      'texto suelto',
      42,
      [],
      { status: 429, code: 'rate_limited' },
      { label: 'Zona sin coordenadas' },
      { label: '   ', latitude: 0, longitude: 0 },
      { label: 'Latitud fuera de rango', latitude: 90.001, longitude: 0 },
      { label: 'Latitud negativa fuera de rango', latitude: -90.001, longitude: 0 },
      { label: 'Longitud fuera de rango', latitude: 0, longitude: 180.001 },
      { label: 'Longitud negativa fuera de rango', latitude: 0, longitude: -180.001 },
      { label: 'Coordenada 999 del simulador', latitude: 999, longitude: null },
      { label: 'NaN latitud', latitude: Number.NaN, longitude: 0 },
      { label: 'Infinito longitud', latitude: 0, longitude: Number.POSITIVE_INFINITY },
      { label: 'Coordenadas como string', latitude: '18.4', longitude: '-97.3' },
    ];

    for (const candidate of invalidInputs) {
      const result = selectIncidentLocationFromCourseEvaluation(
        candidate,
        'Edificio C — Referencia manual',
      );
      expect(result).toEqual({
        source: 'manual',
        label: 'Edificio C — Referencia manual',
      });
      expect(Object.hasOwn(result, 'latitude')).toBe(false);
      expect(Object.hasOwn(result, 'longitude')).toBe(false);
    }
  });

  test('normalizeQueryKey and isValidCoordinatePair handle edge cases deterministically', () => {
    expect(normalizeQueryKey('  Edificio   de   Prueba A  ')).toBe(
      'edificio de prueba a',
    );
    expect(isValidCoordinatePair(0, 0)).toBe(true);
    expect(isValidCoordinatePair(91, 0)).toBe(false);
    expect(isValidCoordinatePair(0, -181)).toBe(false);
    expect(isValidCoordinatePair(Number.NaN, 0)).toBe(false);
  });

  test('planRetry enforces bounded attempts (stops at attempt 4) and progressive finite delays', () => {
    const attempt1 = planRetryFromCourseEvaluation({
      method: 'GET',
      status: 'timeout',
      attempt: 1,
    });
    const attempt2 = planRetryFromCourseEvaluation({
      method: 'GET',
      status: 503,
      attempt: 2,
    });
    const attempt3 = planRetryFromCourseEvaluation({
      method: 'GET',
      status: 500,
      attempt: 3,
    });
    const attempt4 = planRetryFromCourseEvaluation({
      method: 'GET',
      status: 'timeout',
      attempt: 4,
    });

    expect(attempt1).toEqual({
      retry: true,
      delayMs: 250,
      requiresStableIdempotencyKey: false,
    });
    expect(attempt2).toEqual({
      retry: true,
      delayMs: 500,
      requiresStableIdempotencyKey: false,
    });
    expect(attempt3).toEqual({
      retry: true,
      delayMs: 1_000,
      requiresStableIdempotencyKey: false,
    });
    expect(attempt2.delayMs).toBeGreaterThan(attempt1.delayMs);
    expect(attempt3.delayMs).toBeGreaterThan(attempt2.delayMs);
    expect(attempt4).toEqual({
      retry: false,
      delayMs: 0,
      requiresStableIdempotencyKey: false,
    });
  });

  test('planRetry honors valid Retry-After and clamps excessive delays to finite bounds', () => {
    expect(
      planRetry({
        method: 'GET',
        status: 429,
        attempt: 1,
        retryAfterMs: 800,
      }),
    ).toEqual({
      retry: true,
      delayMs: 800,
      requiresStableIdempotencyKey: false,
    });

    expect(
      planRetry(
        {
          method: 'GET',
          status: 429,
          attempt: 1,
          retryAfterMs: 99_999,
        },
        { maxAttempts: 4, baseDelayMs: 200, maxDelayMs: 5_000 },
      ),
    ).toEqual({
      retry: true,
      delayMs: 5_000,
      requiresStableIdempotencyKey: false,
    });

    expect(
      computeProgressiveDelayMs(1, Number.NaN, {
        maxAttempts: 4,
        baseDelayMs: 300,
        maxDelayMs: 4_000,
      }),
    ).toBe(300);
    expect(parseRetryAfterHeaderMs('1')).toBe(1_000);
    expect(parseRetryAfterHeaderMs('invalid')).toBeUndefined();
  });

  test('planRetry requires stable idempotencyKey for POST and rejects non-retryable 4xx statuses', () => {
    expect(
      planRetryFromCourseEvaluation({
        method: 'POST',
        status: 503,
        attempt: 1,
      }),
    ).toEqual({
      retry: false,
      delayMs: 0,
      requiresStableIdempotencyKey: true,
    });

    expect(
      planRetryFromCourseEvaluation({
        method: 'POST',
        status: 'timeout',
        attempt: 1,
        idempotencyKey: '   ',
      }),
    ).toEqual({
      retry: false,
      delayMs: 0,
      requiresStableIdempotencyKey: true,
    });

    expect(
      planRetryFromCourseEvaluation({
        method: 'POST',
        status: 'timeout',
        attempt: 2,
        idempotencyKey: 'resolve-campus-inc-001-op-1',
      }),
    ).toEqual({
      retry: true,
      delayMs: 500,
      requiresStableIdempotencyKey: false,
    });

    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(
        planRetryFromCourseEvaluation({
          method: 'POST',
          status,
          attempt: 1,
          idempotencyKey: 'resolve-campus-inc-001-op-1',
        }),
      ).toEqual({
        retry: false,
        delayMs: 0,
        requiresStableIdempotencyKey: false,
      });
    }
  });
});

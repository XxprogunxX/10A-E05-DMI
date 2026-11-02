import {
  FetchHttpTransport,
  HttpTransportFailure,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
} from '../src/infrastructure/http/HttpTransport';
import {
  CourseGeocodingClient,
  InMemoryGeocodingCache,
  NominatimGeocodingAdapter,
} from '../src/infrastructure/location/GeocodingClient';

class ScriptedHttpTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];

  constructor(
    private readonly steps: readonly (HttpResponse | Error)[],
  ) {}

  async request(input: HttpRequest): Promise<HttpResponse> {
    this.requests.push(input);
    const index = Math.min(this.requests.length - 1, this.steps.length - 1);
    const step = this.steps[index];
    if (!step) {
      throw new HttpTransportFailure('network');
    }
    if (step instanceof Error) {
      throw step;
    }
    return step;
  }
}

describe('Week 09 — Geocoding Infrastructure, Cache & Retry Execution (Francisco)', () => {
  test('caches valid geocoding hits by normalized query and expires entries after TTL', async () => {
    let clockMs = 1_000;
    const cache = new InMemoryGeocodingCache({ ttlMs: 5_000 });
    const transport = new ScriptedHttpTransport([
      {
        status: 200,
        body: JSON.stringify({
          label: 'Edificio de prueba A',
          latitude: 18.4148,
          longitude: -97.3435,
        }),
      },
    ]);

    const client = new CourseGeocodingClient(transport, {
      cache,
      now: () => clockMs,
      sleep: async () => undefined,
    });

    const first = await client.resolveLocation(
      '  Edificio de   Prueba A ',
      'Referencia manual A',
    );
    expect(first).toEqual({
      kind: 'resolved',
      location: {
        source: 'provider',
        label: 'Edificio de prueba A',
        latitude: 18.4148,
        longitude: -97.3435,
      },
      fromCache: false,
      attempts: 1,
    });
    expect(transport.requests).toHaveLength(1);

    // Second lookup with different casing/spaces hits cache without calling transport
    const second = await client.resolveLocation(
      'edificio de prueba a',
      'Referencia manual A',
    );
    expect(second).toEqual({
      kind: 'resolved',
      location: {
        source: 'provider',
        label: 'Edificio de prueba A',
        latitude: 18.4148,
        longitude: -97.3435,
      },
      fromCache: true,
      attempts: 0,
    });
    expect(transport.requests).toHaveLength(1);

    // Advance past TTL: cache expires and triggers a fresh network request
    clockMs += 6_000;
    const third = await client.resolveLocation(
      'edificio de prueba a',
      'Referencia manual A',
    );
    expect(third).toMatchObject({ kind: 'resolved', fromCache: false });
    expect(transport.requests).toHaveLength(2);
  });

  test('falls back to manual location without caching when provider returns incomplete, invalid_coordinates or malformed JSON', async () => {
    const cache = new InMemoryGeocodingCache();
    const transport = new ScriptedHttpTransport([
      { status: 200, body: JSON.stringify({ label: 'Zona ficticia' }) },
      {
        status: 200,
        body: JSON.stringify({
          label: 'Zona ficticia',
          latitude: 999,
          longitude: null,
        }),
      },
      { status: 200, body: '{"items": [}' },
    ]);

    const client = new CourseGeocodingClient(transport, {
      cache,
      sleep: async () => undefined,
    });

    const incomplete = await client.resolveLocation(
      'zona-1',
      'Laboratorio C — Manual',
      'incomplete',
    );
    expect(incomplete).toEqual({
      kind: 'fallback_manual',
      location: { source: 'manual', label: 'Laboratorio C — Manual' },
      reason: 'invalid_response',
      attempts: 1,
    });

    const invalidCoords = await client.resolveLocation(
      'zona-2',
      'Laboratorio C — Manual',
      'invalid_coordinates',
    );
    expect(invalidCoords).toEqual({
      kind: 'fallback_manual',
      location: { source: 'manual', label: 'Laboratorio C — Manual' },
      reason: 'invalid_response',
      attempts: 1,
    });

    const malformed = await client.resolveLocation(
      'zona-3',
      'Laboratorio C — Manual',
      'malformed',
    );
    expect(malformed).toEqual({
      kind: 'fallback_manual',
      location: { source: 'manual', label: 'Laboratorio C — Manual' },
      reason: 'malformed',
      attempts: 1,
    });

    expect(cache.get('zona-1')).toBeNull();
    expect(cache.get('zona-2')).toBeNull();
    expect(cache.get('zona-3')).toBeNull();
  });

  test('honors Retry-After on HTTP 429 and recovers when subsequent attempt succeeds', async () => {
    const observedDelays: number[] = [];
    const transport = new ScriptedHttpTransport([
      {
        status: 429,
        body: JSON.stringify({ code: 'rate_limited' }),
        headers: { 'retry-after': '1' },
      },
      {
        status: 200,
        body: JSON.stringify({
          label: 'Edificio de prueba A',
          latitude: 0,
          longitude: 0,
        }),
      },
    ]);

    const client = new CourseGeocodingClient(transport, {
      sleep: async (ms) => {
        observedDelays.push(ms);
      },
    });

    const outcome = await client.resolveLocation(
      'Edificio A',
      'Edificio A Manual',
      'rate_limited',
    );

    expect(outcome).toEqual({
      kind: 'resolved',
      location: {
        source: 'provider',
        label: 'Edificio de prueba A',
        latitude: 0,
        longitude: 0,
      },
      fromCache: false,
      attempts: 2,
    });
    expect(observedDelays).toEqual([1_000]);
  });

  test('stops retrying at attempt 4 on persistent timeout or offline network and returns manual location', async () => {
    const observedDelays: number[] = [];
    const transport = new ScriptedHttpTransport([
      new HttpTransportFailure('timeout'),
      new HttpTransportFailure('timeout'),
      new HttpTransportFailure('timeout'),
      new HttpTransportFailure('timeout'),
    ]);

    const client = new CourseGeocodingClient(transport, {
      sleep: async (ms) => {
        observedDelays.push(ms);
      },
    });

    const outcome = await client.resolveLocation(
      'Edificio Lejano',
      'Edificio Lejano — Entrada Norte',
      'slow',
    );

    expect(outcome).toEqual({
      kind: 'fallback_manual',
      location: {
        source: 'manual',
        label: 'Edificio Lejano — Entrada Norte',
      },
      reason: 'timeout',
      attempts: 4,
    });
    expect(transport.requests).toHaveLength(4);
    expect(observedDelays).toEqual([250, 500, 1_000]);
    expect(
      client.getAttemptObservations().map((item) => ({
        attempt: item.attempt,
        status: item.status,
        delayMs: item.delayMs,
        retried: item.retried,
      })),
    ).toEqual([
      { attempt: 1, status: 'timeout', delayMs: 250, retried: true },
      { attempt: 2, status: 'timeout', delayMs: 500, retried: true },
      { attempt: 3, status: 'timeout', delayMs: 1_000, retried: true },
      { attempt: 4, status: 'timeout', delayMs: 0, retried: false },
    ]);
  });

  test('NominatimGeocodingAdapter maps synthetic OpenStreetMap Nominatim response and falls back on failure', async () => {
    const transport = new ScriptedHttpTransport([
      {
        status: 200,
        body: JSON.stringify([
          {
            display_name:
              'Universidad Tecnológica de Tehuacán, San Pablo Tepetzingo, Tehuacán, Puebla, México',
            lat: '18.4148421',
            lon: '-97.3435432',
          },
        ]),
      },
    ]);

    const adapter = new NominatimGeocodingAdapter(transport);
    const resolved = await adapter.resolveLocation(
      'Universidad Tecnologica de Tehuacan',
      'Campus UTT Manual',
    );

    expect(resolved).toEqual({
      kind: 'resolved',
      location: {
        source: 'provider',
        label:
          'Universidad Tecnológica de Tehuacán, San Pablo Tepetzingo, Tehuacán, Puebla, México',
        latitude: 18.4148421,
        longitude: -97.3435432,
      },
      fromCache: false,
      attempts: 1,
    });
    expect(transport.requests[0]?.headers['User-Agent']).toBe(
      'CampusOps-DMI-Academic/1.0',
    );
  });

  test('rejects a Nominatim result with a missing longitude instead of treating null as zero', async () => {
    const transport = new ScriptedHttpTransport([
      { status: 200, body: JSON.stringify([{ display_name: 'Zona ficticia', lat: '18.4', lon: null }]) },
    ]);
    const adapter = new NominatimGeocodingAdapter(transport);

    await expect(adapter.resolveLocation('Zona ficticia', 'Referencia manual')).resolves.toEqual({
      kind: 'fallback_manual',
      location: { source: 'manual', label: 'Referencia manual' },
      reason: 'invalid_response',
      attempts: 1,
    });
  });

  test('fetch transport normalizes response headers for Retry-After', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 429,
      headers: new Headers({ 'Retry-After': '2' }),
      text: async () => '{"code":"rate_limited"}',
    } as Response);
    try {
      const response = await new FetchHttpTransport().request({
        url: 'http://backend.test/v1/geocoding?q=zona',
        method: 'GET',
        headers: {},
        timeoutMs: 50,
      });
      expect(response.headers?.['retry-after']).toBe('2');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

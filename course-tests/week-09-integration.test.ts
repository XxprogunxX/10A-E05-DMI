import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { createElement } from 'react';

import { CreateCloudIncident } from '../src/application/incidents/CreateCloudIncident';
import { ResilientIncidentActionService } from '../src/application/resilience/ResilientIncidentActionService';
import { ReportTechnicalError } from '../src/application/telemetry/ReportTechnicalError';
import {
  HttpTransportFailure,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
} from '../src/infrastructure/http/HttpTransport';
import { IncidentApiClient } from '../src/infrastructure/incidents/IncidentApiClient';
import { RemoteIncidentRepository } from '../src/infrastructure/incidents/RemoteIncidentRepository';
import {
  CourseGeocodingClient,
  InMemoryGeocodingCache,
} from '../src/infrastructure/location/GeocodingClient';
import { SafeTelemetrySink } from '../src/infrastructure/telemetry/SafeTelemetrySink';
import { CreateIncidentScreen } from '../src/ui/screens/CreateIncidentScreen';

jest.setTimeout(30_000);

class NodeHttpTransport implements HttpTransport {
  async request(input: HttpRequest): Promise<HttpResponse> {
    return await new Promise((resolve, reject) => {
      const target = new URL(input.url);
      const request = http.request(
        {
          hostname: target.hostname,
          port: target.port,
          path: `${target.pathname}${target.search}`,
          method: input.method,
          headers: { ...input.headers },
        },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            body += chunk;
          });
          response.on('end', () => {
            const headers: Record<string, string> = {};
            for (const [key, value] of Object.entries(response.headers)) {
              if (typeof value === 'string') headers[key.toLowerCase()] = value;
              else if (Array.isArray(value)) {
                headers[key.toLowerCase()] = value.join(', ');
              }
            }
            resolve({
              status: response.statusCode ?? 0,
              body,
              headers,
            });
          });
        },
      );
      const timeout = setTimeout(() => {
        request.destroy();
        reject(new HttpTransportFailure('timeout'));
      }, input.timeoutMs);
      request.on('error', () => {
        clearTimeout(timeout);
        reject(new HttpTransportFailure('network'));
      });
      request.on('close', () => clearTimeout(timeout));
      if (input.body !== undefined) request.write(input.body);
      request.end();
    });
  }
}

class ScenarioSwitchingHttpTransport implements HttpTransport {
  private readonly inner = new NodeHttpTransport();
  scenario = 'success';
  readonly requests: HttpRequest[] = [];

  async request(input: HttpRequest): Promise<HttpResponse> {
    const requestWithScenario: HttpRequest = {
      ...input,
      headers: {
        ...input.headers,
        'X-Course-Scenario': this.scenario,
      },
    };
    this.requests.push(requestWithScenario);
    return this.inner.request(requestWithScenario);
  }
}

async function startControlledBackend(): Promise<{
  readonly baseUrl: string;
  readonly stop: () => Promise<void>;
}> {
  const child: ChildProcess = spawn(
    process.execPath,
    ['course-backend/server.mjs'],
    {
      cwd: process.cwd(),
      env: { ...process.env, COURSE_BACKEND_PORT: '0' },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );

  const baseUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Controlled backend startup timeout')),
      8_000,
    );
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      const match = chunk.match(/(http:\/\/127\.0\.0\.1:\d+)/);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Controlled backend exited early: ${String(code)}`));
    });
  });

  return {
    baseUrl,
    stop: async () => {
      if (!child.killed) child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        setTimeout(resolve, 300);
      });
    },
  };
}

interface RawIncidentResource {
  readonly version: number;
  readonly status: string;
  readonly payload: {
    readonly location: string;
    readonly history: readonly {
      readonly action: string;
      readonly operationId: string;
    }[];
  };
}

async function readRawIncident(
  baseUrl: string,
  incidentId: string,
  actorId: string,
): Promise<RawIncidentResource> {
  const response = await new NodeHttpTransport().request({
    url: `${baseUrl}/v1/incidents/${incidentId}`,
    method: 'GET',
    headers: {
      Authorization: 'Bearer course-valid-token',
      'X-Course-Actor': actorId,
    },
    timeoutMs: 1_000,
  });
  expect(response.status).toBe(200);
  return JSON.parse(response.body) as RawIncidentResource;
}

describe('Week 09 — resilient integration and manual fallback (Carlos)', () => {
  let backend: Awaited<ReturnType<typeof startControlledBackend>> | null = null;

  beforeAll(async () => {
    backend = await startControlledBackend();
  });

  afterAll(async () => {
    await backend?.stop();
  });

  test('recovers lost resolve and close responses with one server-side event per stable operation', async () => {
    expect(backend).not.toBeNull();
    const baseUrl = backend!.baseUrl;
    const technicianTransport = new ScenarioSwitchingHttpTransport();
    const coordinatorTransport = new ScenarioSwitchingHttpTransport();
    const technicianRepository = new RemoteIncidentRepository(
      new IncidentApiClient(technicianTransport, {
        baseUrl,
        actorId: 'technician-1',
        timeoutMs: 250,
      }),
    );
    const coordinatorRepository = new RemoteIncidentRepository(
      new IncidentApiClient(coordinatorTransport, {
        baseUrl,
        actorId: 'coordinator-1',
        timeoutMs: 250,
      }),
    );
    const geocoding = new CourseGeocodingClient(coordinatorTransport, {
      baseUrl,
      sleep: async () => undefined,
    });
    const technicianService = new ResilientIncidentActionService(
      technicianRepository,
      geocoding,
      { sleep: async () => undefined },
    );
    const observedDelays: number[] = [];
    const coordinatorService = new ResilientIncidentActionService(
      coordinatorRepository,
      geocoding,
      { sleep: async (delayMs) => void observedDelays.push(delayMs) },
    );

    const started = await technicianService.performActionWithRetry(
      'campus-inc-001',
      { action: 'start', baseVersion: 1 },
      'week09-start-campus-inc-001',
    );
    if (started.kind !== 'succeeded') {
      throw new Error(`Start failed: ${JSON.stringify(started)}`);
    }

    const resolveKey = 'resolve-campus-inc-001-op-1';
    const resolved = await technicianService.performActionWithRetry(
      'campus-inc-001',
      {
        action: 'resolve',
        baseVersion: 2,
        diagnosis: 'Switch de laboratorio reemplazado con datos sintéticos',
      },
      resolveKey,
      {
        onBeforeAttempt: (attempt) => {
          technicianTransport.scenario =
            attempt === 1 ? 'timeout_after_commit' : 'success';
        },
      },
    );
    expect(resolved).toMatchObject({
      kind: 'succeeded',
      recoveredFromLostResponse: true,
      attempts: 2,
      result: {
        duplicate: true,
        incident: { status: 'resolved', version: 3 },
      },
    });

    const closeKey = 'close-campus-inc-001-lost-response';
    const closed = await coordinatorService.performActionWithRetry(
      'campus-inc-001',
      { action: 'close', baseVersion: 3 },
      closeKey,
      {
        onBeforeAttempt: (attempt) => {
          coordinatorTransport.scenario =
            attempt === 1 ? 'timeout_after_commit' : 'success';
        },
      },
    );
    expect(closed.kind).toBe('succeeded');
    if (closed.kind !== 'succeeded') {
      throw new Error('Expected close to recover from the lost response');
    }
    expect(closed).toMatchObject({
      recoveredFromLostResponse: true,
      attempts: 2,
      result: {
        duplicate: true,
        incident: { status: 'closed', version: 4 },
      },
      sanitizedTelemetry: {
        incidentId: 'campus-inc-001',
        correlationId: closeKey,
        status: 200,
        attempt: 2,
        location: '[REDACTED]',
        assignedTechnicianId: '[REDACTED]',
        reporterId: '[REDACTED]',
        evidence: '[REDACTED]',
      },
    });
    expect(observedDelays).toEqual([250]);
    expect(
      closed.observations.map(({ attempt, status, delayMs, retried }) => ({
        attempt,
        status,
        delayMs,
        retried,
      })),
    ).toEqual([
      { attempt: 1, status: 'timeout', delayMs: 250, retried: true },
      { attempt: 2, status: 200, delayMs: 0, retried: false },
    ]);

    const closeRequests = coordinatorTransport.requests.filter((request) =>
      request.url.endsWith('/v1/incidents/campus-inc-001/actions'),
    );
    expect(closeRequests).toHaveLength(2);
    expect(closeRequests[0]?.headers['Idempotency-Key']).toBe(closeKey);
    expect(closeRequests[1]?.headers['Idempotency-Key']).toBe(closeKey);
    expect(closeRequests[1]?.body).toBe(closeRequests[0]?.body);

    const raw = await readRawIncident(
      baseUrl,
      'campus-inc-001',
      'coordinator-1',
    );
    expect(raw.status).toBe('closed');
    expect(raw.version).toBe(4);
    expect(
      raw.payload.history.filter(
        (entry) => entry.action === 'resolve' && entry.operationId === resolveKey,
      ),
    ).toHaveLength(1);
    expect(
      raw.payload.history.filter(
        (entry) => entry.action === 'close' && entry.operationId === closeKey,
      ),
    ).toHaveLength(1);
  });

  test('uses provider success/cache and bounded manual fallback for invalid or unavailable geocoding', async () => {
    expect(backend).not.toBeNull();
    const baseUrl = backend!.baseUrl;
    const observedDelays: number[] = [];
    const geocoding = new CourseGeocodingClient(new NodeHttpTransport(), {
      baseUrl,
      cache: new InMemoryGeocodingCache(),
      sleep: async (delayMs) => void observedDelays.push(delayMs),
    });
    const repository = new RemoteIncidentRepository(
      new IncidentApiClient(new NodeHttpTransport(), {
        baseUrl,
        actorId: 'reporter-1',
        timeoutMs: 500,
      }),
    );
    const service = new ResilientIncidentActionService(repository, geocoding, {
      sleep: async () => undefined,
    });

    const providerSuccess = await service.resolveIncidentLocation(
      'Edificio A',
      'Edificio A — referencia manual',
    );
    if (providerSuccess.kind !== 'resolved') {
      throw new Error(`Geocoding failed: ${JSON.stringify(providerSuccess)}`);
    }
    expect(providerSuccess).toMatchObject({
      kind: 'resolved',
      fromCache: false,
      attempts: 1,
      location: { source: 'provider', latitude: 0, longitude: 0 },
    });
    await expect(
      service.resolveIncidentLocation(
        '  edificio   a ',
        'Edificio A — referencia manual',
      ),
    ).resolves.toMatchObject({ kind: 'resolved', fromCache: true, attempts: 0 });

    for (const [scenario, reason] of [
      ['incomplete', 'invalid_response'],
      ['invalid_coordinates', 'invalid_response'],
      ['malformed', 'malformed'],
    ] as const) {
      const result = await service.resolveIncidentLocation(
        `Zona ${scenario}`,
        `Zona ${scenario} — Manual`,
        scenario,
      );
      expect(result).toMatchObject({
        kind: 'fallback_manual',
        reason,
        attempts: 1,
        location: {
          source: 'manual',
          label: `Zona ${scenario} — Manual`,
        },
      });
      expect(Object.hasOwn(result.location, 'latitude')).toBe(false);
      expect(Object.hasOwn(result.location, 'longitude')).toBe(false);
    }

    observedDelays.length = 0;
    await expect(
      service.resolveIncidentLocation(
        'Zona limitada',
        'Zona limitada — Manual',
        'rate_limited',
      ),
    ).resolves.toMatchObject({
      kind: 'fallback_manual',
      reason: 'rate_limited',
      attempts: 4,
      retryAfterMs: 1_000,
    });
    expect(observedDelays).toEqual([1_000, 1_000, 1_000]);

    const created = await service.createIncidentWithLocationFallback(
      {
        category: 'electrical',
        description: 'Falla eléctrica en pasillo principal',
        providerQuery: 'Pasillo Principal',
        manualLocationLabel: 'Edificio D — Planta Baja Manual',
        scenario: 'server_error',
      },
      'week09-create-manual-fallback-001',
    );
    expect(created).toMatchObject({
      kind: 'created',
      selectedLocation: {
        source: 'manual',
        label: 'Edificio D — Planta Baja Manual',
      },
      created: {
        incident: { location: 'Edificio D — Planta Baja Manual' },
      },
    });
  });

  test('CreateIncidentScreen keeps the manual label and submits when the provider fails', async () => {
    expect(backend).not.toBeNull();
    const repository = new RemoteIncidentRepository(
      new IncidentApiClient(new NodeHttpTransport(), {
        baseUrl: backend!.baseUrl,
        actorId: 'reporter-1',
        timeoutMs: 500,
      }),
    );
    const failingProvider = {
      resolveLocation: jest.fn(async (_query: string, manualLabel: string) => ({
        kind: 'fallback_manual' as const,
        location: { source: 'manual' as const, label: manualLabel },
        reason: 'rate_limited' as const,
        attempts: 4,
        retryAfterMs: 1_000,
      })),
    };
    const resilientService = new ResilientIncidentActionService(
      repository,
      failingProvider,
      { sleep: async () => undefined },
    );
    const onCreated = jest.fn();
    const view = await render(
      createElement(CreateIncidentScreen, {
        createCloudIncident: new CreateCloudIncident(repository),
        onBack: () => undefined,
        onCreated,
        reportTechnicalError: new ReportTechnicalError(
          new SafeTelemetrySink(() => undefined),
        ),
        resilientIncidentService: resilientService,
      }),
    );

    await fireEvent.changeText(
      view.getByTestId('incident-description'),
      'Luminaria dañada en laboratorio de cómputo',
    );
    const manualLabel = 'Edificio H — Aula 204 (Referencia Manual)';
    await fireEvent.changeText(
      view.getByTestId('incident-location'),
      manualLabel,
    );

    await fireEvent.press(view.getByTestId('lookup-geocoding-location'));
    await waitFor(() => {
      expect(
        view.getByTestId('location-resolution-status').props.children,
      ).toContain('se conserva ubicación manual');
      expect(view.getByTestId('incident-location').props.value).toBe(manualLabel);
    });

    await fireEvent.press(view.getByTestId('create-incident'));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));

    const createdId = onCreated.mock.calls[0]?.[0] as string;
    const raw = await readRawIncident(baseUrlOrThrow(backend), createdId, 'reporter-1');
    expect(raw.payload.location).toBe(manualLabel);
  });

  test('rejects a POST without a stable idempotency identity before touching the repository', async () => {
    const repository = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      performAction: jest.fn(),
    };
    const provider = {
      resolveLocation: jest.fn(),
    };
    const service = new ResilientIncidentActionService(repository, provider);

    await expect(
      service.performActionWithRetry(
        'campus-inc-001',
        { action: 'close', baseVersion: 1 },
        '   ',
      ),
    ).resolves.toMatchObject({
      kind: 'failed',
      reason: 'missing_idempotency_key',
      requiresStableIdempotencyKey: true,
      attempts: 0,
    });
    expect(repository.performAction).not.toHaveBeenCalled();
  });
});

function baseUrlOrThrow(
  backend: Awaited<ReturnType<typeof startControlledBackend>> | null,
): string {
  if (backend === null) throw new Error('Controlled backend is unavailable');
  return backend.baseUrl;
}

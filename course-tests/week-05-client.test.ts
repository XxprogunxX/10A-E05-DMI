import type { CreateIncidentInput } from '../src/domain/incidents/CloudIncident';
import { IncidentApiClient } from '../src/infrastructure/incidents/IncidentApiClient';
import { RemoteIncidentRepository } from '../src/infrastructure/incidents/RemoteIncidentRepository';
import {
  FetchHttpTransport,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
  HttpTransportFailure,
} from '../src/infrastructure/http/HttpTransport';

const remoteIncident = {
  id: 'campus-inc-001',
  version: 1,
  status: 'assigned',
  payload: {
    category: 'connectivity',
    description: 'Incidencia ficticia',
    location: 'Edificio de prueba A',
    reporterId: 'reporter-1',
    assignedTechnicianId: 'technician-1',
    priority: 'medium',
  },
};

const createInput: CreateIncidentInput = {
  category: 'connectivity',
  description: 'Incidencia ficticia',
  location: 'Edificio de prueba A',
};

type StubOutcome = HttpResponse | Error;

class StubHttpTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];

  constructor(private readonly outcomes: StubOutcome[]) {}

  async request(input: HttpRequest): Promise<HttpResponse> {
    this.requests.push(input);
    const outcome = this.outcomes.shift();
    if (outcome === undefined) {
      throw new Error('Missing controlled response');
    }
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome;
  }
}

function jsonResponse(value: unknown, status = 200): HttpResponse {
  return { status, body: JSON.stringify(value) };
}

function clientFor(transport: HttpTransport): IncidentApiClient {
  return new IncidentApiClient(transport, {
    baseUrl: 'http://backend.test/',
    accessToken: 'course-valid-token',
    actorId: 'reporter-1',
    timeoutMs: 25,
  });
}

test('lists validated incidents without inventing presentation fields', async () => {
  const transport = new StubHttpTransport([
    jsonResponse({ items: [remoteIncident] }),
  ]);

  const result = await clientFor(transport).listIncidents();

  expect(result).toEqual({
    kind: 'available',
    value: [
      {
        id: 'campus-inc-001',
        version: 1,
        status: 'assigned',
        category: 'connectivity',
        description: 'Incidencia ficticia',
        location: 'Edificio de prueba A',
        reporterId: 'reporter-1',
        assignedTechnicianId: 'technician-1',
        priority: 'medium',
      },
    ],
  });
  expect(result).not.toHaveProperty('value.0.title');
  expect(result).not.toHaveProperty('value.0.reportedAt');
  expect(transport.requests).toEqual([
    {
      url: 'http://backend.test/v1/incidents',
      method: 'GET',
      headers: {
        Authorization: 'Bearer course-valid-token',
        'X-Course-Actor': 'reporter-1',
      },
      timeoutMs: 25,
    },
  ]);
});

test('keeps an empty list as a successful available result', async () => {
  const client = clientFor(
    new StubHttpTransport([jsonResponse({ items: [] })]),
  );

  await expect(client.listIncidents()).resolves.toEqual({
    kind: 'available',
    value: [],
  });
});

test('keeps a valid null payload distinct from an invalid contract', async () => {
  const nullable = {
    id: 'campus-inc-nullable',
    version: 1,
    status: 'open',
    payload: null,
  };
  const transport = new StubHttpTransport([
    jsonResponse(nullable),
    jsonResponse({ id: 'missing-envelope-fields' }),
  ]);
  const client = clientFor(transport);

  await expect(client.getIncidentDetail('nullable')).resolves.toEqual({
    kind: 'empty_payload',
  });
  await expect(client.getIncidentDetail('invalid')).resolves.toEqual({
    kind: 'failure',
    error: { kind: 'contract' },
  });
});

test('encodes the detail identifier as a URL segment', async () => {
  const transport = new StubHttpTransport([jsonResponse(remoteIncident)]);

  await clientFor(transport).getIncidentDetail('campus/inc 001');

  expect(transport.requests[0]?.url).toBe(
    'http://backend.test/v1/incidents/campus%2Finc%20001',
  );
  expect(transport.requests[0]?.method).toBe('GET');
});

test('classifies malformed JSON without exposing its body', async () => {
  const body = '{"items":["synthetic-sensitive-description"}';
  const client = clientFor(new StubHttpTransport([{ status: 200, body }]));

  const result = await client.listIncidents();

  expect(result).toEqual({
    kind: 'failure',
    error: { kind: 'invalid_json' },
  });
  expect(JSON.stringify(result)).not.toContain(
    'synthetic-sensitive-description',
  );
});

test('classifies an invalid remote envelope as a contract failure', async () => {
  const client = clientFor(
    new StubHttpTransport([
      jsonResponse({
        items: [{ id: 'campus-inc-invalid', version: '1', payload: {} }],
      }),
    ]),
  );

  await expect(client.listIncidents()).resolves.toEqual({
    kind: 'failure',
    error: { kind: 'contract' },
  });
});

const invalidIncidentFields: readonly (readonly [
  string,
  Readonly<Record<string, unknown>>,
])[] = [
  ['category', { category: 'unknown' }],
  ['description', { description: '   ' }],
  ['location', { location: '' }],
  ['priority', { priority: 'urgent' }],
  ['status', { status: 'unknown' }],
  ['reporter id', { reporterId: 42 }],
  ['technician id', { assignedTechnicianId: false }],
];

test.each(invalidIncidentFields)(
  'rejects an invalid incident %s',
  async (_field, replacement) => {
    const resource = {
      ...remoteIncident,
      ...(replacement.status === undefined
        ? {}
        : { status: replacement.status }),
      payload: {
        ...remoteIncident.payload,
        ...replacement,
      },
    };
    const client = clientFor(
      new StubHttpTransport([jsonResponse({ items: [resource] })]),
    );

    await expect(client.listIncidents()).resolves.toEqual({
      kind: 'failure',
      error: { kind: 'invalid_payload' },
    });
  },
);

test('returns a safe timeout result from a controlled slow transport', async () => {
  const client = clientFor(
    new StubHttpTransport([new HttpTransportFailure('timeout')]),
  );

  await expect(client.listIncidents()).resolves.toEqual({
    kind: 'failure',
    error: { kind: 'timeout' },
  });
});

test('fetch transport aborts a request when its deadline expires', async () => {
  let observedSignal: AbortSignal | undefined;
  const fetchSpy = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation((_input, init) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener('abort', () => {
          const error = new Error('provider details must not escape');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

  try {
    await expect(
      new FetchHttpTransport().request({
        url: 'http://backend.test/v1/incidents',
        method: 'GET',
        headers: {},
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ kind: 'timeout', message: 'timeout' });
    expect(observedSignal?.aborted).toBe(true);
  } finally {
    fetchSpy.mockRestore();
  }
});

test('returns an HTTP 500 result without parsing or throwing its body', async () => {
  const client = clientFor(
    new StubHttpTransport([
      {
        status: 500,
        body: JSON.stringify({ token: 'synthetic-server-token' }),
      },
    ]),
  );

  const result = await client.listIncidents();

  expect(result).toEqual({
    kind: 'failure',
    error: { kind: 'http', status: 500 },
  });
  expect(JSON.stringify(result)).not.toContain('synthetic-server-token');
});

test('reduces arbitrary provider exceptions to a safe network failure', async () => {
  const providerError = new Error(
    'Bearer synthetic-token at Edificio privado: descripción privada',
  );
  const client = clientFor(new StubHttpTransport([providerError]));

  const result = await client.listIncidents();

  expect(result).toEqual({
    kind: 'failure',
    error: { kind: 'network' },
  });
  expect(JSON.stringify(result)).not.toContain('synthetic-token');
  expect(JSON.stringify(result)).not.toContain('Edificio privado');
});

test('creates an incident with the required stable request contract', async () => {
  const operationId = 'clave-estable-de-prueba';
  const transport = new StubHttpTransport([
    jsonResponse(
      { incident: remoteIncident, operationId, duplicate: false },
      201,
    ),
    jsonResponse(
      { incident: remoteIncident, operationId, duplicate: true },
      200,
    ),
  ]);
  const client = clientFor(transport);

  await expect(
    client.createIncident(createInput, operationId),
  ).resolves.toMatchObject({
    kind: 'available',
    value: { operationId, duplicate: false },
  });
  await expect(
    client.createIncident(createInput, operationId),
  ).resolves.toMatchObject({
    kind: 'available',
    value: { operationId, duplicate: true },
  });

  expect(transport.requests).toHaveLength(2);
  for (const request of transport.requests) {
    expect(request).toEqual({
      url: 'http://backend.test/v1/incidents',
      method: 'POST',
      headers: {
        Authorization: 'Bearer course-valid-token',
        'X-Course-Actor': 'reporter-1',
        'Idempotency-Key': operationId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(createInput),
      timeoutMs: 25,
    });
  }
});

test('rejects a creation response with a mismatched operation identifier', async () => {
  const client = clientFor(
    new StubHttpTransport([
      jsonResponse(
        {
          incident: remoteIncident,
          operationId: 'different-operation',
          duplicate: false,
        },
        201,
      ),
    ]),
  );

  await expect(
    client.createIncident(createInput, 'clave-estable-de-prueba'),
  ).resolves.toEqual({
    kind: 'failure',
    error: { kind: 'contract' },
  });
});

test('remote repository delegates list, detail and creation to the client', async () => {
  const operationId = 'clave-estable-de-prueba';
  const transport = new StubHttpTransport([
    jsonResponse({ items: [remoteIncident] }),
    jsonResponse(remoteIncident),
    jsonResponse(
      { incident: remoteIncident, operationId, duplicate: false },
      201,
    ),
  ]);
  const repository = new RemoteIncidentRepository(clientFor(transport));

  await expect(repository.list()).resolves.toMatchObject({ kind: 'available' });
  await expect(repository.getById('campus-inc-001')).resolves.toMatchObject({
    kind: 'available',
  });
  await expect(
    repository.create(createInput, operationId),
  ).resolves.toMatchObject({ kind: 'available' });
  expect(
    transport.requests.map(({ method, url }) => ({ method, url })),
  ).toEqual([
    { method: 'GET', url: 'http://backend.test/v1/incidents' },
    {
      method: 'GET',
      url: 'http://backend.test/v1/incidents/campus-inc-001',
    },
    { method: 'POST', url: 'http://backend.test/v1/incidents' },
  ]);
});

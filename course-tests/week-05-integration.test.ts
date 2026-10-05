/**
 * @jest-environment node
 */


import { CreateCloudIncident } from '../src/application/incidents/CreateCloudIncident';
import { GetCloudIncident } from '../src/application/incidents/GetCloudIncident';
import { ListCloudIncidents } from '../src/application/incidents/ListCloudIncidents';
import { IncidentApiClient } from '../src/infrastructure/incidents/IncidentApiClient';
import { RemoteIncidentRepository } from '../src/infrastructure/incidents/RemoteIncidentRepository';
import { FetchHttpTransport } from '../src/infrastructure/http/HttpTransport';

const BASE_URL = 'http://127.0.0.1:4310';

function createCloudUseCases() {
  const transport = new FetchHttpTransport();

  const client = new IncidentApiClient(transport, {
    baseUrl: BASE_URL,
    accessToken: 'course-valid-token',
    actorId: 'reporter-1',
    timeoutMs: 3_000,
  });

  const repository = new RemoteIncidentRepository(client);

  return {
    list: new ListCloudIncidents(repository),
    detail: new GetCloudIncident(repository),
    create: new CreateCloudIncident(repository),
  };
}

describe('Semana 5 - integracin cliente CampusOps con backend real', () => {
  test('lista incidencias desde el backend real', async () => {
    const { list } = createCloudUseCases();

    const result = await list.execute();

    expect(result.kind).toBe('available');

    if (result.kind === 'available') {
      expect(result.incidents.length).toBeGreaterThan(0);
      expect(result.incidents[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          version: expect.any(Number),
          status: expect.any(String),
          category: expect.any(String),
          description: expect.any(String),
          location: expect.any(String),
          priority: expect.any(String),
        }),
      );

      expect(result.incidents[0]).not.toHaveProperty('title');
      expect(result.incidents[0]).not.toHaveProperty('reportedAt');
    }
  });

  test('consulta el detalle de una incidencia existente', async () => {
    const { detail } = createCloudUseCases();

    const result = await detail.execute('campus-inc-001');

    expect(result.kind).toBe('available');

    if (result.kind === 'available') {
      expect(result.incident.id).toBe('campus-inc-001');
      expect(result.incident.description).toEqual(expect.any(String));
      expect(result.incident.location).toEqual(expect.any(String));
    }
  });

  test('crea una incidencia y conserva la idempotencia', async () => {
    const { create } = createCloudUseCases();

    const idempotencyKey = `week5-integration-${Date.now()}`;

    const input = {
      category: 'equipment' as const,
      description: 'Prueba de integracin Semana 5',
      location: 'Laboratorio de integracin',
    };

    const first = await create.execute(input, idempotencyKey);

    expect(first.kind).toBe('created');

    if (first.kind === 'created') {
      expect(first.result.operationId).toBe(idempotencyKey);
      expect(first.result.duplicate).toBe(false);
      expect(first.result.incident.description).toBe(input.description);
    }

    const second = await create.execute(input, idempotencyKey);

    expect(second.kind).toBe('created');

    if (second.kind === 'created') {
      expect(second.result.operationId).toBe(idempotencyKey);
      expect(second.result.duplicate).toBe(true);
      expect(second.result.incident.id).toBe(
        first.kind === 'created' ? first.result.incident.id : undefined,
      );
    }
  });
});

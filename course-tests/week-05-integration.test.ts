/**
 * @jest-environment node
 */

import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

import { CreateCloudIncident } from '../src/application/incidents/CreateCloudIncident';
import { GetCloudIncident } from '../src/application/incidents/GetCloudIncident';
import { ListCloudIncidents } from '../src/application/incidents/ListCloudIncidents';
import { IncidentApiClient } from '../src/infrastructure/incidents/IncidentApiClient';
import { RemoteIncidentRepository } from '../src/infrastructure/incidents/RemoteIncidentRepository';
import {
  HttpTransportFailure,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
} from '../src/infrastructure/http/HttpTransport';

const BASE_URL = 'http://127.0.0.1:4310';

let backend: ChildProcess;

async function waitForBackend(): Promise<void> {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const reachable = await new Promise<boolean>((resolve) => {
      const request = http.get(`${BASE_URL}/health`, (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      });

      request.setTimeout(500, () => {
        request.destroy();
        resolve(false);
      });

      request.on('error', () => {
        resolve(false);
      });
    });

    if (reachable) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    'El backend local no estuvo disponible dentro del tiempo esperado.',
  );
}

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
          headers: input.headers,
        },
        (response) => {
          let body = '';

          response.setEncoding('utf8');

          response.on('data', (chunk) => {
            body += chunk;
          });

          response.on('end', () => {
            resolve({
              status: response.statusCode ?? 0,
              body,
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

      request.on('close', () => {
        clearTimeout(timeout);
      });

      if (input.body !== undefined) {
        request.write(input.body);
      }

      request.end();
    });
  }
}

beforeAll(async () => {
  const serverPath = path.resolve(process.cwd(), 'course-backend/server.mjs');

  backend = spawn(process.execPath, [serverPath], {
    cwd: process.cwd(),
    stdio: 'pipe',
    windowsHide: true,
  });

  backend.stdout?.on('data', (data) => {
    process.stderr.write(`[BACKEND] ${data}`);
  });

  backend.stderr?.on('data', (data) => {
    process.stderr.write(`[BACKEND ERROR] ${data}`);
  });

  backend.on('error', (error) => {
    process.stderr.write(`[BACKEND PROCESS ERROR] ${error.message}\n`);
  });

  backend.on('exit', (code, signal) => {
    process.stderr.write(`[BACKEND EXIT] code=${code} signal=${signal}\n`);
  });

  await waitForBackend();
});

afterAll(() => {
  backend.kill();
});

jest.setTimeout(15000);

function createCloudUseCases() {
  const transport = new NodeHttpTransport();

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

describe('Semana 5 - integración cliente CampusOps con backend real', () => {
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
      description: 'Prueba de integración Semana 5',
      location: 'Laboratorio de integración',
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

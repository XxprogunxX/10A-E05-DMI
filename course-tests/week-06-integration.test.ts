/**
 * @jest-environment node
 */

import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

import { PerformIncidentAction } from '../src/application/incidents/PerformIncidentAction';
import { IncidentAuthorization } from '../src/application/session/IncidentAuthorization';
import type { SessionSecrets } from '../src/domain/session/SessionSecrets';
import type { SessionStorage } from '../src/domain/session/SessionStorage';
import { IncidentApiClient } from '../src/infrastructure/incidents/IncidentApiClient';
import { RemoteIncidentRepository } from '../src/infrastructure/incidents/RemoteIncidentRepository';
import {
  HttpTransportFailure,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
} from '../src/infrastructure/http/HttpTransport';
import { SessionManager } from '../src/infrastructure/session/SessionManager';

const BASE_URL = 'http://127.0.0.1:4310';
let backend: ChildProcess;

class MemorySessionStorage implements SessionStorage {
  private value: SessionSecrets | null;
  clearCalls = 0;

  constructor(initial: SessionSecrets | null = null) {
    this.value = initial;
  }

  async save(session: SessionSecrets): Promise<void> {
    this.value = { ...session };
  }

  async load(): Promise<SessionSecrets | null> {
    return this.value === null ? null : { ...this.value };
  }

  async clear(): Promise<void> {
    this.clearCalls += 1;
    this.value = null;
  }

  current(): SessionSecrets | null {
    return this.value;
  }
}

class CountingTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];

  constructor(private readonly delegate: HttpTransport = new NodeHttpTransport()) {}

  async request(input: HttpRequest): Promise<HttpResponse> {
    this.requests.push(input);
    return this.delegate.request(input);
  }
}

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
      request.on('error', () => resolve(false));
    });
    if (reachable) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('CampusOps backend did not become ready');
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
          response.on('end', () =>
            resolve({ status: response.statusCode ?? 0, body }),
          );
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

function sessionStack(
  transport: HttpTransport = new CountingTransport(new NodeHttpTransport()),
  storage = new MemorySessionStorage(),
  options: ConstructorParameters<typeof SessionManager>[2] = {},
) {
  const manager = new SessionManager(transport, storage, {
    baseUrl: BASE_URL,
    timeoutMs: 3_000,
    ...options,
  });
  const client = new IncidentApiClient(transport, {
    baseUrl: BASE_URL,
    timeoutMs: 3_000,
    sessionManager: manager,
  });
  const repository = new RemoteIncidentRepository(client);
  const actions = new PerformIncidentAction(
    repository,
    new IncidentAuthorization(),
    manager,
  );
  return { manager, client, actions, storage };
}

beforeAll(async () => {
  backend = spawn(
    process.execPath,
    [path.resolve(process.cwd(), 'course-backend/server.mjs')],
    {
      cwd: process.cwd(),
      stdio: 'pipe',
      windowsHide: true,
    },
  );
  backend.stdout?.on('data', (data) => process.stderr.write(data));
  backend.stderr?.on('data', (data) => process.stderr.write(data));
  await waitForBackend();
});

afterAll(() => {
  backend.kill();
});

jest.setTimeout(15_000);

describe('Semana 6 - sesión, autorización e integración reales', () => {
  test.each([
    ['reporter-1', 'reporter'],
    ['technician-1', 'technician'],
    ['coordinator-1', 'coordinator'],
  ] as const)('login de %s obtiene el perfil %s', async (actorId, role) => {
    const { manager } = sessionStack();

    await expect(manager.login(actorId)).resolves.toMatchObject({
      actorId,
      role,
      generation: 0,
    });
  });

  test('reportante no puede resolver ni siquiera si la UI invoca la operación', async () => {
    const transport = new CountingTransport();
    const { manager, client, actions } = sessionStack(transport);
    await manager.login('reporter-1');

    await expect(
      actions.execute(
        'campus-inc-001',
        { action: 'resolve', baseVersion: 1, diagnosis: 'No autorizado' },
        'week06-reporter-resolve',
      ),
    ).resolves.toEqual({ kind: 'error', error: 'forbidden' });
    expect(
      transport.requests.filter(({ url }) => url.endsWith('/actions')),
    ).toHaveLength(0);

    await expect(
      client.performAction(
        'campus-inc-001',
        { action: 'resolve', baseVersion: 1, diagnosis: 'No autorizado' },
        'week06-backend-forbidden',
      ),
    ).resolves.toEqual({
      kind: 'failure',
      error: { kind: 'http', status: 403 },
    });
  });

  test('técnico asignado resuelve y coordinación cierra y reabre', async () => {
    const technician = sessionStack();
    await technician.manager.login('technician-1');

    const started = await technician.actions.execute(
      'campus-inc-001',
      { action: 'start', baseVersion: 1 },
      'week06-start-assigned',
    );
    expect(started).toMatchObject({
      kind: 'updated',
      result: { incident: { status: 'in_progress', version: 2 } },
    });

    const resolved = await technician.actions.execute(
      'campus-inc-001',
      {
        action: 'resolve',
        baseVersion: 2,
        diagnosis: 'Diagnóstico sintético verificado',
      },
      'week06-resolve-assigned',
    );
    expect(resolved).toMatchObject({
      kind: 'updated',
      result: { incident: { status: 'resolved', version: 3 } },
    });

    const coordinator = sessionStack();
    await coordinator.manager.login('coordinator-1');
    await expect(
      coordinator.actions.execute(
        'campus-inc-001',
        { action: 'close', baseVersion: 3 },
        'week06-coordinator-close',
      ),
    ).resolves.toMatchObject({
      kind: 'updated',
      result: { incident: { status: 'closed', version: 4 } },
    });
    await expect(
      coordinator.actions.execute(
        'campus-inc-001',
        { action: 'reopen', baseVersion: 4 },
        'week06-coordinator-reopen',
      ),
    ).resolves.toMatchObject({
      kind: 'updated',
      result: { incident: { status: 'assigned', version: 5 } },
    });
  });

  test('tres 401 concurrentes comparten un refresh y un único reintento', async () => {
    const expired: SessionSecrets = {
      accessToken: 'course-expired-token',
      refreshToken: 'course-refresh-0',
      actorId: 'technician-1',
    };
    const transport = new CountingTransport();
    const storage = new MemorySessionStorage(expired);
    const { manager, client } = sessionStack(transport, storage, {
      initialSession: expired,
      initialRole: 'technician',
    });

    const results = await Promise.all([
      client.listIncidents(),
      client.getIncidentDetail('campus-inc-001'),
      client.getIncidentDetail('campus-inc-001'),
    ]);

    expect(results.every(({ kind }) => kind === 'available')).toBe(true);
    expect(
      transport.requests.filter(({ url }) => url.endsWith('/session/refresh')),
    ).toHaveLength(1);
    expect(manager.getSessionSnapshot()).toMatchObject({
      accessToken: 'course-valid-token',
      generation: 1,
    });

    await manager.logout();
    expect(manager.getSessionSnapshot()).toBeNull();
    expect(storage.current()).toBeNull();
    expect(storage.clearCalls).toBe(1);
  });
});

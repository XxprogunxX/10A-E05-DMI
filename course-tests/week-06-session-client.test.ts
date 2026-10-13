import type { CreateIncidentInput } from '../src/domain/incidents/CloudIncident';
import type { SessionSecrets } from '../src/domain/session/SessionSecrets';
import type { SessionStorage } from '../src/domain/session/SessionStorage';
import type {
  HttpRequest,
  HttpResponse,
  HttpTransport,
} from '../src/infrastructure/http/HttpTransport';
import { IncidentApiClient } from '../src/infrastructure/incidents/IncidentApiClient';
import {
  SessionManager,
  SessionManagerFailure,
  type SessionClock,
} from '../src/infrastructure/session/SessionManager';

const baseUrl = 'http://backend.test';
const expiredSession: SessionSecrets = {
  accessToken: 'course-expired-token',
  refreshToken: 'course-refresh-0',
  actorId: 'reporter-1',
};
const refreshedSession: SessionSecrets = {
  accessToken: 'course-token-generation-1',
  refreshToken: 'course-refresh-1',
  actorId: 'reporter-1',
};
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
const operationId = 'clave-estable-de-prueba';

function jsonResponse(value: unknown, status = 200): HttpResponse {
  return { status, body: JSON.stringify(value) };
}

class MemorySessionStorage implements SessionStorage {
  saveCalls = 0;
  clearCalls = 0;

  constructor(private value: SessionSecrets | null) {}

  async save(session: SessionSecrets): Promise<void> {
    this.saveCalls += 1;
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
    return this.value === null ? null : { ...this.value };
  }
}

class Concurrent401Transport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  refreshCalls = 0;
  private expiredCalls = 0;
  private releaseRefresh: (() => void) | undefined;
  private readonly allInitialRequestsArrived = new Promise<void>((resolve) => {
    this.releaseRefresh = resolve;
  });

  async request(input: HttpRequest): Promise<HttpResponse> {
    this.requests.push(input);

    if (input.url.endsWith('/v1/session/refresh')) {
      this.refreshCalls += 1;
      await this.allInitialRequestsArrived;
      return jsonResponse({
        accessToken: refreshedSession.accessToken,
        refreshToken: refreshedSession.refreshToken,
        expiresIn: 60,
      });
    }

    if (input.headers.Authorization === `Bearer ${expiredSession.accessToken}`) {
      this.expiredCalls += 1;
      if (this.expiredCalls === 3) {
        this.releaseRefresh?.();
      }
      return { status: 401, body: '{"token":"must-not-escape"}' };
    }

    if (input.url.endsWith('/v1/incidents') && input.method === 'GET') {
      return jsonResponse({ items: [remoteIncident] });
    }
    if (input.url.endsWith('/v1/incidents') && input.method === 'POST') {
      return jsonResponse(
        { incident: remoteIncident, operationId, duplicate: false },
        201,
      );
    }
    return jsonResponse(remoteIncident);
  }
}

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

class ControlledClock implements SessionClock {
  constructor(private milliseconds: number) {}

  now(): number {
    return this.milliseconds;
  }

  advance(milliseconds: number): void {
    this.milliseconds += milliseconds;
  }
}

function sessionManagerFor(
  transport: HttpTransport,
  storage: SessionStorage,
): SessionManager {
  return new SessionManager(transport, storage, {
    baseUrl,
    timeoutMs: 25,
    initialSession: expiredSession,
    initialRole: 'reporter',
  });
}

function clientFor(
  transport: HttpTransport,
  sessionManager: SessionManager,
): IncidentApiClient {
  return new IncidentApiClient(transport, {
    baseUrl,
    timeoutMs: 25,
    sessionManager,
  });
}

describe('Week 06 — session-aware infrastructure client (Francisco)', () => {
  test('three concurrent 401 responses share one refresh and all retry successfully', async () => {
    const transport = new Concurrent401Transport();
    const storage = new MemorySessionStorage(expiredSession);
    const manager = sessionManagerFor(transport, storage);
    const client = clientFor(transport, manager);

    const [list, detail, creation] = await Promise.all([
      client.listIncidents(),
      client.getIncidentDetail('campus-inc-001'),
      client.createIncident(createInput, operationId),
    ]);

    expect(list.kind).toBe('available');
    expect(detail.kind).toBe('available');
    expect(creation.kind).toBe('available');
    expect(transport.refreshCalls).toBe(1);
    expect(storage.current()).toMatchObject({
      ...refreshedSession,
      role: 'reporter',
      generation: 1,
    });
    expect(manager.getSessionSnapshot()).toMatchObject({
      accessToken: refreshedSession.accessToken,
      generation: 1,
    });

    const retriedRequests = transport.requests.filter(
      ({ headers, url }) =>
        !url.endsWith('/v1/session/refresh') &&
        headers.Authorization === `Bearer ${refreshedSession.accessToken}`,
    );
    expect(retriedRequests).toHaveLength(3);
  });

  test('login validates the response, persists it and exposes the assigned role', async () => {
    const loggedInSession: SessionSecrets = {
      accessToken: 'course-login-token',
      refreshToken: 'course-login-refresh',
      actorId: 'technician-1',
    };
    const transport = new StubHttpTransport([
      jsonResponse({
        ...loggedInSession,
        role: 'technician',
        expiresIn: 60,
      }),
    ]);
    const storage = new MemorySessionStorage(null);
    const manager = new SessionManager(transport, storage, {
      baseUrl,
      timeoutMs: 25,
    });

    await expect(manager.login('technician-1')).resolves.toEqual({
      accessToken: loggedInSession.accessToken,
      actorId: 'technician-1',
      role: 'technician',
      generation: 0,
    });
    expect(storage.current()).toMatchObject({
      ...loggedInSession,
      role: 'technician',
      generation: 0,
    });
    expect(transport.requests[0]).toEqual({
      url: `${baseUrl}/v1/session/login`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actorId: 'technician-1' }),
      timeoutMs: 25,
    });
  });

  test('controlled clock expires the token and refreshes without real waits', async () => {
    const clock = new ControlledClock(1_000);
    const transport = new StubHttpTransport([
      jsonResponse({
        actorId: 'reporter-1',
        role: 'reporter',
        accessToken: 'short-lived-token',
        refreshToken: 'course-refresh-0',
        expiresIn: 1,
      }),
      jsonResponse({
        accessToken: refreshedSession.accessToken,
        refreshToken: refreshedSession.refreshToken,
        expiresIn: 60,
      }),
      jsonResponse({ items: [remoteIncident] }),
    ]);
    const storage = new MemorySessionStorage(null);
    const manager = new SessionManager(transport, storage, {
      baseUrl,
      timeoutMs: 25,
      clock,
    });
    const client = clientFor(transport, manager);

    await manager.login('reporter-1');
    expect(manager.isAccessTokenExpired()).toBe(false);
    clock.advance(1_000);
    expect(manager.isAccessTokenExpired()).toBe(true);

    await expect(client.listIncidents()).resolves.toMatchObject({
      kind: 'available',
    });
    expect(transport.requests.map(({ url }) => url)).toEqual([
      `${baseUrl}/v1/session/login`,
      `${baseUrl}/v1/session/refresh`,
      `${baseUrl}/v1/incidents`,
    ]);
    expect(transport.requests[2]?.headers.Authorization).toBe(
      `Bearer ${refreshedSession.accessToken}`,
    );
  });

  test('failed refresh returns a controlled 401 and clears persisted secrets', async () => {
    const leakedToken = 'synthetic-provider-token';
    const transport = new StubHttpTransport([
      { status: 401, body: JSON.stringify({ token: leakedToken }) },
      { status: 500, body: JSON.stringify({ token: leakedToken }) },
    ]);
    const storage = new MemorySessionStorage(expiredSession);
    const manager = sessionManagerFor(transport, storage);
    const client = clientFor(transport, manager);

    const result = await client.listIncidents();

    expect(result).toEqual({
      kind: 'failure',
      error: { kind: 'http', status: 401 },
    });
    expect(manager.getSessionSnapshot()).toBeNull();
    expect(storage.current()).toBeNull();
    expect(storage.clearCalls).toBe(1);
    expect(JSON.stringify(result)).not.toContain(leakedToken);
  });

  test('a second 401 after refresh is not retried or refreshed again', async () => {
    const transport = new StubHttpTransport([
      { status: 401, body: '' },
      jsonResponse({
        accessToken: refreshedSession.accessToken,
        refreshToken: refreshedSession.refreshToken,
        expiresIn: 60,
      }),
      { status: 401, body: '' },
    ]);
    const storage = new MemorySessionStorage(expiredSession);
    const manager = sessionManagerFor(transport, storage);
    const client = clientFor(transport, manager);

    await expect(client.listIncidents()).resolves.toEqual({
      kind: 'failure',
      error: { kind: 'http', status: 401 },
    });
    expect(transport.requests).toHaveLength(3);
    expect(
      transport.requests.filter(({ url }) =>
        url.endsWith('/v1/session/refresh'),
      ),
    ).toHaveLength(1);
  });

  test('logout clears memory and storage through the session-aware client', async () => {
    const transport = new StubHttpTransport([]);
    const storage = new MemorySessionStorage(expiredSession);
    const manager = sessionManagerFor(transport, storage);
    const client = clientFor(transport, manager);

    await client.logout();

    expect(manager.getSessionSnapshot()).toBeNull();
    expect(storage.current()).toBeNull();
    expect(storage.clearCalls).toBe(1);
    expect(transport.requests).toEqual([]);
  });

  test('logout makes an in-flight refresh obsolete and prevents token restoration', async () => {
    let completeRefresh:
      | ((response: HttpResponse) => void)
      | undefined;
    const transport: HttpTransport = {
      request: jest.fn(
        () =>
          new Promise<HttpResponse>((resolve) => {
            completeRefresh = resolve;
          }),
      ),
    };
    const storage = new MemorySessionStorage(expiredSession);
    const manager = sessionManagerFor(transport, storage);

    const refresh = manager.acquireValidToken(0);
    const rejection = expect(refresh).rejects.toMatchObject({
      kind: 'obsolete_refresh',
      message: 'Session operation failed.',
    });
    await manager.logout();
    completeRefresh?.(
      jsonResponse({
        accessToken: refreshedSession.accessToken,
        refreshToken: refreshedSession.refreshToken,
        expiresIn: 60,
      }),
    );

    await rejection;
    expect(manager.getSessionSnapshot()).toBeNull();
    expect(storage.current()).toBeNull();
  });

  test('provider exceptions become generic session failures without secrets', async () => {
    const leakedDetails =
      'Bearer synthetic-secret at Edificio privado with private description';
    const transport = new StubHttpTransport([new Error(leakedDetails)]);
    const storage = new MemorySessionStorage(expiredSession);
    const manager = sessionManagerFor(transport, storage);

    let observed: unknown;
    try {
      await manager.acquireValidToken(0);
    } catch (error: unknown) {
      observed = error;
    }

    expect(observed).toBeInstanceOf(SessionManagerFailure);
    expect(observed).toMatchObject({
      kind: 'refresh_failed',
      message: 'Session operation failed.',
    });
    expect(JSON.stringify(observed)).not.toContain('synthetic-secret');
    expect(JSON.stringify(observed)).not.toContain('Edificio privado');
    expect(storage.current()).toBeNull();
  });
});

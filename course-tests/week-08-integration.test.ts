/**
 * @jest-environment node
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { IncidentAuthorization } from '../src/application/session/IncidentAuthorization';
import { OfflineIncidentSyncService } from '../src/application/sync/OfflineIncidentSyncService';
import type { CloudIncident } from '../src/domain/incidents/CloudIncident';
import type { SessionSecrets } from '../src/domain/session/SessionSecrets';
import type { SessionStorage } from '../src/domain/session/SessionStorage';
import {
  HttpTransportFailure,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
} from '../src/infrastructure/http/HttpTransport';
import { IncidentApiClient } from '../src/infrastructure/incidents/IncidentApiClient';
import { RemoteIncidentRepository } from '../src/infrastructure/incidents/RemoteIncidentRepository';
import { FileKeyValuePersistenceDriver } from '../src/infrastructure/persistence/FileKeyValuePersistenceDriver';
import { PersistentIncidentStore } from '../src/infrastructure/persistence/PersistentIncidentStore';
import { SessionManager } from '../src/infrastructure/session/SessionManager';

let backend: ChildProcess;
let baseUrl = '';
let tempDir = '';

class MemorySessionStorage implements SessionStorage {
  private value: SessionSecrets | null = null;

  async save(session: SessionSecrets): Promise<void> {
    this.value = { ...session };
  }

  async load(): Promise<SessionSecrets | null> {
    return this.value === null ? null : { ...this.value };
  }

  async clear(): Promise<void> {
    this.value = null;
  }
}

class ScenarioNodeHttpTransport implements HttpTransport {
  scenario: string | null = null;

  async request(input: HttpRequest): Promise<HttpResponse> {
    return await new Promise((resolve, reject) => {
      const target = new URL(input.url);
      const headers: Record<string, string> = {
        ...input.headers,
        ...(this.scenario === null
          ? {}
          : { 'X-Course-Scenario': this.scenario }),
      };
      const request = http.request(
        {
          hostname: target.hostname,
          port: target.port,
          path: `${target.pathname}${target.search}`,
          method: input.method,
          headers,
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

async function waitForBackend(): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const reachable = await new Promise<boolean>((resolve) => {
      const request = http.get(`${baseUrl}/health`, (response) => {
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

function createActorContext(
  filePath: string,
  transport = new ScenarioNodeHttpTransport(),
  timeoutMs = 3_000,
) {
  if (!baseUrl) throw new Error('Backend URL is not initialized');
  const sessionManager = new SessionManager(
    transport,
    new MemorySessionStorage(),
    { baseUrl, timeoutMs },
  );
  const apiClient = new IncidentApiClient(transport, {
    baseUrl,
    timeoutMs,
    sessionManager,
  });
  const repository = new RemoteIncidentRepository(apiClient);
  const authorization = new IncidentAuthorization();
  const store = new PersistentIncidentStore(
    new FileKeyValuePersistenceDriver(filePath),
  );
  return {
    transport,
    sessionManager,
    repository,
    store,
    syncService: new OfflineIncidentSyncService(
      store,
      repository,
      authorization,
      sessionManager,
    ),
  };
}

beforeAll(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'campusops-week08-'));
  backend = spawn(
    process.execPath,
    [path.resolve(process.cwd(), 'course-backend/server.mjs')],
    {
      cwd: process.cwd(),
      env: { ...process.env, COURSE_BACKEND_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  baseUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('CampusOps backend startup timed out')),
      10_000,
    );
    backend.stdout?.setEncoding('utf8');
    backend.stdout?.on('data', (chunk: string) => {
      const match = chunk.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    backend.once('error', reject);
    backend.once('exit', (code) =>
      reject(new Error(`CampusOps backend exited early: ${code}`)),
    );
  });
  await waitForBackend();
});

afterAll(async () => {
  backend?.kill();
  if (tempDir.startsWith(os.tmpdir())) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

jest.setTimeout(20_000);

describe('Week 08 — durable offline synchronization (Carlos)', () => {
  it('recovers a real disk queue and preserves both sides of a reassignment conflict', async () => {
    const databasePath = path.join(tempDir, 'conflict-database.json');
    const firstTechnicianSession = createActorContext(databasePath);
    await firstTechnicianSession.sessionManager.login('technician-1');
    await firstTechnicianSession.store.initialize();

    const cached = await firstTechnicianSession.syncService.cacheRemoteIncident(
      'campus-inc-001',
    );
    expect(cached.kind).toBe('cached');
    if (cached.kind !== 'cached') throw new Error('Expected cached incident');
    const baseSnapshot = cached.incident;

    await expect(
      firstTechnicianSession.syncService.enqueueOfflineAction({
        operationId: 'op-week08-tech1-start-001',
        incidentId: 'campus-inc-001',
        payload: { action: 'start', baseVersion: 1 },
        createdAt: '2026-10-20T10:00:00.000Z',
        pendingEvidence: [
          {
            evidenceId: 'ev-week08-photo-001',
            localUri: 'file:///local/pending/ev-week08-photo-001.jpg',
            mimeType: 'image/jpeg',
            uploadState: 'pending_upload',
          },
        ],
      }),
    ).resolves.toMatchObject({ kind: 'queued' });
    await firstTechnicianSession.store.close();

    const diskText = await fs.readFile(databasePath, 'utf8');
    expect(diskText).toContain('op-week08-tech1-start-001');
    expect(diskText).toContain('pending_upload');

    const coordinator = createActorContext(
      path.join(tempDir, 'coordinator-conflict.json'),
    );
    await coordinator.sessionManager.login('coordinator-1');
    await expect(
      coordinator.repository.performAction(
        'campus-inc-001',
        { action: 'assign', baseVersion: 1, technicianId: 'technician-2' },
        'op-week08-coord-reassign-001',
      ),
    ).resolves.toMatchObject({
      kind: 'available',
      value: {
        incident: {
          version: 2,
          status: 'assigned',
          assignedTechnicianId: 'technician-2',
        },
      },
    });

    const reopenedTechnicianSession = createActorContext(databasePath);
    await reopenedTechnicianSession.sessionManager.login('technician-1');
    await reopenedTechnicianSession.store.initialize();
    const recoveredQueue = await reopenedTechnicianSession.store.getQueue();
    expect(recoveredQueue).toHaveLength(1);
    expect(recoveredQueue[0]).toMatchObject({
      operationId: 'op-week08-tech1-start-001',
      pendingEvidence: [{ uploadState: 'pending_upload' }],
    });

    const outcomes =
      await reopenedTechnicianSession.syncService.syncPendingQueue({
        remoteStateInspector: coordinator.repository,
        baseSnapshots: { 'campus-inc-001': baseSnapshot },
      });
    expect(outcomes).toEqual([
      {
        operationId: 'op-week08-tech1-start-001',
        status: 'conflict',
        conflictFields: ['work'],
        remoteIncident: expect.objectContaining({
          version: 2,
          status: 'assigned',
          assignedTechnicianId: 'technician-2',
        }),
        authorizationStillValid: false,
      },
    ]);

    const queueAfterConflict = await reopenedTechnicianSession.store.getQueue();
    expect(queueAfterConflict).toHaveLength(1);
    expect(queueAfterConflict[0]).toMatchObject({
      status: 'conflicted',
      conflictFields: ['work'],
    });
    await expect(
      reopenedTechnicianSession.syncService.syncPendingQueue({
        remoteStateInspector: coordinator.repository,
        baseSnapshots: { 'campus-inc-001': baseSnapshot },
      }),
    ).resolves.toEqual([]);

    const localRecord =
      await reopenedTechnicianSession.store.getIncidentRecord(
        'campus-inc-001',
      );
    expect(localRecord?.incident).toMatchObject({
      version: 2,
      assignedTechnicianId: 'technician-2',
    });
  });

  it('retains failures and removes only a server-confirmed idempotent operation', async () => {
    const reporter = createActorContext(
      path.join(tempDir, 'reporter-idempotency.json'),
    );
    await reporter.sessionManager.login('reporter-1');
    const created = await reporter.repository.create(
      {
        category: 'electrical',
        description: 'Falla de tablero en edificio B',
        location: 'Edificio B · Planta Baja',
      },
      'op-week08-create-inc-002',
    );
    expect(created.kind).toBe('available');
    if (created.kind !== 'available') throw new Error('Expected incident');
    const incidentId = created.value.incident.id;

    const coordinator = createActorContext(
      path.join(tempDir, 'coordinator-idempotency.json'),
    );
    await coordinator.sessionManager.login('coordinator-1');
    await expect(
      coordinator.repository.performAction(
        incidentId,
        { action: 'assign', baseVersion: 1, technicianId: 'technician-1' },
        'op-week08-assign-tech1-002',
      ),
    ).resolves.toMatchObject({ kind: 'available' });

    const technicianTransport = new ScenarioNodeHttpTransport();
    const technician = createActorContext(
      path.join(tempDir, 'idempotency-database.json'),
      technicianTransport,
    );
    await technician.sessionManager.login('technician-1');
    await technician.store.initialize();
    await technician.syncService.cacheRemoteIncident(incidentId);
    const operationId = 'op-week08-idempotent-start-002';
    await technician.syncService.enqueueOfflineAction({
      operationId,
      incidentId,
      payload: { action: 'start', baseVersion: 2 },
    });

    technicianTransport.scenario = 'server_error';
    await expect(technician.syncService.syncPendingQueue()).resolves.toEqual([
      { operationId, status: 'pending_retry', error: 'http' },
    ]);
    expect(await technician.store.getQueue()).toMatchObject([
      { operationId, status: 'failed' },
    ]);

    technicianTransport.scenario = null;
    await expect(technician.syncService.syncPendingQueue()).resolves.toEqual([
      {
        operationId,
        status: 'synced',
        duplicate: false,
        incident: expect.objectContaining({
          id: incidentId,
          version: 3,
          status: 'in_progress',
        }),
      },
    ]);
    expect(await technician.store.getQueue()).toHaveLength(0);

    await expect(
      technician.repository.performAction(
        incidentId,
        { action: 'start', baseVersion: 2 },
        operationId,
      ),
    ).resolves.toEqual({
      kind: 'available',
      value: {
        operationId,
        duplicate: true,
        incident: expect.objectContaining({
          id: incidentId,
          version: 3,
          status: 'in_progress',
        }),
      },
    });
  });

  it('merges independent remote priority and local work changes before syncing', async () => {
    const reporter = createActorContext(path.join(tempDir, 'reporter-merge.json'));
    await reporter.sessionManager.login('reporter-1');
    const created = await reporter.repository.create(
      {
        category: 'connectivity',
        description: 'Punto de red intermitente',
        location: 'Edificio C · Aula 2',
      },
      'op-week08-create-merge-003',
    );
    if (created.kind !== 'available') throw new Error('Expected incident');
    const incidentId = created.value.incident.id;

    const coordinator = createActorContext(
      path.join(tempDir, 'coordinator-merge.json'),
    );
    await coordinator.sessionManager.login('coordinator-1');
    await coordinator.repository.performAction(
      incidentId,
      { action: 'assign', baseVersion: 1, technicianId: 'technician-1' },
      'op-week08-assign-merge-003',
    );

    const technician = createActorContext(
      path.join(tempDir, 'technician-merge.json'),
    );
    await technician.sessionManager.login('technician-1');
    await technician.store.initialize();
    const cached = await technician.syncService.cacheRemoteIncident(incidentId);
    if (cached.kind !== 'cached') throw new Error('Expected cached incident');
    await technician.syncService.enqueueOfflineAction({
      operationId: 'op-week08-start-merge-003',
      incidentId,
      payload: { action: 'start', baseVersion: 2 },
    });

    await coordinator.repository.performAction(
      incidentId,
      { action: 'prioritize', baseVersion: 2, priority: 'high' },
      'op-week08-priority-merge-003',
    );
    const outcomes = await technician.syncService.syncPendingQueue({
      baseSnapshots: { [incidentId]: cached.incident },
    });

    expect(outcomes).toMatchObject([
      {
        operationId: 'op-week08-start-merge-003',
        status: 'merged_and_synced',
        mergedFields: {
          priority: 'high',
          work: {
            assignedTechnicianId: 'technician-1',
            status: 'in_progress',
          },
        },
        incident: {
          version: 4,
          priority: 'high',
          status: 'in_progress',
        },
      },
    ]);
    expect(await technician.store.getQueue()).toHaveLength(0);
  });

  it('keeps the first local operation when an operationId is enqueued twice', async () => {
    const store = new PersistentIncidentStore(
      new FileKeyValuePersistenceDriver(
        path.join(tempDir, 'local-deduplication.json'),
      ),
    );
    await store.initialize();
    const incident: CloudIncident = {
      id: 'local-inc-duplicate',
      version: 1,
      status: 'assigned',
      category: 'maintenance',
      description: 'Registro local ficticio',
      location: 'Taller',
      priority: 'medium',
      reporterId: 'reporter-1',
      assignedTechnicianId: 'technician-1',
    };
    await store.saveIncident(incident);
    await store.enqueueOfflineOperation({
      operationId: 'op-week08-comment-dedup-004',
      incidentId: incident.id,
      actorId: 'technician-1',
      payload: { action: 'comment', baseVersion: 1, text: 'Primer texto' },
    });
    await store.enqueueOfflineOperation({
      operationId: 'op-week08-comment-dedup-004',
      incidentId: incident.id,
      actorId: 'technician-1',
      payload: { action: 'comment', baseVersion: 1, text: 'Texto distinto' },
    });

    expect(await store.getQueue()).toMatchObject([
      { payload: { text: 'Primer texto' } },
    ]);
    expect((await store.getIncidentRecord(incident.id))?.notes).toEqual([
      { actorId: 'technician-1', text: 'Primer texto' },
    ]);
  });

  it('recovers an interrupted migration from its disk backup after reconstruction', async () => {
    const databasePath = path.join(tempDir, 'interrupted-migration.json');
    const driver = new FileKeyValuePersistenceDriver(databasePath);
    const storageKey = 'campusops.offline.db.v2';
    const backupKey = 'campusops.offline.db.backup';
    const legacy = {
      schemaVersion: 1,
      incidents: {
        'legacy-inc-001': {
          id: 'legacy-inc-001',
          version: 4,
          status: 'assigned',
          category: 'maintenance',
          description: 'Incidencia previa ficticia',
          location: 'Edificio legado',
          priority: 'medium',
          reporterId: 'reporter-1',
          assignedTo: 'technician-1',
        },
      },
      pendingQueue: [
        {
          opId: 'op-week08-legacy-start-005',
          incidentId: 'legacy-inc-001',
          version: 4,
          actor: 'technician-1',
          action: 'start',
          body: { action: 'start', baseVersion: 4 },
        },
      ],
    };
    await driver.setItem(backupKey, JSON.stringify(legacy));
    await driver.setItem(
      storageKey,
      JSON.stringify({
        schemaVersion: 2,
        corruptedPartialMigration: true,
      }),
    );

    const reconstructed = new PersistentIncidentStore(
      new FileKeyValuePersistenceDriver(databasePath),
    );
    const recovered = await reconstructed.initialize();

    expect(recovered).toMatchObject({
      schemaVersion: 2,
      migratedFromVersion: 1,
      incidents: {
        'legacy-inc-001': {
          incident: { assignedTechnicianId: 'technician-1' },
        },
      },
      queue: [{ operationId: 'op-week08-legacy-start-005' }],
    });
    await expect(
      new FileKeyValuePersistenceDriver(databasePath).getItem(backupKey),
    ).resolves.toBeNull();
  });
});

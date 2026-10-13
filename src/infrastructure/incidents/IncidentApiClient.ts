import {
  INCIDENT_CATEGORIES,
  type CloudIncident,
  type CreatedIncident,
  type CreateIncidentInput,
  type IncidentActionInput,
  type UpdatedIncident,
} from '../../domain/incidents/CloudIncident';
import type {
  HttpRequest,
  HttpResponse,
  HttpTransport,
} from '../http/HttpTransport';
import { HttpTransportFailure } from '../http/HttpTransport';
import type {
  SessionManager,
  SessionSnapshot,
} from '../session/SessionManager';
import { parseIncidentResource } from './IncidentDto';

export type IncidentClientFailure =
  | Readonly<{ kind: 'timeout' }>
  | Readonly<{ kind: 'network' }>
  | Readonly<{ kind: 'http'; status: number }>
  | Readonly<{ kind: 'invalid_json' }>
  | Readonly<{ kind: 'contract' }>
  | Readonly<{ kind: 'invalid_payload' }>;

export type IncidentClientResult<T> =
  | Readonly<{ kind: 'available'; value: T }>
  | Readonly<{ kind: 'empty_payload' }>
  | Readonly<{ kind: 'failure'; error: IncidentClientFailure }>;

export interface IncidentApiClientOptions {
  readonly baseUrl?: string;
  readonly accessToken?: string;
  readonly actorId?: string;
  readonly timeoutMs?: number;
  readonly sessionManager?: SessionManager;
}

type SafeResponse =
  | Readonly<{ ok: true; value: HttpResponse }>
  | Readonly<{ ok: false; error: IncidentClientFailure }>;

const DEFAULT_BASE_URL = 'http://127.0.0.1:4310';
const DEFAULT_ACCESS_TOKEN = 'course-valid-token';
const DEFAULT_ACTOR_ID = 'reporter-1';
const DEFAULT_TIMEOUT_MS = 1_000;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonemptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidCreateInput(input: CreateIncidentInput): boolean {
  return (
    INCIDENT_CATEGORIES.some((category) => category === input.category) &&
    isNonemptyText(input.description) &&
    isNonemptyText(input.location)
  );
}

function isValidIdempotencyKey(value: string): boolean {
  return value.trim().length >= 8;
}

function isValidActionInput(input: IncidentActionInput): boolean {
  if (!Number.isInteger(input.baseVersion) || input.baseVersion < 0) {
    return false;
  }

  switch (input.action) {
    case 'assign':
      return isNonemptyText(input.technicianId);
    case 'prioritize':
      return ['low', 'medium', 'high'].includes(input.priority);
    case 'resolve':
      return isNonemptyText(input.diagnosis);
    case 'comment':
      return isNonemptyText(input.text);
    case 'add_evidence':
      return isNonemptyText(input.evidenceId);
    case 'start':
    case 'close':
    case 'reopen':
      return true;
  }
}

function parseJson(
  body: string,
): Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false }> {
  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false };
  }
}

export class IncidentApiClient {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly actorId: string;
  private readonly timeoutMs: number;
  private readonly sessionManager: SessionManager | undefined;

  constructor(
    private readonly transport: HttpTransport,
    options: IncidentApiClientOptions = {},
  ) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.accessToken = options.accessToken ?? DEFAULT_ACCESS_TOKEN;
    this.actorId = options.actorId ?? DEFAULT_ACTOR_ID;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sessionManager = options.sessionManager;
  }

  async listIncidents(): Promise<
    IncidentClientResult<readonly CloudIncident[]>
  > {
    const response = await this.requestAuthorized({
      url: `${this.baseUrl}/v1/incidents`,
      method: 'GET',
      headers: {},
      timeoutMs: this.timeoutMs,
    });
    if (!response.ok) {
      return { kind: 'failure', error: response.error };
    }
    if (response.value.status !== 200) {
      return {
        kind: 'failure',
        error: { kind: 'http', status: response.value.status },
      };
    }

    const decoded = parseJson(response.value.body);
    if (!decoded.ok) {
      return { kind: 'failure', error: { kind: 'invalid_json' } };
    }
    if (!isObjectRecord(decoded.value) || !Array.isArray(decoded.value.items)) {
      return { kind: 'failure', error: { kind: 'contract' } };
    }

    const incidents: CloudIncident[] = [];
    let hasEmptyPayload = false;
    for (const item of decoded.value.items) {
      const parsed = parseIncidentResource(item);
      if (!parsed.ok) {
        if (parsed.error === 'empty_payload') {
          hasEmptyPayload = true;
          continue;
        }
        return {
          kind: 'failure',
          error: { kind: parsed.error },
        };
      }
      incidents.push(parsed.value);
    }

    if (hasEmptyPayload) {
      return { kind: 'empty_payload' };
    }

    return { kind: 'available', value: incidents };
  }

  async getIncidentDetail(
    incidentId: string,
  ): Promise<IncidentClientResult<CloudIncident>> {
    const response = await this.requestAuthorized({
      url: `${this.baseUrl}/v1/incidents/${encodeURIComponent(incidentId)}`,
      method: 'GET',
      headers: {},
      timeoutMs: this.timeoutMs,
    });
    if (!response.ok) {
      return { kind: 'failure', error: response.error };
    }
    return this.parseSingleIncidentResponse(response.value, [200]);
  }

  async createIncident(
    input: CreateIncidentInput,
    idempotencyKey: string,
  ): Promise<IncidentClientResult<CreatedIncident>> {
    if (
      !isValidCreateInput(input) ||
      !isValidIdempotencyKey(idempotencyKey)
    ) {
      return { kind: 'failure', error: { kind: 'invalid_payload' } };
    }

    const response = await this.requestAuthorized({
      url: `${this.baseUrl}/v1/incidents`,
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        category: input.category,
        description: input.description,
        location: input.location,
      }),
      timeoutMs: this.timeoutMs,
    });
    if (!response.ok) {
      return { kind: 'failure', error: response.error };
    }
    if (![200, 201].includes(response.value.status)) {
      return {
        kind: 'failure',
        error: { kind: 'http', status: response.value.status },
      };
    }

    const decoded = parseJson(response.value.body);
    if (!decoded.ok) {
      return { kind: 'failure', error: { kind: 'invalid_json' } };
    }
    if (
      !isObjectRecord(decoded.value) ||
      typeof decoded.value.operationId !== 'string' ||
      decoded.value.operationId !== idempotencyKey ||
      typeof decoded.value.duplicate !== 'boolean' ||
      !Object.hasOwn(decoded.value, 'incident')
    ) {
      return { kind: 'failure', error: { kind: 'contract' } };
    }

    const incident = parseIncidentResource(decoded.value.incident);
    if (!incident.ok) {
      if (incident.error === 'empty_payload') {
        return { kind: 'empty_payload' };
      }
      return {
        kind: 'failure',
        error: { kind: incident.error },
      };
    }

    return {
      kind: 'available',
      value: {
        incident: incident.value,
        operationId: decoded.value.operationId,
        duplicate: decoded.value.duplicate,
      },
    };
  }

  async performAction(
    incidentId: string,
    input: IncidentActionInput,
    idempotencyKey: string,
  ): Promise<IncidentClientResult<UpdatedIncident>> {
    if (
      !isNonemptyText(incidentId) ||
      !isValidActionInput(input) ||
      !isValidIdempotencyKey(idempotencyKey)
    ) {
      return { kind: 'failure', error: { kind: 'invalid_payload' } };
    }

    const response = await this.requestAuthorized({
      url: `${this.baseUrl}/v1/incidents/${encodeURIComponent(incidentId)}/actions`,
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
      timeoutMs: this.timeoutMs,
    });
    if (!response.ok) {
      return { kind: 'failure', error: response.error };
    }
    if (![200, 201].includes(response.value.status)) {
      return {
        kind: 'failure',
        error: { kind: 'http', status: response.value.status },
      };
    }

    const decoded = parseJson(response.value.body);
    if (!decoded.ok) {
      return { kind: 'failure', error: { kind: 'invalid_json' } };
    }
    if (
      !isObjectRecord(decoded.value) ||
      decoded.value.operationId !== idempotencyKey ||
      typeof decoded.value.duplicate !== 'boolean' ||
      !Object.hasOwn(decoded.value, 'incident')
    ) {
      return { kind: 'failure', error: { kind: 'contract' } };
    }

    const incident = parseIncidentResource(decoded.value.incident);
    if (!incident.ok) {
      return incident.error === 'empty_payload'
        ? { kind: 'empty_payload' }
        : { kind: 'failure', error: { kind: incident.error } };
    }

    return {
      kind: 'available',
      value: {
        incident: incident.value,
        operationId: idempotencyKey,
        duplicate: decoded.value.duplicate,
      },
    };
  }

  async logout(): Promise<void> {
    await this.sessionManager?.logout();
  }

  private authorizationHeaders(
    snapshot?: SessionSnapshot,
  ): Readonly<Record<string, string>> {
    return {
      Authorization: `Bearer ${snapshot?.accessToken ?? this.accessToken}`,
      'X-Course-Actor': snapshot?.actorId ?? this.actorId,
    };
  }

  private async requestAuthorized(input: HttpRequest): Promise<SafeResponse> {
    let initialSession = this.sessionManager?.getSessionSnapshot();
    if (this.sessionManager !== undefined && initialSession === null) {
      return {
        ok: true,
        value: { status: 401, body: '' },
      };
    }

    if (
      this.sessionManager !== undefined &&
      initialSession !== undefined &&
      initialSession !== null &&
      this.sessionManager.isAccessTokenExpired()
    ) {
      try {
        await this.sessionManager.acquireValidToken(initialSession.generation);
      } catch {
        return { ok: true, value: { status: 401, body: '' } };
      }
      initialSession = this.sessionManager.getSessionSnapshot();
      if (initialSession === null) {
        return { ok: true, value: { status: 401, body: '' } };
      }
    }

    const firstResponse = await this.request({
      ...input,
      headers: {
        ...input.headers,
        ...this.authorizationHeaders(initialSession ?? undefined),
      },
    });

    if (
      !firstResponse.ok ||
      firstResponse.value.status !== 401 ||
      this.sessionManager === undefined ||
      initialSession === undefined ||
      initialSession === null
    ) {
      return firstResponse;
    }

    try {
      await this.sessionManager.acquireValidToken(initialSession.generation);
    } catch {
      return firstResponse;
    }

    const refreshedSession = this.sessionManager.getSessionSnapshot();
    if (refreshedSession === null) {
      return firstResponse;
    }

    // This is the only retry. A second 401 is returned to the caller.
    return this.request({
      ...input,
      headers: {
        ...input.headers,
        ...this.authorizationHeaders(refreshedSession),
      },
    });
  }

  private async request(input: HttpRequest): Promise<SafeResponse> {
    try {
      return { ok: true, value: await this.transport.request(input) };
    } catch (error: unknown) {
      if (error instanceof HttpTransportFailure) {
        return { ok: false, error: { kind: error.kind } };
      }
      return { ok: false, error: { kind: 'network' } };
    }
  }

  private parseSingleIncidentResponse(
    response: HttpResponse,
    acceptedStatuses: readonly number[],
  ): IncidentClientResult<CloudIncident> {
    if (!acceptedStatuses.includes(response.status)) {
      return {
        kind: 'failure',
        error: { kind: 'http', status: response.status },
      };
    }

    const decoded = parseJson(response.body);
    if (!decoded.ok) {
      return { kind: 'failure', error: { kind: 'invalid_json' } };
    }
    const incident = parseIncidentResource(decoded.value);
    if (!incident.ok) {
      if (incident.error === 'empty_payload') {
        return { kind: 'empty_payload' };
      }
      return {
        kind: 'failure',
        error: { kind: incident.error },
      };
    }
    return { kind: 'available', value: incident.value };
  }
}

import type { SessionSecrets } from '../../domain/session/SessionSecrets';
import type { SessionStorage } from '../../domain/session/SessionStorage';
import type { HttpTransport } from '../http/HttpTransport';

export type SessionRole = 'reporter' | 'technician' | 'coordinator';

export interface SessionSnapshot {
  readonly accessToken: string;
  readonly actorId: string;
  readonly role: SessionRole | null;
  readonly generation: number;
}

export type SessionManagerFailureKind =
  | 'unauthenticated'
  | 'login_failed'
  | 'refresh_failed'
  | 'obsolete_refresh'
  | 'storage_failed';

export class SessionManagerFailure extends Error {
  readonly name = 'SessionManagerFailure';

  constructor(readonly kind: SessionManagerFailureKind) {
    super('Session operation failed.');
  }
}

export interface SessionManagerOptions {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly initialSession?: SessionSecrets;
  readonly initialRole?: SessionRole;
  readonly initialGeneration?: number;
}

interface LoginResponse {
  readonly actorId: string;
  readonly role: SessionRole;
  readonly accessToken: string;
  readonly refreshToken: string;
}

interface RefreshResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
}

type StoredSession = SessionSecrets &
  Readonly<{
    role?: SessionRole | null;
    generation?: number;
  }>;

const DEFAULT_BASE_URL = 'http://127.0.0.1:4310';
const DEFAULT_TIMEOUT_MS = 1_000;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonemptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSessionRole(value: unknown): value is SessionRole {
  return (
    value === 'reporter' || value === 'technician' || value === 'coordinator'
  );
}

function parseJson(body: string): unknown | null {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function parseLoginResponse(body: string, actorId: string): LoginResponse | null {
  const decoded = parseJson(body);
  if (
    !isObjectRecord(decoded) ||
    decoded.actorId !== actorId ||
    !isSessionRole(decoded.role) ||
    !isNonemptyText(decoded.accessToken) ||
    !isNonemptyText(decoded.refreshToken)
  ) {
    return null;
  }

  return {
    actorId: decoded.actorId,
    role: decoded.role,
    accessToken: decoded.accessToken,
    refreshToken: decoded.refreshToken,
  };
}

function parseRefreshResponse(body: string): RefreshResponse | null {
  const decoded = parseJson(body);
  if (
    !isObjectRecord(decoded) ||
    !isNonemptyText(decoded.accessToken) ||
    !isNonemptyText(decoded.refreshToken)
  ) {
    return null;
  }

  return {
    accessToken: decoded.accessToken,
    refreshToken: decoded.refreshToken,
  };
}

/**
 * Owns the mutable session used by infrastructure clients. Refresh is
 * single-flight: concurrent 401 responses share the same promise.
 */
export class SessionManager {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private session: StoredSession | null;
  private role: SessionRole | null;
  private generation: number;
  private authenticationEpoch = 0;
  private refreshPromise: Promise<string> | null = null;

  constructor(
    private readonly transport: HttpTransport,
    private readonly storage: SessionStorage,
    options: SessionManagerOptions = {},
  ) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.session = options.initialSession ?? null;
    this.role = options.initialRole ?? null;
    this.generation = options.initialGeneration ?? 0;
  }

  async initialize(role: SessionRole | null = null): Promise<void> {
    try {
      const stored = (await this.storage.load()) as StoredSession | null;
      this.session = stored;
      this.role =
        stored === null
          ? null
          : isSessionRole(stored.role)
            ? stored.role
            : role;
      this.generation =
        stored !== null &&
        Number.isInteger(stored.generation) &&
        (stored.generation ?? -1) >= 0
          ? (stored.generation ?? 0)
          : 0;
      this.authenticationEpoch += 1;
    } catch {
      this.session = null;
      this.role = null;
      this.generation = 0;
      throw new SessionManagerFailure('storage_failed');
    }
  }

  getSessionSnapshot(): SessionSnapshot | null {
    if (this.session === null) {
      return null;
    }

    return {
      accessToken: this.session.accessToken,
      actorId: this.session.actorId,
      role: this.role,
      generation: this.generation,
    };
  }

  async login(actorId: string): Promise<SessionSnapshot> {
    if (!isNonemptyText(actorId)) {
      throw new SessionManagerFailure('login_failed');
    }

    let response;
    try {
      response = await this.transport.request({
        url: `${this.baseUrl}/v1/session/login`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId }),
        timeoutMs: this.timeoutMs,
      });
    } catch {
      throw new SessionManagerFailure('login_failed');
    }

    if (response.status !== 200) {
      throw new SessionManagerFailure('login_failed');
    }

    const parsed = parseLoginResponse(response.body, actorId);
    if (parsed === null) {
      throw new SessionManagerFailure('login_failed');
    }

    const session: StoredSession = {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      actorId: parsed.actorId,
      role: parsed.role,
      generation: 0,
    };

    this.authenticationEpoch += 1;
    this.session = session;
    this.role = parsed.role;
    this.generation = 0;

    try {
      await this.storage.save(session);
    } catch {
      this.session = null;
      this.role = null;
      throw new SessionManagerFailure('storage_failed');
    }

    return this.requireSnapshot();
  }

  /**
   * Returns the token produced by the current shared refresh. If another
   * request already refreshed the failed generation, no second call is made.
   */
  acquireValidToken(failedGeneration = this.generation): Promise<string> {
    if (this.session === null) {
      return Promise.reject(new SessionManagerFailure('unauthenticated'));
    }

    if (failedGeneration < this.generation) {
      return Promise.resolve(this.session.accessToken);
    }

    if (this.refreshPromise !== null) {
      return this.refreshPromise;
    }

    const epoch = this.authenticationEpoch;
    const sessionAtStart = this.session;
    const promise = this.performRefresh(epoch, sessionAtStart).finally(() => {
      if (this.refreshPromise === promise) {
        this.refreshPromise = null;
      }
    });
    this.refreshPromise = promise;
    return promise;
  }

  async logout(): Promise<void> {
    this.authenticationEpoch += 1;
    this.session = null;
    this.role = null;
    this.generation = 0;
    this.refreshPromise = null;

    try {
      await this.storage.clear();
    } catch {
      throw new SessionManagerFailure('storage_failed');
    }
  }

  private async performRefresh(
    expectedEpoch: number,
    sessionAtStart: StoredSession,
  ): Promise<string> {
    let response;
    try {
      response = await this.transport.request({
        url: `${this.baseUrl}/v1/session/refresh`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: sessionAtStart.refreshToken }),
        timeoutMs: this.timeoutMs,
      });
    } catch {
      await this.failRefresh(expectedEpoch);
      throw new SessionManagerFailure('refresh_failed');
    }

    const parsed =
      response.status === 200 ? parseRefreshResponse(response.body) : null;
    if (parsed === null) {
      await this.failRefresh(expectedEpoch);
      throw new SessionManagerFailure('refresh_failed');
    }

    if (
      this.authenticationEpoch !== expectedEpoch ||
      this.session !== sessionAtStart
    ) {
      throw new SessionManagerFailure('obsolete_refresh');
    }

    const nextGeneration = this.generation + 1;
    const refreshedSession: StoredSession = {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      actorId: sessionAtStart.actorId,
      role: this.role,
      generation: nextGeneration,
    };

    try {
      await this.storage.save(refreshedSession);
    } catch {
      await this.failRefresh(expectedEpoch);
      throw new SessionManagerFailure('storage_failed');
    }

    if (this.authenticationEpoch !== expectedEpoch) {
      if (this.session === null) {
        try {
          await this.storage.clear();
        } catch {
          // Memory remains anonymous even if the storage adapter fails.
        }
      }
      throw new SessionManagerFailure('obsolete_refresh');
    }

    this.session = refreshedSession;
    this.generation = nextGeneration;
    return refreshedSession.accessToken;
  }

  private async failRefresh(expectedEpoch: number): Promise<void> {
    if (this.authenticationEpoch !== expectedEpoch) {
      return;
    }

    this.authenticationEpoch += 1;
    this.session = null;
    this.role = null;
    this.generation = 0;
    try {
      await this.storage.clear();
    } catch {
      // The public failure remains generic and never exposes provider data.
    }
  }

  private requireSnapshot(): SessionSnapshot {
    const snapshot = this.getSessionSnapshot();
    if (snapshot === null) {
      throw new SessionManagerFailure('unauthenticated');
    }
    return snapshot;
  }
}

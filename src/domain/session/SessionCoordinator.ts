export type SessionStatus = 'anonymous' | 'authenticated';

export interface AuthCoordinationEvent {
  readonly type: 'request401' | 'refreshSucceeded' | 'refreshFailed' | 'logout';
  readonly requestId?: string;
  readonly generation?: number;
  readonly token?: string;
}

export interface SessionCoordinationSummary {
  readonly status: SessionStatus;
  readonly activeGeneration: number | null;
  readonly refreshCalls: number;
  readonly retriedRequestIds: readonly string[];
  readonly persistedToken: string | null;
}

/**
 * Coalesces concurrent 401 responses into a single-flight refresh operation,
 * bounds retries to prevent refresh loops, and safely returns to anonymous
 * unauthenticated state on failure or logout.
 */
export class SessionCoordinator {
  private status: SessionStatus = 'anonymous';
  private activeGeneration: number | null = null;
  private refreshCalls = 0;
  private inFlightGeneration: number | null = null;
  private persistedToken: string | null = null;
  private readonly pendingRequests: string[] = [];
  private readonly retriedRequests: string[] = [];
  private readonly requestRetryCount = new Map<string, number>();

  processEvent(event: AuthCoordinationEvent): void {
    switch (event.type) {
      case 'request401': {
        const reqId = event.requestId;
        const eventGen = event.generation ?? (this.activeGeneration ?? 0);

        // Bounded retries: each requestId can be retried at most once per generation failure
        if (reqId) {
          const retries = this.requestRetryCount.get(reqId) ?? 0;
          if (retries >= 1 && eventGen === this.activeGeneration) {
            // Request already retried in this generation: prevent infinite refresh loop
            break;
          }
        }

        // Single-flight: coalesce requests at the same generation
        if (this.inFlightGeneration === eventGen) {
          if (reqId && !this.pendingRequests.includes(reqId)) {
            this.pendingRequests.push(reqId);
          }
        } else if (this.activeGeneration !== null && eventGen < this.activeGeneration) {
          // Obsolete 401: a refresh already completed to a newer generation
          if (reqId && !this.retriedRequests.includes(reqId)) {
            const retries = this.requestRetryCount.get(reqId) ?? 0;
            if (retries < 1) {
              this.requestRetryCount.set(reqId, retries + 1);
              this.retriedRequests.push(reqId);
            }
          }
        } else {
          // Trigger a new single-flight refresh operation
          this.refreshCalls += 1;
          this.inFlightGeneration = eventGen;
          if (reqId && !this.pendingRequests.includes(reqId)) {
            this.pendingRequests.push(reqId);
          }
        }
        break;
      }

      case 'refreshSucceeded': {
        const nextGen = event.generation ?? ((this.activeGeneration ?? 0) + 1);
        this.activeGeneration = nextGen;
        this.status = 'authenticated';
        this.persistedToken = event.token ?? this.persistedToken ?? null;
        this.inFlightGeneration = null;

        // Drain pending requests for single-flight retry
        while (this.pendingRequests.length > 0) {
          const reqId = this.pendingRequests.shift()!;
          const retries = this.requestRetryCount.get(reqId) ?? 0;
          if (retries < 1) {
            this.requestRetryCount.set(reqId, retries + 1);
            this.retriedRequests.push(reqId);
          }
        }
        break;
      }

      case 'refreshFailed': {
        this.status = 'anonymous';
        this.persistedToken = null;
        this.activeGeneration = null;
        this.inFlightGeneration = null;
        this.pendingRequests.length = 0;
        break;
      }

      case 'logout': {
        this.status = 'anonymous';
        this.persistedToken = null;
        this.activeGeneration = null;
        this.inFlightGeneration = null;
        this.pendingRequests.length = 0;
        break;
      }
    }
  }

  getSummary(): SessionCoordinationSummary {
    return {
      status: this.status,
      activeGeneration: this.activeGeneration,
      refreshCalls: this.refreshCalls,
      retriedRequestIds: [...this.retriedRequests],
      persistedToken: this.persistedToken,
    };
  }
}

export function coordinateSessionEvents(
  events: readonly AuthCoordinationEvent[],
): SessionCoordinationSummary {
  const coordinator = new SessionCoordinator();
  for (const event of events) {
    coordinator.processEvent(event);
  }
  return coordinator.getSummary();
}

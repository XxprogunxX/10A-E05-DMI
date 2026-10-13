import { coordinateRefresh } from '../src/course-evaluation';
import {
  SessionCoordinator,
  type AuthCoordinationEvent,
} from '../src/domain/session/SessionCoordinator';

describe('Week 06 — Session Coordinator and Single-Flight Refresh (Javier)', () => {
  it('coalesces multiple concurrent 401s into a single refresh call and retries each request once (nominal)', () => {
    const events: AuthCoordinationEvent[] = [
      { type: 'request401', requestId: 'req-list-1', generation: 0 },
      { type: 'request401', requestId: 'req-detail-2', generation: 0 },
      { type: 'request401', requestId: 'req-create-3', generation: 0 },
      { type: 'refreshSucceeded', generation: 1, token: 'course-token-gen-1' },
    ];

    const summary = coordinateRefresh(events);

    expect(summary).toEqual({
      status: 'authenticated',
      activeGeneration: 1,
      refreshCalls: 1,
      retriedRequestIds: ['req-list-1', 'req-detail-2', 'req-create-3'],
      persistedToken: 'course-token-gen-1',
    });
  });

  it('handles obsolete 401s when a refresh to a newer generation already succeeded without extra refresh calls (boundary)', () => {
    const events: AuthCoordinationEvent[] = [
      // Refresh already completed from gen 0 to gen 1
      { type: 'request401', requestId: 'req-early', generation: 0 },
      { type: 'refreshSucceeded', generation: 1, token: 'course-token-gen-1' },
      // Obsolete request that was in-flight with gen 0 receives 401 afterwards
      { type: 'request401', requestId: 'req-lagged', generation: 0 },
    ];

    const summary = coordinateRefresh(events);

    expect(summary.refreshCalls).toBe(1);
    expect(summary.activeGeneration).toBe(1);
    expect(summary.status).toBe('authenticated');
    expect(summary.retriedRequestIds).toContain('req-early');
    expect(summary.retriedRequestIds).toContain('req-lagged');
  });

  it('safely transitions to anonymous and wipes persisted token on failed refresh (failure)', () => {
    const events: AuthCoordinationEvent[] = [
      { type: 'request401', requestId: 'req-a', generation: 0 },
      { type: 'request401', requestId: 'req-b', generation: 0 },
      { type: 'refreshFailed' },
    ];

    const summary = coordinateRefresh(events);

    expect(summary).toEqual({
      status: 'anonymous',
      activeGeneration: null,
      refreshCalls: 1,
      retriedRequestIds: [],
      persistedToken: null,
    });
  });

  it('prevents infinite refresh loops by bounding retries per request to at most once (boundary/failure)', () => {
    const coordinator = new SessionCoordinator();

    // First cycle: 401 -> refresh succeeded
    coordinator.processEvent({ type: 'request401', requestId: 'loop-req', generation: 0 });
    coordinator.processEvent({
      type: 'refreshSucceeded',
      generation: 1,
      token: 'course-token-gen-1',
    });

    // The retried request fails again with 401 in generation 1
    coordinator.processEvent({ type: 'request401', requestId: 'loop-req', generation: 1 });
    // And if it repeats for the same generation, it must not trigger infinite refresh loops
    coordinator.processEvent({ type: 'request401', requestId: 'loop-req', generation: 1 });

    const summary = coordinator.getSummary();
    // Only 2 refresh calls total (gen 0 and gen 1), not unbounded
    expect(summary.refreshCalls).toBeLessThanOrEqual(2);
  });

  it('logout removes persisted session state and returns to anonymous (nominal)', () => {
    const events: AuthCoordinationEvent[] = [
      { type: 'refreshSucceeded', generation: 1, token: 'valid-active-token' },
      { type: 'logout' },
    ];

    const summary = coordinateRefresh(events);

    expect(summary.status).toBe('anonymous');
    expect(summary.persistedToken).toBeNull();
    expect(summary.activeGeneration).toBeNull();
  });

  it('returns anonymous initial state when event sequence is empty (boundary)', () => {
    const summary = coordinateRefresh([]);

    expect(summary).toEqual({
      status: 'anonymous',
      activeGeneration: null,
      refreshCalls: 0,
      retriedRequestIds: [],
      persistedToken: null,
    });
  });
});

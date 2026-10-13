import type {
  IncidentActionInput,
  UpdatedIncident,
} from '../../domain/incidents/CloudIncident';
import type { CloudIncidentRepository } from '../../domain/incidents/CloudIncidentRepository';
import type { SessionIdentityProvider } from '../../domain/session/SessionIdentity';
import {
  IncidentAuthorization,
  IncidentAuthorizationFailure,
} from '../session/IncidentAuthorization';

export type PerformIncidentActionState =
  | Readonly<{ kind: 'updated'; result: UpdatedIncident }>
  | Readonly<{
      kind: 'error';
      error:
        | 'unauthenticated'
        | 'forbidden'
        | 'timeout'
        | 'network'
        | 'http'
        | 'invalid_json'
        | 'contract'
        | 'invalid_payload';
    }>;

export class PerformIncidentAction {
  constructor(
    private readonly repository: CloudIncidentRepository,
    private readonly authorization: IncidentAuthorization,
    private readonly session: SessionIdentityProvider,
  ) {}

  async execute(
    incidentId: string,
    input: IncidentActionInput,
    idempotencyKey: string,
  ): Promise<PerformIncidentActionState> {
    const identity = this.session.getSessionSnapshot();
    if (identity === null || identity.role === null) {
      return { kind: 'error', error: 'unauthenticated' };
    }

    const current = await this.repository.getById(incidentId);
    if (current.kind === 'empty_payload') {
      return { kind: 'error', error: 'contract' };
    }
    if (current.kind === 'failure') {
      return { kind: 'error', error: current.error.kind };
    }

    try {
      this.authorization.assertAuthorized({
        actorId: identity.actorId,
        role: identity.role,
        permission: input.action,
        incident: current.value,
      });
    } catch (error: unknown) {
      if (error instanceof IncidentAuthorizationFailure) {
        return { kind: 'error', error: error.kind };
      }
      throw error;
    }

    const result = await this.repository.performAction(
      incidentId,
      input,
      idempotencyKey,
    );
    if (result.kind === 'available') {
      return { kind: 'updated', result: result.value };
    }
    if (result.kind === 'empty_payload') {
      return { kind: 'error', error: 'contract' };
    }
    return { kind: 'error', error: result.error.kind };
  }
}

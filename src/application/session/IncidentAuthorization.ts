import type {
  CloudIncident,
  IncidentActionName,
} from '../../domain/incidents/CloudIncident';
import type {
  SessionIdentity,
  SessionRole,
} from '../../domain/session/SessionIdentity';

export type IncidentPermission = 'create' | 'view' | IncidentActionName;

export interface IncidentAuthorizationRequest extends SessionIdentity {
  readonly permission: IncidentPermission;
  readonly incident?: CloudIncident;
}

export type IncidentAuthorizationFailureKind =
  | 'unauthenticated'
  | 'forbidden';

export class IncidentAuthorizationFailure extends Error {
  readonly name = 'IncidentAuthorizationFailure';

  constructor(readonly kind: IncidentAuthorizationFailureKind) {
    super('Incident operation is not authorized.');
  }
}

function canView(
  actorId: string,
  role: SessionRole,
  incident: CloudIncident,
): boolean {
  if (role === 'coordinator') {
    return true;
  }
  if (role === 'reporter') {
    return incident.reporterId === actorId;
  }
  return incident.assignedTechnicianId === actorId;
}

/**
 * Enforces CampusOps permissions independently of UI visibility. The backend
 * remains the final authority, while this service prevents forbidden requests
 * from being initiated by application use cases.
 */
export class IncidentAuthorization {
  can(request: IncidentAuthorizationRequest): boolean {
    const { actorId, role, permission, incident } = request;

    if (!actorId.trim() || role === null) {
      return false;
    }

    if (permission === 'create') {
      return role === 'reporter';
    }

    if (incident === undefined || !canView(actorId, role, incident)) {
      return false;
    }

    if (
      permission === 'view' ||
      permission === 'comment' ||
      permission === 'add_evidence'
    ) {
      return true;
    }

    if (role === 'technician') {
      if (permission === 'start') {
        return incident.status === 'assigned';
      }
      if (permission === 'resolve') {
        return incident.status === 'in_progress';
      }
      return false;
    }

    if (role !== 'coordinator') {
      return false;
    }

    if (permission === 'close') {
      return incident.status === 'resolved';
    }
    if (permission === 'reopen') {
      return incident.status === 'resolved' || incident.status === 'closed';
    }
    return permission === 'assign' || permission === 'prioritize';
  }

  assertAuthorized(request: IncidentAuthorizationRequest): void {
    if (this.can(request)) {
      return;
    }

    throw new IncidentAuthorizationFailure(
      request.role === null || !request.actorId.trim()
        ? 'unauthenticated'
        : 'forbidden',
    );
  }
}

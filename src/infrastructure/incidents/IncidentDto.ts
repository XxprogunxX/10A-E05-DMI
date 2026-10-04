import {
  INCIDENT_CATEGORIES,
  type CloudIncident,
  type IncidentCategory,
} from '../../domain/incidents/CloudIncident';
import type {
  IncidentPriority,
  IncidentStatus,
} from '../../domain/incidents/Incident';
import { parseRemoteResource } from '../remote/parseRemoteResource';

const INCIDENT_STATUSES: ReadonlySet<string> = new Set<IncidentStatus>([
  'open',
  'assigned',
  'in_progress',
  'resolved',
  'closed',
]);

const INCIDENT_PRIORITIES: ReadonlySet<string> = new Set<IncidentPriority>([
  'low',
  'medium',
  'high',
]);

const INCIDENT_CATEGORY_SET: ReadonlySet<string> = new Set<IncidentCategory>(
  INCIDENT_CATEGORIES,
);

export type IncidentResourceParseResult =
  | Readonly<{ ok: true; value: CloudIncident }>
  | Readonly<{
      ok: false;
      error: 'contract' | 'empty_payload' | 'invalid_payload';
    }>;

function isNonemptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIncidentStatus(value: string): value is IncidentStatus {
  return INCIDENT_STATUSES.has(value);
}

function isIncidentCategory(value: unknown): value is IncidentCategory {
  return typeof value === 'string' && INCIDENT_CATEGORY_SET.has(value);
}

function isIncidentPriority(value: unknown): value is IncidentPriority {
  return typeof value === 'string' && INCIDENT_PRIORITIES.has(value);
}

/** Validates the shared envelope, then maps only published incident fields. */
export function parseIncidentResource(
  input: unknown,
): IncidentResourceParseResult {
  const resource = parseRemoteResource(input);
  if (!resource.ok) {
    return { ok: false, error: 'contract' };
  }
  if (resource.value.payload === null) {
    return { ok: false, error: 'empty_payload' };
  }

  const { id, version, status, payload } = resource.value;
  const {
    category,
    description,
    location,
    priority,
    reporterId,
    assignedTechnicianId,
  } = payload;

  const validReporterId =
    reporterId === undefined || isNonemptyText(reporterId);
  const validTechnicianId =
    assignedTechnicianId === undefined ||
    assignedTechnicianId === null ||
    isNonemptyText(assignedTechnicianId);

  if (
    !isIncidentStatus(status) ||
    !isIncidentCategory(category) ||
    !isNonemptyText(description) ||
    !isNonemptyText(location) ||
    !isIncidentPriority(priority) ||
    !validReporterId ||
    !validTechnicianId
  ) {
    return { ok: false, error: 'invalid_payload' };
  }

  return {
    ok: true,
    value: {
      id,
      version,
      status,
      category,
      description,
      location,
      priority,
      ...(reporterId === undefined ? {} : { reporterId }),
      ...(assignedTechnicianId === undefined ? {} : { assignedTechnicianId }),
    },
  };
}

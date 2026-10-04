import type { IncidentPriority, IncidentStatus } from './Incident';

export const INCIDENT_CATEGORIES = [
  'electrical',
  'laboratory',
  'water',
  'connectivity',
  'equipment',
  'safety',
  'maintenance',
] as const;

export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

/** Validated incident data used by the application, without invented fields. */
export interface CloudIncident {
  readonly id: string;
  readonly version: number;
  readonly status: IncidentStatus;
  readonly category: IncidentCategory;
  readonly description: string;
  readonly location: string;
  readonly priority: IncidentPriority;
  readonly reporterId?: string;
  readonly assignedTechnicianId?: string | null;
}

export interface CreateIncidentInput {
  readonly category: IncidentCategory;
  readonly description: string;
  readonly location: string;
}

export interface CreatedIncident {
  readonly incident: CloudIncident;
  readonly operationId: string;
  readonly duplicate: boolean;
}

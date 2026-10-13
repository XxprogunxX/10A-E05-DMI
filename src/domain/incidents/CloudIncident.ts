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

export type IncidentActionInput =
  | Readonly<{
      action: 'assign';
      baseVersion: number;
      technicianId: string;
    }>
  | Readonly<{
      action: 'prioritize';
      baseVersion: number;
      priority: IncidentPriority;
    }>
  | Readonly<{ action: 'start'; baseVersion: number }>
  | Readonly<{
      action: 'resolve';
      baseVersion: number;
      diagnosis: string;
    }>
  | Readonly<{ action: 'close'; baseVersion: number }>
  | Readonly<{ action: 'reopen'; baseVersion: number }>
  | Readonly<{
      action: 'comment';
      baseVersion: number;
      text: string;
    }>
  | Readonly<{
      action: 'add_evidence';
      baseVersion: number;
      evidenceId: string;
    }>;

export type IncidentActionName = IncidentActionInput['action'];

export interface UpdatedIncident {
  readonly incident: CloudIncident;
  readonly operationId: string;
  readonly duplicate: boolean;
}

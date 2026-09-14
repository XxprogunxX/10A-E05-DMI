export type IncidentStatus =
  'open' | 'assigned' | 'in_progress' | 'resolved' | 'closed';

export type IncidentPriority = 'low' | 'medium' | 'high';

export interface Incident {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly location: string;
  readonly status: IncidentStatus;
  readonly priority: IncidentPriority;
  readonly reportedAt: string;
}

import type { IncidentRepository } from '../../domain/incidents/IncidentRepository';

export interface IncidentSummary {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly location: string;
  readonly priority: 'low' | 'medium' | 'high';
  readonly status: 'open' | 'assigned' | 'in_progress' | 'resolved' | 'closed';
}

export class ListIncidents {
  constructor(private readonly repository: IncidentRepository) {}

  async execute(): Promise<readonly IncidentSummary[]> {
    const incidents = await this.repository.list();

    return incidents.map(
      ({ id, title, category, location, priority, status }) => ({
        id,
        title,
        category,
        location,
        priority,
        status,
      }),
    );
  }
}

import type { IncidentRepository } from '../../domain/incidents/IncidentRepository';

export interface IncidentDetail {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly location: string;
  readonly priority: 'low' | 'medium' | 'high';
  readonly status: 'open' | 'assigned' | 'in_progress' | 'resolved' | 'closed';
  readonly reportedAt: string;
}

export class GetIncidentDetail {
  constructor(private readonly repository: IncidentRepository) {}

  async execute(id: string): Promise<IncidentDetail | null> {
    return this.repository.getById(id);
  }
}

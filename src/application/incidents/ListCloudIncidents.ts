import type { CloudIncident } from '../../domain/incidents/CloudIncident';
import type {
  CloudIncidentRepository,
} from '../../domain/incidents/CloudIncidentRepository';

export type CloudIncidentListState =
  | {
      kind: 'available';
      incidents: readonly CloudIncident[];
    }
  | {
      kind: 'empty';
    }
  | {
      kind: 'error';
      error:
        | 'timeout'
        | 'network'
        | 'http'
        | 'invalid_json'
        | 'contract'
        | 'invalid_payload';
    };

export class ListCloudIncidents {
  constructor(
    private readonly repository: CloudIncidentRepository,
  ) {}

  async execute(): Promise<CloudIncidentListState> {
    const result = await this.repository.list();

    if (result.kind === 'available') {
      return {
        kind: 'available',
        incidents: result.value,
      };
    }

    if (result.kind === 'empty_payload') {
      return {
        kind: 'empty',
      };
    }

    return {
      kind: 'error',
      error: result.error.kind,
    };
  }
}



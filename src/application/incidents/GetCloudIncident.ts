import type { CloudIncident } from '../../domain/incidents/CloudIncident';
import type {
  CloudIncidentRepository,
} from '../../domain/incidents/CloudIncidentRepository';

export type CloudIncidentDetailState =
  | {
      kind: 'available';
      incident: CloudIncident;
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

export class GetCloudIncident {
  constructor(
    private readonly repository: CloudIncidentRepository,
  ) {}

  async execute(id: string): Promise<CloudIncidentDetailState> {
    const result = await this.repository.getById(id);

    if (result.kind === 'available') {
      return {
        kind: 'available',
        incident: result.value,
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



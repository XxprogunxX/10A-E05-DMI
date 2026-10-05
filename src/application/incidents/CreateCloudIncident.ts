import type {
  CreateIncidentInput,
  CreatedIncident,
} from '../../domain/incidents/CloudIncident';
import type {
  CloudIncidentRepository,
} from '../../domain/incidents/CloudIncidentRepository';

export type CreateCloudIncidentState =
  | {
      kind: 'created';
      result: CreatedIncident;
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

export class CreateCloudIncident {
  constructor(
    private readonly repository: CloudIncidentRepository,
  ) {}

  async execute(
    input: CreateIncidentInput,
    idempotencyKey: string,
  ): Promise<CreateCloudIncidentState> {
    const result = await this.repository.create(input, idempotencyKey);

    if (result.kind === 'available') {
      return {
        kind: 'created',
        result: result.value,
      };
    }

    if (result.kind === 'empty_payload') {
      return {
        kind: 'error',
        error: 'contract',
      };
    }

    return {
      kind: 'error',
      error: result.error.kind,
    };
  }
}



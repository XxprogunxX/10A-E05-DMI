import type {
  CloudIncident,
  CreateIncidentInput,
  CreatedIncident,
  IncidentActionInput,
  UpdatedIncident,
} from '../../domain/incidents/CloudIncident';
import type {
  CloudIncidentFailure,
  CloudIncidentRepository,
  CloudIncidentResult,
} from '../../domain/incidents/CloudIncidentRepository';
import {
  type IncidentClientFailure,
  type IncidentClientResult,
  IncidentApiClient,
} from './IncidentApiClient';

function mapFailure(error: IncidentClientFailure): CloudIncidentFailure {
  return error;
}

function mapResult<T>(
  result: IncidentClientResult<T>,
): CloudIncidentResult<T> {
  if (result.kind === 'available') {
    return result;
  }

  if (result.kind === 'empty_payload') {
    return result;
  }

  return {
    kind: 'failure',
    error: mapFailure(result.error),
  };
}

/** Remote gateway kept separate from UI and application presentation models. */
export class RemoteIncidentRepository implements CloudIncidentRepository {
  constructor(private readonly client: IncidentApiClient) {}

  async list(): Promise<
    CloudIncidentResult<readonly CloudIncident[]>
  > {
    return mapResult(await this.client.listIncidents());
  }

  async getById(
    id: string,
  ): Promise<CloudIncidentResult<CloudIncident>> {
    return mapResult(await this.client.getIncidentDetail(id));
  }

  async create(
    input: CreateIncidentInput,
    idempotencyKey: string,
  ): Promise<CloudIncidentResult<CreatedIncident>> {
    return mapResult(
      await this.client.createIncident(input, idempotencyKey),
    );
  }

  async performAction(
    incidentId: string,
    input: IncidentActionInput,
    idempotencyKey: string,
  ): Promise<CloudIncidentResult<UpdatedIncident>> {
    return mapResult(
      await this.client.performAction(incidentId, input, idempotencyKey),
    );
  }
}

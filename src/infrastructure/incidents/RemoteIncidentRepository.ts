import type {
  CloudIncident,
  CreatedIncident,
  CreateIncidentInput,
} from '../../domain/incidents/CloudIncident';
import {
  type IncidentClientResult,
  IncidentApiClient,
} from './IncidentApiClient';

/** Remote gateway kept separate from UI and application presentation models. */
export class RemoteIncidentRepository {
  constructor(private readonly client: IncidentApiClient) {}

  list(): Promise<IncidentClientResult<readonly CloudIncident[]>> {
    return this.client.listIncidents();
  }

  getById(id: string): Promise<IncidentClientResult<CloudIncident>> {
    return this.client.getIncidentDetail(id);
  }

  create(
    input: CreateIncidentInput,
    idempotencyKey: string,
  ): Promise<IncidentClientResult<CreatedIncident>> {
    return this.client.createIncident(input, idempotencyKey);
  }
}

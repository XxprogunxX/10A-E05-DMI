import type {
  CloudIncident,
  CreateIncidentInput,
  CreatedIncident,
} from './CloudIncident';

export type CloudIncidentFailure =
  | { kind: 'timeout' }
  | { kind: 'network' }
  | { kind: 'http'; status: number }
  | { kind: 'invalid_json' }
  | { kind: 'contract' }
  | { kind: 'invalid_payload' };

export type CloudIncidentResult<T> =
  | { kind: 'available'; value: T }
  | { kind: 'empty_payload' }
  | { kind: 'failure'; error: CloudIncidentFailure };

export interface CloudIncidentRepository {
  list(): Promise<CloudIncidentResult<readonly CloudIncident[]>>;
  getById(id: string): Promise<CloudIncidentResult<CloudIncident>>;
  create(
    input: CreateIncidentInput,
    idempotencyKey: string,
  ): Promise<CloudIncidentResult<CreatedIncident>>;
}

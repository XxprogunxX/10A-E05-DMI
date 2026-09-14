import type { Incident } from './Incident';

/** Port owned by the domain. Providers can be replaced without changing use cases. */
export interface IncidentRepository {
  list(): Promise<readonly Incident[]>;
  getById(id: string): Promise<Incident | null>;
}

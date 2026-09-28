import { GetIncidentDetail } from '../application/incidents/GetIncidentDetail';
import { ListIncidents } from '../application/incidents/ListIncidents';
import type { IncidentRepository } from '../domain/incidents/IncidentRepository';
import { InMemoryIncidentRepository } from '../infrastructure/incidents/InMemoryIncidentRepository';
import type { SessionStorage } from '../domain/session/SessionStorage';
import { ExpoSecureSessionStorage } from '../infrastructure/session/ExpoSecureSessionStorage';

export interface AppDependencies {
  readonly listIncidents: ListIncidents;
  readonly getIncidentDetail: GetIncidentDetail;
  readonly sessionStorage: SessionStorage;
}

/** The only place that chooses concrete providers for the running application. */
export function createAppDependencies(
  repository: IncidentRepository = new InMemoryIncidentRepository(),
  sessionStorage: SessionStorage = new ExpoSecureSessionStorage(),
): AppDependencies {
  return {
    listIncidents: new ListIncidents(repository),
    getIncidentDetail: new GetIncidentDetail(repository),
    sessionStorage,
  };
}

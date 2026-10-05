import { CreateCloudIncident } from '../application/incidents/CreateCloudIncident';
import { GetCloudIncident } from '../application/incidents/GetCloudIncident';
import { GetIncidentDetail } from '../application/incidents/GetIncidentDetail';
import { ListCloudIncidents } from '../application/incidents/ListCloudIncidents';
import { ListIncidents } from '../application/incidents/ListIncidents';
import { ReportTechnicalError } from '../application/telemetry/ReportTechnicalError';
import type { IncidentRepository } from '../domain/incidents/IncidentRepository';
import { InMemoryIncidentRepository } from '../infrastructure/incidents/InMemoryIncidentRepository';
import { IncidentApiClient } from '../infrastructure/incidents/IncidentApiClient';
import { RemoteIncidentRepository } from '../infrastructure/incidents/RemoteIncidentRepository';
import { FetchHttpTransport } from '../infrastructure/http/HttpTransport';
import type { SessionStorage } from '../domain/session/SessionStorage';
import { ExpoSecureSessionStorage } from '../infrastructure/session/ExpoSecureSessionStorage';
import { SafeTelemetrySink } from '../infrastructure/telemetry/SafeTelemetrySink';

export interface AppDependencies {
  readonly listIncidents: ListIncidents;
  readonly getIncidentDetail: GetIncidentDetail;
  readonly listCloudIncidents: ListCloudIncidents;
  readonly getCloudIncident: GetCloudIncident;
  readonly createCloudIncident: CreateCloudIncident;
  readonly sessionStorage: SessionStorage;
  readonly reportTechnicalError: ReportTechnicalError;
}

/** The only place that chooses concrete providers for the running application. */
export function createAppDependencies(
  repository: IncidentRepository = new InMemoryIncidentRepository(),
  sessionStorage: SessionStorage = new ExpoSecureSessionStorage(),
  telemetrySink = new SafeTelemetrySink(() => undefined),
): AppDependencies {
  const cloudTransport = new FetchHttpTransport();
  const cloudClient = new IncidentApiClient(cloudTransport);
  const cloudRepository = new RemoteIncidentRepository(cloudClient);

  return {
    listIncidents: new ListIncidents(repository),
    getIncidentDetail: new GetIncidentDetail(repository),
    listCloudIncidents: new ListCloudIncidents(cloudRepository),
    getCloudIncident: new GetCloudIncident(cloudRepository),
    createCloudIncident: new CreateCloudIncident(cloudRepository),
    sessionStorage,
    reportTechnicalError: new ReportTechnicalError(telemetrySink),
  };
}

import { CreateCloudIncident } from '../application/incidents/CreateCloudIncident';
import { GetCloudIncident } from '../application/incidents/GetCloudIncident';
import { GetIncidentDetail } from '../application/incidents/GetIncidentDetail';
import { ListCloudIncidents } from '../application/incidents/ListCloudIncidents';
import { ListIncidents } from '../application/incidents/ListIncidents';
import { PerformIncidentAction } from '../application/incidents/PerformIncidentAction';
import { IncidentAuthorization } from '../application/session/IncidentAuthorization';
import { OfflineIncidentSyncService } from '../application/sync/OfflineIncidentSyncService';
import { ReportTechnicalError } from '../application/telemetry/ReportTechnicalError';
import type { IncidentRepository } from '../domain/incidents/IncidentRepository';
import { InMemoryIncidentRepository } from '../infrastructure/incidents/InMemoryIncidentRepository';
import { IncidentApiClient } from '../infrastructure/incidents/IncidentApiClient';
import { RemoteIncidentRepository } from '../infrastructure/incidents/RemoteIncidentRepository';
import { FetchHttpTransport } from '../infrastructure/http/HttpTransport';
import type { SessionStorage } from '../domain/session/SessionStorage';
import type { OfflineIncidentStorePort } from '../domain/sync/OfflineSyncTypes';
import { ExpoSecureKeyValueDriver } from '../infrastructure/persistence/ExpoSecureKeyValueDriver';
import { PersistentIncidentStore } from '../infrastructure/persistence/PersistentIncidentStore';
import { ExpoSecureSessionStorage } from '../infrastructure/session/ExpoSecureSessionStorage';
import { SessionManager } from '../infrastructure/session/SessionManager';
import { SafeTelemetrySink } from '../infrastructure/telemetry/SafeTelemetrySink';

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:4310';

export interface AppDependencies {
  readonly listIncidents: ListIncidents;
  readonly getIncidentDetail: GetIncidentDetail;
  readonly listCloudIncidents: ListCloudIncidents;
  readonly getCloudIncident: GetCloudIncident;
  readonly createCloudIncident: CreateCloudIncident;
  readonly performIncidentAction: PerformIncidentAction;
  readonly incidentAuthorization: IncidentAuthorization;
  readonly offlineStore: OfflineIncidentStorePort;
  readonly offlineSyncService: OfflineIncidentSyncService;
  readonly sessionManager: SessionManager;
  readonly sessionStorage: SessionStorage;
  readonly reportTechnicalError: ReportTechnicalError;
}

/** The only place that chooses concrete providers for the running application. */
export function createAppDependencies(
  repository: IncidentRepository = new InMemoryIncidentRepository(),
  sessionStorage: SessionStorage = new ExpoSecureSessionStorage(),
  telemetrySink = new SafeTelemetrySink(() => undefined),
  backendBaseUrl =
    process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? DEFAULT_BACKEND_URL,
  offlineStore: OfflineIncidentStorePort = new PersistentIncidentStore(
    new ExpoSecureKeyValueDriver(),
  ),
): AppDependencies {
  const cloudTransport = new FetchHttpTransport();
  const sessionManager = new SessionManager(cloudTransport, sessionStorage, {
    baseUrl: backendBaseUrl,
  });
  const cloudClient = new IncidentApiClient(cloudTransport, {
    baseUrl: backendBaseUrl,
    sessionManager,
  });
  const cloudRepository = new RemoteIncidentRepository(cloudClient);
  const incidentAuthorization = new IncidentAuthorization();
  const offlineSyncService = new OfflineIncidentSyncService(
    offlineStore,
    cloudRepository,
    incidentAuthorization,
    sessionManager,
  );

  return {
    listIncidents: new ListIncidents(repository),
    getIncidentDetail: new GetIncidentDetail(repository),
    listCloudIncidents: new ListCloudIncidents(cloudRepository),
    getCloudIncident: new GetCloudIncident(cloudRepository),
    createCloudIncident: new CreateCloudIncident(cloudRepository),
    performIncidentAction: new PerformIncidentAction(
      cloudRepository,
      incidentAuthorization,
      sessionManager,
    ),
    incidentAuthorization,
    offlineStore,
    offlineSyncService,
    sessionManager,
    sessionStorage,
    reportTechnicalError: new ReportTechnicalError(telemetrySink),
  };
}

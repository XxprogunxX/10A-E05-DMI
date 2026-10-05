import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { GetIncidentDetail } from '../../application/incidents/GetIncidentDetail';
import type {
  CloudIncidentDetailState,
  GetCloudIncident,
} from '../../application/incidents/GetCloudIncident';
import type { ReportTechnicalError } from '../../application/telemetry/ReportTechnicalError';

interface Props {
  readonly getIncidentDetail?: GetIncidentDetail;
  readonly getCloudIncident?: GetCloudIncident;
  readonly incidentId: string;
  readonly onBack: () => void;
  readonly reportTechnicalError: ReportTechnicalError;
}

function errorMessage(
  error: Extract<CloudIncidentDetailState, { kind: 'error' }>['error'],
): string {
  switch (error) {
    case 'timeout':
      return 'El servidor tardó demasiado en responder.';
    case 'network':
      return 'No fue posible comunicarse con el servidor.';
    case 'http':
      return 'El servidor no pudo completar la consulta.';
    case 'invalid_json':
      return 'El servidor devolvió una respuesta no válida.';
    case 'contract':
      return 'La respuesta del servidor no cumple el contrato esperado.';
    case 'invalid_payload':
      return 'Los datos recibidos no son válidos.';
  }
}

export function IncidentDetailScreen({
  getIncidentDetail,
  getCloudIncident,
  incidentId,
  onBack,
  reportTechnicalError,
}: Props) {
  const [cloudResult, setCloudResult] = useState<
    Extract<CloudIncidentDetailState, { kind: 'available' }>['incident'] | null
  >(null);

  const [legacyResult, setLegacyResult] = useState<
    Awaited<ReturnType<GetIncidentDetail['execute']>> | null
  >(null);

  const [state, setState] = useState<
    'loading' | 'ready' | 'not-found' | 'error'
  >('loading');

  const [errorKind, setErrorKind] = useState<
    Extract<CloudIncidentDetailState, { kind: 'error' }>['error'] | null
  >(null);

  const loadIncident = useCallback(() => {
    setState('loading');
    setErrorKind(null);

    if (getCloudIncident) {
      let active = true;

      getCloudIncident
        .execute(incidentId)
        .then((response) => {
          if (!active) return;

          if (response.kind === 'available') {
            setCloudResult(response.incident);
            setLegacyResult(null);
            setState('ready');
            return;
          }

          if (response.kind === 'empty') {
            setCloudResult(null);
            setLegacyResult(null);
            setState('not-found');
            return;
          }

          reportTechnicalError.execute(
            {
              operation: 'load-cloud-incident-detail',
              correlationId: 'corr-synthetic-cloud-detail-001',
              attempt: 1,
            },
            new Error(`cloud incident detail failed: ${response.error}`),
          );

          setErrorKind(response.error);
          setState('error');
        })
        .catch((error: unknown) => {
          reportTechnicalError.execute(
            {
              operation: 'load-cloud-incident-detail',
              correlationId: 'corr-synthetic-cloud-detail-002',
              attempt: 1,
            },
            error,
          );

          if (active) {
            setErrorKind('network');
            setState('error');
          }
        });

      return () => {
        active = false;
      };
    }

    if (getIncidentDetail) {
      let active = true;

      getIncidentDetail
        .execute(incidentId)
        .then((result) => {
          if (!active) return;

          setLegacyResult(result);
          setCloudResult(null);
          setState('ready');
        })
        .catch((error: unknown) => {
          reportTechnicalError.execute(
            {
              operation: 'load-incident-detail',
              correlationId: 'corr-synthetic-legacy-detail-001',
              attempt: 1,
            },
            error,
          );

          if (active) {
            setErrorKind('network');
            setState('error');
          }
        });

      return () => {
        active = false;
      };
    }

    setErrorKind('network');
    setState('error');
    return undefined;
  }, [
    getCloudIncident,
    getIncidentDetail,
    incidentId,
    reportTechnicalError,
  ]);

  useEffect(() => {
  const timer = setTimeout(() => {
    void loadIncident();
  }, 0);

  return () => clearTimeout(timer);
}, [loadIncident]);

  if (state === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator accessibilityLabel="Cargando detalle" />
        <Text>Cargando detalle...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      testID="incident-detail-screen"
    >
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        style={styles.backButton}
      >
        <Text style={styles.backText}>← Volver a incidencias</Text>
      </Pressable>

      {state === 'not-found' ? (
        <View style={styles.message}>
          <Text>La incidencia no contiene datos disponibles.</Text>

          <Pressable
            accessibilityRole="button"
            onPress={loadIncident}
            style={styles.actionButton}
            testID="retry-incident-detail"
          >
            <Text style={styles.actionText}>Reintentar</Text>
          </Pressable>
        </View>
      ) : null}

      {state === 'error' ? (
        <View style={styles.message}>
          <Text>
            {errorKind
              ? errorMessage(errorKind)
              : 'No fue posible cargar el detalle.'}
          </Text>

          <Pressable
            accessibilityRole="button"
            onPress={loadIncident}
            style={styles.actionButton}
            testID="retry-incident-detail"
          >
            <Text style={styles.actionText}>Reintentar</Text>
          </Pressable>
        </View>
      ) : null}

      {state === 'ready' && cloudResult ? (
        <View style={styles.card}>
          <Text style={styles.identifier}>{cloudResult.id}</Text>
          <Text style={styles.heading}>{cloudResult.category}</Text>

          <Text>{cloudResult.description}</Text>

          <Text>
            <Text style={styles.label}>Ubicación:</Text>{' '}
            {cloudResult.location}
          </Text>

          <Text>
            <Text style={styles.label}>Estado:</Text>{' '}
            {cloudResult.status}
          </Text>

          <Text>
            <Text style={styles.label}>Prioridad:</Text>{' '}
            {cloudResult.priority}
          </Text>

          <Text>
            <Text style={styles.label}>Versión:</Text>{' '}
            {cloudResult.version}
          </Text>

          {cloudResult.reporterId ? (
            <Text>
              <Text style={styles.label}>Reportante:</Text>{' '}
              {cloudResult.reporterId}
            </Text>
          ) : null}

          {cloudResult.assignedTechnicianId ? (
            <Text>
              <Text style={styles.label}>Técnico asignado:</Text>{' '}
              {cloudResult.assignedTechnicianId}
            </Text>
          ) : null}
        </View>
      ) : null}

      {state === 'ready' && legacyResult ? (
        <View style={styles.card}>
          <Text style={styles.identifier}>{legacyResult.id}</Text>
          <Text style={styles.heading}>{legacyResult.title}</Text>

          <Text>{legacyResult.description}</Text>

          <Text>
            <Text style={styles.label}>Categora:</Text>{' '}
            {legacyResult.category}
          </Text>

          <Text>
            <Text style={styles.label}>Ubicación:</Text>{' '}
            {legacyResult.location}
          </Text>

          <Text>
            <Text style={styles.label}>Estado:</Text>{' '}
            {legacyResult.status}
          </Text>

          <Text>
            <Text style={styles.label}>Prioridad:</Text>{' '}
            {legacyResult.priority}
          </Text>

          <Text>
            <Text style={styles.label}>Reportada:</Text>{' '}
            {legacyResult.reportedAt}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: 14,
    justifyContent: 'center',
  },
  content: {
    gap: 14,
    padding: 20,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
  },
  backText: {
    color: '#1555a5',
    fontWeight: '700',
  },
  message: {
    alignItems: 'center',
    gap: 14,
  },
  actionButton: {
    backgroundColor: '#1555a5',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  actionText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    gap: 12,
    padding: 20,
  },
  identifier: {
    color: '#5d6673',
    fontSize: 12,
    fontWeight: '700',
  },
  heading: {
    color: '#15345b',
    fontSize: 23,
    fontWeight: '800',
  },
  label: {
    fontWeight: '700',
  },
});

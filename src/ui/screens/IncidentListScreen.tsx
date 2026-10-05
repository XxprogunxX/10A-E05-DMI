import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { ListIncidents } from '../../application/incidents/ListIncidents';
import type {
  CloudIncidentListState,
  ListCloudIncidents,
} from '../../application/incidents/ListCloudIncidents';
import type { ReportTechnicalError } from '../../application/telemetry/ReportTechnicalError';

interface Props {
  readonly listIncidents?: ListIncidents;
  readonly listCloudIncidents?: ListCloudIncidents;
  readonly onSelectIncident: (id: string) => void;
  readonly reportTechnicalError: ReportTechnicalError;
}

const statusLabels: Record<
  'open' | 'assigned' | 'in_progress' | 'resolved' | 'closed',
  string
> = {
  open: 'Abierta',
  assigned: 'Asignada',
  in_progress: 'En proceso',
  resolved: 'Resuelta',
  closed: 'Cerrada',
};

function errorMessage(
  state: Extract<CloudIncidentListState, { kind: 'error' }>,
): string {
  switch (state.error) {
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

export function IncidentListScreen({
  listIncidents,
  listCloudIncidents,
  onSelectIncident,
  reportTechnicalError,
}: Props) {
  const [incidents, setIncidents] = useState<
    NonNullable<
      Extract<CloudIncidentListState, { kind: 'available' }>['incidents']
    >
  >([]);
  const [legacyIncidents, setLegacyIncidents] = useState<
    Awaited<ReturnType<ListIncidents['execute']>>
  >([]);
  const [state, setState] = useState<
    'loading' | 'ready' | 'empty' | 'error'
  >('loading');
  const [errorKind, setErrorKind] = useState<
    Extract<CloudIncidentListState, { kind: 'error' }>['error'] | null
  >(null);

  const loadIncidents = useCallback(() => {
    setState('loading');
    setErrorKind(null);

    if (listCloudIncidents) {
      let active = true;

      listCloudIncidents.execute().then((result) => {
        if (!active) return;

        if (result.kind === 'available') {
          setIncidents(result.incidents);
          setLegacyIncidents([]);
          setState(result.incidents.length === 0 ? 'empty' : 'ready');
          return;
        }

        if (result.kind === 'empty') {
          setIncidents([]);
          setLegacyIncidents([]);
          setState('empty');
          return;
        }

        reportTechnicalError.execute(
          {
            operation: 'load-cloud-incidents',
            correlationId: 'corr-synthetic-cloud-list-001',
            attempt: 1,
          },
          new Error(`cloud incident request failed: ${result.error}`),
        );

        setErrorKind(result.error);
        setState('error');
      }).catch((error: unknown) => {
        reportTechnicalError.execute(
          {
            operation: 'load-cloud-incidents',
            correlationId: 'corr-synthetic-cloud-list-002',
            attempt: 1,
          },
          error,
        );

        if (active) {
          setErrorKind(null);
          setState('error');
        }
      });

      return () => {
        active = false;
      };
    }

    if (listIncidents) {
      let active = true;

      listIncidents.execute().then((result) => {
        if (!active) return;

        setLegacyIncidents(result);
        setIncidents([]);
        setState(result.length === 0 ? 'empty' : 'ready');
      }).catch((error: unknown) => {
        reportTechnicalError.execute(
          {
            operation: 'load-incidents',
            correlationId: 'corr-synthetic-list-001',
            attempt: 1,
          },
          error,
        );

        if (active) {
          setErrorKind(null);
          setState('error');
        }
      });

      return () => {
        active = false;
      };
    }

    setState('error');
    setErrorKind('network');
    return undefined;
  }, [listCloudIncidents, listIncidents, reportTechnicalError]);

  useEffect(() => {
  const timer = setTimeout(() => {
    void loadIncidents();
  }, 0);

  return () => clearTimeout(timer);
}, [loadIncidents]);

  if (state === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator accessibilityLabel="Cargando incidencias" />
        <Text>Cargando incidencias...</Text>
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>
          {errorKind
            ? errorMessage({ kind: 'error', error: errorKind })
            : 'No fue posible cargar las incidencias.'}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={loadIncidents}
          style={styles.actionButton}
          testID="retry-incidents"
        >
          <Text style={styles.actionText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      testID="incident-list-screen"
    >
      <Text style={styles.heading}>Incidencias recientes</Text>

      {state === 'empty' ? (
        <View style={styles.empty}>
          <Text>No hay incidencias registradas.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={loadIncidents}
            style={styles.actionButton}
            testID="refresh-empty-incidents"
          >
            <Text style={styles.actionText}>Actualizar</Text>
          </Pressable>
        </View>
      ) : null}

      {incidents.map((incident) => (
        <Pressable
          accessibilityRole="button"
          key={incident.id}
          onPress={() => onSelectIncident(incident.id)}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          testID={`incident-${incident.id}`}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{incident.category}</Text>
            <Text style={styles.badge}>{statusLabels[incident.status]}</Text>
          </View>
          <Text numberOfLines={2}>{incident.description}</Text>
          <Text>{incident.location}</Text>
          <Text style={styles.identifier}>
            {incident.id}  Prioridad {incident.priority}  Versión{' '}
            {incident.version}
          </Text>
        </Pressable>
      ))}

      {legacyIncidents.map((incident) => (
        <Pressable
          accessibilityRole="button"
          key={incident.id}
          onPress={() => onSelectIncident(incident.id)}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          testID={`incident-${incident.id}`}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{incident.title}</Text>
            <Text style={styles.badge}>{statusLabels[incident.status]}</Text>
          </View>
          <Text>{incident.category}</Text>
          <Text style={styles.identifier}>
            {incident.id}  Prioridad {incident.priority}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: 14,
    justifyContent: 'center',
    padding: 20,
  },
  content: { gap: 12, padding: 20 },
  heading: { color: '#15345b', fontSize: 21, fontWeight: '700' },
  empty: { gap: 14 },
  errorText: { textAlign: 'center' },
  actionButton: {
    alignSelf: 'center',
    backgroundColor: '#1555a5',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  actionText: { color: '#ffffff', fontWeight: '700' },
  card: {
    gap: 8,
    padding: 16,
    backgroundColor: '#ffffff',
    borderColor: '#dce3ed',
    borderRadius: 12,
    borderWidth: 1,
  },
  pressed: { opacity: 0.72 },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  cardTitle: { color: '#15345b', flex: 1, fontSize: 17, fontWeight: '700' },
  badge: { color: '#17643a', fontWeight: '600' },
  identifier: { color: '#5d6673', fontSize: 12 },
});

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type {
  GetIncidentDetail,
  IncidentDetail,
} from '../../application/incidents/GetIncidentDetail';

interface Props {
  readonly getIncidentDetail: GetIncidentDetail;
  readonly incidentId: string;
  readonly onBack: () => void;
}

export function IncidentDetailScreen({
  getIncidentDetail,
  incidentId,
  onBack,
}: Props) {
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [state, setState] = useState<
    'loading' | 'ready' | 'not-found' | 'error'
  >('loading');

  useEffect(() => {
    let active = true;
    getIncidentDetail
      .execute(incidentId)
      .then((result) => {
        if (active) {
          setIncident(result);
          setState(result ? 'ready' : 'not-found');
        }
      })
      .catch(() => active && setState('error'));

    return () => {
      active = false;
    };
  }, [getIncidentDetail, incidentId]);

  if (state === 'loading') {
    return (
      <ActivityIndicator
        accessibilityLabel="Cargando detalle"
        style={styles.centered}
      />
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
        <Text>La incidencia solicitada no existe.</Text>
      ) : null}
      {state === 'error' ? (
        <Text>No fue posible cargar el detalle.</Text>
      ) : null}
      {state === 'ready' && incident ? (
        <View style={styles.card}>
          <Text style={styles.identifier}>{incident.id}</Text>
          <Text style={styles.heading}>{incident.title}</Text>
          <Text>{incident.description}</Text>
          <Text>
            <Text style={styles.label}>Categoría:</Text> {incident.category}
          </Text>
          <Text>
            <Text style={styles.label}>Ubicación:</Text> {incident.location}
          </Text>
          <Text>
            <Text style={styles.label}>Estado:</Text> {incident.status}
          </Text>
          <Text>
            <Text style={styles.label}>Prioridad:</Text> {incident.priority}
          </Text>
          <Text>
            <Text style={styles.label}>Registrada:</Text> {incident.reportedAt}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { marginTop: 40 },
  content: { gap: 14, padding: 20 },
  backButton: { alignSelf: 'flex-start', paddingVertical: 8 },
  backText: { color: '#1555a5', fontWeight: '700' },
  card: { gap: 12, padding: 20, backgroundColor: '#ffffff', borderRadius: 12 },
  identifier: { color: '#5d6673', fontSize: 12, fontWeight: '700' },
  heading: { color: '#15345b', fontSize: 23, fontWeight: '800' },
  label: { fontWeight: '700' },
});

import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { getBackendHealth } from './src/api/courseBackend';
import { createAppDependencies } from './src/composition/createAppDependencies';
import { IncidentDetailScreen } from './src/ui/screens/IncidentDetailScreen';
import { IncidentListScreen } from './src/ui/screens/IncidentListScreen';

export default function App() {
  const [status, setStatus] = useState<'checking' | 'available' | 'offline'>(
    'checking',
  );
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(
    null,
  );
  const dependencies = useMemo(() => createAppDependencies(), []);

  useEffect(() => {
    let active = true;
    getBackendHealth()
      .then(() => active && setStatus('available'))
      .catch(() => active && setStatus('offline'));
    return () => {
      active = false;
    };
  }, []);

  return (
    <View style={styles.screen}>
      <View accessibilityRole="summary" style={styles.header}>
        <Text style={styles.title}>CampusOps</Text>
        <Text>Incidencias del campus · entorno académico ficticio</Text>
        <Text testID="backend-status">Backend: {status}</Text>
      </View>
      {selectedIncidentId === null ? (
        <IncidentListScreen
          listIncidents={dependencies.listIncidents}
          onSelectIncident={setSelectedIncidentId}
        />
      ) : (
        <IncidentDetailScreen
          getIncidentDetail={dependencies.getIncidentDetail}
          incidentId={selectedIncidentId}
          onBack={() => setSelectedIncidentId(null)}
        />
      )}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7fb' },
  header: {
    gap: 6,
    paddingHorizontal: 20,
    paddingBottom: 14,
    paddingTop: 18,
    backgroundColor: '#ffffff',
    borderBottomColor: '#dce3ed',
    borderBottomWidth: 1,
  },
  title: { color: '#15345b', fontSize: 28, fontWeight: '800' },
});

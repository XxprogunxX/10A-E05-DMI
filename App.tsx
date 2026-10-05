import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { getBackendHealth } from './src/api/courseBackend';
import { createAppDependencies } from './src/composition/createAppDependencies';
import { CreateIncidentScreen } from './src/ui/screens/CreateIncidentScreen';
import { IncidentDetailScreen } from './src/ui/screens/IncidentDetailScreen';
import { IncidentListScreen } from './src/ui/screens/IncidentListScreen';

type Screen =
  | { kind: 'list' }
  | { kind: 'detail'; id: string }
  | { kind: 'create' };

export default function App() {
  const [status, setStatus] = useState<'checking' | 'available' | 'offline'>(
    'checking',
  );
  const [screen, setScreen] = useState<Screen>({ kind: 'list' });
  const dependencies = useMemo(() => createAppDependencies(), []);

  useEffect(() => {
    let active = true;

    getBackendHealth()
      .then(() => active && setStatus('available'))
      .catch((error: unknown) => {
        dependencies.reportTechnicalError.execute(
          {
            operation: 'check-backend-health',
            correlationId: 'corr-synthetic-health-001',
            attempt: 1,
          },
          error,
        );

        if (active) {
          setStatus('offline');
        }
      });

    return () => {
      active = false;
    };
  }, [dependencies.reportTechnicalError]);

  return (
    <View style={styles.screen}>
      <View accessibilityRole="summary" style={styles.header}>
        <Text style={styles.title}>CampusOps</Text>
        <Text>Incidencias del campus · entorno académico ficticio</Text>
        <Text testID="backend-status">Backend: {status}</Text>

        {screen.kind === 'list' ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setScreen({ kind: 'create' })}
            style={styles.createButton}
            testID="open-create-incident"
          >
            <Text style={styles.createText}>Nueva incidencia</Text>
          </Pressable>
        ) : null}
      </View>

      {screen.kind === 'list' ? (
        <IncidentListScreen
          listCloudIncidents={dependencies.listCloudIncidents}
          onSelectIncident={(id) => setScreen({ kind: 'detail', id })}
          reportTechnicalError={dependencies.reportTechnicalError}
        />
      ) : null}

      {screen.kind === 'detail' ? (
        <IncidentDetailScreen
          getCloudIncident={dependencies.getCloudIncident}
          incidentId={screen.id}
          onBack={() => setScreen({ kind: 'list' })}
          reportTechnicalError={dependencies.reportTechnicalError}
        />
      ) : null}

      {screen.kind === 'create' ? (
        <CreateIncidentScreen
          createCloudIncident={dependencies.createCloudIncident}
          onCreated={(id) => setScreen({ kind: 'detail', id })}
          onBack={() => setScreen({ kind: 'list' })}
          reportTechnicalError={dependencies.reportTechnicalError}
        />
      ) : null}

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
  createButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#1555a5',
    borderRadius: 8,
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  createText: { color: '#ffffff', fontWeight: '700' },
});

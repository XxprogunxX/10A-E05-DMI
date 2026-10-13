import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { getBackendHealth } from './src/api/courseBackend';
import { createAppDependencies } from './src/composition/createAppDependencies';
import { CreateIncidentScreen } from './src/ui/screens/CreateIncidentScreen';
import { IncidentDetailScreen } from './src/ui/screens/IncidentDetailScreen';
import { IncidentListScreen } from './src/ui/screens/IncidentListScreen';
import type { SessionSnapshot } from './src/infrastructure/session/SessionManager';

type Screen =
  | { kind: 'list' }
  | { kind: 'detail'; id: string }
  | { kind: 'create' };

type AuthenticationState =
  | 'initializing'
  | 'anonymous'
  | 'authenticating'
  | 'authenticated';

const COURSE_ACTORS = [
  { id: 'reporter-1', label: 'Reportante' },
  { id: 'technician-1', label: 'Técnico' },
  { id: 'coordinator-1', label: 'Coordinador' },
] as const;

export default function App() {
  const [status, setStatus] = useState<'checking' | 'available' | 'offline'>(
    'checking',
  );
  const [screen, setScreen] = useState<Screen>({ kind: 'list' });
  const dependencies = useMemo(() => createAppDependencies(), []);
  const [authentication, setAuthentication] = useState<AuthenticationState>(
    dependencies.sessionManager ? 'initializing' : 'authenticated',
  );
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [authenticationError, setAuthenticationError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const manager = dependencies.sessionManager;
    if (!manager) {
      return undefined;
    }

    let active = true;
    manager
      .initialize()
      .then(() => {
        if (!active) return;
        const restored = manager.getSessionSnapshot();
        setSession(restored);
        setAuthentication(restored === null ? 'anonymous' : 'authenticated');
      })
      .catch(() => {
        if (!active) return;
        setAuthenticationError('No fue posible restaurar la sesión segura.');
        setAuthentication('anonymous');
      });

    return () => {
      active = false;
    };
  }, [dependencies.sessionManager]);

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

  const login = async (actorId: string) => {
    setAuthentication('authenticating');
    setAuthenticationError(null);
    try {
      const authenticated = await dependencies.sessionManager.login(actorId);
      setSession(authenticated);
      setScreen({ kind: 'list' });
      setAuthentication('authenticated');
    } catch {
      setSession(null);
      setAuthenticationError('No fue posible iniciar la sesión de prueba.');
      setAuthentication('anonymous');
    }
  };

  const logout = async () => {
    try {
      await dependencies.sessionManager.logout();
    } finally {
      setSession(null);
      setScreen({ kind: 'list' });
      setAuthentication('anonymous');
    }
  };

  return (
    <View style={styles.screen}>
      <View accessibilityRole="summary" style={styles.header}>
        <Text style={styles.title}>CampusOps</Text>
        <Text>Incidencias del campus · entorno académico ficticio</Text>
        <Text testID="backend-status">Backend: {status}</Text>

        {session ? (
          <View style={styles.sessionRow}>
            <Text testID="active-session">
              Sesión: {session.actorId} · {session.role ?? 'sin perfil'}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void logout()}
              testID="logout"
            >
              <Text style={styles.logoutText}>Cerrar sesión</Text>
            </Pressable>
          </View>
        ) : null}

        {authentication === 'authenticated' &&
        screen.kind === 'list' &&
        (!dependencies.sessionManager || session?.role === 'reporter') ? (
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

      {authentication !== 'authenticated' ? (
        <View style={styles.authentication} testID="session-login">
          <Text style={styles.authenticationTitle}>
            {authentication === 'initializing'
              ? 'Restaurando sesión segura...'
              : 'Selecciona un actor de prueba'}
          </Text>
          {authenticationError ? (
            <Text accessibilityRole="alert" style={styles.authenticationError}>
              {authenticationError}
            </Text>
          ) : null}
          {authentication !== 'initializing'
            ? COURSE_ACTORS.map((actor) => (
                <Pressable
                  accessibilityRole="button"
                  disabled={authentication === 'authenticating'}
                  key={actor.id}
                  onPress={() => void login(actor.id)}
                  style={styles.actorButton}
                  testID={`login-${actor.id}`}
                >
                  <Text style={styles.actorButtonText}>
                    {actor.label} · {actor.id}
                  </Text>
                </Pressable>
              ))
            : null}
        </View>
      ) : null}

      {authentication === 'authenticated' && screen.kind === 'list' ? (
        <IncidentListScreen
          listCloudIncidents={dependencies.listCloudIncidents}
          onSelectIncident={(id) => setScreen({ kind: 'detail', id })}
          reportTechnicalError={dependencies.reportTechnicalError}
        />
      ) : null}

      {authentication === 'authenticated' && screen.kind === 'detail' ? (
        <IncidentDetailScreen
          getCloudIncident={dependencies.getCloudIncident}
          incidentId={screen.id}
          onBack={() => setScreen({ kind: 'list' })}
          reportTechnicalError={dependencies.reportTechnicalError}
        />
      ) : null}

      {authentication === 'authenticated' && screen.kind === 'create' ? (
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
  sessionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  logoutText: { color: '#8b1e1e', fontWeight: '700' },
  authentication: {
    alignItems: 'stretch',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 24,
  },
  authenticationTitle: {
    color: '#15345b',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  authenticationError: { color: '#8b1e1e', textAlign: 'center' },
  actorButton: {
    alignItems: 'center',
    backgroundColor: '#1555a5',
    borderRadius: 8,
    padding: 12,
  },
  actorButtonText: { color: '#ffffff', fontWeight: '700' },
});

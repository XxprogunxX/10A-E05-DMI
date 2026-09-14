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
  IncidentSummary,
  ListIncidents,
} from '../../application/incidents/ListIncidents';

interface Props {
  readonly listIncidents: ListIncidents;
  readonly onSelectIncident: (id: string) => void;
}

const statusLabels: Record<IncidentSummary['status'], string> = {
  open: 'Abierta',
  assigned: 'Asignada',
  in_progress: 'En proceso',
  resolved: 'Resuelta',
  closed: 'Cerrada',
};

export function IncidentListScreen({ listIncidents, onSelectIncident }: Props) {
  const [incidents, setIncidents] = useState<readonly IncidentSummary[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    listIncidents
      .execute()
      .then((items) => {
        if (active) {
          setIncidents(items);
          setState('ready');
        }
      })
      .catch(() => active && setState('error'));

    return () => {
      active = false;
    };
  }, [listIncidents]);

  if (state === 'loading') {
    return (
      <ActivityIndicator
        accessibilityLabel="Cargando incidencias"
        style={styles.centered}
      />
    );
  }

  if (state === 'error') {
    return (
      <Text style={styles.centered}>
        No fue posible cargar las incidencias.
      </Text>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      testID="incident-list-screen"
    >
      <Text style={styles.heading}>Incidencias recientes</Text>
      {incidents.length === 0 ? (
        <Text>No hay incidencias registradas.</Text>
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
            <Text style={styles.cardTitle}>{incident.title}</Text>
            <Text style={styles.badge}>{statusLabels[incident.status]}</Text>
          </View>
          <Text>
            {incident.category} · {incident.location}
          </Text>
          <Text style={styles.identifier}>
            {incident.id} · Prioridad {incident.priority}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { marginTop: 40, textAlign: 'center' },
  content: { gap: 12, padding: 20 },
  heading: { color: '#15345b', fontSize: 21, fontWeight: '700' },
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

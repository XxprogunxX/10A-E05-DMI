import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { CreateCloudIncident } from '../../application/incidents/CreateCloudIncident';
import { CLOUD_INCIDENT_CATEGORIES } from '../../application/incidents/CloudIncidentCategories';
import type { ReportTechnicalError } from '../../application/telemetry/ReportTechnicalError';

interface Props {
  readonly createCloudIncident: CreateCloudIncident;
  readonly onCreated: (id: string) => void;
  readonly onBack: () => void;
  readonly reportTechnicalError: ReportTechnicalError;
}

function createIdempotencyKey(): string {
  return `create-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function CreateIncidentScreen({
  createCloudIncident,
  onCreated,
  onBack,
  reportTechnicalError,
}: Props) {
  const [category, setCategory] =
    useState<(typeof CLOUD_INCIDENT_CATEGORIES)[number]>('maintenance');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(createIdempotencyKey);

  const submit = async () => {
    if (!description.trim() || !location.trim()) {
      setError('Completa la descripcin y la ubicacin.');
      setState('error');
      return;
    }

    setState('saving');
    setError(null);

    try {
      const result = await createCloudIncident.execute(
        {
          category,
          description: description.trim(),
          location: location.trim(),
        },
        idempotencyKey,
      );

      if (result.kind === 'created') {
        onCreated(result.result.incident.id);
        return;
      }

      reportTechnicalError.execute(
        {
          operation: 'create-cloud-incident',
          correlationId: 'corr-synthetic-cloud-create-001',
          attempt: 1,
        },
        new Error(`cloud incident creation failed: ${result.error}`),
      );

      setError(
        result.error === 'timeout'
          ? 'El servidor tard demasiado en responder.'
          : result.error === 'network'
            ? 'No fue posible comunicarse con el servidor.'
            : 'No fue posible crear la incidencia.',
      );
      setState('error');
    } catch (caught: unknown) {
      reportTechnicalError.execute(
        {
          operation: 'create-cloud-incident',
          correlationId: 'corr-synthetic-cloud-create-002',
          attempt: 1,
        },
        caught,
      );
      setError('No fue posible crear la incidencia.');
      setState('error');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        style={styles.backButton}
      >
        <Text style={styles.backText}>? Cancelar</Text>
      </Pressable>

      <Text style={styles.heading}>Nueva incidencia</Text>

      <Text style={styles.label}>Categora</Text>

      <View style={styles.categories}>
        {CLOUD_INCIDENT_CATEGORIES.map((item) => (
          <Pressable
            accessibilityRole="button"
            key={item}
            onPress={() => setCategory(item)}
            style={[
              styles.categoryButton,
              category === item && styles.categorySelected,
            ]}
          >
            <Text>{item}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Descripcin</Text>

      <TextInput
        multiline
        onChangeText={setDescription}
        placeholder="Describe la incidencia"
        style={styles.input}
        testID="incident-description"
        value={description}
      />

      <Text style={styles.label}>Ubicacin</Text>

      <TextInput
        onChangeText={setLocation}
        placeholder="Indica la ubicacin"
        style={styles.input}
        testID="incident-location"
        value={location}
      />

      {state === 'error' && error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={state === 'saving'}
        onPress={submit}
        style={styles.submit}
        testID="create-incident"
      >
        {state === 'saving' ? (
          <ActivityIndicator />
        ) : (
          <Text style={styles.submitText}>Crear incidencia</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 12,
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
  heading: {
    color: '#15345b',
    fontSize: 24,
    fontWeight: '800',
  },
  label: {
    fontWeight: '700',
  },
  categories: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryButton: {
    borderColor: '#dce3ed',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  categorySelected: {
    borderWidth: 2,
  },
  input: {
    borderColor: '#dce3ed',
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    padding: 10,
  },
  error: {
    textAlign: 'center',
  },
  submit: {
    alignItems: 'center',
    backgroundColor: '#1555a5',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 46,
  },
  submitText: {
    color: '#ffffff',
    fontWeight: '700',
  },
});

import { render, waitFor } from '@testing-library/react-native';
import { createElement } from 'react';

import { ListIncidents } from '../src/application/incidents/ListIncidents';
import { ReportTechnicalError } from '../src/application/telemetry/ReportTechnicalError';
import type { Incident } from '../src/domain/incidents/Incident';
import type { IncidentRepository } from '../src/domain/incidents/IncidentRepository';
import type { TechnicalErrorEvent } from '../src/domain/telemetry/TelemetrySink';
import { redactTelemetry } from '../src/domain/telemetry/redactTelemetry';
import { SafeTelemetrySink } from '../src/infrastructure/telemetry/SafeTelemetrySink';
import { IncidentListScreen } from '../src/ui/screens/IncidentListScreen';

test('redacts sensitive fields in nested objects', () => {
  expect(
    redactTelemetry({
      request: {
        authorization: 'Bearer synthetic-secret',
        profile: { password: 'synthetic-password' },
      },
    }),
  ).toEqual({
    request: {
      authorization: '[REDACTED]',
      profile: { password: '[REDACTED]' },
    },
  });
});

test('redacts sensitive fields in nested lists', () => {
  expect(
    redactTelemetry({
      attempts: [
        { token: 'synthetic-token' },
        [{ evidence: ['synthetic-evidence'] }],
      ],
    }),
  ).toEqual({
    attempts: [
      { token: '[REDACTED]' },
      [{ evidence: '[REDACTED]' }],
    ],
  });
});

test('normalizes case, underscores and hyphens when comparing keys', () => {
  expect(
    redactTelemetry({
      REFRESH_TOKEN: 'synthetic-refresh-token',
      'display-name': 'Persona sintética',
      internal_comments: ['Comentario sintético'],
    }),
  ).toEqual({
    REFRESH_TOKEN: '[REDACTED]',
    'display-name': '[REDACTED]',
    internal_comments: '[REDACTED]',
  });
});

test('creates a deep copy without mutating its input', () => {
  const input = {
    operation: 'synthetic-operation',
    nested: [{ email: 'persona@example.test', attempt: 1 }],
  };

  const output = redactTelemetry(input) as typeof input;

  expect(output).not.toBe(input);
  expect(output.nested).not.toBe(input.nested);
  expect(input.nested[0]?.email).toBe('persona@example.test');
});

test('preserves the allowed technical context', () => {
  expect(
    redactTelemetry({
      incidentId: 'INC-SYNTHETIC-001',
      correlationId: 'corr-synthetic-001',
      status: 'failed',
      attempt: 1,
      durationMs: 25,
      operation: 'load-incidents',
    }),
  ).toEqual({
    incidentId: 'INC-SYNTHETIC-001',
    correlationId: 'corr-synthetic-001',
    status: 'failed',
    attempt: 1,
    durationMs: 25,
    operation: 'load-incidents',
  });
});

test('removes access and refresh tokens', () => {
  const serialized = JSON.stringify(
    redactTelemetry({
      accessToken: 'access-synthetic-secret',
      refreshToken: 'refresh-synthetic-secret',
    }),
  );

  expect(serialized).not.toContain('access-synthetic-secret');
  expect(serialized).not.toContain('refresh-synthetic-secret');
});

test('removes names and email addresses', () => {
  expect(
    redactTelemetry({
      name: 'Nombre Sintético',
      displayName: 'Persona Sintética',
      email: 'persona@example.test',
    }),
  ).toEqual({
    name: '[REDACTED]',
    displayName: '[REDACTED]',
    email: '[REDACTED]',
  });
});

test('removes location and coordinates', () => {
  expect(
    redactTelemetry({
      location: 'Edificio sintético',
      latitude: 19.4,
      longitude: -99.1,
    }),
  ).toEqual({
    location: '[REDACTED]',
    latitude: '[REDACTED]',
    longitude: '[REDACTED]',
  });
});

test('removes photographs and internal comments', () => {
  expect(
    redactTelemetry({
      photos: ['synthetic-photo.jpg'],
      internalComments: ['Comentario sintético'],
      assignmentHistory: [{ technicianId: 'TECH-SYNTHETIC-001' }],
    }),
  ).toEqual({
    photos: '[REDACTED]',
    internalComments: '[REDACTED]',
    assignmentHistory: '[REDACTED]',
  });
});

test('technical error service never forwards the external error', () => {
  const record = jest.fn();
  const service = new ReportTechnicalError({ record });

  service.execute(
    {
      operation: 'load-incidents',
      correlationId: 'corr-synthetic-001',
      attempt: 1,
    },
    new Error('request failed with token synthetic-leaked-token'),
  );

  expect(record).toHaveBeenCalledWith({
    operation: 'load-incidents',
    correlationId: 'corr-synthetic-001',
    status: 'failed',
    attempt: 1,
  });
  expect(JSON.stringify(record.mock.calls)).not.toContain(
    'synthetic-leaked-token',
  );
});

test('safe sink sanitizes an event before the final transport', () => {
  const transport = jest.fn();
  const sink = new SafeTelemetrySink(transport);
  const unsafeRuntimeEvent = {
    operation: 'synthetic-operation',
    correlationId: 'corr-synthetic-002',
    status: 'failed',
    attempt: 1,
    access_token: 'synthetic-transport-token',
    reporterId: 'REPORTER-SYNTHETIC-001',
  } as unknown as TechnicalErrorEvent;

  sink.record(unsafeRuntimeEvent);

  expect(transport).toHaveBeenCalledWith({
    operation: 'synthetic-operation',
    correlationId: 'corr-synthetic-002',
    status: 'failed',
    attempt: 1,
    access_token: '[REDACTED]',
    reporterId: '[REDACTED]',
  });
  expect(JSON.stringify(transport.mock.calls)).not.toContain(
    'synthetic-transport-token',
  );
});

class RejectingIncidentRepository implements IncidentRepository {
  async list(): Promise<readonly Incident[]> {
    throw new Error('failure with token synthetic-operation-token');
  }

  async getById(_id: string): Promise<Incident | null> {
    return null;
  }
}

test('an actual incident operation reports only safe context on failure', async () => {
  const transport = jest.fn();
  const reportTechnicalError = new ReportTechnicalError(
    new SafeTelemetrySink(transport),
  );
  const view = await render(
    createElement(IncidentListScreen, {
      listIncidents: new ListIncidents(new RejectingIncidentRepository()),
      onSelectIncident: jest.fn(),
      reportTechnicalError,
    }),
  );

  await waitFor(() =>
    expect(
      view.getByText('No fue posible cargar las incidencias.'),
    ).toBeTruthy(),
  );
  expect(transport).toHaveBeenCalledWith({
    operation: 'load-incidents',
    correlationId: 'corr-synthetic-list-001',
    status: 'failed',
    attempt: 1,
  });
  expect(JSON.stringify(transport.mock.calls)).not.toContain(
    'synthetic-operation-token',
  );
});

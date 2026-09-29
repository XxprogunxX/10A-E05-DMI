import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { ListIncidents } from '../src/application/incidents/ListIncidents';
import type { Incident } from '../src/domain/incidents/Incident';
import { InMemoryIncidentRepository } from '../src/infrastructure/incidents/InMemoryIncidentRepository';
import { redactForTelemetry } from '../src/course-evaluation';

test('redacts credentials and private incident data without changing the input', () => {
  const input = {
    correlationId: 'corr-001',
    status: 'failed',
    request: {
      headers: {
        authorization: 'Bearer synthetic-token',
        accept: 'application/json',
      },
    },
    profile: {
      email: 'persona@campusops.test',
      display_name: 'Persona ficticia',
    },
    incidentId: 'INC-001',
    location: 'Edificio ficticio',
    photos: ['synthetic-photo-1'],
    internalComments: ['Comentario ficticio'],
  };

  expect(redactForTelemetry(input)).toEqual({
    correlationId: 'corr-001',
    status: 'failed',
    request: {
      headers: {
        authorization: '[REDACTED]',
        accept: 'application/json',
      },
    },
    profile: {
      email: '[REDACTED]',
      display_name: '[REDACTED]',
    },
    incidentId: 'INC-001',
    location: '[REDACTED]',
    photos: '[REDACTED]',
    internalComments: '[REDACTED]',
  });
  expect(input.request.headers.authorization).toBe('Bearer synthetic-token');
  expect(input.photos).toEqual(['synthetic-photo-1']);
});

test('redacts sensitive values nested inside arrays', () => {
  expect(
    redactForTelemetry({
      attempts: [
        { attempt: 1, access_token: 'synthetic-token', durationMs: 25 },
        { attempt: 2, latitude: 19.4, longitude: -99.1, durationMs: 40 },
      ],
    }),
  ).toEqual({
    attempts: [
      { attempt: 1, access_token: '[REDACTED]', durationMs: 25 },
      {
        attempt: 2,
        latitude: '[REDACTED]',
        longitude: '[REDACTED]',
        durationMs: 40,
      },
    ],
  });
});

test('incident summaries omit exact locations that belong in the detail view', async () => {
  const incident: Incident = {
    id: 'INC-PRIVATE-001',
    title: 'Incidencia ficticia',
    description: 'Descripción de prueba',
    category: 'Prueba',
    location: 'Ubicación ficticia reservada',
    status: 'open',
    priority: 'medium',
    reportedAt: '2026-09-24T10:00:00-06:00',
  };
  const listIncidents = new ListIncidents(
    new InMemoryIncidentRepository([incident]),
  );

  const result = await listIncidents.execute();

  expect(result).toEqual([
    {
      id: 'INC-PRIVATE-001',
      title: 'Incidencia ficticia',
      category: 'Prueba',
      status: 'open',
      priority: 'medium',
    },
  ]);
  expect(result[0]).not.toHaveProperty('location');
});

test('Git ignores private environment variants but keeps the example trackable', () => {
  const repository = path.resolve(__dirname, '..');
  const isIgnored = (candidate: string) =>
    spawnSync(
      'git',
      ['check-ignore', '--no-index', '-q', '--', candidate],
      { cwd: repository },
    ).status === 0;

  expect(isIgnored('.env')).toBe(true);
  expect(isIgnored('.env.local')).toBe(true);
  expect(isIgnored('.env.production')).toBe(true);
  expect(isIgnored('.env.example')).toBe(false);
});

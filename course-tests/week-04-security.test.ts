import { redactForTelemetry } from '../src/course-evaluation';

test('telemetry redaction handles normalized nested keys without mutating the input', () => {
  const input = {
    incidentId: 'campus-inc-001',
    correlationId: 'correlation-001',
    request: {
      headers: {
        Authorization: 'Bearer synthetic-token',
        'x-api-key': 'synthetic-api-key',
      },
    },
    attempts: [
      { status: 'failed', access_token: 'synthetic-access-token' },
      { status: 'retried', durationMs: 25 },
    ],
  };

  expect(redactForTelemetry(input)).toEqual({
    incidentId: 'campus-inc-001',
    correlationId: 'correlation-001',
    request: {
      headers: {
        Authorization: '[REDACTED]',
        'x-api-key': '[REDACTED]',
      },
    },
    attempts: [
      { status: 'failed', access_token: '[REDACTED]' },
      { status: 'retried', durationMs: 25 },
    ],
  });

  expect(input.request.headers.Authorization).toBe('Bearer synthetic-token');
  expect(input.attempts[0]?.access_token).toBe('synthetic-access-token');
});

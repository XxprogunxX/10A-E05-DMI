const REDACTED = '[REDACTED]';

const SENSITIVE_TELEMETRY_KEYS = new Set([
  'authorization',
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'secret',
  'cookie',
  'setcookie',
  'sessionid',
  'email',
  'displayname',
  'name',
  'userid',
  'reporterid',
  'technicianid',
  'assignedtechnicianid',
  'location',
  'latitude',
  'longitude',
  'photos',
  'evidence',
  'internalcomments',
  'assignmenthistory',
]);

function normalizeTelemetryKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

function redactValue(
  value: unknown,
  visited: WeakMap<object, unknown>,
): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  const previous = visited.get(value);
  if (previous !== undefined) {
    return previous;
  }

  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    visited.set(value, copy);
    value.forEach((item) => copy.push(redactValue(item, visited)));
    return copy;
  }

  const copy: Record<string, unknown> = {};
  visited.set(value, copy);
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    copy[key] = SENSITIVE_TELEMETRY_KEYS.has(normalizeTelemetryKey(key))
      ? REDACTED
      : redactValue(item, visited);
  });
  return copy;
}

/** Returns a sanitized deep copy suitable for a telemetry boundary. */
export function redactTelemetry(input: unknown): unknown {
  return redactValue(input, new WeakMap<object, unknown>());
}

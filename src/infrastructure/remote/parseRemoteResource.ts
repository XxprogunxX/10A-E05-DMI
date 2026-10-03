export type RemoteJsonObject = Readonly<Record<string, unknown>>;

export type RemoteResource = Readonly<{
  id: string;
  version: number;
  status: string;
  payload: RemoteJsonObject | null;
}>;

export type RemoteResourceParseResult =
  | Readonly<{ ok: true; value: RemoteResource }>
  | Readonly<{ ok: false; error: 'contract' }>;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates the transport envelope before a provider response reaches the app.
 * Domain-specific payload validation is deliberately performed by each client.
 */
export function parseRemoteResource(
  input: unknown,
): RemoteResourceParseResult {
  if (!isObjectRecord(input)) {
    return { ok: false, error: 'contract' };
  }

  const { id, version, status, payload } = input;
  const validPayload = payload === null || isObjectRecord(payload);

  if (
    typeof id !== 'string' ||
    id.trim().length === 0 ||
    typeof status !== 'string' ||
    status.trim().length === 0 ||
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 0 ||
    !validPayload
  ) {
    return { ok: false, error: 'contract' };
  }

  return {
    ok: true,
    value: {
      id,
      version,
      status,
      payload: payload === null ? null : { ...payload },
    },
  };
}

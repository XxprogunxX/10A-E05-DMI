export interface SessionSecrets {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly actorId: string;
}

export function isSessionSecrets(value: unknown): value is SessionSecrets {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.accessToken === 'string' &&
    candidate.accessToken.length > 0 &&
    typeof candidate.refreshToken === 'string' &&
    candidate.refreshToken.length > 0 &&
    typeof candidate.actorId === 'string' &&
    candidate.actorId.length > 0
  );
}

export type SessionRole = 'reporter' | 'technician' | 'coordinator';

export interface SessionIdentity {
  readonly actorId: string;
  readonly role: SessionRole | null;
}

/** Read-only session view consumed by application services. */
export interface SessionIdentityProvider {
  getSessionSnapshot(): SessionIdentity | null;
}

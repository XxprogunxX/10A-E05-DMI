import type { SessionSecrets } from './SessionSecrets';

export interface SessionStorage {
  save(session: SessionSecrets): Promise<void>;
  load(): Promise<SessionSecrets | null>;
  clear(): Promise<void>;
}

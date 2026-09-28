import * as SecureStore from 'expo-secure-store';

import {
  isSessionSecrets,
  type SessionSecrets,
} from '../../domain/session/SessionSecrets';
import type { SessionStorage } from '../../domain/session/SessionStorage';

const SESSION_KEY = 'campusops.session.v1';
const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: 'mx.edu.dmi.campusops.session',
};

export interface SecureStoreDriver {
  isAvailableAsync(): Promise<boolean>;
  setItemAsync(
    key: string,
    value: string,
    options?: SecureStore.SecureStoreOptions,
  ): Promise<void>;
  getItemAsync(
    key: string,
    options?: SecureStore.SecureStoreOptions,
  ): Promise<string | null>;
  deleteItemAsync(
    key: string,
    options?: SecureStore.SecureStoreOptions,
  ): Promise<void>;
}

const nativeSecureStore: SecureStoreDriver = {
  isAvailableAsync: SecureStore.isAvailableAsync,
  setItemAsync: SecureStore.setItemAsync,
  getItemAsync: SecureStore.getItemAsync,
  deleteItemAsync: SecureStore.deleteItemAsync,
};

function storageFailure(): Error {
  return new Error('No fue posible acceder al almacenamiento seguro.');
}

/**
 * Persists only the small session secret. Incident data, photos, and comments do
 * not belong in this store. Failures are deliberately reported without native
 * messages or serialized values because either could disclose session data.
 */
export class ExpoSecureSessionStorage implements SessionStorage {
  constructor(private readonly driver: SecureStoreDriver = nativeSecureStore) {}

  async save(session: SessionSecrets): Promise<void> {
    if (!isSessionSecrets(session)) {
      throw storageFailure();
    }

    try {
      await this.requireAvailability();
      await this.driver.setItemAsync(
        SESSION_KEY,
        JSON.stringify(session),
        STORE_OPTIONS,
      );
    } catch {
      throw storageFailure();
    }
  }

  async load(): Promise<SessionSecrets | null> {
    try {
      await this.requireAvailability();
      const stored = await this.driver.getItemAsync(SESSION_KEY, STORE_OPTIONS);
      if (stored === null) {
        return null;
      }

      const parsed: unknown = JSON.parse(stored);
      if (!isSessionSecrets(parsed)) {
        await this.driver.deleteItemAsync(SESSION_KEY, STORE_OPTIONS);
        return null;
      }

      return parsed;
    } catch {
      throw storageFailure();
    }
  }

  async clear(): Promise<void> {
    try {
      await this.requireAvailability();
      await this.driver.deleteItemAsync(SESSION_KEY, STORE_OPTIONS);
    } catch {
      throw storageFailure();
    }
  }

  private async requireAvailability(): Promise<void> {
    if (!(await this.driver.isAvailableAsync())) {
      throw storageFailure();
    }
  }
}

import * as SecureStore from 'expo-secure-store';

import type { KeyValuePersistenceDriver } from './PersistentIncidentStore';

const OFFLINE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: 'mx.edu.dmi.campusops.offline',
};

export interface SecureKeyValueDriver {
  isAvailableAsync(): Promise<boolean>;
  getItemAsync(
    key: string,
    options?: SecureStore.SecureStoreOptions,
  ): Promise<string | null>;
  setItemAsync(
    key: string,
    value: string,
    options?: SecureStore.SecureStoreOptions,
  ): Promise<void>;
  deleteItemAsync(
    key: string,
    options?: SecureStore.SecureStoreOptions,
  ): Promise<void>;
}

const nativeSecureStore: SecureKeyValueDriver = {
  isAvailableAsync: SecureStore.isAvailableAsync,
  getItemAsync: SecureStore.getItemAsync,
  setItemAsync: SecureStore.setItemAsync,
  deleteItemAsync: SecureStore.deleteItemAsync,
};

// Used only when the native module is unavailable, such as headless Jest.
const fallbackDeviceDisk = new Map<string, string>();

function normalizeSecureStoreKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

function persistenceFailure(): Error {
  return new Error('No fue posible acceder al almacenamiento offline.');
}

/**
 * Native Expo adapter for the offline database. Its isolated keychain service
 * deliberately differs from the session-secret namespace.
 */
export class ExpoSecureKeyValueDriver implements KeyValuePersistenceDriver {
  constructor(
    private readonly driver: SecureKeyValueDriver = nativeSecureStore,
  ) {}

  async getItem(key: string): Promise<string | null> {
    const safeKey = normalizeSecureStoreKey(key);
    if (!(await this.canUseNative())) {
      return fallbackDeviceDisk.get(safeKey) ?? null;
    }
    try {
      return await this.driver.getItemAsync(safeKey, OFFLINE_STORE_OPTIONS);
    } catch {
      throw persistenceFailure();
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    const safeKey = normalizeSecureStoreKey(key);
    if (!(await this.canUseNative())) {
      fallbackDeviceDisk.set(safeKey, value);
      return;
    }
    try {
      await this.driver.setItemAsync(safeKey, value, OFFLINE_STORE_OPTIONS);
    } catch {
      throw persistenceFailure();
    }
  }

  async removeItem(key: string): Promise<void> {
    const safeKey = normalizeSecureStoreKey(key);
    if (!(await this.canUseNative())) {
      fallbackDeviceDisk.delete(safeKey);
      return;
    }
    try {
      await this.driver.deleteItemAsync(safeKey, OFFLINE_STORE_OPTIONS);
    } catch {
      throw persistenceFailure();
    }
  }

  private async canUseNative(): Promise<boolean> {
    try {
      return await this.driver.isAvailableAsync();
    } catch {
      return false;
    }
  }
}

import {
  ExpoSecureKeyValueDriver,
  type SecureKeyValueDriver,
} from '../src/infrastructure/persistence/ExpoSecureKeyValueDriver';

type StoreOptions = Parameters<SecureKeyValueDriver['setItemAsync']>[2];

class MemoryNativeDriver implements SecureKeyValueDriver {
  available = true;
  failWrites = false;
  readonly values = new Map<string, string>();
  lastKey: string | null = null;
  lastOptions: StoreOptions;

  async isAvailableAsync(): Promise<boolean> {
    return this.available;
  }

  async getItemAsync(
    key: string,
    options?: StoreOptions,
  ): Promise<string | null> {
    this.lastKey = key;
    this.lastOptions = options;
    return this.values.get(key) ?? null;
  }

  async setItemAsync(
    key: string,
    value: string,
    options?: StoreOptions,
  ): Promise<void> {
    this.lastKey = key;
    this.lastOptions = options;
    if (this.failWrites) throw new Error(`provider leaked ${value}`);
    this.values.set(key, value);
  }

  async deleteItemAsync(
    key: string,
    options?: StoreOptions,
  ): Promise<void> {
    this.lastKey = key;
    this.lastOptions = options;
    this.values.delete(key);
  }
}

describe('Week 08 — Expo durable key-value adapter', () => {
  test('uses a normalized key and an isolated offline namespace', async () => {
    const native = new MemoryNativeDriver();
    const driver = new ExpoSecureKeyValueDriver(native);

    await driver.setItem('campusops/offline:db', 'synthetic-offline-value');
    await expect(driver.getItem('campusops/offline:db')).resolves.toBe(
      'synthetic-offline-value',
    );
    expect(native.lastKey).toBe('campusops_offline_db');
    expect(native.lastOptions).toMatchObject({
      keychainService: 'mx.edu.dmi.campusops.offline',
    });
    expect(native.lastOptions).not.toMatchObject({
      keychainService: 'mx.edu.dmi.campusops.session',
    });
  });

  test('retains values across adapter reconstruction in headless mode', async () => {
    const unavailable = new MemoryNativeDriver();
    unavailable.available = false;
    const key = 'week08.headless.reconstruction';

    await new ExpoSecureKeyValueDriver(unavailable).setItem(key, 'queued');
    await expect(
      new ExpoSecureKeyValueDriver(unavailable).getItem(key),
    ).resolves.toBe('queued');
    await new ExpoSecureKeyValueDriver(unavailable).removeItem(key);
    await expect(
      new ExpoSecureKeyValueDriver(unavailable).getItem(key),
    ).resolves.toBeNull();
  });

  test('fails closed without leaking values when native persistence fails', async () => {
    const native = new MemoryNativeDriver();
    native.failWrites = true;
    const driver = new ExpoSecureKeyValueDriver(native);
    const secretDescription = 'private-offline-description';

    await expect(
      driver.setItem('week08.failure', secretDescription),
    ).rejects.toThrow('No fue posible acceder al almacenamiento offline.');
    try {
      await driver.setItem('week08.failure', secretDescription);
    } catch (error: unknown) {
      expect(String(error)).not.toContain(secretDescription);
    }
  });
});

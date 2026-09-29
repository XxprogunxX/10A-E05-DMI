import {
  ExpoSecureSessionStorage,
  type SecureStoreDriver,
} from '../src/infrastructure/session/ExpoSecureSessionStorage';

class MemorySecureStore implements SecureStoreDriver {
  available = true;
  value: string | null = null;
  deleted = false;

  async isAvailableAsync(): Promise<boolean> {
    return this.available;
  }

  async setItemAsync(_key: string, value: string): Promise<void> {
    this.value = value;
  }

  async getItemAsync(): Promise<string | null> {
    return this.value;
  }

  async deleteItemAsync(): Promise<void> {
    this.deleted = true;
    this.value = null;
  }
}

const syntheticSession = {
  accessToken: 'synthetic-access-token',
  refreshToken: 'synthetic-refresh-token',
  actorId: 'technician-1',
} as const;

test('stores and restores the session through the secure driver', async () => {
  const driver = new MemorySecureStore();
  const storage = new ExpoSecureSessionStorage(driver);

  await storage.save(syntheticSession);

  expect(driver.value).toContain('synthetic-access-token');
  await expect(storage.load()).resolves.toEqual(syntheticSession);
});

test('removes an invalid persisted session instead of returning it', async () => {
  const driver = new MemorySecureStore();
  driver.value = JSON.stringify({ accessToken: 'incomplete' });
  const storage = new ExpoSecureSessionStorage(driver);

  await expect(storage.load()).resolves.toBeNull();
  expect(driver.deleted).toBe(true);
  expect(driver.value).toBeNull();
});

test('fails closed without leaking the stored value in the error', async () => {
  const driver = new MemorySecureStore();
  driver.available = false;
  driver.value = JSON.stringify(syntheticSession);
  const storage = new ExpoSecureSessionStorage(driver);

  await expect(storage.load()).rejects.toThrow(
    'No fue posible acceder al almacenamiento seguro.',
  );

  try {
    await storage.load();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect(message).not.toContain(syntheticSession.accessToken);
    expect(message).not.toContain(syntheticSession.refreshToken);
    expect(message).not.toContain(syntheticSession.actorId);
  }
});

test('clears the secure session on logout', async () => {
  const driver = new MemorySecureStore();
  driver.value = JSON.stringify(syntheticSession);
  const storage = new ExpoSecureSessionStorage(driver);

  await storage.clear();

  expect(driver.deleted).toBe(true);
  expect(driver.value).toBeNull();
});

import fs from 'node:fs/promises';
import path from 'node:path';

import type { KeyValuePersistenceDriver } from './PersistentIncidentStore';

function isStringMap(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  );
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: string }).code === 'ENOENT'
  );
}

/**
 * Disk-backed driver that serializes access and atomically replaces its JSON
 * document. A completed write survives object destruction and process restart;
 * an interrupted temp-file write leaves the previous document intact.
 */
export class FileKeyValuePersistenceDriver
  implements KeyValuePersistenceDriver
{
  private operationTail: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async getItem(key: string): Promise<string | null> {
    return this.runExclusive(async () => {
      const map = await this.readMap();
      return Object.hasOwn(map, key) ? (map[key] ?? null) : null;
    });
  }

  async setItem(key: string, value: string): Promise<void> {
    await this.runExclusive(async () => {
      const map = await this.readMap();
      map[key] = value;
      await this.writeMap(map);
    });
  }

  async removeItem(key: string): Promise<void> {
    await this.runExclusive(async () => {
      const map = await this.readMap();
      delete map[key];
      await this.writeMap(map);
    });
  }

  private async readMap(): Promise<Record<string, string>> {
    try {
      const parsed: unknown = JSON.parse(
        await fs.readFile(this.filePath, 'utf8'),
      );
      if (!isStringMap(parsed)) {
        throw new Error('Invalid durable key-value file.');
      }
      return parsed;
    } catch (error: unknown) {
      if (isMissingFile(error)) {
        return {};
      }
      throw error;
    }
  }

  private async writeMap(map: Record<string, string>): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(map, null, 2), 'utf8');
    await fs.rename(tempPath, this.filePath);
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

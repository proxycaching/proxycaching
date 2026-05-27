import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { promises as fsPromises } from 'fs';
import { EncryptionConfig } from './config';
import { Logger } from './logger';

export interface CacheEntry {
  id: string;
  request: {
    method: string;
    url: string;
    headers: Record<string, string | string[]>;
    body?: string;
    bodyEncoding?: 'utf8' | 'base64';
  };
  response: {
    status: number;
    headers: Record<string, string | string[]>;
    body?: string;
    bodyEncoding?: 'utf8' | 'base64';
  };
  createdAt: string;
  lastAccessedAt: string;
  hitCount: number;
  metadata: Record<string, unknown>;
}

interface CacheManifestItem {
  id: string;
  createdAt: string;
  lastAccessedAt: string;
  hitCount: number;
  requestUrl: string;
  requestMethod: string;
}

interface ManifestFile {
  [key: string]: CacheManifestItem;
}

interface EncryptedPayload {
  iv: string;
  authTag: string;
  data: string;
}

export interface CacheStats {
  podcachePath: string;
  totalEntries: number;
  manifestSizeBytes: number;
  cacheSizeBytes: number;
  lastAccessedAt?: string;
}

export class CacheStore {
  private manifest: ManifestFile = {};
  private manifestPath: string;

  constructor(
    private podcachePath: string,
    private encryptionConfig?: EncryptionConfig,
    private logger?: Logger
  ) {
    this.manifestPath = path.join(this.podcachePath, 'manifest.json');
  }

  async initialize(): Promise<void> {
    await fsPromises.mkdir(this.podcachePath, { recursive: true });
    await this.setLocalPermissions();
    await this.loadManifest();
    this.logger?.info('CacheStore initialized', {
      podcachePath: this.podcachePath,
      entries: Object.keys(this.manifest).length,
    });
  }

  private async setLocalPermissions(): Promise<void> {
    if (process.platform === 'win32') {
      return;
    }

    try {
      await fsPromises.chmod(this.podcachePath, 0o700);
    } catch (error) {
      console.warn(`Unable to enforce local-only permissions on podcache path: ${this.podcachePath}`, error);
    }
  }

  async get(key: string): Promise<CacheEntry | null> {
    const item = this.manifest[key];
    if (!item) {
      this.logger?.debug('CacheStore.get miss', { key });
      return null;
    }

    const entryPath = this.getEntryPath(item.id);
    if (!fs.existsSync(entryPath)) {
      this.logger?.warn('CacheStore.get missing cache file', { key, entryPath });
      delete this.manifest[key];
      await this.saveManifest();
      return null;
    }

    const entry = await this.loadEntry(entryPath);
    if (!entry) {
      this.logger?.warn('CacheStore.get failed to load entry', { key, entryPath });
      delete this.manifest[key];
      await this.saveManifest();
      return null;
    }

    item.hitCount += 1;
    item.lastAccessedAt = new Date().toISOString();
    entry.hitCount = item.hitCount;
    entry.lastAccessedAt = item.lastAccessedAt;

    await this.saveEntry(entry);
    await this.saveManifest();

    return entry;
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const id = entry.id || this.createEntryId(key);
    const now = new Date().toISOString();
    const storedEntry: CacheEntry = {
      ...entry,
      id,
      createdAt: entry.createdAt || now,
      lastAccessedAt: now,
      hitCount: entry.hitCount ?? 1,
    };

    const item: CacheManifestItem = {
      id,
      createdAt: storedEntry.createdAt,
      lastAccessedAt: storedEntry.lastAccessedAt,
      hitCount: storedEntry.hitCount,
      requestUrl: storedEntry.request.url,
      requestMethod: storedEntry.request.method,
    };

    this.manifest[key] = item;
    await this.saveEntry(storedEntry);
    await this.saveManifest();
    this.logger?.info('CacheStore.set entry', { key, id, requestUrl: storedEntry.request.url });
  }
  async peek(key: string): Promise<CacheEntry | null> {
    const item = this.manifest[key];
    if (!item) {
      return null;
    }

    const entryPath = this.getEntryPath(item.id);
    if (!fs.existsSync(entryPath)) {
      return null;
    }

    return this.loadEntry(entryPath);
  }
  async listKeys(): Promise<string[]> {
    return Object.keys(this.manifest);
  }

  async getManifestItem(key: string): Promise<CacheManifestItem | null> {
    return this.manifest[key] ?? null;
  }

  private getEntryPath(id: string): string {
    return path.join(this.podcachePath, `${id}.json`);
  }

  private async loadManifest(): Promise<void> {
    try {
      const raw = await fsPromises.readFile(this.manifestPath, 'utf-8');
      this.manifest = JSON.parse(raw) as ManifestFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.manifest = {};
        await this.saveManifest();
      } else {
        throw error;
      }
    }
  }

  async getStats(): Promise<CacheStats> {
    const totalEntries = Object.keys(this.manifest).length;
    let manifestSizeBytes = 0;
    let cacheSizeBytes = 0;
    let lastAccessedAt: string | undefined;

    try {
      const manifestStat = await fsPromises.stat(this.manifestPath);
      manifestSizeBytes = manifestStat.size;
    } catch {
      manifestSizeBytes = 0;
    }

    for (const item of Object.values(this.manifest)) {
      try {
        const entryStat = await fsPromises.stat(this.getEntryPath(item.id));
        cacheSizeBytes += entryStat.size;
      } catch {
        // ignore missing files when calculating cache size
      }

      if (!lastAccessedAt || item.lastAccessedAt > lastAccessedAt) {
        lastAccessedAt = item.lastAccessedAt;
      }
    }

    return {
      podcachePath: this.podcachePath,
      totalEntries,
      manifestSizeBytes,
      cacheSizeBytes,
      lastAccessedAt,
    };
  }

  private async saveManifest(): Promise<void> {
    await fsPromises.writeFile(
      this.manifestPath,
      JSON.stringify(this.manifest, null, 2),
      'utf-8'
    );
    this.logger?.debug('CacheStore.saveManifest', { manifestPath: this.manifestPath, entries: Object.keys(this.manifest).length });
  }

  private async saveEntry(entry: CacheEntry): Promise<void> {
    const payload = JSON.stringify(entry, null, 2);
    const entryPath = this.getEntryPath(entry.id);
    const output = this.encryptionConfig?.enabled
      ? JSON.stringify(await this.encryptPayload(payload))
      : payload;

    await fsPromises.writeFile(entryPath, output, 'utf-8');
    this.logger?.debug('CacheStore.saveEntry', { id: entry.id, entryPath });
  }

  private async loadEntry(entryPath: string): Promise<CacheEntry | null> {
    try {
      const raw = await fsPromises.readFile(entryPath, 'utf-8');
      const parsed = JSON.parse(raw);

      if (this.isEncryptedPayload(parsed)) {
        const decrypted = await this.decryptPayload(parsed);
        return JSON.parse(decrypted) as CacheEntry;
      }

      return parsed as CacheEntry;
    } catch (error) {
      return null;
    }
  }

  private isEncryptedPayload(payload: unknown): payload is EncryptedPayload {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'iv' in payload &&
      'authTag' in payload &&
      'data' in payload
    );
  }

  private async encryptPayload(plaintext: string): Promise<EncryptedPayload> {
    if (!this.encryptionConfig?.enabled) {
      throw new Error('Encryption is not enabled.');
    }

    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.encryptionConfig.algorithm, key, iv) as crypto.CipherGCM;
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      data: encrypted.toString('base64'),
    };
  }

  private async decryptPayload(payload: EncryptedPayload): Promise<string> {
    const key = this.getEncryptionKey();
    const iv = Buffer.from(payload.iv, 'base64');
    const authTag = Buffer.from(payload.authTag, 'base64');
    const encrypted = Buffer.from(payload.data, 'base64');
    const decipher = crypto.createDecipheriv(this.encryptionConfig!.algorithm, key, iv) as crypto.DecipherGCM;
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }

  private getEncryptionKey(): Buffer {
    if (!this.encryptionConfig) {
      throw new Error('Encryption config is missing.');
    }

    const envKey = process.env[this.encryptionConfig.keyEnvVar];
    if (!envKey) {
      throw new Error(`Encryption key is required in env var ${this.encryptionConfig.keyEnvVar}.`);
    }

    const keyBuffer = Buffer.from(envKey, 'base64');
    if (keyBuffer.length !== 32) {
      throw new Error('Encryption key must be a 32-byte base64 string.');
    }

    return keyBuffer;
  }

  private createEntryId(key: string): string {
    return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
  }
}

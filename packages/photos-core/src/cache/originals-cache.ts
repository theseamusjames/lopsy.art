/**
 * Originals on this device (spec 6.7), keyed by SHA-256: read from the
 * cache, else downloaded from storage, verified against the checksum the
 * library recorded, and cached. Concurrent reads of one original share a
 * download.
 */

import { sha256Hex } from '../storage/content-hash';
import { StorageError } from '../storage/errors';
import type { FileId, StorageAdapter } from '../storage/types';
import type { BlobCache } from './blob-cache';
import { SharedDownloads, type SharedReadOptions } from './shared-downloads';

const GB = 1_000_000_000;
export const ORIGINALS_MAX_BUDGET = 20 * GB;
export const ORIGINALS_QUOTA_SHARE = 0.3;

export interface OriginalRef {
  readonly fileId: FileId;
  /** Lower-case hex SHA-256 of the original's bytes. */
  readonly sha256: string;
  readonly byteSize: number;
}

/** min(20 GB, 30 % of the origin's quota); 20 GB when the quota is unknown. */
export async function defaultOriginalsBudget(
  estimate: (() => Promise<{ quota?: number }>) | null = typeof navigator !== 'undefined' && navigator.storage
    ? () => navigator.storage.estimate()
    : null,
): Promise<number> {
  if (!estimate) return ORIGINALS_MAX_BUDGET;
  try {
    const { quota } = await estimate();
    return quota === undefined ? ORIGINALS_MAX_BUDGET : Math.min(ORIGINALS_MAX_BUDGET, Math.floor(quota * ORIGINALS_QUOTA_SHARE));
  } catch {
    return ORIGINALS_MAX_BUDGET;
  }
}

export class OriginalsCache {
  private readonly downloads = new SharedDownloads();

  constructor(readonly cache: BlobCache) {}

  async readOriginal(adapter: StorageAdapter, asset: OriginalRef, options: SharedReadOptions = {}): Promise<Blob> {
    const key = asset.sha256.toLowerCase();
    const cached = await this.cache.get(key);
    if (cached && cached.size === asset.byteSize) {
      options.onProgress?.(cached.size, cached.size);
      return cached;
    }
    return this.downloads.run(
      key,
      async (signal, onProgress) => {
        const blob = await adapter.readContent(asset.fileId, { signal, onProgress });
        const actual = blob.size === asset.byteSize ? await sha256Hex(blob) : null;
        if (actual !== key) {
          throw new StorageError('invalid', `The original ${asset.fileId} does not match its recorded checksum`);
        }
        await this.cache.put(key, blob);
        return blob;
      },
      options,
    );
  }

  /** Keeps an original from eviction, e.g. while it is open in the editor. */
  pin(sha256: string): void {
    this.cache.pin(sha256.toLowerCase());
  }

  unpin(sha256: string): void {
    this.cache.unpin(sha256.toLowerCase());
  }
}

/**
 * Screen previews on this device (spec 6.7), keyed by the preview file's
 * ID. Preview files are written once per version and size, so an ID
 * always names the same bytes.
 */

import type { FileId, StorageAdapter } from '../storage/types';
import type { BlobCache } from './blob-cache';
import { SharedDownloads, type SharedReadOptions } from './shared-downloads';

export const PREVIEWS_DEFAULT_BUDGET = 2_000_000_000;

export class PreviewCache {
  private readonly downloads = new SharedDownloads();

  constructor(readonly cache: BlobCache) {}

  /** From the cache, else downloaded and cached. */
  async readPreview(adapter: StorageAdapter, fileId: FileId, options: SharedReadOptions = {}): Promise<Blob> {
    const cached = await this.cache.get(fileId);
    if (cached) {
      options.onProgress?.(cached.size, cached.size);
      return cached;
    }
    return this.downloads.run(
      fileId,
      async (signal, onProgress) => {
        const blob = await adapter.readContent(fileId, { signal, onProgress });
        await this.cache.put(fileId, blob);
        return blob;
      },
      options,
    );
  }

  /** Caches a preview this device rendered and uploaded, so it is not downloaded again. */
  put(fileId: FileId, blob: Blob): Promise<void> {
    return this.cache.put(fileId, blob);
  }

  get(fileId: FileId): Promise<Blob | null> {
    return this.cache.get(fileId);
  }
}

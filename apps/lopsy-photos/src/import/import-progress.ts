/** The numbers the import strip shows, from an ImportProgress. Pure. */

import type { ImportItem, ImportProgress } from '@lopsy/photos-core/import/types';

export interface ImportStats {
  readonly total: number;
  readonly done: number;
  readonly duplicates: number;
  readonly failed: readonly ImportItem[];
  /** Items that have stopped moving, whatever the outcome. */
  readonly settled: number;
  readonly totalBytes: number;
  readonly sentBytes: number;
  /** 0..1 by bytes. */
  readonly fraction: number;
}

export function importStats(progress: ImportProgress): ImportStats {
  let done = 0;
  let duplicates = 0;
  let totalBytes = 0;
  let sentBytes = 0;
  const failed: ImportItem[] = [];
  for (const item of progress.items) {
    totalBytes += item.byteSize;
    switch (item.state) {
      case 'done':
        done++;
        sentBytes += item.byteSize;
        break;
      case 'duplicate':
      case 'skipped':
        duplicates++;
        sentBytes += item.byteSize;
        break;
      case 'failed':
      case 'unsupported':
        failed.push(item);
        sentBytes += item.byteSize;
        break;
      case 'verifying':
        sentBytes += item.byteSize;
        break;
      default:
        sentBytes += Math.min(item.byteSize, item.sentBytes);
    }
  }
  const total = progress.items.length;
  return {
    total,
    done,
    duplicates,
    failed,
    settled: done + duplicates + failed.length,
    totalBytes,
    sentBytes,
    fraction: totalBytes === 0 ? (progress.finished ? 1 : 0) : sentBytes / totalBytes,
  };
}

/** "About 3 minutes left", from bytes sent so far over the time taken. */
export function estimateLeft(stats: ImportStats, elapsedMs: number): string | null {
  if (stats.sentBytes <= 0 || elapsedMs < 2000) return null;
  const rate = stats.sentBytes / elapsedMs;
  const leftMs = (stats.totalBytes - stats.sentBytes) / rate;
  if (leftMs < 1000) return null;
  const s = Math.round(leftMs / 1000);
  if (s < 60) return 'Less than a minute left';
  const m = Math.round(s / 60);
  if (m < 60) return `About ${m} minute${m === 1 ? '' : 's'} left`;
  const h = Math.round(m / 6) / 10;
  return `About ${h} hours left`;
}

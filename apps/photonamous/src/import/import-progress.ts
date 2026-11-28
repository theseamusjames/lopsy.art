/**
 * What the import strip shows, from an ImportProgress: its numbers, its
 * headline, and whether the import ended cleanly. Pure.
 */

import type { ImportItem, ImportProgress } from '@lopsy/photos-core/import/types';
import { formatBytes, plural } from './import-summary';

export interface ImportStats {
  readonly total: number;
  readonly done: number;
  readonly duplicates: number;
  readonly failed: readonly ImportItem[];
  /** Items that have stopped moving, whatever the outcome. */
  readonly settled: number;
  /** Items a pause left waiting for `resumeImports`. */
  readonly paused: number;
  /** Items Stop left out: not imported, not failed. */
  readonly stopped: number;
  /** Items the importer set aside after a failure, to try again (error "Waiting to retry: …"). */
  readonly waiting: readonly ImportItem[];
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
  let paused = 0;
  let stopped = 0;
  const waiting: ImportItem[] = [];
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
      case 'stopped':
        stopped++;
        sentBytes += item.byteSize;
        break;
      case 'verifying':
        sentBytes += item.byteSize;
        break;
      default:
        if (progress.finished && item.error === 'Paused') paused++;
        if (isWaitingToRetry(item)) waiting.push(item);
        sentBytes += Math.min(item.byteSize, item.sentBytes);
    }
  }
  const total = progress.items.length;
  return {
    total,
    done,
    duplicates,
    failed,
    settled: done + duplicates + failed.length + stopped,
    paused,
    stopped,
    waiting,
    totalBytes,
    sentBytes,
    fraction: totalBytes === 0 ? (progress.finished ? 1 : 0) : sentBytes / totalBytes,
  };
}

/** How an import stands, in counts. */
export interface ImportEnd {
  readonly finished: boolean;
  readonly failed: number;
  /** Items set aside to try again. */
  readonly waiting: number;
  /** Items a pause left to do. */
  readonly paused: number;
  /** Items Stop left out. */
  readonly stopped: number;
}

/**
 * Whether the import is over with nothing failed, nothing waiting to try
 * again and nothing paused. Its outcome is then a toast and the strip goes;
 * any other end keeps the strip, with Retry or Resume and what failed.
 */
export function endedCleanly(end: ImportEnd): boolean {
  return end.finished && end.failed === 0 && end.waiting === 0 && end.paused === 0 && end.stopped === 0;
}

/**
 * The strip's headline, and a clean import's toast: progress while it runs,
 * then its outcome, counting photos as the grid does (`pairHalves` JPEG
 * halves of RAW+JPEG pairs are files, not photos of their own).
 */
export function importHeadline(progress: ImportProgress, stats: ImportStats, pairHalves: number): string {
  if (progress.stopped && !progress.finished) return 'Stopping the import…';
  if (progress.stopped) return stoppedHeadline(stats, pairHalves);
  const waiting = stats.waiting.length;
  if (progress.finished && stats.paused > 0) return `Import paused · ${plural(stats.paused, 'photo')} still to go`;
  if (progress.finished && waiting > 0) return `Imported ${plural(stats.done, 'photo')} · ${plural(waiting, 'photo')} waiting to try again`;
  if (progress.finished) {
    const pairs = pairHalves > 0 ? ` (${plural(stats.done, 'file')}: RAW+JPEG pairs count once)` : '';
    const skipped = stats.duplicates > 0 ? `, skipped ${stats.duplicates} already in the library` : '';
    return `Imported ${plural(stats.done - pairHalves, 'photo')}${pairs}${skipped}`;
  }
  return `Importing ${stats.settled.toLocaleString()} of ${plural(stats.total, 'photo')} · ${formatBytes(stats.totalBytes - stats.sentBytes)} left`;
}

/** After Stop: what came in and what did not, and how to get the rest. */
export function stoppedHeadline(stats: ImportStats, pairHalves: number): string {
  const imported = stats.done - pairHalves + stats.duplicates;
  return `Import stopped: ${imported.toLocaleString('en-US')} of ${plural(stats.total - pairHalves, 'photo')} imported, ${stats.stopped.toLocaleString('en-US')} not. Choose the same photos again to import the rest.`;
}

/** The headline while the import waits for the person to reconnect (ImportProgress.needsSignIn). */
export function signInHeadline(stats: ImportStats): string {
  const left = stats.total - stats.settled;
  return `Reconnect to Google Drive to continue · ${left.toLocaleString('en-US')} of ${plural(stats.total, 'photo')} left`;
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

export const RETRY_NOTE_PREFIX = 'Waiting to retry';

/** An item the importer parked after a failure; it stays queued until a resume. */
export function isWaitingToRetry(item: ImportItem): boolean {
  return item.state === 'queued' && item.error !== null && item.error.startsWith(RETRY_NOTE_PREFIX);
}

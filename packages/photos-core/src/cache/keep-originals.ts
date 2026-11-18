/**
 * "Keep originals" on this device (spec 5.7, 6.7): how much of the
 * originals cache to keep, and for All, downloading every original in the
 * background.
 *
 * - recent (default): least recently used beyond min(20 GB, 30 % of the quota) goes first.
 * - all: every original, downloaded one at a time; it can be paused and it
 *   stops before the browser's storage quota.
 * - none: nothing beyond what is open (pinned) or just read.
 */

import type { StorageAdapter } from '../storage/types';
import { defaultOriginalsBudget, type OriginalRef, type OriginalsCache } from './originals-cache';

export type KeepOriginals = 'recent' | 'all' | 'none';

export const KEEP_ORIGINALS_DEFAULT: KeepOriginals = 'recent';

export function parseKeepOriginals(raw: string | null): KeepOriginals {
  return raw === 'all' || raw === 'none' ? raw : KEEP_ORIGINALS_DEFAULT;
}

export type StorageEstimate = () => Promise<{ usage?: number; quota?: number }>;

/** All stops while this share of the browser's quota would still be free. */
export const ALL_STOPS_AT_QUOTA_SHARE = 0.9;

function browserEstimate(): StorageEstimate | null {
  return typeof navigator !== 'undefined' && navigator.storage ? () => navigator.storage.estimate() : null;
}

/** The originals cache's budget for a mode. */
export async function budgetFor(mode: KeepOriginals, estimate: StorageEstimate | null = browserEstimate()): Promise<number> {
  if (mode === 'none') return 0;
  if (mode === 'recent') return defaultOriginalsBudget(estimate);
  return Number.POSITIVE_INFINITY;
}

export type DownloadState = 'running' | 'paused' | 'full' | 'done' | 'stopped';

export interface DownloadProgress {
  readonly state: DownloadState;
  /** Originals to keep, those already here included. */
  readonly total: number;
  /** Already on the device or downloaded. */
  readonly done: number;
  /** Failed this round; tried again on the next. */
  readonly failed: number;
  readonly downloadedBytes: number;
}

export interface OriginalsDownloadOptions {
  readonly originals: OriginalsCache;
  readonly adapter: StorageAdapter;
  /** The library's originals, read again on every round. */
  readonly list: () => readonly OriginalRef[];
  readonly estimate?: StorageEstimate | null;
}

/**
 * Downloads every original not yet on the device, one at a time, into the
 * originals cache. `pause` cancels the download in flight; `resume`
 * starts a new round, which skips what is already here.
 */
export class OriginalsDownload {
  private progress: DownloadProgress = { state: 'paused', total: 0, done: 0, failed: 0, downloadedBytes: 0 };
  private readonly listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private round: Promise<void> | null = null;
  private readonly estimate: StorageEstimate | null;

  constructor(private readonly options: OriginalsDownloadOptions) {
    this.estimate = options.estimate === undefined ? browserEstimate() : options.estimate;
  }

  getProgress(): DownloadProgress {
    return this.progress;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Starts (or restarts) a round. Resolves when it ends: done, paused, full or stopped. */
  resume(): Promise<void> {
    if (this.round) return this.round;
    const controller = new AbortController();
    this.controller = controller;
    const round = this.run(controller.signal).finally(() => {
      if (this.round === round) this.round = null;
    });
    this.round = round;
    return round;
  }

  pause(): void {
    this.end('paused');
  }

  /** For good: the mode changed or the library closed. */
  stop(): void {
    this.end('stopped');
  }

  private end(state: 'paused' | 'stopped'): void {
    this.controller?.abort();
    this.controller = null;
    if (this.progress.state === 'running' || state === 'stopped') this.set({ state });
  }

  private set(patch: Partial<DownloadProgress>): void {
    this.progress = { ...this.progress, ...patch };
    for (const listener of this.listeners) listener();
  }

  private async run(signal: AbortSignal): Promise<void> {
    const assets = [...this.options.list()];
    const cache = this.options.originals.cache;
    const missing: OriginalRef[] = [];
    for (const asset of assets) if (!(await cache.has(asset.sha256.toLowerCase()))) missing.push(asset);
    this.set({ state: 'running', total: assets.length, done: assets.length - missing.length, failed: 0, downloadedBytes: 0 });
    for (const asset of missing) {
      if (signal.aborted) return;
      if (!(await this.fits(asset.byteSize))) {
        this.set({ state: 'full' });
        return;
      }
      try {
        await this.options.originals.readOriginal(this.options.adapter, asset, { signal });
        this.set({ done: this.progress.done + 1, downloadedBytes: this.progress.downloadedBytes + asset.byteSize });
      } catch {
        if (signal.aborted) return;
        this.set({ failed: this.progress.failed + 1 });
      }
    }
    if (!signal.aborted) this.set({ state: 'done' });
  }

  private async fits(bytes: number): Promise<boolean> {
    if (!this.estimate) return true;
    try {
      const { usage, quota } = await this.estimate();
      if (usage === undefined || quota === undefined) return true;
      return usage + bytes <= quota * ALL_STOPS_AT_QUOTA_SHARE;
    } catch {
      return true;
    }
  }
}

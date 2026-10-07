/**
 * Scheduling and bookkeeping for the context-loss backup (#973), kept free
 * of the engine, the store and the DOM so it can be unit-tested; see
 * `gpu-layer-backup.ts` for the wiring.
 *
 * A backup *pass* reads every raster and text layer for one history key and,
 * only once every layer is in, *commits* as the backup a restore may use. A
 * pass in progress is never visible to restore: the last committed backup
 * stays in place until the new one is whole.
 *
 * Per layer, the last readback is kept with the layer's content stamp (the
 * engine's write generation and the texture size). A layer whose stamp is
 * unchanged on the same engine reuses its blob instead of being read again
 * (#1221), so a blur after a stroke on one layer re-reads only that layer.
 *
 * In `idle` mode (window blur) a pass reads one layer per idle callback, so
 * the event never blocks for the whole document; `pause` (window focus)
 * stops it, and an edit between slices abandons it — the stamps keep what
 * was read for the next pass. In `now` mode (tab hidden) the pass finishes
 * synchronously: the user isn't looking, and a hidden tab's timers may not
 * run.
 *
 * A document whose backup would exceed `maxBytes` is remembered as too large
 * for its history key, so leaving the window again without an edit reads
 * nothing (#1222). A new key is also skipped without a readback when the
 * known sizes of its unchanged layers alone already exceed the cap.
 */

import type { RasterLayer, TextLayer } from '../types';

export type BackupLayer = RasterLayer | TextLayer;

export interface LayerBackup {
  /** Null for a layer with no visible content. */
  readonly blob: Uint8Array | null;
  /** The layer as it was when the backup holding these pixels was taken. */
  readonly layer: BackupLayer;
}

export interface HistoryKey {
  readonly undoTop: unknown;
  readonly undoLength: number;
  readonly redoTop: unknown;
  readonly redoLength: number;
  readonly layers: unknown;
}

export interface BackupSet {
  readonly key: HistoryKey;
  readonly takenAt: number;
  readonly layers: ReadonlyMap<string, LayerBackup>;
}

/** What a layer texture holds, cheaply: equal stamps mean equal readbacks. */
export interface LayerStamp {
  /** The engine the texture lives in; generations restart with a new one. */
  readonly engine: object;
  /** 0 when the engine never saw the layer written. */
  readonly generation: number;
  readonly width: number;
  readonly height: number;
}

export interface LayerBackupDeps {
  isContextLost: () => boolean;
  /** Push pending JS pixel data to the GPU and refresh stale JS mask bytes. */
  prepare: () => void;
  historyKey: () => HistoryKey;
  /** The layers a backup holds, in document order. */
  backupLayers: () => readonly BackupLayer[];
  /** Null when the layer (or the engine) is gone. */
  stamp: (layerId: string) => LayerStamp | null;
  readBlob: (layerId: string) => Uint8Array | null;
  /** Run `callback` when the main thread is idle; returns a canceller. */
  scheduleIdle: (callback: () => void) => () => void;
  now: () => number;
  warn: (message: string) => void;
  maxBytes: () => number;
}

export type BackupMode = 'idle' | 'now';

export interface LayerBackupStats {
  /** Layer readbacks since the runner was created. */
  readonly reads: number;
  readonly committed: number;
  readonly tooLarge: number;
  readonly isPassPending: boolean;
}

export interface LayerBackupRunner {
  request: (mode: BackupMode) => void;
  pause: () => void;
  committed: () => BackupSet | null;
  stats: () => LayerBackupStats;
  reset: () => void;
}

export const TOO_LARGE_WARNING = '[Lopsy] document too large for a context-loss backup; skipped';

export function isSameHistoryKey(a: HistoryKey, b: HistoryKey): boolean {
  return a.undoTop === b.undoTop
    && a.undoLength === b.undoLength
    && a.redoTop === b.redoTop
    && a.redoLength === b.redoLength
    && a.layers === b.layers;
}

/**
 * Whether a readback taken at `prev` still describes the texture at `next`.
 * Generation 0 means the engine never reported a write, which proves
 * nothing, so such a layer is always read.
 */
export function isStampUnchanged(prev: LayerStamp | undefined, next: LayerStamp): boolean {
  if (!prev || next.generation === 0) return false;
  return prev.engine === next.engine
    && prev.generation === next.generation
    && prev.width === next.width
    && prev.height === next.height;
}

interface LayerRecord {
  readonly stamp: LayerStamp;
  readonly bytes: number;
  /** Undefined once dropped to free memory; `bytes` is still known. */
  readonly blob: Uint8Array | null | undefined;
}

/**
 * Bytes the backup is certain to need: the recorded sizes of layers whose
 * texture hasn't changed since. Changed or never-read layers count as zero,
 * so this never overstates the total.
 */
export function knownBackupBytes(
  layerIds: readonly string[],
  stampOf: (layerId: string) => LayerStamp | null,
  records: ReadonlyMap<string, { readonly stamp: LayerStamp; readonly bytes: number }>,
): number {
  let total = 0;
  for (const id of layerIds) {
    const record = records.get(id);
    const stamp = stampOf(id);
    if (record && stamp && isStampUnchanged(record.stamp, stamp)) total += record.bytes;
  }
  return total;
}

interface Pass {
  readonly key: HistoryKey;
  readonly layers: readonly BackupLayer[];
  next: number;
  totalBytes: number;
  readonly out: Map<string, LayerBackup>;
}

export function createLayerBackupRunner(deps: LayerBackupDeps): LayerBackupRunner {
  let committed: BackupSet | null = null;
  let tooLargeKey: HistoryKey | null = null;
  let pass: Pass | null = null;
  let cancelScheduled: (() => void) | null = null;
  const records = new Map<string, LayerRecord>();
  let reads = 0;
  let commits = 0;
  let tooLargeCount = 0;

  function unschedule(): void {
    cancelScheduled?.();
    cancelScheduled = null;
  }

  function markTooLarge(key: HistoryKey): void {
    deps.warn(TOO_LARGE_WARNING);
    tooLargeCount++;
    tooLargeKey = key;
    committed = null;
    pass = null;
    unschedule();
    for (const [id, record] of records) records.set(id, { ...record, blob: undefined });
  }

  function commit(done: Pass): void {
    committed = { key: done.key, takenAt: deps.now(), layers: done.out };
    commits++;
    tooLargeKey = null;
    pass = null;
    for (const id of records.keys()) {
      if (!done.out.has(id)) records.delete(id);
    }
  }

  function startPass(key: HistoryKey): Pass | null {
    const layers = deps.backupLayers();
    const known = knownBackupBytes(layers.map((l) => l.id), deps.stamp, records);
    if (known > deps.maxBytes()) {
      markTooLarge(key);
      return null;
    }
    return { key, layers, next: 0, totalBytes: 0, out: new Map() };
  }

  /** Back up one layer; returns whether that took a readback. */
  function backUpLayer(current: Pass, layer: BackupLayer): boolean {
    const stamp = deps.stamp(layer.id);
    const record = records.get(layer.id);
    let blob: Uint8Array | null;
    let bytes: number;
    let isRead = false;
    if (stamp && record && record.blob !== undefined && isStampUnchanged(record.stamp, stamp)) {
      blob = record.blob;
      bytes = record.bytes;
    } else {
      blob = deps.readBlob(layer.id);
      bytes = blob?.byteLength ?? 0;
      reads++;
      isRead = true;
      if (stamp) records.set(layer.id, { stamp, bytes, blob });
      else records.delete(layer.id);
    }
    current.totalBytes += bytes;
    current.out.set(layer.id, { blob, layer });
    return isRead;
  }

  /**
   * Advance `current` until it has done one readback (`isSliced`) or every
   * layer is in. Commits a finished pass; returns whether it is still open.
   */
  function advance(current: Pass, isSliced: boolean): boolean {
    while (current.next < current.layers.length) {
      const layer = current.layers[current.next];
      current.next++;
      if (!layer) continue;
      const isRead = backUpLayer(current, layer);
      if (current.totalBytes > deps.maxBytes()) {
        markTooLarge(current.key);
        return false;
      }
      if (isRead && isSliced && current.next < current.layers.length) return true;
    }
    commit(current);
    return false;
  }

  function scheduleSlice(): void {
    unschedule();
    cancelScheduled = deps.scheduleIdle(runSlice);
  }

  function runSlice(): void {
    cancelScheduled = null;
    const current = pass;
    if (!current) return;
    if (deps.isContextLost()) {
      pass = null;
      return;
    }
    deps.prepare();
    // The user came back and edited: this pass no longer describes the
    // document. What it read stays in the records for the next pass.
    if (!isSameHistoryKey(current.key, deps.historyKey())) {
      pass = null;
      return;
    }
    if (advance(current, true)) scheduleSlice();
  }

  function request(mode: BackupMode): void {
    unschedule();
    // A lost context reads back zeros: keep the last good backup.
    if (deps.isContextLost()) {
      pass = null;
      return;
    }
    deps.prepare();
    const key = deps.historyKey();
    if (committed && isSameHistoryKey(committed.key, key)) {
      pass = null;
      return;
    }
    if (tooLargeKey && isSameHistoryKey(tooLargeKey, key)) {
      pass = null;
      return;
    }
    if (!pass || !isSameHistoryKey(pass.key, key)) pass = startPass(key);
    const current = pass;
    if (!current) return;
    if (mode === 'now') {
      advance(current, false);
      return;
    }
    scheduleSlice();
  }

  return {
    request,
    pause: unschedule,
    committed: () => committed,
    stats: () => ({ reads, committed: commits, tooLarge: tooLargeCount, isPassPending: pass !== null }),
    reset: () => {
      unschedule();
      committed = null;
      tooLargeKey = null;
      pass = null;
      records.clear();
    },
  };
}

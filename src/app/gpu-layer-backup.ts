/**
 * CPU-side backup of raster and text layer pixels, so a WebGL context loss
 * doesn't wipe the document (#973). Text layers are backed up as rendered
 * pixels too: nothing re-renders them on the fresh engine, whose textures
 * start out 1×1, so skipping them left every live type layer blank (#1088).
 *
 * Layer pixels live only in GPU textures, and by the time
 * `webglcontextlost` fires there is nothing left to read. So the pixels are
 * read back *before* a loss can happen, at the moments the user is away:
 * when the tab is hidden or the window loses focus. Nothing is read when
 * the undo/redo stacks and layer list are unchanged since the last backup,
 * and only layers whose texture changed are read again (#1221); see
 * `layer-backup-runner.ts` for how the work is sliced and when it is
 * skipped. Undo itself stays GPU-only (no per-edit readback).
 *
 * After the context is restored, `restoreLayerBackup` re-uploads the backup
 * behind a loading overlay. Edits made after the last backup are lost.
 */

import { getEngine, getEngineCanvas } from '../engine-wasm/engine-state';
import { readLayerBackupBlob, readLayerContentStamp, uploadCompressed } from '../engine-wasm/gpu-pixel-access';
import { flushLayerSync } from '../engine-wasm/engine-sync';
import { useEditorStore } from './editor-store';
import { useUIStore } from './ui-store';
import { materializeAllMaskData } from './mask-data-sync';
import { clearJsPixelData } from './store/clear-js-pixel-data';
import { createLayerBackupRunner } from './layer-backup-runner';
import type {
  BackupLayer, BackupMode, HistoryKey, LayerBackup, LayerBackupStats, LayerStamp,
} from './layer-backup-runner';
import type { Layer } from '../types';

/** Above this the backup is skipped rather than held in memory. */
const MAX_BACKUP_BYTES = 512 * 1024 * 1024;

export const RESTORING_MESSAGE = 'Restoring your layers after a graphics reset…';

let maxBytesOverride: number | null = null;

function currentHistoryKey(): HistoryKey {
  const s = useEditorStore.getState();
  return {
    undoTop: s.undoStack[s.undoStack.length - 1],
    undoLength: s.undoStack.length,
    redoTop: s.redoStack[s.redoStack.length - 1],
    redoLength: s.redoStack.length,
    layers: s.document.layers,
  };
}

function isGpuContextLost(): boolean {
  const gl = getEngineCanvas()?.getContext('webgl2');
  return !gl || gl.isContextLost();
}

function backupLayers(): BackupLayer[] {
  return useEditorStore.getState().document.layers
    .filter((l): l is BackupLayer => l.type === 'raster' || l.type === 'text');
}

function layerStamp(layerId: string): LayerStamp | null {
  const engine = getEngine();
  const stamp = readLayerContentStamp(layerId);
  return engine && stamp ? { engine, ...stamp } : null;
}

function scheduleIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(callback, { timeout: 1000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, 0);
  return () => window.clearTimeout(handle);
}

const runner = createLayerBackupRunner({
  isContextLost: isGpuContextLost,
  prepare: () => {
    // Pending JS pixel data isn't on the GPU yet; masks live in JS and may
    // lag their GPU copy.
    flushLayerSync(useEditorStore.getState());
    materializeAllMaskData();
  },
  historyKey: currentHistoryKey,
  backupLayers,
  stamp: layerStamp,
  readBlob: readLayerBackupBlob,
  scheduleIdle,
  now: () => Date.now(),
  warn: (message) => console.warn(message),
  maxBytes: () => maxBytesOverride ?? MAX_BACKUP_BYTES,
});

/**
 * Bring the backup up to date. `idle` (window blur) reads one layer per idle
 * callback; `now` (tab hidden) finishes before returning. A lost context
 * reads back zeros, so nothing is read (and the last good backup is kept)
 * while the context is gone.
 */
export function backupLayersToCpu(mode: BackupMode): void {
  runner.request(mode);
}

/** The user is back: stop reading until they leave again. */
export function pauseLayerBackup(): void {
  runner.pause();
}

export function hasLayerBackup(): boolean {
  return runner.committed() !== null;
}

/** Time the current backup was taken, or null without one. */
export function layerBackupTime(): number | null {
  return runner.committed()?.takenAt ?? null;
}

/** Readback counters for the dev-only e2e hook. */
export function layerBackupStats(): LayerBackupStats {
  return runner.stats();
}

/** Dev-only: lower the backup cap so e2e tests can reach it; null restores it. */
export function setLayerBackupMaxBytesForTest(bytes: number | null): void {
  maxBytesOverride = bytes;
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/**
 * The layer to pair with its backed-up pixels. A raster layer moved or
 * resized since the backup goes back to the geometry its pixels had. A text
 * layer goes back to the model it had then: its x/y are the rendered
 * texture's top-left, and its text and type settings must describe the
 * restored glyphs, or the next re-render would place them elsewhere.
 */
export function layerForBackup(current: Layer, b: LayerBackup): Layer {
  if (current.type === 'text' && b.layer.type === 'text') return b.layer;
  if (current.type !== 'raster' || b.layer.type !== 'raster') return current;
  const { x, y, width, height } = b.layer;
  if (current.x === x && current.y === y && current.width === width && current.height === height) return current;
  return { ...current, x, y, width, height };
}

/**
 * Re-upload the last committed backup into a fresh engine after a context
 * restore, behind the loading overlay. A backup pass still in progress is
 * never used. Layers deleted since the backup are skipped, as is a layer
 * whose type changed since (its pixels no longer describe it); see
 * {@link layerForBackup} for edits made since. Returns the number of layers
 * restored.
 */
export async function restoreLayerBackup(): Promise<number> {
  const current = runner.committed();
  if (!current) return 0;
  const ui = useUIStore.getState();
  ui.openModal({ kind: 'loading', message: RESTORING_MESSAGE });
  try {
    await nextPaint();
    useEditorStore.setState((s) => ({
      document: {
        ...s.document,
        layers: s.document.layers.map((l) => {
          const b = current.layers.get(l.id);
          return b ? layerForBackup(l, b) : l;
        }),
      },
    }));
    // The new engine must know every layer before its texture is replaced.
    flushLayerSync(useEditorStore.getState());
    let restored = 0;
    const types = new Map(useEditorStore.getState().document.layers.map((l) => [l.id, l.type]));
    for (const [id, b] of current.layers) {
      if (types.get(id) !== b.layer.type || !b.blob) continue;
      uploadCompressed(id, b.blob);
      clearJsPixelData(id);
      restored++;
    }
    return restored;
  } finally {
    useUIStore.getState().closeModalOfKind('loading');
  }
}

/** Test-only: drop any backup. */
export function __resetLayerBackupForTest(): void {
  runner.reset();
}

/**
 * CPU-side backup of raster and text layer pixels, so a WebGL context loss
 * doesn't wipe the document (#973). Text layers are backed up as rendered
 * pixels too: nothing re-renders them on the fresh engine, whose textures
 * start out 1×1, so skipping them left every live type layer blank (#1088).
 *
 * Layer pixels live only in GPU textures, and by the time
 * `webglcontextlost` fires there is nothing left to read. So the pixels are
 * read back *before* a loss can happen, at the moments the user is away:
 * when the tab is hidden or the window loses focus. The readback is skipped
 * when nothing was edited since the previous backup — every pixel edit
 * pushes a history entry, so an unchanged undo/redo stack means unchanged
 * pixels. Undo itself stays GPU-only (no per-edit readback).
 *
 * After the context is restored, `restoreLayerBackup` re-uploads the backup
 * behind a loading overlay. Edits made after the last backup are lost.
 */

import { getEngineCanvas } from '../engine-wasm/engine-state';
import { readLayerBackupBlob, uploadCompressed } from '../engine-wasm/gpu-pixel-access';
import { flushLayerSync } from '../engine-wasm/engine-sync';
import { useEditorStore } from './editor-store';
import { useUIStore } from './ui-store';
import { materializeAllMaskData } from './mask-data-sync';
import { clearJsPixelData } from './store/clear-js-pixel-data';
import type { Layer, RasterLayer, TextLayer } from '../types';

/** Above this the backup is skipped rather than held in memory. */
const MAX_BACKUP_BYTES = 512 * 1024 * 1024;

export const RESTORING_MESSAGE = 'Restoring your layers after a graphics reset…';

export interface LayerBackup {
  /** Null for a layer with no visible content. */
  readonly blob: Uint8Array | null;
  /** The layer as it was when its pixels were read back. */
  readonly layer: RasterLayer | TextLayer;
}

export interface HistoryKey {
  readonly undoTop: unknown;
  readonly undoLength: number;
  readonly redoTop: unknown;
  readonly redoLength: number;
  readonly layers: unknown;
}

interface BackupSet {
  readonly key: HistoryKey;
  readonly takenAt: number;
  readonly layers: ReadonlyMap<string, LayerBackup>;
}

let backup: BackupSet | null = null;

export function isSameHistoryKey(a: HistoryKey, b: HistoryKey): boolean {
  return a.undoTop === b.undoTop
    && a.undoLength === b.undoLength
    && a.redoTop === b.redoTop
    && a.redoLength === b.redoLength
    && a.layers === b.layers;
}

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

/**
 * Read every raster layer back to the CPU, unless nothing changed since
 * the last backup. A lost context reads back zeros, so no backup is taken
 * (and the last good one is kept) while the context is gone.
 */
export function backupLayersToCpu(): void {
  if (isGpuContextLost()) return;
  const key = currentHistoryKey();
  if (backup && isSameHistoryKey(backup.key, key)) return;

  const state = useEditorStore.getState();
  // Pending JS pixel data isn't on the GPU yet; masks live in JS and may
  // lag their GPU copy.
  flushLayerSync(state);
  materializeAllMaskData();

  const layers = new Map<string, LayerBackup>();
  let totalBytes = 0;
  for (const layer of useEditorStore.getState().document.layers) {
    if (layer.type !== 'raster' && layer.type !== 'text') continue;
    const blob = readLayerBackupBlob(layer.id);
    totalBytes += blob?.byteLength ?? 0;
    if (totalBytes > MAX_BACKUP_BYTES) {
      console.warn('[Lopsy] document too large for a context-loss backup; skipped');
      backup = null;
      return;
    }
    layers.set(layer.id, { blob, layer });
  }
  backup = { key, takenAt: Date.now(), layers };
}

export function hasLayerBackup(): boolean {
  return backup !== null;
}

/** Time the current backup was taken, or null without one. */
export function layerBackupTime(): number | null {
  return backup?.takenAt ?? null;
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
 * Re-upload the backup into a fresh engine after a context restore, behind
 * the loading overlay. Layers deleted since the backup are skipped, as is a
 * layer whose type changed since (its pixels no longer describe it); see
 * {@link layerForBackup} for edits made since. Returns the number of layers
 * restored.
 */
export async function restoreLayerBackup(): Promise<number> {
  const current = backup;
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
  backup = null;
}

import { useEditorStore } from '../editor-store';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  filterInvert,
  filterDesaturate,
  filterAddNoise,
  filterFillWithNoise,
  filterFindEdges,
  saveFilterPreview,
  restoreFilterPreview,
  clearFilterPreview,
} from '../../engine-wasm/wasm-bridge';
import { readLayerCompressed, uploadCompressed } from '../../engine-wasm/gpu-pixel-access';
import { flushLayerSync } from '../../engine-wasm/engine-sync';
import { filterRegistry } from '../../filters/filter-registry';
import type { FilterDefinition } from '../../filters/filter-types';

export type FilterDialogId =
  | 'gaussian-blur'
  | 'box-blur'
  | 'unsharp-mask'
  | 'add-noise'
  | 'fill-noise'
  | 'brightness-contrast'
  | 'hue-saturation'
  | 'posterize'
  | 'threshold'
  | 'motion-blur'
  | 'radial-blur'
  | 'find-edges'
  | 'cel-shading'
  | 'clouds'
  | 'smoke'
  | 'pixelate'
  | 'halftone'
  | 'solarize'
  | 'kaleidoscope'
  | 'oil-paint'
  | 'chromatic-aberration'
  | 'pixel-stretch'
  | 'lens-distortion'
  | 'spherize'
  | 'bloom'
  | 'surface-blur'
  | 'pattern-fill'
  | 'emboss'
  | 'voronoi'
  | 'fibers';

function getActiveLayerId(): string | null {
  return useEditorStore.getState().document.activeLayerId;
}


export function getFilterDialogConfig(id: FilterDialogId): FilterDefinition | null {
  return filterRegistry[id] ?? null;
}

export function applyGenericFilter(id: FilterDialogId, values: Record<string, number>): void {
  const filter = filterRegistry[id];
  if (!filter) return;

  const activeId = getActiveLayerId();
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory(filter.title);
  filter.applyGpu(engine, activeId, values);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

/** Begin a filter preview session — saves the current layer GPU texture. */
export function beginFilterPreview(): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;
  // Ensure all layer data is synced to the GPU before saving the preview.
  // Without this, the engine may have stale/empty textures if no frame
  // has rendered since the last state change.
  const state = useEditorStore.getState();
  flushLayerSync(state);
  saveFilterPreview(engine, activeId);
}

/** Apply a filter for preview without pushing history. */
export function previewGenericFilter(id: FilterDialogId, values: Record<string, number>): void {
  const filter = filterRegistry[id];
  if (!filter) return;
  const activeId = getActiveLayerId();
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;

  // Restore original layer content before applying new preview
  restoreFilterPreview(engine);
  filter.applyGpu(engine, activeId, values);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

/** Cancel the filter preview and restore the original layer. */
export function cancelFilterPreviewSession(): void {
  const engine = getEngine();
  if (!engine) return;
  restoreFilterPreview(engine);
  clearFilterPreview(engine);
  const activeId = getActiveLayerId();
  if (activeId) {
    clearJsPixelData(activeId);
  }
  useEditorStore.getState().notifyRender();
}

/** Apply the filter for real, push history, and clean up the preview. */
export function applyGenericFilterWithPreview(id: FilterDialogId, values: Record<string, number>): void {
  const filter = filterRegistry[id];
  if (!filter) return;
  const activeId = getActiveLayerId();
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;

  // Snapshot the current GPU texture (the preview the user is looking at)
  // so we can restore it after capturing history from the original.
  const previewPixels = readLayerCompressed(activeId);

  // Restore original so history captures the unfiltered state
  restoreFilterPreview(engine);
  clearFilterPreview(engine);

  useEditorStore.getState().pushHistory(filter.title);

  if (previewPixels) {
    uploadCompressed(activeId, previewPixels);
  } else {
    filter.applyGpu(engine, activeId, values);
  }

  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function applyInvert(): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory('Invert');
  filterInvert(engine, activeId);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function applyDesaturate(): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory('Desaturate');
  filterDesaturate(engine, activeId);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function applyAddNoise(amount: number, monochrome: boolean): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory('Add Noise');
  filterAddNoise(engine, activeId, amount, monochrome);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function applyFillWithNoise(monochrome: boolean): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory('Fill with Noise');
  filterFillWithNoise(engine, activeId, monochrome);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function applyFindEdges(): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory('Find Edges');
  filterFindEdges(engine, activeId);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

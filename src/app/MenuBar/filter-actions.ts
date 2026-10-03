import { useEditorStore } from '../editor-store';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  filterInvert,
  filterDesaturate,
  filterFindEdges,
  saveFilterPreview,
  restoreFilterPreview,
  clearFilterPreview,
  type Engine,
} from '../../engine-wasm/wasm-bridge';
import { readLayerCompressed, uploadCompressed } from '../../engine-wasm/gpu-pixel-access';
import { flushLayerSync } from '../../engine-wasm/engine-sync';
import { filterRegistry } from '../../filters/filter-registry';
import type { FilterDefinition } from '../../filters/filter-types';
import { syncLayerAfterFullSize } from '../sync-layer-after-full-size';
import {
  isFilteringMask,
  markFilterTargetWritten,
  resolveFilterTarget,
  runOnFilterTarget,
  type FilterTarget,
} from './filter-target';

export type FilterDialogId =
  | 'gaussian-blur'
  | 'box-blur'
  | 'unsharp-mask'
  | 'add-noise'
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
  | 'bloom'
  | 'surface-blur'
  | 'pattern-fill'
  | 'emboss'
  | 'voronoi'
  | 'fibers'
  | 'sunburst'
  | 'color-lut';

export function getFilterDialogConfig(id: FilterDialogId): FilterDefinition | null {
  return filterRegistry[id] ?? null;
}

export function applyGenericFilter(id: FilterDialogId, values: Record<string, number>): void {
  const filter = filterRegistry[id];
  if (!filter) return;
  const target = resolveFilterTarget();
  if (!target) return;
  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory(filter.title);
  runOnFilterTarget(engine, target, () => filter.applyGpu(engine, target.layerId, values));
  markFilterTargetWritten(engine, target, true);
  useEditorStore.getState().notifyRender();
}

/** Begin a filter preview session — saves the current layer (or mask) GPU texture. */
export function beginFilterPreview(): void {
  const target = resolveFilterTarget();
  if (!target) return;
  const engine = getEngine();
  if (!engine) return;
  // Ensure all layer data is synced to the GPU before saving the preview.
  // Without this, the engine may have stale/empty textures if no frame
  // has rendered since the last state change.
  const state = useEditorStore.getState();
  flushLayerSync(state);
  runOnFilterTarget(engine, target, () => saveFilterPreview(engine, target.layerId));
  // saveFilterPreview calls ensure_layer_full_size on the WASM side to
  // guarantee the preview snapshot is doc-sized. Reconcile JS bounds so a
  // subsequent syncLayers push does not clobber the engine's expanded
  // descriptor with the pre-filter x/y/width/height (#771).
  if (!target.isMask) syncLayerAfterFullSize(engine, target.layerId);
}

/** Apply a filter for preview without pushing history. */
export function previewGenericFilter(id: FilterDialogId, values: Record<string, number>): void {
  const filter = filterRegistry[id];
  if (!filter) return;
  const target = resolveFilterTarget();
  if (!target) return;
  const engine = getEngine();
  if (!engine) return;

  // Restore original layer content before applying new preview
  runOnFilterTarget(engine, target, () => {
    restoreFilterPreview(engine);
    filter.applyGpu(engine, target.layerId, values);
  });
  markFilterTargetWritten(engine, target, false);
  useEditorStore.getState().notifyRender();
}

/** Cancel the filter preview and restore the original layer. */
export function cancelFilterPreviewSession(): void {
  const engine = getEngine();
  if (!engine) return;
  const activeId = useEditorStore.getState().document.activeLayerId;
  const target: FilterTarget | null = activeId ? { layerId: activeId, isMask: isFilteringMask() } : null;
  if (target) runOnFilterTarget(engine, target, () => restoreFilterPreview(engine));
  else restoreFilterPreview(engine);
  clearFilterPreview(engine);
  if (target?.isMask) markFilterTargetWritten(engine, target, true);
  else if (target) clearJsPixelData(target.layerId);
  useEditorStore.getState().notifyRender();
}

/** Apply the filter for real, push history, and clean up the preview. */
export function applyGenericFilterWithPreview(id: FilterDialogId, values: Record<string, number>): void {
  const filter = filterRegistry[id];
  if (!filter) return;
  const target = resolveFilterTarget();
  if (!target) return;
  const engine = getEngine();
  if (!engine) return;

  // Snapshot the current GPU texture (the preview the user is looking at)
  // so we can restore it after capturing history from the original, then
  // restore the original so history captures the unfiltered state.
  let previewPixels: Uint8Array | null = null;
  runOnFilterTarget(engine, target, () => {
    previewPixels = readLayerCompressed(target.layerId);
    restoreFilterPreview(engine);
  });
  clearFilterPreview(engine);

  useEditorStore.getState().pushHistory(filter.title);

  runOnFilterTarget(engine, target, () => {
    if (previewPixels) {
      uploadCompressed(target.layerId, previewPixels);
    } else {
      filter.applyGpu(engine, target.layerId, values);
    }
  });
  markFilterTargetWritten(engine, target, true);
  useEditorStore.getState().notifyRender();
}

function applyInstantFilter(label: string, run: (engine: Engine, layerId: string) => void): void {
  const target = resolveFilterTarget();
  if (!target) return;
  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory(label);
  runOnFilterTarget(engine, target, () => run(engine, target.layerId));
  markFilterTargetWritten(engine, target, true);
  useEditorStore.getState().notifyRender();
}

export function applyInvert(): void {
  applyInstantFilter('Invert', filterInvert);
}

export function applyDesaturate(): void {
  applyInstantFilter('Desaturate', filterDesaturate);
}

export function applyFindEdges(): void {
  applyInstantFilter('Find Edges', filterFindEdges);
}

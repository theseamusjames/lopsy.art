import { useEditorStore } from '../editor-store';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  filterColorLut,
  saveFilterPreview,
  restoreFilterPreview,
  clearFilterPreview,
} from '../../engine-wasm/wasm-bridge';
import { readLayerCompressed, uploadCompressed } from '../../engine-wasm/gpu-pixel-access';
import { flushLayerSync } from '../../engine-wasm/engine-sync';
import { syncLayerAfterFullSize } from '../sync-layer-after-full-size';
import type { LutPreset } from '../../filters/color-lut';
import {
  isFilteringMask,
  markFilterTargetWritten,
  runOnFilterTarget,
  type FilterTarget,
} from './filter-target';

function getFilterTarget(): FilterTarget | null {
  const activeId = useEditorStore.getState().document.activeLayerId;
  return activeId ? { layerId: activeId, isMask: isFilteringMask() } : null;
}

export function beginColorLutPreview(): void {
  const target = getFilterTarget();
  if (!target) return;
  const engine = getEngine();
  if (!engine) return;
  const state = useEditorStore.getState();
  flushLayerSync(state);
  runOnFilterTarget(engine, target, () => saveFilterPreview(engine, target.layerId));
  // saveFilterPreview expands the layer texture to doc size — reconcile
  // JS bounds so the next syncLayers push does not clobber it (#771).
  if (!target.isMask) syncLayerAfterFullSize(engine, target.layerId);
}

export function previewColorLut(preset: LutPreset, intensity: number): void {
  const target = getFilterTarget();
  if (!target) return;
  const engine = getEngine();
  if (!engine) return;

  runOnFilterTarget(engine, target, () => {
    restoreFilterPreview(engine);
    filterColorLut(engine, target.layerId, preset.data, preset.size, intensity);
  });
  markFilterTargetWritten(engine, target, false);
  useEditorStore.getState().notifyRender();
}

export function cancelColorLutPreview(): void {
  const engine = getEngine();
  if (!engine) return;
  const target = getFilterTarget();
  if (target) runOnFilterTarget(engine, target, () => restoreFilterPreview(engine));
  else restoreFilterPreview(engine);
  clearFilterPreview(engine);
  if (target?.isMask) markFilterTargetWritten(engine, target, true);
  else if (target) clearJsPixelData(target.layerId);
  useEditorStore.getState().notifyRender();
}

export function applyColorLut(preset: LutPreset, intensity: number): void {
  const target = getFilterTarget();
  if (!target) return;
  const engine = getEngine();
  if (!engine) return;

  let previewPixels: Uint8Array | null = null;
  runOnFilterTarget(engine, target, () => {
    previewPixels = readLayerCompressed(target.layerId);
    restoreFilterPreview(engine);
  });
  clearFilterPreview(engine);

  useEditorStore.getState().pushHistory('Color LUT');

  runOnFilterTarget(engine, target, () => {
    if (previewPixels) {
      uploadCompressed(target.layerId, previewPixels);
    } else {
      filterColorLut(engine, target.layerId, preset.data, preset.size, intensity);
    }
  });
  markFilterTargetWritten(engine, target, true);
  useEditorStore.getState().notifyRender();
}

export function applyColorLutDirect(preset: LutPreset, intensity: number): void {
  const target = getFilterTarget();
  if (!target) return;
  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory('Color LUT');
  runOnFilterTarget(engine, target, () => {
    filterColorLut(engine, target.layerId, preset.data, preset.size, intensity);
  });
  markFilterTargetWritten(engine, target, true);
  useEditorStore.getState().notifyRender();
}

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
import { syncLayerBoundsAfterFilter, syncAndClearLayerAfterFilter } from './filter-layer-sync';
import type { LutPreset } from '../../filters/color-lut';

function getActiveLayerId(): string | null {
  return useEditorStore.getState().document.activeLayerId;
}

export function beginColorLutPreview(): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;
  const state = useEditorStore.getState();
  flushLayerSync(state);
  saveFilterPreview(engine, activeId);
  syncLayerBoundsAfterFilter(engine, activeId);
}

export function previewColorLut(preset: LutPreset, intensity: number): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;

  restoreFilterPreview(engine);
  filterColorLut(engine, activeId, preset.data, preset.size, intensity);
  syncAndClearLayerAfterFilter(engine, activeId);
  useEditorStore.getState().notifyRender();
}

export function cancelColorLutPreview(): void {
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

export function applyColorLut(preset: LutPreset, intensity: number): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;

  const previewPixels = readLayerCompressed(activeId);

  restoreFilterPreview(engine);
  clearFilterPreview(engine);

  useEditorStore.getState().pushHistory('Color LUT');

  if (previewPixels) {
    uploadCompressed(activeId, previewPixels);
  } else {
    filterColorLut(engine, activeId, preset.data, preset.size, intensity);
  }

  syncAndClearLayerAfterFilter(engine, activeId);
  useEditorStore.getState().notifyRender();
}

export function applyColorLutDirect(preset: LutPreset, intensity: number): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory('Color LUT');
  filterColorLut(engine, activeId, preset.data, preset.size, intensity);
  syncAndClearLayerAfterFilter(engine, activeId);
  useEditorStore.getState().notifyRender();
}

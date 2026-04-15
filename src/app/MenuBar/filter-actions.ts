import { useEditorStore } from '../editor-store';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  filterInvert,
  filterDesaturate,
  filterAddNoise,
  filterFillWithNoise,
  filterFindEdges,
  filterGradientMap,
  saveFilterPreview,
  restoreFilterPreview,
  clearFilterPreview,
} from '../../engine-wasm/wasm-bridge';
import type { GradientPreset } from '../../components/FilterDialog/GradientMapDialog';
import { filterRegistry } from './filters';
import type { FilterDefinition } from './filters';

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
  | 'gradient-map';

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

  useEditorStore.getState().pushHistory();
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

  // Restore original first so history captures the unfiltered state
  restoreFilterPreview(engine);
  clearFilterPreview(engine);

  // Now apply for real with history
  useEditorStore.getState().pushHistory();
  filter.applyGpu(engine, activeId, values);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function applyInvert(): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory();
  filterInvert(engine, activeId);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function applyDesaturate(): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory();
  filterDesaturate(engine, activeId);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function applyAddNoise(amount: number, monochrome: boolean): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory();
  filterAddNoise(engine, activeId, amount, monochrome);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function applyFillWithNoise(monochrome: boolean): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory();
  filterFillWithNoise(engine, activeId, monochrome);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function applyFindEdges(): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory();
  filterFindEdges(engine, activeId);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

function applyGradientMapToEngine(
  engine: NonNullable<ReturnType<typeof getEngine>>,
  layerId: string,
  preset: GradientPreset,
  mix: number,
): void {
  const positions = new Float32Array(preset.stops.map((s) => s.position));
  const r = new Float32Array(preset.stops.map((s) => s.color[0]));
  const g = new Float32Array(preset.stops.map((s) => s.color[1]));
  const b = new Float32Array(preset.stops.map((s) => s.color[2]));
  const a = new Float32Array(preset.stops.map((s) => s.color[3]));
  filterGradientMap(engine, layerId, preset.stops.length, positions, r, g, b, a, mix);
}

export function applyGradientMap(preset: GradientPreset, mix: number): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory();
  applyGradientMapToEngine(engine, activeId, preset, mix);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function previewGradientMap(preset: GradientPreset, mix: number): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;

  restoreFilterPreview(engine);
  applyGradientMapToEngine(engine, activeId, preset, mix);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function applyGradientMapWithPreview(preset: GradientPreset, mix: number): void {
  const activeId = getActiveLayerId();
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;

  restoreFilterPreview(engine);
  clearFilterPreview(engine);

  useEditorStore.getState().pushHistory();
  applyGradientMapToEngine(engine, activeId, preset, mix);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

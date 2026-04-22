import { useEditorStore } from '../editor-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { readLayerPixels, getLayerTextureDimensions, filterPatternFill, saveFilterPreview, restoreFilterPreview, clearFilterPreview } from '../../engine-wasm/wasm-bridge';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { usePatternStore, generateThumbnail } from '../pattern-store';
import type { PatternDefinition } from '../pattern-store';

let patternCounter = 0;

export function definePattern(): void {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  let dims: Uint32Array;
  try {
    dims = getLayerTextureDimensions(engine, activeId);
  } catch {
    return;
  }
  const width = dims[0] ?? 0;
  const height = dims[1] ?? 0;
  if (width === 0 || height === 0) return;

  const pixels = readLayerPixels(engine, activeId);
  if (!pixels || pixels.length === 0) return;

  const data = new Uint8Array(pixels);
  const thumbnail = generateThumbnail(data, width, height);
  patternCounter++;

  const pattern: PatternDefinition = {
    id: `pattern-${Date.now()}-${patternCounter}`,
    name: `Pattern ${patternCounter}`,
    width,
    height,
    data,
    thumbnail,
  };

  usePatternStore.getState().addPattern(pattern);
}

export function applyPatternFill(patternId: string, scale: number, offsetX: number, offsetY: number): void {
  const pattern = usePatternStore.getState().patterns.find((p) => p.id === patternId);
  if (!pattern) return;

  const activeId = useEditorStore.getState().document.activeLayerId;
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory();
  filterPatternFill(
    engine,
    activeId,
    pattern.data,
    pattern.width,
    pattern.height,
    scale / 100,
    offsetX / 100,
    offsetY / 100,
  );
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function beginPatternPreview(): void {
  const activeId = useEditorStore.getState().document.activeLayerId;
  if (!activeId) return;
  const engine = getEngine();
  if (!engine) return;
  saveFilterPreview(engine, activeId);
}

export function previewPatternFill(patternId: string, scale: number, offsetX: number, offsetY: number): void {
  const pattern = usePatternStore.getState().patterns.find((p) => p.id === patternId);
  if (!pattern) return;

  const activeId = useEditorStore.getState().document.activeLayerId;
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  restoreFilterPreview(engine);
  filterPatternFill(
    engine,
    activeId,
    pattern.data,
    pattern.width,
    pattern.height,
    scale / 100,
    offsetX / 100,
    offsetY / 100,
  );
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function cancelPatternPreview(): void {
  const engine = getEngine();
  if (!engine) return;
  restoreFilterPreview(engine);
  clearFilterPreview(engine);
  const activeId = useEditorStore.getState().document.activeLayerId;
  if (activeId) {
    clearJsPixelData(activeId);
  }
  useEditorStore.getState().notifyRender();
}

export function applyPatternFillWithPreview(patternId: string, scale: number, offsetX: number, offsetY: number): void {
  const pattern = usePatternStore.getState().patterns.find((p) => p.id === patternId);
  if (!pattern) return;

  const activeId = useEditorStore.getState().document.activeLayerId;
  if (!activeId) return;

  const engine = getEngine();
  if (!engine) return;

  restoreFilterPreview(engine);
  clearFilterPreview(engine);

  useEditorStore.getState().pushHistory();
  filterPatternFill(
    engine,
    activeId,
    pattern.data,
    pattern.width,
    pattern.height,
    scale / 100,
    offsetX / 100,
    offsetY / 100,
  );
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

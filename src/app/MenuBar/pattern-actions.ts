import { useEditorStore } from '../editor-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { readLayerPixels, getLayerTextureDimensions, getLayerEngineBounds, filterPatternFill, saveFilterPreview, restoreFilterPreview, clearFilterPreview } from '../../engine-wasm/wasm-bridge';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { usePatternStore, generateThumbnail } from '../pattern-store';
import { syncLayerAfterFullSize } from '../sync-layer-after-full-size';
import type { PatternDefinition, PatternFillSettings } from '../pattern-store';
import { extractSelectionPattern } from './pattern-extract';
import { guardPixelWrite } from '../../layers/paint-target';
import type { Layer } from '../../types';

let patternCounter = 0;

function findActiveLayer(): Layer | undefined {
  const st = useEditorStore.getState();
  const id = st.document.activeLayerId;
  if (!id) return undefined;
  return st.document.layers.find((l) => l.id === id);
}

export function definePattern(): void {
  const state = useEditorStore.getState();
  const activeId = state.document.activeLayerId;
  if (!activeId) return;

  // Reading from a group layer produces the zero/1x1 texture path already,
  // but text layers have a texture that will be wiped by the next re-render
  // — treat the same as any other pixel-read on those types.
  if (!guardPixelWrite(findActiveLayer())) return;

  const engine = getEngine();
  if (!engine) return;

  let dims: Uint32Array;
  try {
    dims = getLayerTextureDimensions(engine, activeId);
  } catch {
    return;
  }
  const layerW = dims[0] ?? 0;
  const layerH = dims[1] ?? 0;
  if (layerW === 0 || layerH === 0) return;

  const pixels = readLayerPixels(engine, activeId);
  if (!pixels || pixels.length === 0) return;

  const { selection } = state;
  let data: Uint8Array;
  let width: number;
  let height: number;

  if (selection.active && selection.bounds && selection.mask) {
    const [texX = 0, texY = 0] = getLayerEngineBounds(engine, activeId);
    const extracted = extractSelectionPattern(
      { pixels, x: texX, y: texY, width: layerW, height: layerH },
      { bounds: selection.bounds, mask: selection.mask, maskWidth: selection.maskWidth, maskHeight: selection.maskHeight },
      state.document.width,
      state.document.height,
    );
    if (!extracted) return;
    ({ data, width, height } = extracted);
  } else {
    data = new Uint8Array(pixels);
    width = layerW;
    height = layerH;
  }

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

function runPatternFill(
  engine: NonNullable<ReturnType<typeof getEngine>>,
  layerId: string,
  pattern: PatternDefinition,
  settings: PatternFillSettings,
): void {
  filterPatternFill(
    engine,
    layerId,
    pattern.data,
    pattern.width,
    pattern.height,
    settings.scale / 100,
    settings.rowStagger / 100,
    settings.columnStagger / 100,
    settings.offsetX / 100,
    settings.offsetY / 100,
  );
}

export function applyPatternFill(patternId: string, settings: PatternFillSettings): void {
  const pattern = usePatternStore.getState().patterns.find((p) => p.id === patternId);
  if (!pattern) return;

  const activeId = useEditorStore.getState().document.activeLayerId;
  if (!activeId) return;

  if (!guardPixelWrite(findActiveLayer())) return;

  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory('Pattern Fill');
  runPatternFill(engine, activeId, pattern, settings);
  syncLayerAfterFullSize(engine, activeId);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

export function beginPatternPreview(): void {
  const activeId = useEditorStore.getState().document.activeLayerId;
  if (!activeId) return;
  if (!guardPixelWrite(findActiveLayer())) return;
  const engine = getEngine();
  if (!engine) return;
  saveFilterPreview(engine, activeId);
  // saveFilterPreview expands the layer texture to doc size — reconcile
  // JS bounds so the next syncLayers push does not clobber it (#771).
  syncLayerAfterFullSize(engine, activeId);
}

export function previewPatternFill(patternId: string, settings: PatternFillSettings): void {
  const pattern = usePatternStore.getState().patterns.find((p) => p.id === patternId);
  if (!pattern) return;

  const activeId = useEditorStore.getState().document.activeLayerId;
  if (!activeId) return;

  if (!guardPixelWrite(findActiveLayer())) return;

  const engine = getEngine();
  if (!engine) return;

  restoreFilterPreview(engine);
  runPatternFill(engine, activeId, pattern, settings);
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

export function applyPatternFillWithPreview(patternId: string, settings: PatternFillSettings): void {
  const pattern = usePatternStore.getState().patterns.find((p) => p.id === patternId);
  if (!pattern) return;

  const activeId = useEditorStore.getState().document.activeLayerId;
  if (!activeId) return;

  if (!guardPixelWrite(findActiveLayer())) return;

  const engine = getEngine();
  if (!engine) return;

  restoreFilterPreview(engine);
  clearFilterPreview(engine);

  useEditorStore.getState().pushHistory('Pattern Fill');
  runPatternFill(engine, activeId, pattern, settings);
  syncLayerAfterFullSize(engine, activeId);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

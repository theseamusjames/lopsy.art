import { useEditorStore } from '../editor-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { readLayerPixels, getLayerTextureDimensions, filterPatternFill, saveFilterPreview, restoreFilterPreview, clearFilterPreview } from '../../engine-wasm/wasm-bridge';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import { usePatternStore, generateThumbnail } from '../pattern-store';
import { syncLayerAfterFullSize } from '../sync-layer-after-full-size';
import type { PatternDefinition } from '../pattern-store';
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
    const { bounds, mask, maskWidth, maskHeight } = selection;
    const x0 = Math.max(0, Math.round(bounds.x));
    const y0 = Math.max(0, Math.round(bounds.y));
    const x1 = Math.min(layerW, Math.round(bounds.x + bounds.width));
    const y1 = Math.min(layerH, Math.round(bounds.y + bounds.height));
    width = x1 - x0;
    height = y1 - y0;
    if (width <= 0 || height <= 0) return;

    data = new Uint8Array(width * height * 4);
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const srcX = x0 + col;
        const srcY = y0 + row;
        const srcIdx = (srcY * layerW + srcX) * 4;
        const dstIdx = (row * width + col) * 4;

        let maskVal = 0;
        if (srcX >= 0 && srcX < maskWidth && srcY >= 0 && srcY < maskHeight) {
          maskVal = (mask[srcY * maskWidth + srcX] ?? 0) / 255;
        }

        data[dstIdx] = pixels[srcIdx] ?? 0;
        data[dstIdx + 1] = pixels[srcIdx + 1] ?? 0;
        data[dstIdx + 2] = pixels[srcIdx + 2] ?? 0;
        data[dstIdx + 3] = Math.round((pixels[srcIdx + 3] ?? 0) * maskVal);
      }
    }
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

export function applyPatternFill(patternId: string, scale: number, offsetX: number, offsetY: number): void {
  const pattern = usePatternStore.getState().patterns.find((p) => p.id === patternId);
  if (!pattern) return;

  const activeId = useEditorStore.getState().document.activeLayerId;
  if (!activeId) return;

  if (!guardPixelWrite(findActiveLayer())) return;

  const engine = getEngine();
  if (!engine) return;

  useEditorStore.getState().pushHistory('Pattern Fill');
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

export function previewPatternFill(patternId: string, scale: number, offsetX: number, offsetY: number): void {
  const pattern = usePatternStore.getState().patterns.find((p) => p.id === patternId);
  if (!pattern) return;

  const activeId = useEditorStore.getState().document.activeLayerId;
  if (!activeId) return;

  if (!guardPixelWrite(findActiveLayer())) return;

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

  if (!guardPixelWrite(findActiveLayer())) return;

  const engine = getEngine();
  if (!engine) return;

  restoreFilterPreview(engine);
  clearFilterPreview(engine);

  useEditorStore.getState().pushHistory('Pattern Fill');
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
  syncLayerAfterFullSize(engine, activeId);
  clearJsPixelData(activeId);
  useEditorStore.getState().notifyRender();
}

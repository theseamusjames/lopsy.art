import type { InteractionContext } from '../../app/interactions/interaction-types';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { clearJsPixelData } from '../../app/store/clear-js-pixel-data';
import { getEngine } from '../../engine-wasm/engine-state';
import { flushLayerSync } from '../../engine-wasm/engine-sync';
import {
  floodFill as wasmFloodFill,
  applyFillToLayer as wasmApplyFillToLayer,
  readLayerPixelsForFill as wasmReadLayerPixelsForFill,
  fillQuickMask as wasmFillQuickMask,
  fillMask as wasmFillMask,
  uploadLayerMask,
  readMaskTexture,
} from '../../engine-wasm/wasm-bridge';

/** Down handler for the bucket fill tool. Flood-fills from the click point,
 *  intersected with any active selection, and uploads to the GPU. */
export function handleFillDown(ctx: InteractionContext): void {
  const { layerPos, canvasPos, activeLayerId } = ctx;
  const editorState = useEditorStore.getState();
  const isQuickMaskMode = useUIStore.getState().maskMode === 'quickMask';

  // In quick mask mode: fill the quick mask texture instead of the layer
  if (isQuickMaskMode) {
    editorState.pushHistory('Quick Mask Fill');
    const toolSettings = useToolSettingsStore.getState();
    const tolerance = toolSettings.fillTolerance;
    const contiguous = toolSettings.fillContiguous;

    const engine = getEngine();
    if (!engine) return;

    const startX = Math.round(canvasPos.x);
    const startY = Math.round(canvasPos.y);

    wasmFillQuickMask(engine, startX, startY, tolerance, contiguous, 0);
    editorState.notifyRender();
    return;
  }

  // Mask edit mode: fill the layer mask texture
  const maskEditMode = useUIStore.getState().maskMode === 'layerMask';
  const maskLayer = editorState.document.layers.find((l) => l.id === activeLayerId);
  if (maskEditMode && maskLayer?.mask) {
    editorState.pushHistory('Mask Fill');
    const toolSettings = useToolSettingsStore.getState();
    const tolerance = toolSettings.fillTolerance;
    const contiguous = toolSettings.fillContiguous;

    const engine = getEngine();
    if (!engine) return;

    const maskBytes = new Uint8Array(maskLayer.mask.data.buffer, maskLayer.mask.data.byteOffset, maskLayer.mask.data.byteLength);
    uploadLayerMask(engine, activeLayerId, maskBytes, maskLayer.mask.width, maskLayer.mask.height);

    const startX = Math.round(layerPos.x);
    const startY = Math.round(layerPos.y);

    // mode 1 = fill black (hide), matching brush behavior
    wasmFillMask(engine, activeLayerId, startX, startY, tolerance, contiguous, 1);

    const maskData = readMaskTexture(engine, activeLayerId);
    if (maskData) {
      editorState.updateLayerMaskData(activeLayerId, new Uint8ClampedArray(maskData));
    }
    editorState.notifyRender();
    return;
  }

  // Normal mode: fill the active layer
  editorState.pushHistory('Bucket Fill');
  const toolSettings = useToolSettingsStore.getState();
  const color = toolSettings.foregroundColor;
  toolSettings.addRecentColor(color);
  const tolerance = toolSettings.fillTolerance;
  const contiguous = toolSettings.fillContiguous;

  const engine = getEngine();
  if (!engine) return;

  flushLayerSync(editorState);
  const { width: docW, height: docH } = editorState.document;
  const layer = editorState.document.layers.find((l) => l.id === activeLayerId);
  const canvasX = Math.round(layerPos.x + (layer?.x ?? 0));
  const canvasY = Math.round(layerPos.y + (layer?.y ?? 0));

  const { selection } = editorState;
  if (selection.active && selection.mask) {
    const idx = canvasY * docW + canvasX;
    if (idx >= 0 && idx < selection.mask.length && (selection.mask[idx] ?? 0) < 1) {
      return;
    }
  }

  const pixelData = wasmReadLayerPixelsForFill(engine, activeLayerId);
  const fillMask = wasmFloodFill(
    pixelData, docW, docH,
    canvasX, canvasY,
    color.r, color.g, color.b, Math.round(color.a * 255),
    tolerance, contiguous,
  );

  if (selection.active && selection.mask) {
    const selMask = selection.mask;
    for (let i = 0; i < fillMask.length && i < selMask.length; i++) {
      fillMask[i] = Math.round((fillMask[i]! * (selMask[i] ?? 0)) / 255);
    }
  }

  wasmApplyFillToLayer(
    engine, activeLayerId,
    color.r / 255, color.g / 255, color.b / 255, color.a,
    fillMask, docW, docH,
  );
  clearJsPixelData(activeLayerId);
  editorState.notifyRender();
}

import type { InteractionContext } from '../../app/interactions/interaction-types';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { clearJsPixelData } from '../../app/store/clear-js-pixel-data';
import { pixelDataManager } from '../../engine/pixel-data-manager';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  floodFill as wasmFloodFill,
  applyFillToLayer as wasmApplyFillToLayer,
  readLayerPixelsForFill as wasmReadLayerPixelsForFill,
  bucketFillSolid as wasmBucketFillSolid,
  bucketFillByColorGpu as wasmBucketFillByColorGpu,
  getLayerTextureDimensions,
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
    const { tolerance, contiguous } = toolSettings.settings.fill;

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
    const { tolerance, contiguous } = toolSettings.settings.fill;

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
  const { tolerance, contiguous } = toolSettings.settings.fill;

  const engine = getEngine();
  if (!engine) return;

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
  const selMaskBytes = (selection.active && selection.mask)
    ? new Uint8Array(selection.mask.buffer, selection.mask.byteOffset, selection.mask.byteLength)
    : null;
  const selW = selection.active ? selection.maskWidth : 0;
  const selH = selection.active ? selection.maskHeight : 0;

  // #667 fast path — empty layer + no JS pixel data yet means the GPU
  // texture is still lazy (1x1) or hasn't been painted since alloc. The
  // flood fill would cover everything regardless of contiguous/tolerance,
  // so skip the readback + CPU flood + mask upload roundtrip entirely.
  if (isLayerEffectivelyEmpty(engine, activeLayerId)) {
    wasmBucketFillSolid(
      engine, activeLayerId,
      color.r / 255, color.g / 255, color.b / 255, color.a,
      selMaskBytes ?? undefined, selW, selH,
    );
    clearJsPixelData(activeLayerId);
    editorState.notifyRender();
    return;
  }

  // #667 fast path — non-contiguous fill ("fill by color") is a pure
  // per-pixel color-match. Run it as a single shader pass instead of
  // reading 80MB back to JS + walking every pixel on CPU.
  if (!contiguous) {
    wasmBucketFillByColorGpu(
      engine, activeLayerId,
      canvasX, canvasY,
      color.r / 255, color.g / 255, color.b / 255, color.a,
      tolerance / 255,
      selMaskBytes ?? undefined, selW, selH,
    );
    clearJsPixelData(activeLayerId);
    editorState.notifyRender();
    return;
  }

  // Contiguous fill: BFS is sequential — still runs on CPU via the
  // WASM flood-fill routine — but we compose the result on GPU.
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

/**
 * True when the layer has no committed content — its GPU texture is still
 * the lazy 1x1 placeholder and there's no JS pixel buffer waiting to sync.
 * Both conditions matter: a freshly-added layer has 1x1 GPU + no JS data;
 * a layer that was cleared retains a doc-sized (all-transparent) texture.
 */
function isLayerEffectivelyEmpty(
  engine: ReturnType<typeof getEngine>,
  layerId: string,
): boolean {
  if (!engine) return false;
  const dims = getLayerTextureDimensions(engine, layerId);
  const w = dims[0] ?? 0;
  const h = dims[1] ?? 0;
  if (w > 1 || h > 1) return false;
  if (pixelDataManager.get(layerId)) return false;
  if (pixelDataManager.getSparse(layerId)) return false;
  return true;
}

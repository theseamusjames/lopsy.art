/**
 * Liquify tool actions — open/close the session and commit/cancel the warp.
 *
 * The design matches the mesh-warp pattern: we read GPU pixel data on open,
 * accumulate warp in JS (displacement map), render a preview via an offscreen
 * canvas, and on Apply we upload the final warped pixels to the GPU layer.
 */

import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { readLayerAsImageData, clearFrameCache } from '../../engine-wasm/gpu-pixel-access';
import { getEngine } from '../../engine-wasm/engine-state';
import { uploadLayerPixels } from '../../engine-wasm/wasm-bridge';
import { clearJsPixelData } from '../store/clear-js-pixel-data';
import {
  createDisplacementMap,
  renderWarp,
  defaultLiquifySettings,
} from '../../tools/liquify/liquify';
import type { LiquifySession } from '../ui-store';

/**
 * Open a Liquify session on the active layer.
 * Snapshots the GPU pixels and initialises a zeroed displacement map.
 */
export function openLiquify(): void {
  const editorStore = useEditorStore.getState();
  const activeId = editorStore.document.activeLayerId;
  if (!activeId) return;

  // Force a fresh readback (skip the frame cache which may be stale).
  clearFrameCache();
  const imageData = readLayerAsImageData(activeId);
  if (!imageData) return;

  const { width, height } = imageData;
  const snapshot = new Uint8ClampedArray(imageData.data.length);
  snapshot.set(imageData.data);

  const session: LiquifySession = {
    layerId: activeId,
    layerWidth: width,
    layerHeight: height,
    originalPixels: snapshot,
    displacementMap: createDisplacementMap(width, height),
    settings: defaultLiquifySettings(),
    isPainting: false,
    lastPaintPoint: null,
  };

  useUIStore.getState().setLiquify(session);
}

/**
 * Apply the current displacement map to the layer as a permanent edit.
 * Pushes an undo entry, uploads warped pixels to GPU, then closes the session.
 */
export function applyLiquify(): void {
  const ui = useUIStore.getState();
  const session = ui.liquify;
  if (!session) return;

  const engine = getEngine();
  if (!engine) return;

  const { layerId, layerWidth, layerHeight, originalPixels, displacementMap } = session;

  // Render the warped image into a new buffer
  const warped = new Uint8ClampedArray(originalPixels.length);
  renderWarp(originalPixels, displacementMap, warped);

  // Push history before modifying the layer
  useEditorStore.getState().pushHistory('Liquify');

  // Upload the warped pixels to the GPU layer texture
  uploadLayerPixels(engine, layerId, warped, layerWidth, layerHeight, 0, 0);

  // Invalidate the JS pixel data cache for this layer
  clearJsPixelData(layerId);

  // Close the session
  ui.setLiquify(null);

  // Trigger a render
  useEditorStore.getState().notifyRender();
}

/**
 * Cancel the Liquify session — discard the displacement map and restore
 * the original pixels (by re-uploading the snapshot), then close the panel.
 */
export function cancelLiquify(): void {
  const ui = useUIStore.getState();
  const session = ui.liquify;
  if (!session) return;

  const engine = getEngine();

  if (engine) {
    const { layerId, layerWidth, layerHeight, originalPixels } = session;
    // Restore original GPU texture
    uploadLayerPixels(engine, layerId, originalPixels, layerWidth, layerHeight, 0, 0);
    clearJsPixelData(layerId);
  }

  ui.setLiquify(null);
  useEditorStore.getState().notifyRender();
}

/**
 * Rerender the current warp state onto the GPU layer texture (no history push).
 * Called during painting to update the live preview.
 */
export function previewLiquify(): void {
  const session = useUIStore.getState().liquify;
  if (!session) return;

  const engine = getEngine();
  if (!engine) return;

  const { layerId, layerWidth, layerHeight, originalPixels, displacementMap } = session;

  const warped = new Uint8ClampedArray(originalPixels.length);
  renderWarp(originalPixels, displacementMap, warped);

  uploadLayerPixels(engine, layerId, warped, layerWidth, layerHeight, 0, 0);
  clearJsPixelData(layerId);
  useEditorStore.getState().notifyRender();
}

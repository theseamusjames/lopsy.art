import type { InteractionContext } from '../../app/interactions/interaction-types';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { clearJsPixelData } from '../../app/store/clear-js-pixel-data';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  floodFill as wasmFloodFill,
  applyFillToLayer as wasmApplyFillToLayer,
  readLayerPixelsForFill as wasmReadLayerPixelsForFill,
} from '../../engine-wasm/wasm-bridge';

/** Down handler for the bucket fill tool. Flood-fills from the click point,
 *  intersected with any active selection, and uploads to the GPU. */
export function handleFillDown(ctx: InteractionContext): void {
  const { layerPos, activeLayerId } = ctx;
  const editorState = useEditorStore.getState();
  editorState.pushHistory();
  const toolSettings = useToolSettingsStore.getState();
  const color = toolSettings.foregroundColor;
  toolSettings.addRecentColor(color);
  const tolerance = toolSettings.fillTolerance;
  const contiguous = toolSettings.fillContiguous;

  const engine = getEngine();
  if (!engine) return;

  const pixelData = wasmReadLayerPixelsForFill(engine, activeLayerId);
  const { width: docW, height: docH } = editorState.document;
  const layer = editorState.document.layers.find((l) => l.id === activeLayerId);
  const canvasX = Math.round(layerPos.x + (layer?.x ?? 0));
  const canvasY = Math.round(layerPos.y + (layer?.y ?? 0));
  const fillMask = wasmFloodFill(
    pixelData, docW, docH,
    canvasX, canvasY,
    color.r, color.g, color.b, Math.round(color.a * 255),
    tolerance, contiguous,
  );

  const { selection } = editorState;
  if (selection.active && selection.mask) {
    const selMask = selection.mask;
    for (let i = 0; i < fillMask.length && i < selMask.length; i++) {
      if (selMask[i] === 0) {
        fillMask[i] = 0;
      }
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

import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { Point } from '../../types';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { sampleColor as wasmSampleColor } from '../../engine-wasm/wasm-bridge';

/** Sample one composited pixel from the GPU at the given canvas-space point. */
function gpuSampleColorAt(canvasX: number, canvasY: number): { r: number; g: number; b: number; a: number } | null {
  const engine = getEngine();
  if (!engine) return null;
  const rgba = wasmSampleColor(engine, canvasX, canvasY, 1);
  if (rgba.length < 4) return null;
  return { r: rgba[0]!, g: rgba[1]!, b: rgba[2]!, a: rgba[3]! / 255 };
}

export function handleEyedropperDown(ctx: InteractionContext): InteractionState {
  const { canvasPos, activeLayerId, activeLayer } = ctx;

  const gpuColor = gpuSampleColorAt(canvasPos.x, canvasPos.y);
  if (gpuColor) {
    useToolSettingsStore.getState().setForegroundColor(gpuColor);
  }

  return {
    drawing: true,
    lastPoint: canvasPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'eyedropper',
    startPoint: null,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleEyedropperMove(state: InteractionState, layerLocalPos: Point): void {
  const canvasX = layerLocalPos.x + state.layerStartX;
  const canvasY = layerLocalPos.y + state.layerStartY;
  const gpuColor = gpuSampleColorAt(canvasX, canvasY);
  if (gpuColor) {
    useToolSettingsStore.getState().setForegroundColor(gpuColor);
  }
}

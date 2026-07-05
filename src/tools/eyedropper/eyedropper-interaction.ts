import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { Point } from '../../types';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { sampleColor as wasmSampleColor } from '../../engine-wasm/wasm-bridge';
import { coalesceToAnimationFrame } from '../../utils/raf-coalesce';

/** Sample one composited pixel from the GPU at the given canvas-space point. */
function gpuSampleColorAt(canvasX: number, canvasY: number): { r: number; g: number; b: number; a: number } | null {
  const engine = getEngine();
  if (!engine) return null;
  const rgba = wasmSampleColor(engine, canvasX, canvasY, 1);
  if (rgba.length < 4) return null;
  return { r: rgba[0]!, g: rgba[1]!, b: rgba[2]!, a: rgba[3]! / 255 };
}

function sampleAndApply(x: number, y: number): void {
  const gpuColor = gpuSampleColorAt(x, y);
  if (gpuColor) {
    useToolSettingsStore.getState().setForegroundColor(gpuColor);
  }
}

// `readPixels` is a pipeline-synchronizing call — issuing it once per
// pointer event stalls the JS thread on a full GPU flush per move (issue
// #641). Coalescing to rAF caps it at one readback per rendered frame.
const coalescedSample = coalesceToAnimationFrame(sampleAndApply);

export function handleEyedropperDown(ctx: InteractionContext): InteractionState {
  const { canvasPos, activeLayerId, activeLayer } = ctx;

  // Sample the down-click synchronously; the user expects the color to
  // update instantly on click even before the next frame.
  sampleAndApply(canvasPos.x, canvasPos.y);

  return {
    drawing: true,
    lastPoint: canvasPos,
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
  coalescedSample(canvasX, canvasY);
}

/** Test seam: flush any pending coalesced readback (also used on tool-up). */
export function flushEyedropperSample(): void {
  coalescedSample.flush();
}

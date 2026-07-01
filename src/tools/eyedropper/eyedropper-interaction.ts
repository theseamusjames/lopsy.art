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

// Coalesce eyedropper move sampling to at most one readback per animation
// frame. `gl.readPixels` is a pipeline-synchronizing call: on a large
// canvas with many layers it stalls the JS thread until the GPU flushes
// pending composite work. Firing it at pointer-event rate turned every
// eyedropper drag into a per-move sync (#641). We keep only the most
// recent position and sample it on the next rAF, so at most one readback
// per rendered frame instead of one per pointer event.
let pendingSample: { x: number; y: number } | null = null;
let sampleRafId: number | null = null;

function flushPendingSample(): void {
  sampleRafId = null;
  const pending = pendingSample;
  pendingSample = null;
  if (!pending) return;
  const gpuColor = gpuSampleColorAt(pending.x, pending.y);
  if (gpuColor) {
    useToolSettingsStore.getState().setForegroundColor(gpuColor);
  }
}

function scheduleSample(canvasX: number, canvasY: number): void {
  pendingSample = { x: canvasX, y: canvasY };
  if (sampleRafId !== null) return;
  if (typeof requestAnimationFrame === 'function') {
    sampleRafId = requestAnimationFrame(flushPendingSample);
    return;
  }
  // Test / non-browser environment: flush synchronously.
  flushPendingSample();
}

/** Test-only hook to force any pending rAF sample to run now. */
export function _flushEyedropperSampleForTest(): void {
  if (sampleRafId !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(sampleRafId);
  }
  sampleRafId = null;
  flushPendingSample();
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
  scheduleSample(canvasX, canvasY);
}

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

// Coalesce eyedropper reads: readPixels forces a GPU pipeline flush, so
// doing it on every pointer-move stalls the main thread once per event.
// Instead, remember the latest requested position and drain it in a
// rAF-scoped callback so at most one readback happens per rendered frame.
let pendingSample: { x: number; y: number } | null = null;
let rafHandle: number | null = null;

function scheduleSample(x: number, y: number): void {
  pendingSample = { x, y };
  if (rafHandle !== null) return;
  const raf = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb: FrameRequestCallback): number => setTimeout(() => cb(0), 16) as unknown as number;
  rafHandle = raf(() => {
    rafHandle = null;
    const sample = pendingSample;
    pendingSample = null;
    if (!sample) return;
    const gpuColor = gpuSampleColorAt(sample.x, sample.y);
    if (gpuColor) {
      useToolSettingsStore.getState().setForegroundColor(gpuColor);
    }
  });
}

/** Test hook: drop any pending frame so tests start from a clean slate. */
export function _resetEyedropperThrottleForTests(): void {
  pendingSample = null;
  if (rafHandle !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(rafHandle);
  }
  rafHandle = null;
}

export function handleEyedropperDown(ctx: InteractionContext): InteractionState {
  const { canvasPos, activeLayerId, activeLayer } = ctx;

  // Sample synchronously on pointer-down so the picked color reflects
  // exactly where the user clicked — the throttled path is only for the
  // continuous move stream.
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

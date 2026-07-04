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

function performSample(canvasX: number, canvasY: number): void {
  const gpuColor = gpuSampleColorAt(canvasX, canvasY);
  if (gpuColor) {
    useToolSettingsStore.getState().setForegroundColor(gpuColor);
  }
}

export function handleEyedropperDown(ctx: InteractionContext): InteractionState {
  const { canvasPos, activeLayerId, activeLayer } = ctx;

  // Reset any coalesced move state left over from a prior gesture.
  pendingSample = null;
  scheduledHandle = null;

  performSample(canvasPos.x, canvasPos.y);

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

// GPU→CPU readback (gl.readPixels) is a pipeline-synchronising call that
// stalls until pending compositing work has finished. Firing it on every
// pointer move floods the main thread on a large canvas with many layers.
// Coalesce moves to at most once per animation frame — the latest position
// wins.
let pendingSample: { x: number; y: number } | null = null;
let scheduledHandle: number | null = null;

function flushPendingSample(): void {
  scheduledHandle = null;
  const p = pendingSample;
  pendingSample = null;
  if (p) performSample(p.x, p.y);
}

function scheduleSample(): void {
  if (scheduledHandle !== null) return;
  if (typeof requestAnimationFrame === 'function') {
    scheduledHandle = requestAnimationFrame(flushPendingSample);
  } else {
    // Environments without rAF (e.g. some test setups): fall back to a
    // microtask so the coalescing behaviour still holds.
    scheduledHandle = 1;
    queueMicrotask(flushPendingSample);
  }
}

export function handleEyedropperMove(state: InteractionState, layerLocalPos: Point): void {
  pendingSample = {
    x: layerLocalPos.x + state.layerStartX,
    y: layerLocalPos.y + state.layerStartY,
  };
  scheduleSample();
}

/** Test-only helper: run any pending coalesced sample synchronously. */
export function __flushEyedropperSampleForTest(): void {
  if (scheduledHandle !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(scheduledHandle);
  }
  flushPendingSample();
}

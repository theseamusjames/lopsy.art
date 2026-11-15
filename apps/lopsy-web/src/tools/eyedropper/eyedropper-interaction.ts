import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS, seedPixel } from '../../app/interactions/interaction-types';
import type { Point } from '../../types';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { sampleColor as wasmSampleColor } from '../../engine-wasm/wasm-bridge';
import { coalesceToAnimationFrame } from '../../utils/raf-coalesce';

/**
 * Counts sample requests. A readback may answer after a newer one was
 * asked for (the pointer moved on); only the newest request's colour is
 * applied.
 */
let latestSampleRequest = 0;

/** Sample one composited pixel from the GPU and make it the foreground colour. */
function sampleAndApply(x: number, y: number): void {
  const engine = getEngine();
  if (!engine) return;
  const request = ++latestSampleRequest;
  wasmSampleColor(engine, x, y, 1)
    .then((rgba) => {
      if (request !== latestSampleRequest || rgba.length < 4) return;
      useToolSettingsStore.getState().setForegroundColor({
        r: rgba[0]!,
        g: rgba[1]!,
        b: rgba[2]!,
        a: rgba[3]! / 255,
      });
    })
    .catch(() => {});
}

// `readPixels` is a pipeline-synchronizing call — issuing it once per
// pointer event stalls the JS thread on a full GPU flush per move (issue
// #641). Coalescing to rAF caps it at one readback per rendered frame.
const coalescedSample = coalesceToAnimationFrame(sampleAndApply);

export function handleEyedropperDown(ctx: InteractionContext): InteractionState {
  const { canvasPos, activeLayerId, activeLayer } = ctx;

  // Ask for the down-click's colour at once, not on the next frame; the
  // user expects it to update on click.
  const pixel = seedPixel(ctx);
  sampleAndApply(pixel.x, pixel.y);

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

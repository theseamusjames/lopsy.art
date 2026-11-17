import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { Point } from '../../types';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  applySmudgeDab as gpuSmudgeDab,
  applySmudgeDabBatch as gpuSmudgeDabBatch,
} from '../../engine-wasm/wasm-bridge';
import { syncLayerAfterFullSize } from '../../app/sync-layer-after-full-size';
import { clearJsPixelData } from '../../app/store/clear-js-pixel-data';
import { interpolateDeferred, interpolateFlat } from '../common/dab-interpolation';

/**
 * Distance between smudge dabs. Each dab drags the pixels by the step it
 * takes and blends them in with a soft falloff, so at the 25 % pitch the
 * other tools use the falloff of every dab shows as a separate band down the
 * trail. A 5 % pitch (never under 1 px) keeps the smear continuous.
 */
export function smudgeSpacing(size: number): number {
  return Math.max(1, size * 0.05);
}

export function handleSmudgeDown(ctx: InteractionContext): InteractionState {
  const { activeLayerId, activeLayer, shiftKey } = ctx;
  let { layerPos } = ctx;
  const editorState = useEditorStore.getState();
  editorState.pushHistory('Smudge');
  const { size, strength: strengthPercent } = useToolSettingsStore.getState().settings.smudge;
  const strength = strengthPercent / 100;

  let startLayer = activeLayer;
  const engine = getEngine();
  if (engine) {
    const synced = syncLayerAfterFullSize(engine, activeLayerId);
    if (synced) {
      startLayer = synced;
      layerPos = { x: ctx.canvasPos.x - synced.x, y: ctx.canvasPos.y - synced.y };
    }

    const shiftLine = shiftKey
      && ctx.lastPaintPointRef.current
      && ctx.lastPaintPointRef.current.layerId === activeLayerId;
    if (shiftLine) {
      const from = ctx.lastPaintPointRef.current!.point;
      const interior = interpolateFlat(from, layerPos, smudgeSpacing(size));
      const pts = new Float64Array(interior.length + 2);
      pts[0] = from.x;
      pts[1] = from.y;
      pts.set(interior, 2);
      gpuSmudgeDabBatch(engine, activeLayerId, pts, size, strength);
    } else {
      gpuSmudgeDab(engine, activeLayerId, layerPos.x, layerPos.y, layerPos.x, layerPos.y, size, strength);
    }
    editorState.notifyRender();
  }

  return {
    drawing: true,
    lastPoint: layerPos,
    layerId: activeLayerId,
    tool: 'smudge',
    startPoint: null,
    layerStartX: startLayer.x,
    layerStartY: startLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleSmudgeMove(state: InteractionState, layerLocalPos: Point): void {
  if (!state.lastPoint) return;
  const { size, strength: strengthPercent } = useToolSettingsStore.getState().settings.smudge;
  const strength = strengthPercent / 100;

  // `lastPoint` is the last dab, not the last pointer sample: dabs are laid
  // a fixed distance apart along the drag whatever the pointer speed, and
  // the distance short of the next step carries over to the next move.
  const from = state.lastPoint;
  const dabs = interpolateDeferred(from, layerLocalPos, smudgeSpacing(size));
  if (dabs.length === 0) return;

  const engine = getEngine();
  if (engine && state.layerId) {
    const pts = new Float64Array(dabs.length + 2);
    pts[0] = from.x;
    pts[1] = from.y;
    pts.set(dabs, 2);
    gpuSmudgeDabBatch(engine, state.layerId, pts, size, strength);
  }
  state.lastPoint = { x: dabs[dabs.length - 2] ?? from.x, y: dabs[dabs.length - 1] ?? from.y };
  useEditorStore.getState().notifyRender();
}

/**
 * Smudge writes the layer texture directly (it isn't a PAINT_TOOLS stroke,
 * so the shared pointer-up path never marks it). Without this the next
 * history snapshot — including the redo entry captured on undo — reuses the
 * pre-smudge texture handle and the smudge is lost on redo (#939).
 */
export function handleSmudgeUp(state: InteractionState): void {
  if (state.layerId) clearJsPixelData(state.layerId);
}

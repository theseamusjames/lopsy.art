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
import { interpolateFlat } from '../common/dab-interpolation';

export function handleSmudgeDown(ctx: InteractionContext): InteractionState {
  const { canvasPos, activeLayerId, shiftKey } = ctx;
  const editorState = useEditorStore.getState();
  editorState.pushHistory('Smudge');
  const { size, strength: strengthPercent } = useToolSettingsStore.getState().settings.smudge;
  const strength = strengthPercent / 100;

  let activeLayer = ctx.activeLayer;
  let layerPos = ctx.layerPos;

  const engine = getEngine();
  if (engine) {
    // The smudge GPU dispatch calls ensure_layer_full_size, which expands a
    // cropped or offset layer (e.g. a freshly pasted selection) to cover the
    // document and repositions its origin to (<=0, <=0). Sync the JS store to
    // match BEFORE computing layer-local coords — otherwise the dab
    // coordinates, and the layer position pushed on the next sync frame, are
    // offset and the layer appears to jump. Mirrors the GPU brush path.
    const synced = syncLayerAfterFullSize(engine, activeLayerId);
    if (synced) {
      activeLayer = synced;
      layerPos = { x: canvasPos.x - synced.x, y: canvasPos.y - synced.y };
    }

    const shiftLine = shiftKey
      && ctx.lastPaintPointRef.current
      && ctx.lastPaintPointRef.current.layerId === activeLayerId;
    if (shiftLine) {
      // Build a flat [prev, p1, p2, ...] array starting from the last stroke
      // endpoint so the smudge pulls along the full shift-click line.
      const from = ctx.lastPaintPointRef.current!.point;
      const spacing = Math.max(1, size * 0.25);
      const interior = interpolateFlat(from, layerPos, spacing);
      const pts = new Float64Array(interior.length + 2);
      pts[0] = from.x;
      pts[1] = from.y;
      pts.set(interior, 2);
      gpuSmudgeDabBatch(engine, activeLayerId, pts, size, strength);
    } else {
      // First dab has no prior point — use the current position as its own
      // prev, which is a no-op by construction (delta = 0).
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
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleSmudgeMove(state: InteractionState, layerLocalPos: Point): void {
  if (!state.lastPoint) return;
  const { size, strength: strengthPercent } = useToolSettingsStore.getState().settings.smudge;
  const strength = strengthPercent / 100;
  const spacing = Math.max(1, size * 0.25);

  const engine = getEngine();
  if (engine && state.layerId) {
    const from = state.lastPoint;
    const interior = interpolateFlat(from, layerLocalPos, spacing);
    const pts = new Float64Array(interior.length + 2);
    pts[0] = from.x;
    pts[1] = from.y;
    pts.set(interior, 2);
    gpuSmudgeDabBatch(engine, state.layerId, pts, size, strength);
  }
  state.lastPoint = layerLocalPos;
  useEditorStore.getState().notifyRender();
}

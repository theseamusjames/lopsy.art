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
      const spacing = Math.max(1, size * 0.25);
      const interior = interpolateFlat(from, layerPos, spacing);
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

import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { Point } from '../../types';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  applyLiquifyDab as gpuLiquifyDab,
  applyLiquifyDabBatch as gpuLiquifyDabBatch,
} from '../../engine-wasm/wasm-bridge';
import { interpolateFlat } from '../common/dab-interpolation';

const MODE_MAP = { push: 0, pinch: 1, twirl: 2 } as const;

function getDirFromPoints(from: Point, to: Point): [number, number] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) return [1, 0];
  return [dx / len, dy / len];
}

export function handleLiquifyDown(ctx: InteractionContext): InteractionState {
  const { layerPos, activeLayerId, activeLayer } = ctx;
  const editorState = useEditorStore.getState();
  editorState.pushHistory();
  const toolSettings = useToolSettingsStore.getState();
  const size = toolSettings.liquifySize;
  const strength = toolSettings.liquifyStrength / 100;
  const mode = MODE_MAP[toolSettings.liquifyMode];

  const engine = getEngine();
  if (engine) {
    gpuLiquifyDab(engine, activeLayerId, layerPos.x, layerPos.y, size, strength, mode, 1, 0);
    editorState.notifyRender();
  }

  return {
    drawing: true,
    lastPoint: layerPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'liquify',
    startPoint: null,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleLiquifyMove(state: InteractionState, layerLocalPos: Point): void {
  if (!state.lastPoint) return;
  const toolSettings = useToolSettingsStore.getState();
  const size = toolSettings.liquifySize;
  const strength = toolSettings.liquifyStrength / 100;
  const mode = MODE_MAP[toolSettings.liquifyMode];
  const spacing = Math.max(1, size * 0.25);

  const [dirX, dirY] = getDirFromPoints(state.lastPoint, layerLocalPos);

  const engine = getEngine();
  if (engine && state.layerId) {
    const pts = interpolateFlat(state.lastPoint, layerLocalPos, spacing);
    if (pts.length >= 2) {
      gpuLiquifyDabBatch(engine, state.layerId, pts, size, strength, mode, dirX, dirY);
    }
  }
  state.lastPoint = layerLocalPos;
  useEditorStore.getState().notifyRender();
}

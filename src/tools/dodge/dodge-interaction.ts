import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { Point } from '../../types';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  applyDodgeBurnDab as gpuDodgeBurnDab,
  applyDodgeBurnDabBatch as gpuDodgeBurnDabBatch,
} from '../../engine-wasm/wasm-bridge';
import { interpolateFlat } from '../common/dab-interpolation';

/** Map dodge/burn mode string to the GPU enum (0 = dodge, 1 = burn). */
function dodgeModeToU32(mode: 'dodge' | 'burn'): number {
  return mode === 'dodge' ? 0 : 1;
}

export function handleDodgeDown(ctx: InteractionContext): InteractionState {
  const { layerPos, activeLayerId, activeLayer, shiftKey } = ctx;
  const editorState = useEditorStore.getState();
  editorState.pushHistory();
  const toolSettings = useToolSettingsStore.getState();
  const dodgeMode = toolSettings.dodgeMode;
  const exposure = toolSettings.dodgeExposure / 100;
  const dodgeSize = toolSettings.brushSize;
  const dodgeShiftLine = shiftKey
    && ctx.lastPaintPointRef.current
    && ctx.lastPaintPointRef.current.layerId === activeLayerId;

  const engine = getEngine();
  if (engine) {
    const modeU32 = dodgeModeToU32(dodgeMode);
    if (dodgeShiftLine) {
      const spacing = Math.max(1, dodgeSize * 0.25);
      const pts = interpolateFlat(ctx.lastPaintPointRef.current!.point, layerPos, spacing);
      gpuDodgeBurnDabBatch(engine, activeLayerId, pts, dodgeSize, modeU32, exposure);
    } else {
      gpuDodgeBurnDab(engine, activeLayerId, layerPos.x, layerPos.y, dodgeSize, modeU32, exposure);
    }
    editorState.notifyRender();
  }

  return {
    drawing: true,
    lastPoint: layerPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'dodge',
    startPoint: null,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleDodgeMove(state: InteractionState, layerLocalPos: Point): void {
  if (!state.lastPoint) return;
  const toolSettings = useToolSettingsStore.getState();
  const dodgeMode = toolSettings.dodgeMode;
  const exposure = toolSettings.dodgeExposure / 100;
  const dodgeSize = toolSettings.brushSize;
  const dodgeSpacing = Math.max(1, dodgeSize * 0.25);

  const engine = getEngine();
  if (engine && state.layerId) {
    const pts = interpolateFlat(state.lastPoint, layerLocalPos, dodgeSpacing);
    gpuDodgeBurnDabBatch(engine, state.layerId, pts, dodgeSize, dodgeModeToU32(dodgeMode), exposure);
  }
  state.lastPoint = layerLocalPos;
  useEditorStore.getState().notifyRender();
}

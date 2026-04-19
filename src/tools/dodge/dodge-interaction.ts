import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { Point } from '../../types';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  beginDodgeBurnStroke,
  applyDodgeBurnDabBatch as gpuDodgeBurnDabBatch,
  endDodgeBurnStroke,
} from '../../engine-wasm/wasm-bridge';
import { interpolateFlat } from '../common/dab-interpolation';
import {
  setPendingDodgeStroke,
  clearPendingDodgeStroke,
} from '../../app/interactions/pending-stroke';
import type { DodgeMode } from './dodge';

const DODGE_HARDNESS = 0.5;

function dodgeModeToU32(mode: DodgeMode): number {
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
    beginDodgeBurnStroke(engine, activeLayerId, modeU32);
    setPendingDodgeStroke(activeLayerId);
    if (dodgeShiftLine) {
      const spacing = Math.max(1, dodgeSize * 0.25);
      const pts = interpolateFlat(ctx.lastPaintPointRef.current!.point, layerPos, spacing);
      gpuDodgeBurnDabBatch(engine, activeLayerId, pts, dodgeSize, DODGE_HARDNESS, exposure);
    } else {
      gpuDodgeBurnDabBatch(engine, activeLayerId, new Float64Array([layerPos.x, layerPos.y]), dodgeSize, DODGE_HARDNESS, exposure);
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
  const exposure = toolSettings.dodgeExposure / 100;
  const dodgeSize = toolSettings.brushSize;
  const dodgeSpacing = Math.max(1, dodgeSize * 0.25);

  const engine = getEngine();
  if (engine && state.layerId) {
    const pts = interpolateFlat(state.lastPoint, layerLocalPos, dodgeSpacing);
    gpuDodgeBurnDabBatch(engine, state.layerId, pts, dodgeSize, DODGE_HARDNESS, exposure);
  }
  state.lastPoint = layerLocalPos;
  useEditorStore.getState().notifyRender();
}

export function handleDodgeUp(state: InteractionState): void {
  if (!state.layerId) return;
  const engine = getEngine();
  if (!engine) return;
  endDodgeBurnStroke(engine, state.layerId);
  clearPendingDodgeStroke();
  useEditorStore.getState().notifyRender();
}

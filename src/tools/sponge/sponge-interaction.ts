import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { Point } from '../../types';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  beginSpongeStroke,
  applySpongeDabBatch as gpuSpongeDabBatch,
  endSpongeStroke,
} from '../../engine-wasm/wasm-bridge';
import { interpolateFlat } from '../common/dab-interpolation';
import {
  setPendingSpongeStroke,
  clearPendingSpongeStroke,
} from '../../app/interactions/pending-stroke';
import type { SpongeMode } from './sponge';

const SPONGE_HARDNESS = 0.5;
const SPONGE_SPACING_RATIO = 0.25;
const SPONGE_STRENGTH_SCALE = 0.25;

function scaleSpongeStrength(raw: number): number {
  return raw * raw * SPONGE_STRENGTH_SCALE;
}

function spongeModeToU32(mode: SpongeMode): number {
  return mode === 'saturate' ? 0 : 1;
}

export function handleSpongeDown(ctx: InteractionContext): InteractionState {
  const { layerPos, activeLayerId, activeLayer, shiftKey } = ctx;
  const editorState = useEditorStore.getState();
  const toolSettings = useToolSettingsStore.getState();
  const { mode, strength: rawStrength, size } = toolSettings.settings.sponge;
  editorState.pushHistory(mode === 'saturate' ? 'Saturate' : 'Desaturate');
  const strength = scaleSpongeStrength(rawStrength / 100);
  const shiftLine = shiftKey
    && ctx.lastPaintPointRef.current
    && ctx.lastPaintPointRef.current.layerId === activeLayerId;

  const engine = getEngine();
  if (engine) {
    const modeU32 = spongeModeToU32(mode);
    beginSpongeStroke(engine, activeLayerId, modeU32);
    setPendingSpongeStroke(activeLayerId);
    if (shiftLine) {
      const spacing = Math.max(1, size * SPONGE_SPACING_RATIO);
      const pts = interpolateFlat(ctx.lastPaintPointRef.current!.point, layerPos, spacing);
      gpuSpongeDabBatch(engine, activeLayerId, pts, size, SPONGE_HARDNESS, strength);
    } else {
      gpuSpongeDabBatch(engine, activeLayerId, new Float64Array([layerPos.x, layerPos.y]), size, SPONGE_HARDNESS, strength);
    }
    editorState.notifyRender();
  }

  return {
    drawing: true,
    lastPoint: layerPos,
    layerId: activeLayerId,
    tool: 'sponge',
    startPoint: null,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleSpongeMove(state: InteractionState, layerLocalPos: Point): void {
  if (!state.lastPoint) return;
  const { strength: rawStrength, size } = useToolSettingsStore.getState().settings.sponge;
  const strength = scaleSpongeStrength(rawStrength / 100);
  const spacing = Math.max(1, size * SPONGE_SPACING_RATIO);

  const engine = getEngine();
  if (engine && state.layerId) {
    const pts = interpolateFlat(state.lastPoint, layerLocalPos, spacing);
    gpuSpongeDabBatch(engine, state.layerId, pts, size, SPONGE_HARDNESS, strength);
  }
  state.lastPoint = layerLocalPos;
  useEditorStore.getState().notifyRender();
}

export function handleSpongeUp(state: InteractionState): void {
  if (!state.layerId) return;
  const engine = getEngine();
  if (!engine) return;
  endSpongeStroke(engine, state.layerId);
  clearPendingSpongeStroke();
  useEditorStore.getState().notifyRender();
}

import type { MutableRefObject } from 'react';
import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { Point } from '../../types';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  applyStampDab as gpuStampDab,
  applyStampDabBatch as gpuStampDabBatch,
} from '../../engine-wasm/wasm-bridge';
import { interpolateFlat } from '../common/dab-interpolation';

export function handleStampDown(ctx: InteractionContext): InteractionState | undefined {
  const { layerPos, activeLayerId, activeLayer, altKey, metaKey, shiftKey } = ctx;

  if (altKey || metaKey) {
    ctx.stampSourceRef.current = layerPos;
    ctx.stampOffsetRef.current = null;
    return undefined;
  }
  if (!ctx.stampSourceRef.current) return undefined;

  const editorState = useEditorStore.getState();
  editorState.pushHistory();

  if (!ctx.stampOffsetRef.current) {
    ctx.stampOffsetRef.current = {
      x: ctx.stampSourceRef.current.x - layerPos.x,
      y: ctx.stampSourceRef.current.y - layerPos.y,
    };
  }

  const toolSettings = useToolSettingsStore.getState();
  const engine = getEngine();

  if (engine) {
    const stampShiftLine = shiftKey
      && ctx.lastPaintPointRef.current
      && ctx.lastPaintPointRef.current.layerId === activeLayerId;
    if (stampShiftLine) {
      const spacing = Math.max(1, toolSettings.stampSize * 0.25);
      const pts = interpolateFlat(ctx.lastPaintPointRef.current!.point, layerPos, spacing);
      gpuStampDabBatch(engine, activeLayerId, pts, ctx.stampOffsetRef.current.x, ctx.stampOffsetRef.current.y, toolSettings.stampSize);
    } else {
      gpuStampDab(engine, activeLayerId, layerPos.x, layerPos.y, ctx.stampOffsetRef.current.x, ctx.stampOffsetRef.current.y, toolSettings.stampSize);
    }
    editorState.notifyRender();
  }

  return {
    drawing: true,
    lastPoint: layerPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'stamp',
    startPoint: layerPos,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleStampMove(
  state: InteractionState,
  layerLocalPos: Point,
  stampOffsetRef: MutableRefObject<Point | null>,
): void {
  if (!state.lastPoint || !stampOffsetRef.current) return;

  const toolSettings = useToolSettingsStore.getState();
  const stampSpacing = Math.max(1, toolSettings.stampSize * 0.25);

  const engine = getEngine();
  if (engine && state.layerId) {
    const pts = interpolateFlat(state.lastPoint, layerLocalPos, stampSpacing);
    gpuStampDabBatch(engine, state.layerId, pts, stampOffsetRef.current.x, stampOffsetRef.current.y, toolSettings.stampSize);
  }
  state.lastPoint = layerLocalPos;
  useEditorStore.getState().notifyRender();
}

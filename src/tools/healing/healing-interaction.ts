import type { MutableRefObject } from 'react';
import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { Point } from '../../types';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { applyHealingDab, applyHealingDabBatch } from '../../engine-wasm/wasm-bridge';
import { interpolateFlat } from '../common/dab-interpolation';

/**
 * Apply a healing dab at doc-space position `pos` on the given layer,
 * sampling source from `pos + offset`. Runs entirely on the GPU via
 * the WASM engine to preserve FP16 color precision.
 */
function applyHealDab(layerId: string, pos: Point, offset: Point, size: number, opacity: number): void {
  const engine = getEngine();
  if (!engine) return;

  const layer = useEditorStore.getState().document.layers.find((l) => l.id === layerId);
  const docX = layer?.x ?? 0;
  const docY = layer?.y ?? 0;

  // Convert to layer-local coordinates
  const localX = pos.x - docX;
  const localY = pos.y - docY;

  applyHealingDab(engine, layerId, localX, localY, offset.x, offset.y, size, opacity / 100);
  useEditorStore.getState().notifyRender();
}

function applyHealDabBatch(layerId: string, points: Float64Array, offset: Point, size: number, opacity: number): void {
  const engine = getEngine();
  if (!engine) return;

  applyHealingDabBatch(engine, layerId, points, offset.x, offset.y, size, opacity / 100);
  useEditorStore.getState().notifyRender();
}

export function handleHealingDown(ctx: InteractionContext): InteractionState | undefined {
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
  const { healingSize, healingOpacity } = toolSettings;

  if (shiftKey && ctx.lastPaintPointRef.current && ctx.lastPaintPointRef.current.layerId === activeLayerId) {
    const spacing = Math.max(1, healingSize * 0.25);
    const pts = interpolateFlat(ctx.lastPaintPointRef.current.point, layerPos, spacing);
    const layer = activeLayer;
    const docX = layer?.x ?? 0;
    const docY = layer?.y ?? 0;
    const localPts = new Float64Array(pts.length);
    for (let i = 0; i < pts.length; i += 2) {
      localPts[i] = pts[i]! - docX;
      localPts[i + 1] = pts[i + 1]! - docY;
    }
    applyHealDabBatch(activeLayerId, localPts, ctx.stampOffsetRef.current, healingSize, healingOpacity);
  } else {
    applyHealDab(activeLayerId, layerPos, ctx.stampOffsetRef.current, healingSize, healingOpacity);
  }

  return {
    drawing: true,
    lastPoint: layerPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'healing',
    startPoint: layerPos,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleHealingMove(
  state: InteractionState,
  layerLocalPos: Point,
  stampOffsetRef: MutableRefObject<Point | null>,
): void {
  if (!state.lastPoint || !stampOffsetRef.current || !state.layerId) return;

  const toolSettings = useToolSettingsStore.getState();
  const { healingSize, healingOpacity } = toolSettings;
  const spacing = Math.max(1, healingSize * 0.25);

  const pts = interpolateFlat(state.lastPoint, layerLocalPos, spacing);
  const layer = useEditorStore.getState().document.layers.find((l) => l.id === state.layerId);
  const docX = layer?.x ?? 0;
  const docY = layer?.y ?? 0;
  const localPts = new Float64Array(pts.length);
  for (let i = 0; i < pts.length; i += 2) {
    localPts[i] = pts[i]! - docX;
    localPts[i + 1] = pts[i + 1]! - docY;
  }
  applyHealDabBatch(state.layerId, localPts, stampOffsetRef.current, healingSize, healingOpacity);

  state.lastPoint = layerLocalPos;
}

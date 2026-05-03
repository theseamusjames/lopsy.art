import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { Point } from '../../types';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { PixelBuffer } from '../../engine/pixel-data';
import { applySponge } from './sponge';
import { interpolateFlat } from '../common/dab-interpolation';

/** Spacing as a fraction of brush diameter — matches Dodge/Burn cadence. */
const SPONGE_SPACING_RATIO = 0.25;

function applyDabToLayer(
  layerId: string,
  pos: Point,
  size: number,
  strength: number,
  mode: import('./sponge').SpongeMode,
): void {
  const editorState = useEditorStore.getState();
  const layer = editorState.document.layers.find((l) => l.id === layerId);
  if (!layer) return;

  const imageData = editorState.getOrCreateLayerPixelData(layerId);
  const buf = PixelBuffer.fromImageData(imageData);

  // Convert doc-space pos to layer-local position
  const localX = pos.x - layer.x;
  const localY = pos.y - layer.y;

  applySponge(buf, { x: localX, y: localY }, size, mode, strength);
  editorState.updateLayerPixelData(layerId, buf.toImageData());
}

export function handleSpongeDown(ctx: InteractionContext): InteractionState {
  const { layerPos, activeLayerId, activeLayer, shiftKey } = ctx;
  const editorState = useEditorStore.getState();
  editorState.pushHistory();
  const toolSettings = useToolSettingsStore.getState();
  const mode = toolSettings.spongeMode;
  const strength = toolSettings.spongeStrength / 100;
  const size = toolSettings.spongeSize;

  const shiftLine = shiftKey
    && ctx.lastPaintPointRef.current
    && ctx.lastPaintPointRef.current.layerId === activeLayerId;

  if (shiftLine) {
    const from = ctx.lastPaintPointRef.current!.point;
    const spacing = Math.max(1, size * SPONGE_SPACING_RATIO);
    const pts = interpolateFlat(from, layerPos, spacing);
    // pts is a flat Float64Array of [x0, y0, x1, y1, ...]
    for (let i = 0; i < pts.length; i += 2) {
      applyDabToLayer(activeLayerId, { x: pts[i]!, y: pts[i + 1]! }, size, strength, mode);
    }
  } else {
    applyDabToLayer(activeLayerId, layerPos, size, strength, mode);
  }

  return {
    drawing: true,
    lastPoint: layerPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'sponge',
    startPoint: null,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleSpongeMove(state: InteractionState, layerLocalPos: Point): void {
  if (!state.drawing || !state.lastPoint || !state.layerId) return;
  const toolSettings = useToolSettingsStore.getState();
  const mode = toolSettings.spongeMode;
  const strength = toolSettings.spongeStrength / 100;
  const size = toolSettings.spongeSize;
  const spacing = Math.max(1, size * SPONGE_SPACING_RATIO);

  const pts = interpolateFlat(state.lastPoint, layerLocalPos, spacing);
  for (let i = 0; i < pts.length; i += 2) {
    applyDabToLayer(state.layerId, { x: pts[i]!, y: pts[i + 1]! }, size, strength, mode);
  }

  state.lastPoint = layerLocalPos;
}

import type { MutableRefObject } from 'react';
import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { Point } from '../../types';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { readLayerPixels, getLayerTextureDimensions, uploadLayerPixels } from '../../engine-wasm/wasm-bridge';
import { interpolateFlat } from '../common/dab-interpolation';
import { applyHealingDab } from './healing';
import { PixelBuffer } from '../../engine/pixel-data';

/**
 * Read the current layer pixels from the GPU into a PixelBuffer, or null
 * if the layer has no GPU texture.
 */
function readLayerBuffer(layerId: string): { buffer: PixelBuffer; width: number; height: number; docX: number; docY: number } | null {
  const engine = getEngine();
  if (!engine) return null;

  let dims: Uint32Array | undefined;
  try {
    dims = getLayerTextureDimensions(engine, layerId);
  } catch {
    return null;
  }
  const width = dims?.[0] ?? 0;
  const height = dims?.[1] ?? 0;
  if (width === 0 || height === 0) return null;

  const pixels = readLayerPixels(engine, layerId);
  if (!pixels || pixels.length === 0) return null;

  const clamped = new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  const buffer = PixelBuffer.fromData(clamped, width, height);

  // Retrieve layer position from the store
  const layers = useEditorStore.getState().document.layers;
  const layer = layers.find((l) => l.id === layerId);
  const docX = layer?.x ?? 0;
  const docY = layer?.y ?? 0;

  return { buffer, width, height, docX, docY };
}

/**
 * Apply a healing dab at doc-space position `pos` on the given layer,
 * sampling source from `pos + offset`.
 *
 * This is a JS-side healing: reads GPU texture, applies color-corrected
 * clone math, and re-uploads the modified pixels.
 */
function applyHealDab(layerId: string, pos: Point, offset: Point, size: number, opacity: number): void {
  const engine = getEngine();
  if (!engine) return;

  const layerData = readLayerBuffer(layerId);
  if (!layerData) return;

  const { buffer, width, height, docX, docY } = layerData;

  // Convert doc-space position to layer-local position
  const localPos: Point = { x: pos.x - docX, y: pos.y - docY };
  // Source is always sampled from the same layer (like clone stamp same-layer)
  const localSrc: PixelBuffer = buffer;

  applyHealingDab(buffer, localSrc, localPos, offset, size, opacity / 100);

  uploadLayerPixels(engine, layerId, new Uint8Array(buffer.rawData.buffer, buffer.rawData.byteOffset, buffer.rawData.byteLength), width, height, docX, docY);

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
    for (let i = 0; i < pts.length; i += 2) {
      applyHealDab(activeLayerId, { x: pts[i]!, y: pts[i + 1]! }, ctx.stampOffsetRef.current, healingSize, healingOpacity);
    }
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
  for (let i = 0; i < pts.length; i += 2) {
    applyHealDab(state.layerId, { x: pts[i]!, y: pts[i + 1]! }, stampOffsetRef.current, healingSize, healingOpacity);
  }

  state.lastPoint = layerLocalPos;
}

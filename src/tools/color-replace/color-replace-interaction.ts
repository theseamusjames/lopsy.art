import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import type { Point } from '../../types';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  readLayerPixels,
  getLayerTextureDimensions,
  uploadLayerPixels,
} from '../../engine-wasm/wasm-bridge';
import { clearJsPixelData } from '../../app/store/clear-js-pixel-data';
import { PixelBuffer } from '../../engine/pixel-data';
import { applyColorReplaceDab } from './color-replace';
import { interpolateFlat } from '../common/dab-interpolation';

/**
 * Read the active layer's GPU texture into a PixelBuffer.
 * Returns null if the layer has no texture or the engine is unavailable.
 */
function readLayerBuffer(
  engine: NonNullable<ReturnType<typeof getEngine>>,
  layerId: string,
): { buffer: PixelBuffer; width: number; height: number } | null {
  let dims: Uint32Array;
  try {
    dims = getLayerTextureDimensions(engine, layerId);
  } catch {
    return null;
  }
  const width = dims[0] ?? 0;
  const height = dims[1] ?? 0;
  if (width === 0 || height === 0) return null;

  const pixels = readLayerPixels(engine, layerId);
  if (!pixels || pixels.length === 0) return null;

  const clamped = new Uint8ClampedArray(width * height * 4);
  clamped.set(pixels);
  return { buffer: new PixelBuffer(width, height, clamped), width, height };
}

/**
 * Apply one colour-replace dab at `pos` (layer-local coordinates) and
 * upload the modified pixels back to the GPU.
 */
function applyDab(
  engine: NonNullable<ReturnType<typeof getEngine>>,
  layerId: string,
  pos: Point,
  foreR: number,
  foreG: number,
  foreB: number,
  sampledR: number,
  sampledG: number,
  sampledB: number,
  size: number,
  tolerance: number,
  opacity: number,
  layerOffsetX: number,
  layerOffsetY: number,
): void {
  const layer = readLayerBuffer(engine, layerId);
  if (!layer) return;

  // pos is layer-local; the GPU texture is also in layer-local coordinates.
  applyColorReplaceDab(
    layer.buffer,
    pos.x,
    pos.y,
    size,
    foreR,
    foreG,
    foreB,
    sampledR,
    sampledG,
    sampledB,
    tolerance,
    opacity,
  );

  uploadLayerPixels(engine, layerId, layer.buffer.rawData, layer.width, layer.height, layerOffsetX, layerOffsetY);
  clearJsPixelData(layerId);
}

/**
 * Sample the colour at the brush position on the active layer.
 * Returns null if no valid pixel is found.
 */
function sampleColor(
  engine: NonNullable<ReturnType<typeof getEngine>>,
  layerId: string,
  pos: Point,
): { r: number; g: number; b: number } | null {
  const layer = readLayerBuffer(engine, layerId);
  if (!layer) return null;

  const x = Math.round(pos.x);
  const y = Math.round(pos.y);
  const pixel = layer.buffer.getPixel(x, y);
  if (pixel.a <= 0) return null;
  return { r: pixel.r, g: pixel.g, b: pixel.b };
}

export function handleColorReplaceDown(ctx: InteractionContext): InteractionState | undefined {
  const { layerPos, activeLayerId, activeLayer } = ctx;
  const editorState = useEditorStore.getState();
  editorState.pushHistory();

  const toolSettings = useToolSettingsStore.getState();
  const fg = toolSettings.foregroundColor;
  toolSettings.addRecentColor(fg);

  const size = toolSettings.colorReplaceSize;
  const tolerance = toolSettings.colorReplaceTolerance;
  const opacity = toolSettings.colorReplaceOpacity / 100;

  const engine = getEngine();
  if (!engine) return undefined;

  // Sample the colour under the cursor at stroke start — this is the
  // reference colour used by the tolerance check throughout the stroke.
  const sampledRgb = sampleColor(engine, activeLayerId, layerPos) ?? { r: fg.r, g: fg.g, b: fg.b };
  // Store the sampled colour in strokeColor (r/g/b/a). The 'a' field is
  // repurposed here to carry the sampled R value — we store the sampled
  // RGB in the dedicated strokeColor slot using a convention: the
  // interaction's move handler reads it back from strokeColor.r/g/b.
  // strokeColor.a carries the actual alpha (1) and is not used for sampling.
  const sampledStrokeColor = { r: sampledRgb.r, g: sampledRgb.g, b: sampledRgb.b, a: 1 };

  applyDab(
    engine, activeLayerId, layerPos,
    fg.r, fg.g, fg.b,
    sampledRgb.r, sampledRgb.g, sampledRgb.b,
    size, tolerance, opacity,
    activeLayer.x, activeLayer.y,
  );
  editorState.notifyRender();

  return {
    drawing: true,
    lastPoint: layerPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'color-replace',
    startPoint: layerPos,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    strokeColor: sampledStrokeColor,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleColorReplaceMove(state: InteractionState, layerLocalPos: Point): void {
  if (!state.lastPoint || !state.layerId || !state.strokeColor) return;

  const toolSettings = useToolSettingsStore.getState();
  const fg = toolSettings.foregroundColor;
  const size = toolSettings.colorReplaceSize;
  const tolerance = toolSettings.colorReplaceTolerance;
  const opacity = toolSettings.colorReplaceOpacity / 100;
  const spacing = Math.max(1, size * 0.25);

  const engine = getEngine();
  if (!engine) return;

  const editorState = useEditorStore.getState();
  const layer = editorState.document.layers.find((l) => l.id === state.layerId);
  const layerOffsetX = layer?.x ?? 0;
  const layerOffsetY = layer?.y ?? 0;
  const sampled = state.strokeColor;

  const pts = interpolateFlat(state.lastPoint, layerLocalPos, spacing);
  const ptCount = pts.length / 2;

  for (let i = 0; i < ptCount; i++) {
    const x = pts[i * 2] ?? layerLocalPos.x;
    const y = pts[i * 2 + 1] ?? layerLocalPos.y;
    applyDab(
      engine, state.layerId, { x, y },
      fg.r, fg.g, fg.b,
      sampled.r, sampled.g, sampled.b,
      size, tolerance, opacity,
      layerOffsetX, layerOffsetY,
    );
  }

  state.lastPoint = layerLocalPos;
  useEditorStore.getState().notifyRender();
}

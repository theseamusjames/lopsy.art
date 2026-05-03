import type { InteractionContext, InteractionState } from '../../app/interactions/interaction-types';
import { DEFAULT_TRANSFORM_FIELDS } from '../../app/interactions/interaction-types';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  addLayer,
  removeLayer,
  readLayerPixels,
  getLayerTextureDimensions,
} from '../../engine-wasm/wasm-bridge';
import { uploadCompressed } from '../../engine-wasm/gpu-pixel-access';
import { PixelBuffer } from '../../engine/pixel-data';
import { applyHistoryBrushDab } from './history-brush';
import { interpolateFlat } from '../common/dab-interpolation';
import type { HistorySnapshot } from '../../app/store/types';

/** Unique ID used for the scratch layer that holds the source snapshot pixels. */
const SCRATCH_LAYER_ID = '__history_brush_scratch__';

/** Cached source pixels from the snapshot. Populated once per stroke begin. */
let sourceCache: {
  layerId: string;
  /** Full document-width/height pixel buffer holding source pixels. */
  pixels: PixelBuffer;
} | null = null;

/**
 * Decode a snapshot's GPU blob for a layer into a full-document PixelBuffer.
 * Returns null if no source is set or the layer has no data in the snapshot.
 */
function buildSourceCache(layerId: string): typeof sourceCache {
  const { historyBrushSourceIndex } = useUIStore.getState();
  if (historyBrushSourceIndex === null) return null;

  const editorState = useEditorStore.getState();
  const { undoStack, document: doc } = editorState;

  // Index 0 = "Original" (first undoStack entry before any user edits).
  // Entries 1..undoStack.length map to undoStack[0..n-1].
  let snapshot: HistorySnapshot | null;
  if (historyBrushSourceIndex === 0) {
    snapshot = undoStack[0] ?? null;
  } else {
    snapshot = undoStack[historyBrushSourceIndex - 1] ?? null;
  }

  if (!snapshot || snapshot.metadataOnly) return null;

  const blob = snapshot.gpuSnapshots.get(layerId);
  if (!blob || blob.length === 0) {
    // Layer had no content at that snapshot — treat as fully transparent
    return {
      layerId,
      pixels: new PixelBuffer(doc.width, doc.height),
    };
  }

  // Find the layer's position in the snapshot's document state
  const snapshotLayer = snapshot.document.layers.find((l) => l.id === layerId);
  const srcLayerX = snapshotLayer?.x ?? 0;
  const srcLayerY = snapshotLayer?.y ?? 0;

  const engine = getEngine();
  if (!engine) return null;

  // Upload blob to a temporary scratch layer, read pixels, clean up
  try {
    addLayer(engine, SCRATCH_LAYER_ID);
    uploadCompressed(SCRATCH_LAYER_ID, blob);

    const dims = getLayerTextureDimensions(engine, SCRATCH_LAYER_ID);
    const texW = dims?.[0] ?? 0;
    const texH = dims?.[1] ?? 0;

    const docBuf = new PixelBuffer(doc.width, doc.height);

    if (texW > 0 && texH > 0) {
      const rawPixels = readLayerPixels(engine, SCRATCH_LAYER_ID);
      if (rawPixels && rawPixels.length >= texW * texH * 4) {
        const clamped = new Uint8ClampedArray(rawPixels.buffer, rawPixels.byteOffset, rawPixels.byteLength);
        const texBuf = new PixelBuffer(texW, texH, clamped);
        for (let ty = 0; ty < texH; ty++) {
          for (let tx = 0; tx < texW; tx++) {
            const docX = srcLayerX + tx;
            const docY = srcLayerY + ty;
            if (docX >= 0 && docX < doc.width && docY >= 0 && docY < doc.height) {
              docBuf.setPixel(docX, docY, texBuf.getPixel(tx, ty));
            }
          }
        }
      }
    }

    return { layerId, pixels: docBuf };
  } finally {
    try { removeLayer(engine, SCRATCH_LAYER_ID); } catch { /* ignore */ }
  }
}

function applyDabAtDocPos(docX: number, docY: number, layerId: string, source: NonNullable<typeof sourceCache>): void {
  const editorState = useEditorStore.getState();
  const toolSettings = useToolSettingsStore.getState();
  const size = toolSettings.historyBrushSize;
  const hardness = toolSettings.historyBrushHardness / 100;
  const opacity = toolSettings.historyBrushOpacity / 100;

  // Get full-document-size ImageData for the current layer
  const destImageData = editorState.expandLayerForEditing(layerId);
  const destBuf = PixelBuffer.wrapImageData(destImageData);

  applyHistoryBrushDab({
    destX: docX,
    destY: docY,
    source: source.pixels,
    dest: destBuf,
    radius: size / 2,
    hardness,
    opacity,
  });

  editorState.updateLayerPixelData(layerId, destImageData);
}

export function handleHistoryBrushDown(ctx: InteractionContext): InteractionState | undefined {
  const { canvasPos, layerPos, activeLayerId, activeLayer } = ctx;

  if (useUIStore.getState().historyBrushSourceIndex === null) return undefined;

  const editorState = useEditorStore.getState();
  editorState.pushHistory();

  // Build source cache once per stroke
  sourceCache = buildSourceCache(activeLayerId);
  if (!sourceCache) return undefined;

  applyDabAtDocPos(canvasPos.x, canvasPos.y, activeLayerId, sourceCache);

  return {
    drawing: true,
    lastPoint: canvasPos,
    pixelBuffer: null,
    originalPixelBuffer: null,
    layerId: activeLayerId,
    tool: 'history-brush',
    startPoint: layerPos,
    layerStartX: activeLayer.x,
    layerStartY: activeLayer.y,
    ...DEFAULT_TRANSFORM_FIELDS,
  };
}

export function handleHistoryBrushMove(state: InteractionState, ctx: InteractionContext): void {
  if (!state.lastPoint || !state.layerId || !sourceCache) return;

  const toolSettings = useToolSettingsStore.getState();
  const size = toolSettings.historyBrushSize;
  const spacing = Math.max(1, size * 0.25);

  const pts = interpolateFlat(state.lastPoint, ctx.canvasPos, spacing);
  for (let i = 0; i < pts.length; i += 2) {
    applyDabAtDocPos(pts[i]!, pts[i + 1]!, state.layerId, sourceCache);
  }

  state.lastPoint = ctx.canvasPos;
}

export function handleHistoryBrushUp(_ctx: InteractionContext, _state: InteractionState): void {
  sourceCache = null;
}

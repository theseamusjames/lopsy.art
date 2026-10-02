import { useEditorStore } from '../editor-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { getLayerEngineBounds } from '../../engine-wasm/wasm-bridge';
import { readLayerThumbnail } from '../../engine-wasm/gpu-pixel-access';
import { pixelDataManager } from '../../engine/pixel-data-manager';
import type { Rect } from '../../types';

/**
 * The Clone Stamp and Healing Brush sample only the active layer, so their
 * source preview is drawn from that layer rather than the composite (#1146).
 * The layer is read once (GPU-downscaled for very large layers) and reused
 * until its pixels, bounds or history change.
 */
export interface StampSourceImage {
  readonly image: CanvasImageSource;
  /** Document-space rect the image covers. */
  readonly docRect: Rect;
  readonly imageWidth: number;
  readonly imageHeight: number;
}

const MAX_PREVIEW_SIZE = 2048;

let cached: { key: string; value: StampSourceImage | null } | null = null;

export function getStampSourceImage(layerId: string): StampSourceImage | null {
  const engine = getEngine();
  if (!engine) return null;
  const [x = 0, y = 0, w = 0, h = 0] = getLayerEngineBounds(engine, layerId);
  const editor = useEditorStore.getState();
  const key = [
    layerId, x, y, w, h, pixelDataManager.versionOf(layerId),
    editor.documentVersion, editor.undoStack.length, editor.redoStack.length,
  ].join('|');
  if (cached && cached.key === key) return cached.value;
  cached = { key, value: buildImage(layerId, { x, y, width: w, height: h }) };
  return cached.value;
}

function buildImage(layerId: string, docRect: Rect): StampSourceImage | null {
  if (docRect.width <= 0 || docRect.height <= 0) return null;
  const thumb = readLayerThumbnail(layerId, MAX_PREVIEW_SIZE);
  if (!thumb) return null;
  const canvas = document.createElement('canvas');
  canvas.width = thumb.width;
  canvas.height = thumb.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.putImageData(thumb, 0, 0);
  return { image: canvas, docRect, imageWidth: thumb.width, imageHeight: thumb.height };
}

/** Image-space rect that maps onto the doc-space square of `radius` around `center`. */
export function stampSourceImageRect(
  source: Pick<StampSourceImage, 'docRect' | 'imageWidth' | 'imageHeight'>,
  center: { x: number; y: number },
  radius: number,
): Rect {
  const sx = source.imageWidth / source.docRect.width;
  const sy = source.imageHeight / source.docRect.height;
  return {
    x: (center.x - radius - source.docRect.x) * sx,
    y: (center.y - radius - source.docRect.y) * sy,
    width: radius * 2 * sx,
    height: radius * 2 * sy,
  };
}

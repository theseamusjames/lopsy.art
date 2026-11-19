import { traceSelectionContours } from '../../selection/selection';
import type { Rect } from '../../types';

/**
 * A layer's alpha over its opaque bounding box, in document coordinates.
 * Unlike the document-sized selection mask it keeps the part of the layer
 * past the canvas edge.
 */
export interface LayerAlphaContent {
  readonly alpha: Uint8ClampedArray;
  readonly rect: Rect;
}

interface LayerAlphaRecord {
  layerId: string;
  mask: Uint8ClampedArray;
  content: LayerAlphaContent | null;
  /** The content's outline in document coordinates, traced on first use. */
  outline: number[][] | null;
}

/**
 * The most recent selection built from a layer's alpha (⌘-click on its
 * thumbnail), identified by its mask array: every later selection change
 * installs a new array. A document-sized mask cannot hold the part of a layer
 * past the canvas edge, so a move or transform of this selection lifts the
 * whole layer instead (#994, #1605).
 */
let layerAlphaSelection: LayerAlphaRecord | null = null;

export function recordLayerAlphaSelection(
  layerId: string,
  mask: Uint8ClampedArray,
  content: LayerAlphaContent | null = null,
): void {
  layerAlphaSelection = { layerId, mask, content, outline: null };
}

/** Whether `mask` is still the alpha selection made for `layerId`. */
export function isLayerAlphaSelection(layerId: string, mask: Uint8ClampedArray): boolean {
  return layerAlphaSelection !== null
    && layerAlphaSelection.layerId === layerId
    && layerAlphaSelection.mask === mask;
}

/**
 * The whole layer's alpha behind the layer-alpha selection `mask`, past the
 * canvas edge included, or null when `mask` is not one.
 */
export function layerAlphaContent(layerId: string, mask: Uint8ClampedArray): LayerAlphaContent | null {
  const record = layerAlphaSelection;
  return record?.layerId === layerId && record.mask === mask ? record.content : null;
}

/**
 * The outline of the whole layer behind the selection `mask`, past the canvas
 * edge included, and the rect it frames; null when `mask` is not a
 * layer-alpha selection. The ants of a whole-layer lift trace this, so they
 * frame everything the Move tool carries (#1801).
 */
export function layerAlphaOutline(mask: Uint8ClampedArray): { contours: number[][]; bounds: Rect } | null {
  const record = layerAlphaSelection;
  if (!record || record.mask !== mask || !record.content) return null;
  const { alpha, rect } = record.content;
  record.outline ??= traceSelectionContours(alpha, rect.width, rect.height).map((pts) =>
    pts.map((v, i) => v + (i % 2 === 0 ? rect.x : rect.y)));
  return { contours: record.outline, bounds: rect };
}

/** `content` shifted by (dx, dy): the same pixels, moved. */
export function translateLayerAlphaContent(content: LayerAlphaContent, dx: number, dy: number): LayerAlphaContent {
  const { rect } = content;
  return { alpha: content.alpha, rect: { ...rect, x: rect.x + dx, y: rect.y + dy } };
}

/**
 * The document-sized selection mask of `content`, clipped to the canvas, and
 * the bounds of all of the content, the part past the canvas edge included.
 */
export function layerAlphaContentMask(
  content: LayerAlphaContent,
  docW: number,
  docH: number,
): { mask: Uint8ClampedArray; bounds: Rect } {
  const { alpha, rect } = content;
  const mask = new Uint8ClampedArray(docW * docH);
  const x0 = Math.max(0, rect.x);
  const x1 = Math.min(docW, rect.x + rect.width);
  const y0 = Math.max(0, rect.y);
  const y1 = Math.min(docH, rect.y + rect.height);
  for (let y = y0; y < y1; y++) {
    const src = (y - rect.y) * rect.width - rect.x;
    const dst = y * docW;
    for (let x = x0; x < x1; x++) mask[dst + x] = alpha[src + x] ?? 0;
  }
  return { mask, bounds: rect };
}

/**
 * Stop treating the recorded mask as "the whole layer". A tool that writes
 * pixels can put some outside the mask while the mask array stays the same;
 * lifting the whole layer afterwards would drag those unselected pixels
 * along with the selection.
 */
export function forgetLayerAlphaSelection(): void {
  layerAlphaSelection = null;
}

/**
 * The crop without dragging (WCAG 2.1.1, 2.5.7): an edge moved by arrow
 * keys, and the crop set from typed pixels. Both hold the aspect the crop
 * tool keeps, as a drag does (engine/crop.ts `dragCrop`), and keep the
 * crop inside the image.
 */

import { MIN_CROP, dragCrop, type Rect } from '../engine/crop';

export type CropEdge = 'n' | 'e' | 's' | 'w';

export const CROP_EDGES: readonly CropEdge[] = ['n', 'e', 's', 'w'];

/** An arrow key's step, and Shift's or Page Up's, as shares of the image side. */
export const EDGE_STEP = 0.01;
export const EDGE_LARGE_STEP = 0.1;

export interface PixelSize {
  readonly width: number;
  readonly height: number;
}

function isVertical(edge: CropEdge): boolean {
  return edge === 'n' || edge === 's';
}

/** Where an edge is: across the image for left and right, down it for top and bottom, 0..1. */
export function edgePosition(rect: Rect, edge: CropEdge): number {
  switch (edge) {
    case 'w':
      return rect.x;
    case 'e':
      return rect.x + rect.width;
    case 'n':
      return rect.y;
    case 's':
      return rect.y + rect.height;
  }
}

/**
 * How far a key moves an edge, as a share of the image side (negative is
 * left or up), or null for a key the edge does not take. Arrows move it
 * along its own axis, Page Up and Page Down by the large step (up, or
 * right), Home and End to the image's left or top and right or bottom.
 */
export function edgeKeyDelta(rect: Rect, edge: CropEdge, key: string, isLarge: boolean): number | null {
  const step = isLarge ? EDGE_LARGE_STEP : EDGE_STEP;
  const vertical = isVertical(edge);
  switch (key) {
    case 'ArrowLeft':
      return vertical ? null : -step;
    case 'ArrowRight':
      return vertical ? null : step;
    case 'ArrowUp':
      return vertical ? -step : null;
    case 'ArrowDown':
      return vertical ? step : null;
    case 'PageUp':
      return vertical ? -EDGE_LARGE_STEP : EDGE_LARGE_STEP;
    case 'PageDown':
      return vertical ? EDGE_LARGE_STEP : -EDGE_LARGE_STEP;
    case 'Home':
      return -edgePosition(rect, edge);
    case 'End':
      return 1 - edgePosition(rect, edge);
    default:
      return null;
  }
}

/**
 * The crop after a key on one of its edges, or null when the key does
 * nothing there. `ratio` is the held aspect in pixels (width over
 * height), null for Free; `imageAspect` the image's.
 */
export function cropAfterEdgeKey(
  rect: Rect,
  edge: CropEdge,
  key: string,
  isLarge: boolean,
  ratio: number | null,
  imageAspect: number,
): Rect | null {
  const delta = edgeKeyDelta(rect, edge, key, isLarge);
  if (delta === null) return null;
  return isVertical(edge) ? dragCrop(rect, edge, 0, delta, ratio, imageAspect) : dragCrop(rect, edge, delta, 0, ratio, imageAspect);
}

const SIDE_NAMES: Readonly<Record<CropEdge, string>> = { n: 'top', e: 'right', s: 'bottom', w: 'left' };

/** What an edge slider reads out: how far the edge is in from its own side of the image. */
export function edgeValueText(rect: Rect, edge: CropEdge, size: PixelSize): string {
  const position = edgePosition(rect, edge);
  const inset = edge === 'e' || edge === 's' ? 1 - position : position;
  const pixels = Math.round(Math.max(0, inset) * (isVertical(edge) ? size.height : size.width));
  return `${Math.round(Math.max(0, inset) * 100)} % in from the ${SIDE_NAMES[edge]}, ${pixels} px`;
}

export type CropField = 'x' | 'y' | 'width' | 'height';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The crop with one of its figures typed in pixels of a `size` image:
 * Left and Top move it and keep its size; Width and Height resize it from
 * its top-left corner, the other side following `ratio` (pixels, width
 * over height) when the tool holds one. It stays inside the image.
 */
export function cropWithField(rect: Rect, field: CropField, pixels: number, size: PixelSize, ratio: number | null): Rect {
  if (!Number.isFinite(pixels) || size.width <= 0 || size.height <= 0) return rect;
  const { width: w, height: h } = size;
  switch (field) {
    case 'x':
      return { ...rect, x: clamp(pixels / w, 0, 1 - rect.width) };
    case 'y':
      return { ...rect, y: clamp(pixels / h, 0, 1 - rect.height) };
    case 'width': {
      let width = clamp(pixels / w, MIN_CROP, 1 - rect.x);
      if (ratio === null) return { ...rect, width };
      let height = (width * w) / (ratio * h);
      if (height > 1 - rect.y) {
        height = 1 - rect.y;
        width = (height * h * ratio) / w;
      }
      return { ...rect, width, height };
    }
    case 'height': {
      let height = clamp(pixels / h, MIN_CROP, 1 - rect.y);
      if (ratio === null) return { ...rect, height };
      let width = (height * h * ratio) / w;
      if (width > 1 - rect.x) {
        width = 1 - rect.x;
        height = (width * w) / (ratio * h);
      }
      return { ...rect, width, height };
    }
  }
}

/** How far in from the stage's top and bottom the options bar reaches, beyond its own height: its margin and half a handle. */
export const BAR_CLEARANCE = 24;

/**
 * Whether the crop's options bar goes at the top of the stage instead of
 * the bottom, so it never hides the edge in use (WCAG 2.4.11): when it
 * would cover the crop's bottom edge and not its top one, or would cover
 * both and the bottom edge is the one focused or dragged. `top` and
 * `bottom` are the crop's edges in stage pixels; `reach` is how far in
 * the bar covers from either side.
 */
export function isBarOnTop(crop: { readonly top: number; readonly bottom: number }, stageHeight: number, reach: number, isBottomInUse: boolean): boolean {
  const coversBottom = crop.bottom > stageHeight - reach;
  const coversTop = crop.top < reach;
  if (!coversBottom) return false;
  return !coversTop || isBottomInUse;
}

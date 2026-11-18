/**
 * Crop maths. The recipe stores the crop normalized (0..1) to the oriented
 * source image, before Rotate and Flip (recipe.ts `CropRect`), so a crop
 * survives a later rotation. The Edit view and the engine work in the
 * framed image (rotated clockwise, then mirrored); these functions move a
 * rectangle between the two and keep it inside the image and to an aspect.
 */

import type { CropRect, QuarterTurns } from '@lopsy/photos-core/library/recipe';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FramingLike {
  readonly rotate: QuarterTurns;
  readonly flipH: boolean;
}

export const FULL_RECT: Rect = { x: 0, y: 0, width: 1, height: 1 };

/** Smallest crop side, as a share of the image side. */
export const MIN_CROP = 0.02;

type Point = readonly [number, number];

function rotatePoint([x, y]: Point, rotate: QuarterTurns): Point {
  if (rotate === 90) return [1 - y, x];
  if (rotate === 180) return [1 - x, 1 - y];
  if (rotate === 270) return [y, 1 - x];
  return [x, y];
}

function inverseRotate(rotate: QuarterTurns): QuarterTurns {
  return rotate === 90 ? 270 : rotate === 270 ? 90 : rotate;
}

function boundsOf(a: Point, b: Point): Rect {
  const x0 = Math.min(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  return { x: x0, y: y0, width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) };
}

/** A source-space rectangle in the framed image. */
export function toFramed(rect: Rect, framing: FramingLike): Rect {
  const map = (p: Point): Point => {
    const [x, y] = rotatePoint(p, framing.rotate);
    return framing.flipH ? [1 - x, y] : [x, y];
  };
  return boundsOf(map([rect.x, rect.y]), map([rect.x + rect.width, rect.y + rect.height]));
}

/** A framed-image rectangle back in source space. */
export function fromFramed(rect: Rect, framing: FramingLike): Rect {
  const map = (p: Point): Point => {
    const unflipped: Point = framing.flipH ? [1 - p[0], p[1]] : p;
    return rotatePoint(unflipped, inverseRotate(framing.rotate));
  };
  return boundsOf(map([rect.x, rect.y]), map([rect.x + rect.width, rect.y + rect.height]));
}

/** Whether a crop leaves the whole image. */
export function isFullCrop(rect: Rect | null): boolean {
  if (!rect) return true;
  const e = 1e-6;
  return rect.x <= e && rect.y <= e && rect.width >= 1 - e && rect.height >= 1 - e;
}

/** Keeps a rectangle inside 0..1 and at least MIN_CROP on each side. */
export function clampRect(rect: Rect): Rect {
  const width = Math.min(1, Math.max(MIN_CROP, rect.width));
  const height = Math.min(1, Math.max(MIN_CROP, rect.height));
  return {
    x: Math.min(1 - width, Math.max(0, rect.x)),
    y: Math.min(1 - height, Math.max(0, rect.y)),
    width,
    height,
  };
}

/** Whole pixels of a framed-space crop on a `width`×`height` image. */
export function cropPixels(rect: Rect, width: number, height: number): Rect {
  const x = Math.min(width - 1, Math.max(0, Math.round(rect.x * width)));
  const y = Math.min(height - 1, Math.max(0, Math.round(rect.y * height)));
  const right = Math.min(width, Math.max(x + 1, Math.round((rect.x + rect.width) * width)));
  const bottom = Math.min(height, Math.max(y + 1, Math.round((rect.y + rect.height) * height)));
  return { x, y, width: right - x, height: bottom - y };
}

/** The recipe value for a framed-space crop: null when it keeps the whole image. */
export function recipeCrop(framedRect: Rect, framing: FramingLike): CropRect | null {
  const rect = clampRect(framedRect);
  if (isFullCrop(rect)) return null;
  const source = fromFramed(rect, framing);
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  return { x: round(source.x), y: round(source.y), width: round(source.width), height: round(source.height) };
}

// ---- aspect ----------------------------------------------------------

export type AspectId = 'free' | 'original' | '1:1' | '4:5' | '3:2' | '16:9';

export interface AspectPreset {
  readonly id: AspectId;
  readonly label: string;
}

export const ASPECT_PRESETS: readonly AspectPreset[] = [
  { id: 'free', label: 'Free' },
  { id: 'original', label: 'Original' },
  { id: '1:1', label: '1 : 1' },
  { id: '4:5', label: '4 : 5' },
  { id: '3:2', label: '3 : 2' },
  { id: '16:9', label: '16 : 9' },
];

/**
 * Width over height in pixels for a preset on an image of `imageAspect`
 * (width over height), or null for Free. Fixed ratios are landscape;
 * `isPortrait` turns them (1:1 stays square).
 */
export function aspectRatio(id: AspectId, imageAspect: number, isPortrait: boolean): number | null {
  if (id === 'free') return null;
  const [a = 1, b = 1] = id === 'original' ? [imageAspect, 1] : id.split(':').map(Number);
  const landscape = Math.max(a, b) / Math.min(a, b);
  return isPortrait ? 1 / landscape : landscape;
}

/**
 * The largest rectangle of pixel aspect `ratio` that fits inside `rect`,
 * centred on it. `imageAspect` converts between pixels and the normalized
 * rectangle (its width is a share of the image width, its height of the
 * height).
 */
export function fitAspect(rect: Rect, ratio: number, imageAspect: number): Rect {
  const normRatio = ratio / imageAspect;
  let width = rect.width;
  let height = width / normRatio;
  if (height > rect.height) {
    height = rect.height;
    width = height * normRatio;
  }
  return {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
    width,
    height,
  };
}

// ---- dragging --------------------------------------------------------

export type CropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * The crop after dragging `handle` by (`dx`, `dy`), as shares of the image
 * size, from the crop `start` the drag began with. With a `ratio` the
 * opposite corner (or edge centre) stays put and the size follows the
 * dominant direction of the drag.
 */
export function dragCrop(start: Rect, handle: CropHandle, dx: number, dy: number, ratio: number | null, imageAspect: number): Rect {
  if (handle === 'move') {
    return {
      ...start,
      x: Math.min(1 - start.width, Math.max(0, start.x + dx)),
      y: Math.min(1 - start.height, Math.max(0, start.y + dy)),
    };
  }
  const hasW = handle.includes('w');
  const hasE = handle.includes('e');
  const hasN = handle.includes('n');
  const hasS = handle.includes('s');
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (hasW) left = Math.min(right - MIN_CROP, Math.max(0, left + dx));
  if (hasE) right = Math.max(left + MIN_CROP, Math.min(1, right + dx));
  if (hasN) top = Math.min(bottom - MIN_CROP, Math.max(0, top + dy));
  if (hasS) bottom = Math.max(top + MIN_CROP, Math.min(1, bottom + dy));
  if (ratio === null) return { x: left, y: top, width: right - left, height: bottom - top };
  return constrainDrag(start, { left, top, right, bottom }, { hasW, hasE, hasN, hasS }, ratio / imageAspect);
}

interface Edges {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

function constrainDrag(
  start: Rect,
  e: Edges,
  sides: { hasW: boolean; hasE: boolean; hasN: boolean; hasS: boolean },
  normRatio: number,
): Rect {
  const isHorizontal = sides.hasW || sides.hasE;
  const isVertical = sides.hasN || sides.hasS;
  let width = e.right - e.left;
  let height = e.bottom - e.top;
  if (isHorizontal && (!isVertical || width / normRatio >= height)) height = width / normRatio;
  else width = height * normRatio;
  // Anchor: the opposite side, or the centre on the axis the handle does not touch.
  const anchorX = sides.hasW ? start.x + start.width : sides.hasE ? start.x : start.x + start.width / 2;
  const anchorY = sides.hasN ? start.y + start.height : sides.hasS ? start.y : start.y + start.height / 2;
  const maxW = sides.hasW ? anchorX : sides.hasE ? 1 - anchorX : 2 * Math.min(anchorX, 1 - anchorX);
  const maxH = sides.hasN ? anchorY : sides.hasS ? 1 - anchorY : 2 * Math.min(anchorY, 1 - anchorY);
  const scale = Math.min(1, maxW / width, maxH / height);
  width *= scale;
  height *= scale;
  const x = sides.hasW ? anchorX - width : sides.hasE ? anchorX : anchorX - width / 2;
  const y = sides.hasN ? anchorY - height : sides.hasS ? anchorY : anchorY - height / 2;
  return { x, y, width, height };
}

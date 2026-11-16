import type { Rect } from '../types';

/**
 * `expand` grows the canvas by the border and puts a solid layer beneath
 * the content; `overlay` keeps the canvas size and covers its edges with a
 * layer above the content.
 */
export type BorderPlacement = 'expand' | 'overlay';

export interface BorderWidths {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** Corner radii in pixels; 0 keeps a corner square. */
export interface BorderCorners {
  /** Rounds the outer corners of the frame (the canvas's corners). */
  readonly outer: number;
  /** Rounds the corners of the window inside the frame. */
  readonly inner: number;
}

export const SQUARE_CORNERS: BorderCorners = { outer: 0, inner: 0 };

/**
 * Where the Border layer goes in the project group: `bottom` is a backdrop
 * beneath the content, `top` covers it.
 */
export type BorderLayerPosition = 'bottom' | 'top';

export interface BorderPlan {
  /** Document size after the border is applied. */
  readonly width: number;
  readonly height: number;
  /** How far existing content moves; non-zero only when expanding. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Document-space window left transparent in the border layer; null fills it solid. */
  readonly hole: Rect | null;
  readonly layerPosition: BorderLayerPosition;
  /** Radius of the canvas's corners, at most half its short side. */
  readonly outerRadius: number;
  /** Radius of the window's corners, at most half its short side; 0 without a window. */
  readonly innerRadius: number;
}

/** Parse a width field into a whole, non-negative pixel count; junk reads as 0. */
export function parseBorderWidth(raw: string): number {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

/** Clamp a corner radius to half the short side of a `width` x `height` rectangle. */
export function clampCornerRadius(radius: number, width: number, height: number): number {
  if (!Number.isFinite(radius) || radius <= 0) return 0;
  return Math.min(radius, Math.min(width, height) / 2);
}

export function uniformBorderWidths(width: number): BorderWidths {
  return { top: width, right: width, bottom: width, left: width };
}

/**
 * Work out the canvas and border-layer geometry. Null when there is nothing
 * to draw (every width is zero) or the expanded canvas would exceed
 * `maxSide`.
 *
 * An expanded border with a rounded window goes above the content with a
 * window over the old canvas, so its inner corners can cover the content's.
 */
export function planBorder(
  docWidth: number,
  docHeight: number,
  widths: BorderWidths,
  placement: BorderPlacement,
  maxSide: number,
  corners: BorderCorners = SQUARE_CORNERS,
): BorderPlan | null {
  const { top, right, bottom, left } = widths;
  if (top + right + bottom + left <= 0) return null;

  if (placement === 'expand') {
    const width = docWidth + left + right;
    const height = docHeight + top + bottom;
    if (width > maxSide || height > maxSide) return null;
    const innerRadius = clampCornerRadius(corners.inner, docWidth, docHeight);
    const hole = innerRadius > 0 ? { x: left, y: top, width: docWidth, height: docHeight } : null;
    return {
      width, height, offsetX: left, offsetY: top, hole,
      layerPosition: hole ? 'top' : 'bottom',
      outerRadius: clampCornerRadius(corners.outer, width, height),
      innerRadius,
    };
  }

  const holeWidth = docWidth - left - right;
  const holeHeight = docHeight - top - bottom;
  const hole = holeWidth > 0 && holeHeight > 0
    ? { x: left, y: top, width: holeWidth, height: holeHeight }
    : null;
  return {
    width: docWidth, height: docHeight, offsetX: 0, offsetY: 0, hole,
    layerPosition: 'top',
    outerRadius: clampCornerRadius(corners.outer, docWidth, docHeight),
    innerRadius: hole ? clampCornerRadius(corners.inner, hole.width, hole.height) : 0,
  };
}

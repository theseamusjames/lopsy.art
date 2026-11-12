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

export interface BorderPlan {
  /** Document size after the border is applied. */
  readonly width: number;
  readonly height: number;
  /** How far existing content moves; non-zero only when expanding. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Document-space window left transparent in the border layer; null fills it solid. */
  readonly hole: Rect | null;
}

/** Parse a width field into a whole, non-negative pixel count; junk reads as 0. */
export function parseBorderWidth(raw: string): number {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

export function uniformBorderWidths(width: number): BorderWidths {
  return { top: width, right: width, bottom: width, left: width };
}

/**
 * Work out the canvas and border-layer geometry. Null when there is nothing
 * to draw (every width is zero) or the expanded canvas would exceed
 * `maxSide`.
 */
export function planBorder(
  docWidth: number,
  docHeight: number,
  widths: BorderWidths,
  placement: BorderPlacement,
  maxSide: number,
): BorderPlan | null {
  const { top, right, bottom, left } = widths;
  if (top + right + bottom + left <= 0) return null;

  if (placement === 'expand') {
    const width = docWidth + left + right;
    const height = docHeight + top + bottom;
    if (width > maxSide || height > maxSide) return null;
    return { width, height, offsetX: left, offsetY: top, hole: null };
  }

  const holeWidth = docWidth - left - right;
  const holeHeight = docHeight - top - bottom;
  const hole = holeWidth > 0 && holeHeight > 0
    ? { x: left, y: top, width: holeWidth, height: holeHeight }
    : null;
  return { width: docWidth, height: docHeight, offsetX: 0, offsetY: 0, hole };
}

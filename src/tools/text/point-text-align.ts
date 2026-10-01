import type { TextAlign } from '../../types';

/**
 * Point text has no box, so the engine aligns its lines about the anchor (the
 * click point): the anchor is the block's left edge for left / justify, its
 * centre for center and its right edge for right. This is the share of the
 * block's width that lies left of the anchor.
 */
export function anchorShareOfWidth(align: TextAlign): number {
  if (align === 'center') return 0.5;
  if (align === 'right') return 1;
  return 0;
}

/** True when text is laid out about an anchor point rather than in an area box. */
export function isPointTextLayout(areaWidth: number | null, isVertical: boolean): boolean {
  return areaWidth === null && !isVertical;
}

/**
 * How far to move a point-text anchor when its alignment changes so the block
 * stays where it is: the widest line keeps its place and the others realign
 * against it, instead of the whole block swinging around the old anchor.
 */
export function alignmentAnchorShift(from: TextAlign, to: TextAlign, blockWidth: number): number {
  return (anchorShareOfWidth(to) - anchorShareOfWidth(from)) * blockWidth;
}

/**
 * Width of a laid-out block (its widest line, letter spacing included) from
 * the engine's flat `[x, top, w, h, offset, ...]` glyph positions.
 */
export function blockWidthFromGlyphs(positions: ArrayLike<number>): number {
  let left = Infinity;
  let right = -Infinity;
  for (let i = 0; i + 4 < positions.length; i += 5) {
    const x = positions[i] ?? 0;
    left = Math.min(left, x);
    right = Math.max(right, x + (positions[i + 2] ?? 0));
  }
  return right > left ? right - left : 0;
}

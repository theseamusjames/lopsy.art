import type { Point } from '../../types';
import type { GlyphPlacement } from './text-on-path';

/**
 * A glyph's ink rectangle in its own frame: x runs along the path tangent
 * from the placement point (the centre of the glyph's advance on the
 * baseline), y runs down from the baseline.
 */
export interface GlyphInkRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A glyph's ink rectangle placed on the path: rotated about (x, y). */
export interface PlacedGlyphBox extends GlyphInkRect {
  x: number;
  y: number;
  rotation: number;
}

/** Canvas2D `TextMetrics` fields that locate a glyph's ink. */
export interface GlyphInkMetrics {
  actualBoundingBoxLeft: number;
  actualBoundingBoxRight: number;
  actualBoundingBoxAscent: number;
  actualBoundingBoxDescent: number;
}

/** Room left around the ink for antialiased edges. */
export const PATH_TEXT_INK_PADDING = 2;

/**
 * Ink rectangle of a glyph that is drawn with its advance (`advance`)
 * centred on the placement point, from its Canvas2D metrics. Returns null
 * for glyphs without ink (spaces).
 */
export function glyphInkRect(metrics: GlyphInkMetrics, advance: number): GlyphInkRect | null {
  const origin = -advance / 2;
  const rect = {
    left: origin - metrics.actualBoundingBoxLeft,
    right: origin + metrics.actualBoundingBoxRight,
    top: -metrics.actualBoundingBoxAscent,
    bottom: metrics.actualBoundingBoxDescent,
  };
  if (!(rect.right > rect.left) || !(rect.bottom > rect.top)) return null;
  return rect;
}

/** Places each inked glyph's rectangle at its path placement. */
export function placeGlyphBoxes(
  placements: readonly GlyphPlacement[],
  inkRects: readonly (GlyphInkRect | null)[],
): PlacedGlyphBox[] {
  const boxes: PlacedGlyphBox[] = [];
  for (const p of placements) {
    const ink = inkRects[p.charIndex];
    if (!ink) continue;
    boxes.push({ ...ink, x: p.x, y: p.y, rotation: p.rotation });
  }
  return boxes;
}

function boxCorners(box: PlacedGlyphBox): Point[] {
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  const corners: Point[] = [];
  for (const [u, v] of [
    [box.left, box.top],
    [box.right, box.top],
    [box.right, box.bottom],
    [box.left, box.bottom],
  ] as const) {
    corners.push({ x: box.x + u * cos - v * sin, y: box.y + u * sin + v * cos });
  }
  return corners;
}

/**
 * Integer, document-clipped bounds of the glyph boxes' rotated corners,
 * grown by `padding`. Null when there is no ink inside the document.
 */
export function glyphBoxesBounds(
  boxes: readonly PlacedGlyphBox[],
  padding: number,
  docWidth: number,
  docHeight: number,
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    for (const c of boxCorners(box)) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
    }
  }
  if (minX === Infinity) return null;

  // Anything outside the document is never composited.
  const x0 = Math.max(0, Math.floor(minX - padding));
  const y0 = Math.max(0, Math.floor(minY - padding));
  const x1 = Math.min(docWidth, Math.ceil(maxX + padding));
  const y1 = Math.min(docHeight, Math.ceil(maxY + padding));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The boxes moved by (dx, dy). */
export function offsetGlyphBoxes(
  boxes: readonly PlacedGlyphBox[],
  dx: number,
  dy: number,
): PlacedGlyphBox[] {
  return boxes.map((b) => ({ ...b, x: b.x + dx, y: b.y + dy }));
}

/** Whether `point` lies within `slop` of the box, in the box's own frame. */
export function glyphBoxContains(box: PlacedGlyphBox, point: Point, slop: number): boolean {
  const dx = point.x - box.x;
  const dy = point.y - box.y;
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  const u = dx * cos + dy * sin;
  const v = -dx * sin + dy * cos;
  return u >= box.left - slop && u <= box.right + slop && v >= box.top - slop && v <= box.bottom + slop;
}

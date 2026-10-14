import type { Color, Rect } from '../../types';
import { contextOptions } from '../../engine/color-space';
import { pathStrokeBounds, tracePath, type PathAnchor } from '../../tools/path/path';

/** A straight-alpha RGBA stroke raster with its top-left at (`x`, `y`) in document space. */
export interface PathPatch {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * Rasterize a path stroke (round caps and joins) into a patch covering only
 * the stroke's bounds inside `clip`, rather than a whole-layer buffer (#1292).
 * Returns null when the stroke misses `clip`.
 */
export function rasterizePathPatch(
  anchors: readonly PathAnchor[],
  closed: boolean,
  color: Color,
  strokeWidth: number,
  clip: Rect,
): PathPatch | null {
  const bounds = pathStrokeBounds(anchors, strokeWidth);
  if (!bounds) return null;
  const x0 = Math.max(bounds.x, clip.x);
  const y0 = Math.max(bounds.y, clip.y);
  const x1 = Math.min(bounds.x + bounds.width, clip.x + clip.width);
  const y1 = Math.min(bounds.y + bounds.height, clip.y + clip.height);
  if (x1 <= x0 || y1 <= y0) return null;
  const width = x1 - x0;
  const height = y1 - y0;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', contextOptions);
  if (!ctx) return null;
  ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${color.a})`;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  tracePath(ctx, anchors, closed, -x0, -y0);
  ctx.stroke();
  return { x: x0, y: y0, width, height, data: ctx.getImageData(0, 0, width, height).data };
}

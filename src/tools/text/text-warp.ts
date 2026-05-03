import type { TextWarpStyle } from '../../types/layers';

export interface WarpPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Apply a warp deformation to a single point.
 *
 * All coordinates are in canvas-space relative to the text bounding box:
 *   x ∈ [0, width], y ∈ [0, height]
 *
 * @returns the displaced point, also in canvas-space.
 */
export function applyWarp(
  x: number,
  y: number,
  width: number,
  height: number,
  style: TextWarpStyle,
  bend: number,
): WarpPoint {
  if (style === 'none' || bend === 0) return { x, y };

  // Normalise bend to [-1, 1]
  const b = bend / 100;

  switch (style) {
    case 'arc':
      // Curve the full text block along a circular arc.
      // Horizontal position is mapped to angle; vertical displacement depends on x.
      return arcWarp(x, y, width, height, b);

    case 'arc-lower':
      // Only the lower half of the arc — text bows downward from the baseline.
      return arcLowerWarp(x, y, width, height, b);

    case 'arc-upper':
      // Only the upper half of the arc — text bows upward.
      return arcUpperWarp(x, y, width, height, b);

    case 'bulge':
      // Horizontal bulge: middle is widest, edges squeeze inward.
      return bulgeWarp(x, y, width, height, b);

    case 'flag':
      // Wave along the horizontal axis (one full cycle).
      return flagWarp(x, y, width, height, b);

    case 'wave':
      // Two sinusoidal cycles along x.
      return waveWarp(x, y, width, height, b);

    case 'fish':
      // Fish-eye: middle stretches horizontally, edges pinch.
      return fishWarp(x, y, width, height, b);

    case 'rise':
      // Vertical rise from left to right.
      return riseWarp(x, y, width, height, b);

    case 'squeeze':
      // Squeeze: sides pulled in, top/bottom flare out.
      return squeezeWarp(x, y, width, height, b);

    default:
      return { x, y };
  }
}

// ---------------------------------------------------------------------------
// Individual warp implementations
// ---------------------------------------------------------------------------

function arcWarp(x: number, y: number, width: number, height: number, b: number): WarpPoint {
  // Displace y by a sine curve that peaks at the horizontal centre.
  // Positive bend → arch upward; negative → arch downward.
  const dy = b * Math.sin(Math.PI * x / width) * height * 0.4;
  return { x, y: y - dy };
}

function arcLowerWarp(x: number, y: number, width: number, height: number, b: number): WarpPoint {
  // Same arch but only displaces the lower half of the glyph band.
  // We use a half-sine that lifts or drops the baseline only.
  const t = y / height; // 0 = top, 1 = bottom
  const dy = b * Math.sin(Math.PI * x / width) * height * 0.4 * t;
  return { x, y: y - dy };
}

function arcUpperWarp(x: number, y: number, width: number, height: number, b: number): WarpPoint {
  const t = 1 - y / height; // 0 = bottom, 1 = top
  const dy = b * Math.sin(Math.PI * x / width) * height * 0.4 * t;
  return { x, y: y - dy };
}

function bulgeWarp(x: number, y: number, width: number, height: number, b: number): WarpPoint {
  // Horizontal bulge: x is shifted toward or away from the vertical centre line.
  const cx = width / 2;
  const dx = b * Math.sin(Math.PI * y / height) * (x - cx) * 0.4;
  return { x: x + dx, y };
}

function flagWarp(x: number, y: number, width: number, height: number, b: number): WarpPoint {
  // One sinusoidal wave along the x axis — like a flag rippling.
  const dy = b * Math.sin(2 * Math.PI * x / width) * height * 0.15;
  return { x, y: y + dy };
}

function waveWarp(x: number, y: number, width: number, height: number, b: number): WarpPoint {
  // Two cycles of a sine wave.
  const dy = b * Math.sin(4 * Math.PI * x / width) * height * 0.15;
  return { x, y: y + dy };
}

function fishWarp(x: number, y: number, width: number, _height: number, b: number): WarpPoint {
  // Fish-eye: centre bulges forward horizontally.
  const cx = width / 2;
  const t = (x - cx) / cx; // -1 at left, +1 at right
  const scale = 1 + b * (1 - t * t) * 0.5;
  const newX = cx + (x - cx) / scale;
  return { x: newX, y };
}

function riseWarp(x: number, y: number, width: number, height: number, b: number): WarpPoint {
  // Linearly increase vertical offset from left to right.
  const dy = b * (x / width) * height * 0.5;
  return { x, y: y - dy };
}

function squeezeWarp(x: number, y: number, width: number, height: number, b: number): WarpPoint {
  // Squeeze the text horizontally at mid-height, leaving top and bottom unchanged.
  // t = 0 at top/bottom (no deformation), t = ±1 at vertical centre (max deformation).
  const cy = height / 2;
  const t = (y - cy) / cy; // -1 at top, 0 at centre, +1 at bottom
  const scale = 1 - b * (1 - t * t) * 0.3;
  const cx = width / 2;
  const newX = cx + (x - cx) * scale;
  return { x: newX, y };
}

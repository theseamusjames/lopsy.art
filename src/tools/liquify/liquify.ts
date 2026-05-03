/**
 * Liquify tool — pure logic, no DOM/React.
 *
 * The displacement map stores (dx, dy) pairs for each pixel in the layer.
 * A zero displacement is the identity (no warp). Each brush dab accumulates
 * into the displacement map; the render step samples the original pixel data
 * at (x + dx, y + dy) to produce the warped preview.
 */

export type LiquifyMode = 'push' | 'twirl-cw' | 'twirl-ccw' | 'bloat' | 'pinch';

export interface LiquifySettings {
  readonly mode: LiquifyMode;
  readonly brushSize: number;
  readonly pressure: number;
}

export function defaultLiquifySettings(): LiquifySettings {
  return { mode: 'push', brushSize: 64, pressure: 0.5 };
}

/**
 * Displacement map: parallel Float32Arrays for dx and dy offsets.
 * Indices: y * width + x.
 */
export interface DisplacementMap {
  readonly width: number;
  readonly height: number;
  readonly dx: Float32Array;
  readonly dy: Float32Array;
}

export function createDisplacementMap(width: number, height: number): DisplacementMap {
  return {
    width,
    height,
    dx: new Float32Array(width * height),
    dy: new Float32Array(width * height),
  };
}

/**
 * Compute a smooth radial falloff for a brush dab.
 * Returns values in [0, 1] — 1 at center, 0 at/beyond radius.
 */
function brushWeight(distSq: number, radiusSq: number): number {
  if (distSq >= radiusSq) return 0;
  const t = 1 - distSq / radiusSq;
  // Smooth cubic falloff
  return t * t * (3 - 2 * t);
}

/**
 * Apply a Push dab to the displacement map.
 * Pixels within the brush radius are nudged by (dragDx, dragDy) * weight * pressure.
 */
export function applyPushDab(
  map: DisplacementMap,
  cx: number,
  cy: number,
  dragDx: number,
  dragDy: number,
  radius: number,
  pressure: number,
): void {
  const radiusSq = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(map.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(map.height - 1, Math.ceil(cy + radius));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const distX = x - cx;
      const distY = y - cy;
      const distSq = distX * distX + distY * distY;
      const w = brushWeight(distSq, radiusSq);
      if (w <= 0) continue;
      const idx = y * map.width + x;
      map.dx[idx]! += dragDx * w * pressure;
      map.dy[idx]! += dragDy * w * pressure;
    }
  }
}

/**
 * Apply a Twirl dab. Rotates displacement vectors around the brush center.
 * CW: positive angle step; CCW: negative.
 */
export function applyTwirlDab(
  map: DisplacementMap,
  cx: number,
  cy: number,
  radius: number,
  pressure: number,
  clockwise: boolean,
): void {
  const radiusSq = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(map.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(map.height - 1, Math.ceil(cy + radius));

  // Max angle step per dab (in radians)
  const maxAngle = Math.PI * 0.1 * pressure;
  const sign = clockwise ? 1 : -1;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const distX = x - cx;
      const distY = y - cy;
      const distSq = distX * distX + distY * distY;
      const w = brushWeight(distSq, radiusSq);
      if (w <= 0) continue;

      const angle = sign * maxAngle * w;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const idx = y * map.width + x;

      // Rotate the pixel's displacement vector by `angle`
      const oldDx = map.dx[idx]!;
      const oldDy = map.dy[idx]!;
      map.dx[idx] = cosA * oldDx - sinA * oldDy;
      map.dy[idx] = sinA * oldDx + cosA * oldDy;

      // Also rotate the pixel's position offset from center
      const newDx = cosA * distX - sinA * distY - distX;
      const newDy = sinA * distX + cosA * distY - distY;
      map.dx[idx]! += newDx * w;
      map.dy[idx]! += newDy * w;
    }
  }
}

/**
 * Apply a Bloat dab. Pushes displacement vectors outward from brush center.
 */
export function applyBloatDab(
  map: DisplacementMap,
  cx: number,
  cy: number,
  radius: number,
  pressure: number,
): void {
  const radiusSq = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(map.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(map.height - 1, Math.ceil(cy + radius));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const distX = x - cx;
      const distY = y - cy;
      const distSq = distX * distX + distY * distY;
      const w = brushWeight(distSq, radiusSq);
      if (w <= 0) continue;

      const dist = Math.sqrt(distSq);
      if (dist < 0.001) continue;

      const idx = y * map.width + x;
      const scale = w * pressure * radius * 0.1;
      map.dx[idx]! -= (distX / dist) * scale;
      map.dy[idx]! -= (distY / dist) * scale;
    }
  }
}

/**
 * Apply a Pinch dab. Pulls displacement vectors toward brush center.
 */
export function applyPinchDab(
  map: DisplacementMap,
  cx: number,
  cy: number,
  radius: number,
  pressure: number,
): void {
  const radiusSq = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(map.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(map.height - 1, Math.ceil(cy + radius));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const distX = x - cx;
      const distY = y - cy;
      const distSq = distX * distX + distY * distY;
      const w = brushWeight(distSq, radiusSq);
      if (w <= 0) continue;

      const dist = Math.sqrt(distSq);
      if (dist < 0.001) continue;

      const idx = y * map.width + x;
      const scale = w * pressure * radius * 0.1;
      map.dx[idx]! += (distX / dist) * scale;
      map.dy[idx]! += (distY / dist) * scale;
    }
  }
}

/**
 * Dispatch a brush dab to the appropriate mode handler.
 */
export function applyDab(
  map: DisplacementMap,
  cx: number,
  cy: number,
  dragDx: number,
  dragDy: number,
  settings: LiquifySettings,
): void {
  const { mode, brushSize, pressure } = settings;
  const radius = brushSize / 2;

  switch (mode) {
    case 'push':
      applyPushDab(map, cx, cy, dragDx, dragDy, radius, pressure);
      break;
    case 'twirl-cw':
      applyTwirlDab(map, cx, cy, radius, pressure, true);
      break;
    case 'twirl-ccw':
      applyTwirlDab(map, cx, cy, radius, pressure, false);
      break;
    case 'bloat':
      applyBloatDab(map, cx, cy, radius, pressure);
      break;
    case 'pinch':
      applyPinchDab(map, cx, cy, radius, pressure);
      break;
  }
}

/**
 * Bilinear interpolation: sample imageData at floating-point (sx, sy).
 * Returns RGBA values 0–255.
 */
export function sampleBilinear(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
): [number, number, number, number] {
  // Clamp to valid range
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const fx = sx - x0;
  const fy = sy - y0;

  const cx0 = Math.max(0, Math.min(width - 1, x0));
  const cx1 = Math.max(0, Math.min(width - 1, x1));
  const cy0 = Math.max(0, Math.min(height - 1, y0));
  const cy1 = Math.max(0, Math.min(height - 1, y1));

  const i00 = (cy0 * width + cx0) * 4;
  const i10 = (cy0 * width + cx1) * 4;
  const i01 = (cy1 * width + cx0) * 4;
  const i11 = (cy1 * width + cx1) * 4;

  const r = (1 - fx) * (1 - fy) * data[i00]! + fx * (1 - fy) * data[i10]! +
    (1 - fx) * fy * data[i01]! + fx * fy * data[i11]!;
  const g = (1 - fx) * (1 - fy) * data[i00 + 1]! + fx * (1 - fy) * data[i10 + 1]! +
    (1 - fx) * fy * data[i01 + 1]! + fx * fy * data[i11 + 1]!;
  const b = (1 - fx) * (1 - fy) * data[i00 + 2]! + fx * (1 - fy) * data[i10 + 2]! +
    (1 - fx) * fy * data[i01 + 2]! + fx * fy * data[i11 + 2]!;
  const a = (1 - fx) * (1 - fy) * data[i00 + 3]! + fx * (1 - fy) * data[i10 + 3]! +
    (1 - fx) * fy * data[i01 + 3]! + fx * fy * data[i11 + 3]!;

  return [r, g, b, a];
}

/**
 * Render the warped image into an output Uint8ClampedArray.
 * For each output pixel (x, y), sample the original at (x + dx, y + dy).
 */
export function renderWarp(
  original: Uint8ClampedArray,
  map: DisplacementMap,
  output: Uint8ClampedArray,
): void {
  const { width, height, dx, dy } = map;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const sx = x + dx[idx]!;
      const sy = y + dy[idx]!;

      const [r, g, b, a] = sampleBilinear(original, width, height, sx, sy);
      const outIdx = idx * 4;
      output[outIdx] = Math.round(r);
      output[outIdx + 1] = Math.round(g);
      output[outIdx + 2] = Math.round(b);
      output[outIdx + 3] = Math.round(a);
    }
  }
}

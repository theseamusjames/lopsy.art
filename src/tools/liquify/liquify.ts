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
  // Quintic falloff — gentler than smoothstep, more weight near edges
  return t * t * t * (t * (t * 6 - 15) + 10);
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
      map.dx[idx]! -= dragDx * w * pressure;
      map.dy[idx]! -= dragDy * w * pressure;
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
      const scale = w * pressure * radius * 0.02;
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
      const scale = w * pressure * radius * 0.02;
      map.dx[idx]! += (distX / dist) * scale;
      map.dy[idx]! += (distY / dist) * scale;
    }
  }
}

export interface DirtyRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Dispatch a brush dab and return the dirty bounding rect.
 */
export function applyDab(
  map: DisplacementMap,
  cx: number,
  cy: number,
  dragDx: number,
  dragDy: number,
  settings: LiquifySettings,
): DirtyRect {
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

  const x0 = Math.max(0, Math.floor(cx - radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const x1 = Math.min(map.width - 1, Math.ceil(cx + radius));
  const y1 = Math.min(map.height - 1, Math.ceil(cy + radius));
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export const MAX_DISP = 2048;

/**
 * Encode the full displacement map into a pre-allocated RGBA8 buffer.
 * Called once on session open to initialise the persistent buffer.
 */
export function encodeDisplacementMap(map: DisplacementMap, out: Uint8Array): void {
  const { width, height, dx, dy } = map;
  const len = width * height;

  for (let i = 0; i < len; i++) {
    const ndx = Math.max(0, Math.min(65535, Math.round((dx[i]! / MAX_DISP + 1.0) * 0.5 * 65535)));
    const ndy = Math.max(0, Math.min(65535, Math.round((dy[i]! / MAX_DISP + 1.0) * 0.5 * 65535)));
    const o = i * 4;
    out[o] = (ndx >> 8) & 0xFF;
    out[o + 1] = ndx & 0xFF;
    out[o + 2] = (ndy >> 8) & 0xFF;
    out[o + 3] = ndy & 0xFF;
  }
}

/**
 * Re-encode only the dirty sub-rectangle into the persistent buffer,
 * then return a contiguous copy of that region for GPU sub-image upload.
 */
export function encodeDisplacementRegion(
  map: DisplacementMap,
  encoded: Uint8Array,
  rect: DirtyRect,
): Uint8Array {
  const { width, dx, dy } = map;
  const { x: rx, y: ry, w: rw, h: rh } = rect;
  const sub = new Uint8Array(rw * rh * 4);

  for (let row = 0; row < rh; row++) {
    const mapY = ry + row;
    for (let col = 0; col < rw; col++) {
      const mapX = rx + col;
      const idx = mapY * width + mapX;
      const ndx = Math.max(0, Math.min(65535, Math.round((dx[idx]! / MAX_DISP + 1.0) * 0.5 * 65535)));
      const ndy = Math.max(0, Math.min(65535, Math.round((dy[idx]! / MAX_DISP + 1.0) * 0.5 * 65535)));

      const fullOff = idx * 4;
      encoded[fullOff] = (ndx >> 8) & 0xFF;
      encoded[fullOff + 1] = ndx & 0xFF;
      encoded[fullOff + 2] = (ndy >> 8) & 0xFF;
      encoded[fullOff + 3] = ndy & 0xFF;

      const subOff = (row * rw + col) * 4;
      sub[subOff] = encoded[fullOff]!;
      sub[subOff + 1] = encoded[fullOff + 1]!;
      sub[subOff + 2] = encoded[fullOff + 2]!;
      sub[subOff + 3] = encoded[fullOff + 3]!;
    }
  }

  return sub;
}

import type { Color, Point, PixelSurface } from '../../types';

export interface BrushSettings {
  readonly size: number;
  readonly hardness: number;
  readonly opacity: number;
  readonly flow: number;
  readonly spacing: number;
}

export function defaultBrushSettings(): BrushSettings {
  return { size: 10, hardness: 0.8, opacity: 1, flow: 1, spacing: 0.25 };
}

// Stamp cache — avoids allocating Float32Array + sqrt per pixel on every move
let cachedStamp: Float32Array | null = null;
let cachedStampSize = -1;
let cachedStampHardness = -1;

export function generateBrushStamp(size: number, hardness: number): Float32Array {
  if (cachedStamp && cachedStampSize === size && cachedStampHardness === hardness) {
    return cachedStamp;
  }

  const stamp = new Float32Array(size * size);
  const center = (size - 1) / 2;
  const radius = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > radius) {
        stamp[y * size + x] = 0;
      } else {
        const normalizedDist = dist / radius;
        if (normalizedDist <= hardness) {
          stamp[y * size + x] = 1;
        } else {
          const falloff = 1 - (normalizedDist - hardness) / (1 - hardness);
          stamp[y * size + x] = Math.max(0, falloff);
        }
      }
    }
  }

  cachedStamp = stamp;
  cachedStampSize = size;
  cachedStampHardness = hardness;
  return stamp;
}

export function interpolatePoints(from: Point, to: Point, spacing: number): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 0.001) return [from];

  const step = Math.max(1, spacing);
  const count = Math.max(1, Math.ceil(dist / step));
  const points: Point[] = [];

  for (let i = 0; i <= count; i++) {
    const t = i / count;
    points.push({ x: from.x + dx * t, y: from.y + dy * t });
  }
  return points;
}

/**
 * Fast path: apply brush dab directly to a Uint8ClampedArray buffer.
 * Eliminates per-pixel getPixel/setPixel virtual dispatch and Color
 * object allocation that causes GC pressure during sustained painting.
 */
export function applyBrushDabDirect(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  center: Point,
  stamp: Float32Array,
  stampSize: number,
  color: Color,
  opacity: number,
  flow: number,
): void {
  const halfSize = Math.floor(stampSize / 2);
  const startX = Math.round(center.x) - halfSize;
  const startY = Math.round(center.y) - halfSize;
  const combinedAlpha = opacity * flow * color.a;
  const cr = color.r;
  const cg = color.g;
  const cb = color.b;

  // Clamp loop bounds to avoid per-pixel bounds checks
  const minSx = Math.max(0, -startX);
  const minSy = Math.max(0, -startY);
  const maxSx = Math.min(stampSize, width - startX);
  const maxSy = Math.min(stampSize, height - startY);

  for (let sy = minSy; sy < maxSy; sy++) {
    const py = startY + sy;
    const rowOffset = py * width;
    const stampRow = sy * stampSize;
    for (let sx = minSx; sx < maxSx; sx++) {
      const stampAlpha = stamp[stampRow + sx]!;
      if (stampAlpha <= 0) continue;

      const alpha = stampAlpha * combinedAlpha;
      const px = startX + sx;
      const offset = (rowOffset + px) * 4;

      const ea = (data[offset + 3]!) / 255;
      const outA = alpha + ea * (1 - alpha);
      if (outA <= 0) continue;

      const invOutA = 1 / outA;
      const eaOneMinusAlpha = ea * (1 - alpha);
      data[offset] = Math.min(255, Math.max(0, Math.round((cr * alpha + (data[offset]!) * eaOneMinusAlpha) * invOutA)));
      data[offset + 1] = Math.min(255, Math.max(0, Math.round((cg * alpha + (data[offset + 1]!) * eaOneMinusAlpha) * invOutA)));
      data[offset + 2] = Math.min(255, Math.max(0, Math.round((cb * alpha + (data[offset + 2]!) * eaOneMinusAlpha) * invOutA)));
      data[offset + 3] = Math.min(255, Math.round(outA * 255));
    }
  }
}

export function applyBrushDab(
  surface: PixelSurface,
  center: Point,
  stamp: Float32Array,
  stampSize: number,
  color: Color,
  opacity: number,
  flow: number,
): void {
  // Fast path for surfaces with direct buffer access
  if ('rawData' in surface) {
    const raw = surface as { rawData: Uint8ClampedArray };
    applyBrushDabDirect(raw.rawData, surface.width, surface.height, center, stamp, stampSize, color, opacity, flow);
    return;
  }

  const halfSize = Math.floor(stampSize / 2);
  const startX = Math.round(center.x) - halfSize;
  const startY = Math.round(center.y) - halfSize;

  for (let sy = 0; sy < stampSize; sy++) {
    for (let sx = 0; sx < stampSize; sx++) {
      const px = startX + sx;
      const py = startY + sy;

      if (px < 0 || px >= surface.width || py < 0 || py >= surface.height) continue;

      const stampAlpha = stamp[sy * stampSize + sx] ?? 0;
      if (stampAlpha <= 0) continue;

      const alpha = stampAlpha * opacity * flow * color.a;
      const existing = surface.getPixel(px, py);

      const outA = alpha + existing.a * (1 - alpha);
      if (outA <= 0) continue;

      const outR = Math.round((color.r * alpha + existing.r * existing.a * (1 - alpha)) / outA);
      const outG = Math.round((color.g * alpha + existing.g * existing.a * (1 - alpha)) / outA);
      const outB = Math.round((color.b * alpha + existing.b * existing.a * (1 - alpha)) / outA);

      surface.setPixel(px, py, {
        r: Math.min(255, Math.max(0, outR)),
        g: Math.min(255, Math.max(0, outG)),
        b: Math.min(255, Math.max(0, outB)),
        a: Math.min(1, outA),
      });
    }
  }
}

/**
 * Tracks leftover distance for scatter interpolation (mirrors the
 * remainder in paint-handlers' lopsy_core_interpolate).
 */
let scatterSpacingRemainder = 0;

export function resetScatterSpacingRemainder(): void {
  scatterSpacingRemainder = 0;
}

/**
 * Interpolate points along a line with scatter (random perpendicular offset).
 * Respects spacing remainder across mouse-move events so dabs are correctly
 * spaced even when individual mouse deltas are smaller than the spacing.
 */
export function interpolatePointsWithScatter(
  from: { x: number; y: number },
  to: { x: number; y: number },
  spacing: number,
  scatter: number,
  brushSize: number,
): { x: number; y: number }[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 1e-6) return [];

  const perpX = -dy / dist;
  const perpY = dx / dist;

  const startOffset = spacing - scatterSpacingRemainder;
  if (startOffset > dist) {
    scatterSpacingRemainder += dist;
    return [];
  }

  const points: { x: number; y: number }[] = [];
  let d = startOffset;
  while (d <= dist) {
    const t = d / dist;
    let x = from.x + dx * t;
    let y = from.y + dy * t;

    if (scatter > 0) {
      const offset = (Math.random() - 0.5) * 2 * (scatter / 100) * brushSize * 2;
      x += perpX * offset;
      y += perpY * offset;
    }

    points.push({ x, y });
    d += spacing;
  }
  scatterSpacingRemainder = dist - (d - spacing);

  return points;
}

export function computeShiftClickLine(from: Point, to: Point): { start: Point; end: Point } {
  return { start: from, end: to };
}

import type { Color, Point } from '../../types';

export interface PixelSurface {
  readonly width: number;
  readonly height: number;
  getPixel(x: number, y: number): Color;
  setPixel(x: number, y: number, color: Color): void;
}

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

export function generateBrushStamp(size: number, hardness: number): Float32Array {
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

export function applyBrushDab(
  surface: PixelSurface,
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

export function computeShiftClickLine(from: Point, to: Point): { start: Point; end: Point } {
  return { start: from, end: to };
}

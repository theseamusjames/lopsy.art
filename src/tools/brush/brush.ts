import type { Point } from '../../types';

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
          const t = (normalizedDist - hardness) / (1 - hardness);
          const s = t * t * (3 - 2 * t);
          stamp[y * size + x] = Math.max(0, 1 - s);
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


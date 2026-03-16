import type { Point, PixelSurface } from '../../types';

export interface EraserSettings {
  readonly size: number;
  readonly hardness: number;
  readonly opacity: number;
}

export function defaultEraserSettings(): EraserSettings {
  return { size: 10, hardness: 0.8, opacity: 1 };
}

export function applyEraserDab(
  surface: PixelSurface,
  center: Point,
  stamp: Float32Array,
  stampSize: number,
  opacity: number,
): void {
  // Fast path for surfaces with direct buffer access
  if ('rawData' in surface) {
    const data = (surface as { rawData: Uint8ClampedArray }).rawData;
    const width = surface.width;
    const height = surface.height;
    const halfSize = Math.floor(stampSize / 2);
    const startX = Math.round(center.x) - halfSize;
    const startY = Math.round(center.y) - halfSize;
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

        const eraseAmount = stampAlpha * opacity * 255;
        const px = startX + sx;
        const offset = (rowOffset + px) * 4 + 3;
        const cur = data[offset]!;
        data[offset] = Math.max(0, Math.round(cur - eraseAmount));
      }
    }
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

      const eraseAmount = stampAlpha * opacity;
      const existing = surface.getPixel(px, py);
      const newAlpha = Math.max(0, existing.a - eraseAmount);

      surface.setPixel(px, py, { ...existing, a: newAlpha });
    }
  }
}

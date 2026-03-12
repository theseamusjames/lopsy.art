import type { Color, Point } from '../../types';

export interface PixelSurface {
  readonly width: number;
  readonly height: number;
  getPixel(x: number, y: number): Color;
  setPixel(x: number, y: number, color: Color): void;
}

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

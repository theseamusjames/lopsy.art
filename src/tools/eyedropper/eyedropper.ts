import type { Color } from '../../types';

export interface PixelSurface {
  readonly width: number;
  readonly height: number;
  getPixel(x: number, y: number): Color;
  setPixel(x: number, y: number, color: Color): void;
}

export interface EyedropperSettings {
  readonly sampleSize: 'point' | '3x3' | '5x5';
}

export function defaultEyedropperSettings(): EyedropperSettings {
  return { sampleSize: 'point' };
}

export function sampleColor(
  surface: PixelSurface,
  x: number,
  y: number,
  sampleSize: 'point' | '3x3' | '5x5',
): Color {
  const px = Math.round(x);
  const py = Math.round(y);

  if (sampleSize === 'point') {
    if (px < 0 || px >= surface.width || py < 0 || py >= surface.height) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    return surface.getPixel(px, py);
  }

  const radius = sampleSize === '3x3' ? 1 : 2;
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let totalA = 0;
  let count = 0;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const sx = px + dx;
      const sy = py + dy;
      if (sx >= 0 && sx < surface.width && sy >= 0 && sy < surface.height) {
        const c = surface.getPixel(sx, sy);
        totalR += c.r;
        totalG += c.g;
        totalB += c.b;
        totalA += c.a;
        count++;
      }
    }
  }

  if (count === 0) return { r: 0, g: 0, b: 0, a: 0 };

  return {
    r: Math.round(totalR / count),
    g: Math.round(totalG / count),
    b: Math.round(totalB / count),
    a: totalA / count,
  };
}

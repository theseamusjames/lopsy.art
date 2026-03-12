import type { Color, Point } from '../../types';

export interface PixelSurface {
  readonly width: number;
  readonly height: number;
  getPixel(x: number, y: number): Color;
  setPixel(x: number, y: number, color: Color): void;
}

export interface FillSettings {
  readonly tolerance: number;
  readonly contiguous: boolean;
}

export function defaultFillSettings(): FillSettings {
  return { tolerance: 32, contiguous: true };
}

export function colorDistance(a: Color, b: Color): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  const da = (a.a - b.a) * 255;
  return Math.sqrt(dr * dr + dg * dg + db * db + da * da);
}

export function floodFill(
  surface: PixelSurface,
  startX: number,
  startY: number,
  _fillColor: Color,
  tolerance: number,
  contiguous: boolean,
): Point[] {
  const sx = Math.round(startX);
  const sy = Math.round(startY);

  if (sx < 0 || sx >= surface.width || sy < 0 || sy >= surface.height) return [];

  const targetColor = surface.getPixel(sx, sy);
  const filled: Point[] = [];
  const visited = new Uint8Array(surface.width * surface.height);

  if (contiguous) {
    const stack: Point[] = [{ x: sx, y: sy }];

    while (stack.length > 0) {
      const p = stack.pop()!;
      const idx = p.y * surface.width + p.x;
      if (visited[idx]) continue;
      visited[idx] = 1;

      const pixelColor = surface.getPixel(p.x, p.y);
      if (colorDistance(pixelColor, targetColor) > tolerance) continue;

      filled.push(p);

      if (p.x > 0) stack.push({ x: p.x - 1, y: p.y });
      if (p.x < surface.width - 1) stack.push({ x: p.x + 1, y: p.y });
      if (p.y > 0) stack.push({ x: p.x, y: p.y - 1 });
      if (p.y < surface.height - 1) stack.push({ x: p.x, y: p.y + 1 });
    }
  } else {
    for (let y = 0; y < surface.height; y++) {
      for (let x = 0; x < surface.width; x++) {
        const pixelColor = surface.getPixel(x, y);
        if (colorDistance(pixelColor, targetColor) <= tolerance) {
          filled.push({ x, y });
        }
      }
    }
  }

  return filled;
}

export function applyFill(surface: PixelSurface, pixels: Point[], color: Color): void {
  for (const p of pixels) {
    surface.setPixel(p.x, p.y, color);
  }
}

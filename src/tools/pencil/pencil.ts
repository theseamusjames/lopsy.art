import type { Color, Point } from '../../types';

export interface PixelSurface {
  readonly width: number;
  readonly height: number;
  getPixel(x: number, y: number): Color;
  setPixel(x: number, y: number, color: Color): void;
}

export interface PencilSettings {
  readonly size: number;
}

export function defaultPencilSettings(): PencilSettings {
  return { size: 1 };
}

export function bresenhamLine(x0: number, y0: number, x1: number, y1: number): Point[] {
  const points: Point[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0;
  let cy = y0;

  while (true) {
    points.push({ x: cx, y: cy });
    if (cx === x1 && cy === y1) break;

    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      cx += sx;
    }
    if (e2 < dx) {
      err += dx;
      cy += sy;
    }
  }
  return points;
}

export function drawPencilLine(
  surface: PixelSurface,
  from: Point,
  to: Point,
  color: Color,
  size: number,
): void {
  const points = bresenhamLine(
    Math.round(from.x),
    Math.round(from.y),
    Math.round(to.x),
    Math.round(to.y),
  );

  const half = Math.floor(size / 2);
  for (const p of points) {
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const px = p.x + dx;
        const py = p.y + dy;
        if (px >= 0 && px < surface.width && py >= 0 && py < surface.height) {
          surface.setPixel(px, py, color);
        }
      }
    }
  }
}

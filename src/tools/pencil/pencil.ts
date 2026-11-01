import type { Point } from '../../types';

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

export interface PointerPositions {
  canvasPos: Point;
  layerPos: Point;
  pixelPos?: Point;
}

/**
 * Pointer positions are rounded to the nearest integer, so a click in the
 * right or bottom half of a pixel would land on its neighbour. The Pencil
 * paints whole pixels, so it uses the pixel under the pointer instead
 * (`pixelPos`, the floor of the unrounded position), keeping the layer
 * offset the caller already applied.
 */
export function snapToPixelUnderPointer<T extends PointerPositions>(ctx: T): T {
  const pixel = ctx.pixelPos ?? { x: Math.floor(ctx.canvasPos.x), y: Math.floor(ctx.canvasPos.y) };
  const offsetX = ctx.canvasPos.x - ctx.layerPos.x;
  const offsetY = ctx.canvasPos.y - ctx.layerPos.y;
  return {
    ...ctx,
    canvasPos: pixel,
    layerPos: { x: pixel.x - offsetX, y: pixel.y - offsetY },
  };
}

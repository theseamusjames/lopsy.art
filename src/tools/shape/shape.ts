import type { Color, Point, Rect } from '../../types';
import type { PixelSurface } from '../fill/fill';

export type ShapeMode = 'ellipse' | 'polygon';

export interface ShapeOptions {
  readonly mode: ShapeMode;
  readonly fillColor: Color | null;
  readonly strokeColor: Color | null;
  readonly strokeWidth: number;
  readonly sides: number;
}

/**
 * Draws a shape centered at `center`, sized by dragging to `edge`.
 * The radii are |edge - center| in each axis.
 */
export function drawShape(
  buffer: PixelSurface,
  center: Point,
  edge: Point,
  options: ShapeOptions,
): void {
  const rx = Math.abs(edge.x - center.x);
  const ry = Math.abs(edge.y - center.y);
  if (rx < 1 && ry < 1) return;

  const rect: Rect = {
    x: center.x - rx,
    y: center.y - ry,
    width: rx * 2,
    height: ry * 2,
  };

  if (options.mode === 'ellipse') {
    if (options.fillColor) {
      fillEllipse(buffer, rect, options.fillColor);
    }
    if (options.strokeColor) {
      strokeEllipse(buffer, rect, options.strokeColor, options.strokeWidth);
    }
  } else {
    const vertices = computePolygonVertices(center, rx, ry, options.sides);
    if (options.fillColor) {
      fillPolygon(buffer, vertices, rect, options.fillColor);
    }
    if (options.strokeColor) {
      strokePolygon(buffer, vertices, rect, options.strokeColor, options.strokeWidth);
    }
  }
}

function fillEllipse(buffer: PixelSurface, rect: Rect, color: Color): void {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  if (rx <= 0 || ry <= 0) return;

  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(buffer.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(buffer.height, Math.ceil(rect.y + rect.height));

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) {
        buffer.setPixel(x, y, color);
      }
    }
  }
}

function strokeEllipse(buffer: PixelSurface, rect: Rect, color: Color, width: number): void {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  if (rx <= 0 || ry <= 0) return;

  const sw = Math.max(1, width);
  const outerRx = rx;
  const outerRy = ry;
  const innerRx = Math.max(0, rx - sw);
  const innerRy = Math.max(0, ry - sw);

  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(buffer.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(buffer.height, Math.ceil(rect.y + rect.height));

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const outerD = (dx / outerRx) ** 2 + (dy / outerRy) ** 2;
      if (outerD > 1) continue;
      if (innerRx <= 0 || innerRy <= 0) {
        buffer.setPixel(x, y, color);
        continue;
      }
      const innerD = (dx / innerRx) ** 2 + (dy / innerRy) ** 2;
      if (innerD >= 1) {
        buffer.setPixel(x, y, color);
      }
    }
  }
}

function computePolygonVertices(center: Point, rx: number, ry: number, sides: number): Point[] {
  const n = Math.max(3, Math.round(sides));
  const vertices: Point[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2 + (n % 2 === 0 ? Math.PI / n : 0);
    vertices.push({
      x: center.x + rx * Math.cos(angle),
      y: center.y + ry * Math.sin(angle),
    });
  }
  return vertices;
}

function isPointInPolygon(px: number, py: number, vertices: Point[]): boolean {
  let inside = false;
  const n = vertices.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const vi = vertices[i]!;
    const vj = vertices[j]!;
    if ((vi.y > py) !== (vj.y > py) && px < ((vj.x - vi.x) * (py - vi.y)) / (vj.y - vi.y) + vi.x) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

function minDistanceToEdge(px: number, py: number, vertices: Point[]): number {
  let minDist = Infinity;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const vi = vertices[i]!;
    const vj = vertices[(i + 1) % n]!;
    const d = distanceToSegment(px, py, vi.x, vi.y, vj.x, vj.y);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function fillPolygon(
  buffer: PixelSurface,
  vertices: Point[],
  rect: Rect,
  color: Color,
): void {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(buffer.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(buffer.height, Math.ceil(rect.y + rect.height));

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (isPointInPolygon(x + 0.5, y + 0.5, vertices)) {
        buffer.setPixel(x, y, color);
      }
    }
  }
}

function strokePolygon(
  buffer: PixelSurface,
  vertices: Point[],
  rect: Rect,
  color: Color,
  width: number,
): void {
  const sw = Math.max(1, width);
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(buffer.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(buffer.height, Math.ceil(rect.y + rect.height));

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!isPointInPolygon(x + 0.5, y + 0.5, vertices)) continue;
      const dist = minDistanceToEdge(x + 0.5, y + 0.5, vertices);
      if (dist < sw) {
        buffer.setPixel(x, y, color);
      }
    }
  }
}

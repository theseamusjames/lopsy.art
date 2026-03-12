import type { Color, Point, Rect } from '../../types';
import { PixelBuffer } from '../../engine/pixel-data';

export type ShapeMode = 'rectangle' | 'ellipse';

export interface ShapeOptions {
  readonly mode: ShapeMode;
  readonly fill: boolean;
  readonly strokeWidth: number;
}

export function drawShape(
  buffer: PixelBuffer,
  start: Point,
  end: Point,
  color: Color,
  options: ShapeOptions,
): void {
  const rect: Rect = {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };

  if (rect.width < 1 || rect.height < 1) return;

  if (options.mode === 'rectangle') {
    if (options.fill) {
      fillRect(buffer, rect, color);
    } else {
      strokeRect(buffer, rect, color, options.strokeWidth);
    }
  } else {
    if (options.fill) {
      fillEllipse(buffer, rect, color);
    } else {
      strokeEllipse(buffer, rect, color, options.strokeWidth);
    }
  }
}

function fillRect(buffer: PixelBuffer, rect: Rect, color: Color): void {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(buffer.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(buffer.height, Math.ceil(rect.y + rect.height));

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      buffer.setPixel(x, y, color);
    }
  }
}

function strokeRect(buffer: PixelBuffer, rect: Rect, color: Color, width: number): void {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(buffer.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(buffer.height, Math.ceil(rect.y + rect.height));
  const sw = Math.max(1, Math.floor(width));

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const inTop = y < y0 + sw;
      const inBottom = y >= y1 - sw;
      const inLeft = x < x0 + sw;
      const inRight = x >= x1 - sw;
      if (inTop || inBottom || inLeft || inRight) {
        buffer.setPixel(x, y, color);
      }
    }
  }
}

function fillEllipse(buffer: PixelBuffer, rect: Rect, color: Color): void {
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

function strokeEllipse(buffer: PixelBuffer, rect: Rect, color: Color, width: number): void {
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

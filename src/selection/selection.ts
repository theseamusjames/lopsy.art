import type { Rect } from '../types';

export function createRectSelection(
  rect: Rect,
  canvasWidth: number,
  canvasHeight: number,
): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(canvasWidth * canvasHeight);
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(canvasWidth, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(canvasHeight, Math.ceil(rect.y + rect.height));

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      mask[y * canvasWidth + x] = 255;
    }
  }
  return mask;
}

export function createEllipseSelection(
  rect: Rect,
  canvasWidth: number,
  canvasHeight: number,
): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(canvasWidth * canvasHeight);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const rx = rect.width / 2;
  const ry = rect.height / 2;

  if (rx <= 0 || ry <= 0) return mask;

  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(canvasWidth, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(canvasHeight, Math.ceil(rect.y + rect.height));

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) {
        mask[y * canvasWidth + x] = 255;
      }
    }
  }
  return mask;
}

export function invertSelection(mask: Uint8ClampedArray): Uint8ClampedArray {
  const result = new Uint8ClampedArray(mask.length);
  for (let i = 0; i < mask.length; i++) {
    result[i] = 255 - (mask[i] ?? 0);
  }
  return result;
}

export function combineSelections(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  mode: 'add' | 'subtract' | 'intersect',
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(a.length);
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    switch (mode) {
      case 'add':
        result[i] = Math.min(255, av + bv);
        break;
      case 'subtract':
        result[i] = Math.max(0, av - bv);
        break;
      case 'intersect':
        result[i] = Math.min(av, bv);
        break;
    }
  }
  return result;
}

export function selectionBounds(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
): Rect | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((mask[y * width + x] ?? 0) > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function isEmptySelection(mask: Uint8ClampedArray): boolean {
  for (let i = 0; i < mask.length; i++) {
    if ((mask[i] ?? 0) > 0) return false;
  }
  return true;
}

/**
 * Extract edge segments from a selection mask for marching ants rendering.
 * Returns arrays of horizontal and vertical line segments at pixel boundaries
 * where selected pixels border unselected pixels.
 */
export function getSelectionEdges(
  mask: Uint8ClampedArray,
  maskWidth: number,
  maskHeight: number,
): { h: Float64Array; v: Float64Array } {
  const threshold = 128;
  const hSegments: number[] = [];
  const vSegments: number[] = [];

  for (let y = 0; y < maskHeight; y++) {
    for (let x = 0; x < maskWidth; x++) {
      const selected = (mask[y * maskWidth + x] ?? 0) >= threshold;
      if (!selected) continue;

      // Top edge: selected pixel with unselected (or boundary) above
      if (y === 0 || (mask[(y - 1) * maskWidth + x] ?? 0) < threshold) {
        hSegments.push(x, y, x + 1, y);
      }
      // Bottom edge
      if (y === maskHeight - 1 || (mask[(y + 1) * maskWidth + x] ?? 0) < threshold) {
        hSegments.push(x, y + 1, x + 1, y + 1);
      }
      // Left edge
      if (x === 0 || (mask[y * maskWidth + x - 1] ?? 0) < threshold) {
        vSegments.push(x, y, x, y + 1);
      }
      // Right edge
      if (x === maskWidth - 1 || (mask[y * maskWidth + x + 1] ?? 0) < threshold) {
        vSegments.push(x + 1, y, x + 1, y + 1);
      }
    }
  }

  return { h: new Float64Array(hSegments), v: new Float64Array(vSegments) };
}

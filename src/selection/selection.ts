import type { Rect } from '../types';

interface SelectionMask {
  mask: Uint8ClampedArray | null;
  maskWidth: number;
  maskHeight: number;
}

/**
 * Look up a selection mask value in document/canvas space,
 * returning 0 for any out-of-bounds coordinate or null mask.
 */
export function getSelectionMaskValue(
  sel: SelectionMask,
  canvasX: number,
  canvasY: number,
): number {
  if (!sel.mask) return 0;
  if (canvasX < 0 || canvasX >= sel.maskWidth || canvasY < 0 || canvasY >= sel.maskHeight) return 0;
  return sel.mask[canvasY * sel.maskWidth + canvasX] ?? 0;
}

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

  // Horizontal edges: scan row by row, merge adjacent segments on the same Y
  for (let y = 0; y < maskHeight; y++) {
    let topStart = -1;
    let botStart = -1;
    for (let x = 0; x <= maskWidth; x++) {
      const selected = x < maskWidth && (mask[y * maskWidth + x] ?? 0) >= threshold;
      const isTopEdge = selected && (y === 0 || (mask[(y - 1) * maskWidth + x] ?? 0) < threshold);
      const isBotEdge = selected && (y === maskHeight - 1 || (mask[(y + 1) * maskWidth + x] ?? 0) < threshold);

      if (isTopEdge) {
        if (topStart < 0) topStart = x;
      } else {
        if (topStart >= 0) {
          hSegments.push(topStart, y, x, y);
          topStart = -1;
        }
      }
      if (isBotEdge) {
        if (botStart < 0) botStart = x;
      } else {
        if (botStart >= 0) {
          hSegments.push(botStart, y + 1, x, y + 1);
          botStart = -1;
        }
      }
    }
  }

  // Vertical edges: scan column by column, merge adjacent segments on the same X
  for (let x = 0; x < maskWidth; x++) {
    let leftStart = -1;
    let rightStart = -1;
    for (let y = 0; y <= maskHeight; y++) {
      const selected = y < maskHeight && (mask[y * maskWidth + x] ?? 0) >= threshold;
      const isLeftEdge = selected && (x === 0 || (mask[y * maskWidth + x - 1] ?? 0) < threshold);
      const isRightEdge = selected && (x === maskWidth - 1 || (mask[y * maskWidth + x + 1] ?? 0) < threshold);

      if (isLeftEdge) {
        if (leftStart < 0) leftStart = y;
      } else {
        if (leftStart >= 0) {
          vSegments.push(x, leftStart, x, y);
          leftStart = -1;
        }
      }
      if (isRightEdge) {
        if (rightStart < 0) rightStart = y;
      } else {
        if (rightStart >= 0) {
          vSegments.push(x + 1, rightStart, x + 1, y);
          rightStart = -1;
        }
      }
    }
  }

  return { h: new Float64Array(hSegments), v: new Float64Array(vSegments) };
}

/**
 * Trace selection edge segments into connected contour polylines.
 * Each contour is a flat array of [x0, y0, x1, y1, ...] coordinates.
 * Segments that share endpoints are chained so the canvas dash pattern
 * flows continuously around each contour instead of restarting per segment.
 */
export function traceSelectionContours(
  mask: Uint8ClampedArray,
  maskWidth: number,
  maskHeight: number,
): number[][] {
  const edges = getSelectionEdges(mask, maskWidth, maskHeight);

  // Collect all segments
  const segs: Array<[number, number, number, number]> = [];
  for (let i = 0; i < edges.h.length; i += 4) {
    segs.push([edges.h[i]!, edges.h[i + 1]!, edges.h[i + 2]!, edges.h[i + 3]!]);
  }
  for (let i = 0; i < edges.v.length; i += 4) {
    segs.push([edges.v[i]!, edges.v[i + 1]!, edges.v[i + 2]!, edges.v[i + 3]!]);
  }

  if (segs.length === 0) return [];

  // Build endpoint → segment indices map
  const endMap = new Map<string, number[]>();
  const key = (x: number, y: number) => `${x},${y}`;

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) {
      const list = endMap.get(k);
      if (list) list.push(i);
      else endMap.set(k, [i]);
    }
  }

  // Walk connected segments into contours
  const visited = new Uint8Array(segs.length);
  const contours: number[][] = [];

  for (let i = 0; i < segs.length; i++) {
    if (visited[i]) continue;
    visited[i] = 1;
    const s = segs[i]!;
    const pts: number[] = [s[0], s[1], s[2], s[3]];
    let tailKey = key(s[2], s[3]);

    // Walk forward from tail
    for (;;) {
      const neighbors = endMap.get(tailKey);
      if (!neighbors) break;
      let found = false;
      for (const ni of neighbors) {
        if (visited[ni]) continue;
        visited[ni] = 1;
        const ns = segs[ni]!;
        const k0 = key(ns[0], ns[1]);
        if (k0 === tailKey) {
          pts.push(ns[2], ns[3]);
          tailKey = key(ns[2], ns[3]);
        } else {
          pts.push(ns[0], ns[1]);
          tailKey = key(ns[0], ns[1]);
        }
        found = true;
        break;
      }
      if (!found) break;
    }

    contours.push(pts);
  }

  return contours;
}

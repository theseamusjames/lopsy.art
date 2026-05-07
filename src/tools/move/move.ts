import type { Layer, Point, Rect } from '../../types';

export interface LayerBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

export interface SnapToLayersResult {
  x: number;
  y: number;
  /** Vertical snap line positions (x-coordinates in doc space). */
  snapLinesX: number[];
  /** Horizontal snap line positions (y-coordinates in doc space). */
  snapLinesY: number[];
}

/** Extract the bounding box for a layer that has x/y/width/height. */
function getLayerBounds(layer: Layer): LayerBounds | null {
  if (layer.type === 'group') return null;
  const w = layer.width ?? 0;
  const h = layer.type === 'text' ? 0 : (layer as { height?: number }).height ?? 0;
  if (w <= 0 && h <= 0) return null;
  return {
    left: layer.x,
    right: layer.x + w,
    top: layer.y,
    bottom: layer.y + h,
    centerX: layer.x + w / 2,
    centerY: layer.y + h / 2,
  };
}

/**
 * Snap a moving layer's proposed position to nearby edges of other layers.
 *
 * @param movingLayerId  The layer being moved (excluded from candidates).
 * @param movingLayerX   Proposed x position of the moving layer.
 * @param movingLayerY   Proposed y position of the moving layer.
 * @param movingWidth    Width of the moving layer's bounding box.
 * @param movingHeight   Height of the moving layer's bounding box.
 * @param otherLayers    All layers except the moving one (candidates).
 * @param threshold      Snap distance in document-space pixels.
 */
export function snapPositionToLayers(
  movingLayerX: number,
  movingLayerY: number,
  movingWidth: number,
  movingHeight: number,
  otherLayers: readonly Layer[],
  threshold: number,
): SnapToLayersResult {
  const movingLeft = movingLayerX;
  const movingRight = movingLayerX + movingWidth;
  const movingCenterX = movingLayerX + movingWidth / 2;
  const movingTop = movingLayerY;
  const movingBottom = movingLayerY + movingHeight;
  const movingCenterY = movingLayerY + movingHeight / 2;

  let snapDx: number | null = null;
  let snapDy: number | null = null;
  const snapLinesX: number[] = [];
  const snapLinesY: number[] = [];

  // Moving edges: [edge position, delta to correct the layer]
  const movingEdgesX: Array<[number, (snapTarget: number) => number]> = [
    [movingLeft,    (t) => t],
    [movingCenterX, (t) => t - movingWidth / 2],
    [movingRight,   (t) => t - movingWidth],
  ];
  const movingEdgesY: Array<[number, (snapTarget: number) => number]> = [
    [movingTop,     (t) => t],
    [movingCenterY, (t) => t - movingHeight / 2],
    [movingBottom,  (t) => t - movingHeight],
  ];

  for (const layer of otherLayers) {
    if (!layer.visible) continue;
    const bounds = getLayerBounds(layer);
    if (!bounds) continue;

    const candidateEdgesX = [bounds.left, bounds.centerX, bounds.right];
    const candidateEdgesY = [bounds.top, bounds.centerY, bounds.bottom];

    for (const [movingEdge, toDx] of movingEdgesX) {
      for (const candidateEdge of candidateEdgesX) {
        const dist = Math.abs(movingEdge - candidateEdge);
        if (dist <= threshold) {
          const dx = toDx(candidateEdge) - movingLayerX;
          if (snapDx === null || Math.abs(dx) < Math.abs(snapDx)) {
            snapDx = dx;
            snapLinesX.length = 0;
            snapLinesX.push(candidateEdge);
          } else if (Math.abs(dx) === Math.abs(snapDx)) {
            if (!snapLinesX.includes(candidateEdge)) snapLinesX.push(candidateEdge);
          }
        }
      }
    }

    for (const [movingEdge, toDy] of movingEdgesY) {
      for (const candidateEdge of candidateEdgesY) {
        const dist = Math.abs(movingEdge - candidateEdge);
        if (dist <= threshold) {
          const dy = toDy(candidateEdge) - movingLayerY;
          if (snapDy === null || Math.abs(dy) < Math.abs(snapDy)) {
            snapDy = dy;
            snapLinesY.length = 0;
            snapLinesY.push(candidateEdge);
          } else if (Math.abs(dy) === Math.abs(snapDy)) {
            if (!snapLinesY.includes(candidateEdge)) snapLinesY.push(candidateEdge);
          }
        }
      }
    }
  }

  return {
    x: movingLayerX + (snapDx ?? 0),
    y: movingLayerY + (snapDy ?? 0),
    snapLinesX: snapDx !== null ? snapLinesX : [],
    snapLinesY: snapDy !== null ? snapLinesY : [],
  };
}

export type AlignEdge = 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom';

export function computeAlign(
  edge: AlignEdge,
  contentBounds: Rect,
  canvasWidth: number,
  canvasHeight: number,
  layerX: number,
  layerY: number,
): { x: number; y: number } {
  const relX = contentBounds.x - layerX;
  const relY = contentBounds.y - layerY;

  let x = layerX;
  let y = layerY;

  switch (edge) {
    case 'left':
      x = -relX;
      break;
    case 'center-h':
      x = Math.round((canvasWidth - contentBounds.width) / 2) - relX;
      break;
    case 'right':
      x = canvasWidth - contentBounds.width - relX;
      break;
    case 'top':
      y = -relY;
      break;
    case 'center-v':
      y = Math.round((canvasHeight - contentBounds.height) / 2) - relY;
      break;
    case 'bottom':
      y = canvasHeight - contentBounds.height - relY;
      break;
  }

  return { x: x || 0, y: y || 0 };
}

/**
 * Compute new dimensions and position to fit content within a canvas such
 * that the longest side fits within the canvas bounds, preserving aspect
 * ratio, and the content is centered. Used by the move-tool "Fit" action
 * to bring an oversized pasted/dropped image onto the artboard.
 */
export function computeFit(
  contentWidth: number,
  contentHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number; width: number; height: number } {
  if (contentWidth <= 0 || contentHeight <= 0) {
    return { x: 0, y: 0, width: contentWidth, height: contentHeight };
  }
  const scale = Math.min(canvasWidth / contentWidth, canvasHeight / contentHeight);
  const newW = Math.max(1, Math.round(contentWidth * scale));
  const newH = Math.max(1, Math.round(contentHeight * scale));
  return {
    x: Math.round((canvasWidth - newW) / 2),
    y: Math.round((canvasHeight - newH) / 2),
    width: newW,
    height: newH,
  };
}

export function computeLayerMove(
  startPos: Point,
  currentPos: Point,
  layerX: number,
  layerY: number,
): { x: number; y: number } {
  return {
    x: layerX + (currentPos.x - startPos.x),
    y: layerY + (currentPos.y - startPos.y),
  };
}

export function computeNudge(
  direction: 'up' | 'down' | 'left' | 'right',
  amount: number,
  layerX: number,
  layerY: number,
): { x: number; y: number } {
  switch (direction) {
    case 'up':
      return { x: layerX, y: layerY - amount };
    case 'down':
      return { x: layerX, y: layerY + amount };
    case 'left':
      return { x: layerX - amount, y: layerY };
    case 'right':
      return { x: layerX + amount, y: layerY };
  }
}

interface PixelData {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export function getContentBounds(
  pixelData: PixelData,
  layerX: number,
  layerY: number,
): Rect | null {
  const { width, height, data } = pixelData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;

  return {
    x: layerX + minX,
    y: layerY + minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export function snapPositionToGrid(
  x: number,
  y: number,
  gridSize: number,
  docWidth?: number,
  docHeight?: number,
): { x: number; y: number } {
  // Grid is centered at (docWidth/2, docHeight/2).
  // Snap to the nearest grid line relative to the center.
  const cx = docWidth !== undefined ? docWidth / 2 : 0;
  const cy = docHeight !== undefined ? docHeight / 2 : 0;
  let snappedX = Math.round((x - cx) / gridSize) * gridSize + cx;
  let snappedY = Math.round((y - cy) / gridSize) * gridSize + cy;

  // Also snap to canvas edges (0, docWidth, docHeight) if closer than
  // the grid snap, so content aligns to edges even when the centered
  // grid doesn't perfectly land on them.
  if (docWidth !== undefined) {
    const edgeThreshold = gridSize / 2;
    if (Math.abs(x) < edgeThreshold) snappedX = 0;
    else if (Math.abs(x - docWidth) < edgeThreshold) snappedX = docWidth;
  }
  if (docHeight !== undefined) {
    const edgeThreshold = gridSize / 2;
    if (Math.abs(y) < edgeThreshold) snappedY = 0;
    else if (Math.abs(y - docHeight) < edgeThreshold) snappedY = docHeight;
  }

  return { x: snappedX, y: snappedY };
}

export function snapToGuide(
  position: number,
  guides: number[],
  snapThreshold: number,
): { snapped: boolean; value: number } {
  for (const guide of guides) {
    if (Math.abs(position - guide) <= snapThreshold) {
      return { snapped: true, value: guide };
    }
  }
  return { snapped: false, value: position };
}

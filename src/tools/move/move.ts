import type { Point, Rect } from '../../types';

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

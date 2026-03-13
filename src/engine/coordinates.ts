import type { Point, Rect, ViewportState } from '../types';

export function screenToCanvas(screenX: number, screenY: number, viewport: ViewportState): Point {
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  return {
    x: (screenX - cx - viewport.panX) / viewport.zoom,
    y: (screenY - cy - viewport.panY) / viewport.zoom,
  };
}

export function canvasToScreen(canvasX: number, canvasY: number, viewport: ViewportState): Point {
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  return {
    x: canvasX * viewport.zoom + cx + viewport.panX,
    y: canvasY * viewport.zoom + cy + viewport.panY,
  };
}

export function screenDeltaToCanvas(dx: number, dy: number, zoom: number): Point {
  return {
    x: dx / zoom,
    y: dy / zoom,
  };
}

export function getVisibleRegion(viewport: ViewportState): Rect {
  const topLeft = screenToCanvas(0, 0, viewport);
  const bottomRight = screenToCanvas(viewport.width, viewport.height, viewport);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

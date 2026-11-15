import type { Point, Size } from '../types/geometry';

export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 64;

export interface ViewTransform {
  zoom: number;
  panX: number;
  panY: number;
}

/**
 * Zoom to `zoom` while keeping the document point under `anchor` pinned to the
 * screen — at `target` if given (a pinch whose centre drifts also pans), or in
 * place otherwise. Points are CSS pixels relative to the canvas container's
 * top-left; pan is measured from the container centre, as in the viewport.
 */
export function zoomAtPoint(
  from: ViewTransform,
  zoom: number,
  anchor: Point,
  screen: Size,
  target: Point = anchor,
): ViewTransform {
  const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  const scale = nextZoom / from.zoom;
  const anchorX = anchor.x - screen.width / 2;
  const anchorY = anchor.y - screen.height / 2;
  return {
    zoom: nextZoom,
    panX: target.x - screen.width / 2 - (anchorX - from.panX) * scale,
    panY: target.y - screen.height / 2 - (anchorY - from.panY) * scale,
  };
}

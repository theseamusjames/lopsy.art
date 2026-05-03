import type { Point } from '../types';

export interface ViewportTransform {
  panX: number;
  panY: number;
  zoom: number;
  canvasWidth: number;
  canvasHeight: number;
  docWidth: number;
  docHeight: number;
  rotation: number;
}

/**
 * Convert a screen-space point (relative to the canvas container's top-left)
 * into document-space coordinates, accounting for pan, zoom, and canvas rotation.
 *
 * The rotation is applied around the viewport center. To invert it we
 * un-rotate the screen-space offset by -rotation before dividing by zoom.
 */
export function screenToDoc(screenX: number, screenY: number, vt: ViewportTransform): Point {
  // Offset from viewport center in screen space
  const offsetX = screenX - vt.panX - vt.canvasWidth / 2;
  const offsetY = screenY - vt.panY - vt.canvasHeight / 2;

  // Un-rotate (inverse of the CSS rotation that was applied to the canvas element)
  const cos = Math.cos(-vt.rotation);
  const sin = Math.sin(-vt.rotation);
  const unrotatedX = offsetX * cos - offsetY * sin;
  const unrotatedY = offsetX * sin + offsetY * cos;

  const x = unrotatedX / vt.zoom + vt.docWidth / 2;
  const y = unrotatedY / vt.zoom + vt.docHeight / 2;
  return { x: Math.round(x), y: Math.round(y) };
}

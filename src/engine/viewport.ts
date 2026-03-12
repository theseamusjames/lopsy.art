import type { Point, Rect } from '../types/index';
import { clamp } from '../utils/math';

const MIN_ZOOM = 0.01;
const MAX_ZOOM = 64;

export class Viewport {
  private _zoom: number;
  private _panX: number;
  private _panY: number;
  private _width: number;
  private _height: number;

  constructor(width: number, height: number) {
    this._zoom = 1;
    this._panX = 0;
    this._panY = 0;
    this._width = width;
    this._height = height;
  }

  get zoom(): number {
    return this._zoom;
  }

  get panX(): number {
    return this._panX;
  }

  get panY(): number {
    return this._panY;
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  setSize(width: number, height: number): void {
    this._width = width;
    this._height = height;
  }

  screenToCanvas(point: Point): Point {
    return {
      x: (point.x - this._panX) / this._zoom,
      y: (point.y - this._panY) / this._zoom,
    };
  }

  canvasToScreen(point: Point): Point {
    return {
      x: point.x * this._zoom + this._panX,
      y: point.y * this._zoom + this._panY,
    };
  }

  zoomTo(level: number, center?: Point): void {
    const newZoom = clamp(level, MIN_ZOOM, MAX_ZOOM);
    const anchor = center ?? { x: this._width / 2, y: this._height / 2 };

    // Convert anchor to canvas coords before zoom change
    const canvasPoint = this.screenToCanvas(anchor);

    this._zoom = newZoom;

    // Adjust pan so the canvas point stays under the anchor
    this._panX = anchor.x - canvasPoint.x * this._zoom;
    this._panY = anchor.y - canvasPoint.y * this._zoom;
  }

  zoomBy(delta: number, center: Point): void {
    this.zoomTo(this._zoom * delta, center);
  }

  pan(dx: number, dy: number): void {
    this._panX += dx;
    this._panY += dy;
  }

  fitToRect(rect: Rect, padding: number = 0): void {
    const availableWidth = this._width - padding * 2;
    const availableHeight = this._height - padding * 2;

    if (availableWidth <= 0 || availableHeight <= 0) return;

    const scaleX = availableWidth / rect.width;
    const scaleY = availableHeight / rect.height;
    const newZoom = clamp(Math.min(scaleX, scaleY), MIN_ZOOM, MAX_ZOOM);

    this._zoom = newZoom;

    // Center the rect in the viewport
    const rectCenterX = rect.x + rect.width / 2;
    const rectCenterY = rect.y + rect.height / 2;

    this._panX = this._width / 2 - rectCenterX * this._zoom;
    this._panY = this._height / 2 - rectCenterY * this._zoom;
  }

  reset(): void {
    this._zoom = 1;
    this._panX = 0;
    this._panY = 0;
  }
}

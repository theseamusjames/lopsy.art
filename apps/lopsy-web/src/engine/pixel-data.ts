import type { Color, PixelSurface } from '../types/index';
import { createImageDataFromArray } from './color-space';

export class PixelBuffer {
  readonly width: number;
  readonly height: number;
  private readonly data: Uint8ClampedArray;

  constructor(width: number, height: number, data?: Uint8ClampedArray) {
    this.width = width;
    this.height = height;
    this.data = data ?? new Uint8ClampedArray(width * height * 4);
  }

  private getOffset(x: number, y: number): number {
    return (y * this.width + x) * 4;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  getPixel(x: number, y: number): Color {
    if (!this.inBounds(x, y)) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const offset = this.getOffset(x, y);
    return {
      r: this.data[offset] ?? 0,
      g: this.data[offset + 1] ?? 0,
      b: this.data[offset + 2] ?? 0,
      a: (this.data[offset + 3] ?? 0) / 255,
    };
  }

  setPixel(x: number, y: number, color: Color): void {
    if (!this.inBounds(x, y)) return;
    const offset = this.getOffset(x, y);
    this.data[offset] = color.r;
    this.data[offset + 1] = color.g;
    this.data[offset + 2] = color.b;
    this.data[offset + 3] = Math.round(color.a * 255);
  }

  fill(color: Color): void {
    const a8 = Math.round(color.a * 255);
    const u32 = new Uint32Array(this.data.buffer, this.data.byteOffset, this.data.byteLength / 4);
    const packed = (a8 << 24) | (color.b << 16) | (color.g << 8) | color.r;
    u32.fill(packed);
  }

  clear(): void {
    this.data.fill(0);
  }

  get rawData(): Uint8ClampedArray {
    return this.data;
  }

  offsetOf(x: number, y: number): number {
    return (y * this.width + x) * 4;
  }

  static fromData(data: Uint8ClampedArray, width: number, height: number): PixelBuffer {
    const buf = new PixelBuffer(width, height);
    buf.data.set(data);
    return buf;
  }

  clone(): PixelBuffer {
    const copy = new PixelBuffer(this.width, this.height);
    copy.data.set(this.data);
    return copy;
  }

  toImageData(): ImageData {
    return createImageDataFromArray(this.data, this.width, this.height);
  }

  static fromImageData(imageData: ImageData): PixelBuffer {
    const buffer = new PixelBuffer(imageData.width, imageData.height);
    buffer.data.set(imageData.data);
    return buffer;
  }

  /** Wrap an ImageData's buffer directly — no copy. */
  static wrapImageData(imageData: ImageData): PixelBuffer {
    return new PixelBuffer(imageData.width, imageData.height, imageData.data);
  }
}

/**
 * Read-only surface that projects a layer's pixels into canvas/document
 * coordinate space. Pixels outside the layer bounds read as transparent.
 * Used by the wand tool so flood-fill covers the full canvas, not just
 * the layer's pixel buffer.
 */
export class OffsetSurface implements PixelSurface {
  readonly width: number;
  readonly height: number;
  private readonly inner: PixelBuffer;
  private readonly layerX: number;
  private readonly layerY: number;

  constructor(inner: PixelBuffer, canvasWidth: number, canvasHeight: number, layerX: number, layerY: number) {
    this.inner = inner;
    this.width = canvasWidth;
    this.height = canvasHeight;
    this.layerX = layerX;
    this.layerY = layerY;
  }

  getPixel(x: number, y: number): Color {
    return this.inner.getPixel(x - this.layerX, y - this.layerY);
  }

  setPixel(_x: number, _y: number, _color: Color): void {
    // read-only; wand only needs getPixel
  }
}


import type { Color } from '../types/index';

export class PixelBuffer {
  readonly width: number;
  readonly height: number;
  private readonly data: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
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
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = color.r;
      this.data[i + 1] = color.g;
      this.data[i + 2] = color.b;
      this.data[i + 3] = Math.round(color.a * 255);
    }
  }

  clear(): void {
    this.data.fill(0);
  }

  clone(): PixelBuffer {
    const copy = new PixelBuffer(this.width, this.height);
    copy.data.set(this.data);
    return copy;
  }

  toImageData(): ImageData {
    const imageData = new ImageData(this.width, this.height);
    imageData.data.set(this.data);
    return imageData;
  }

  static fromImageData(imageData: ImageData): PixelBuffer {
    const buffer = new PixelBuffer(imageData.width, imageData.height);
    buffer.data.set(imageData.data);
    return buffer;
  }
}

import { PixelBuffer } from './pixel-data';

export function createMaskSurface(maskData: Uint8ClampedArray, width: number, height: number): PixelBuffer {
  const buf = new PixelBuffer(width, height);
  for (let i = 0; i < maskData.length; i++) {
    const val = maskData[i] ?? 0;
    const x = i % width;
    const y = Math.floor(i / width);
    buf.setPixel(x, y, { r: val, g: val, b: val, a: 1 });
  }
  return buf;
}

export function extractMaskFromSurface(buf: PixelBuffer, width: number, height: number): Uint8ClampedArray {
  const maskData = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = buf.getPixel(x, y);
      maskData[y * width + x] = pixel.r;
    }
  }
  return maskData;
}

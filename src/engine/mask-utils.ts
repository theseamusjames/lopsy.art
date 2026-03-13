import { PixelBuffer } from './pixel-data';

export function createMaskSurface(maskData: Uint8ClampedArray, width: number, height: number): PixelBuffer {
  const buf = new PixelBuffer(width, height);
  const raw = buf.rawData;
  for (let i = 0; i < maskData.length; i++) {
    const val = maskData[i] ?? 0;
    const offset = i * 4;
    raw[offset] = val;
    raw[offset + 1] = val;
    raw[offset + 2] = val;
    raw[offset + 3] = 255;
  }
  return buf;
}

export function extractMaskFromSurface(buf: PixelBuffer, width: number, height: number): Uint8ClampedArray {
  const maskData = new Uint8ClampedArray(width * height);
  const raw = buf.rawData;
  for (let i = 0; i < maskData.length; i++) {
    maskData[i] = raw[i * 4] ?? 0;
  }
  return maskData;
}

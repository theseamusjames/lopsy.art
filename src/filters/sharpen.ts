import { PixelBuffer } from '../engine/pixel-data';
import { gaussianBlur } from './blur';

export function unsharpMask(
  buf: PixelBuffer,
  radius: number,
  amount: number,
  threshold: number,
): PixelBuffer {
  if (radius <= 0 || amount <= 0) {
    return buf.clone();
  }

  const blurred = gaussianBlur(buf, radius);
  const result = buf.clone();
  const { width, height } = buf;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const original = buf.getPixel(x, y);
      const blur = blurred.getPixel(x, y);

      const diffR = original.r - blur.r;
      const diffG = original.g - blur.g;
      const diffB = original.b - blur.b;

      const luminanceDiff = Math.abs(
        0.299 * diffR + 0.587 * diffG + 0.114 * diffB,
      );

      if (luminanceDiff < threshold) {
        continue;
      }

      result.setPixel(x, y, {
        r: Math.min(255, Math.max(0, Math.round(original.r + diffR * amount))),
        g: Math.min(255, Math.max(0, Math.round(original.g + diffG * amount))),
        b: Math.min(255, Math.max(0, Math.round(original.b + diffB * amount))),
        a: original.a,
      });
    }
  }

  return result;
}

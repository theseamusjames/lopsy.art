import { PixelBuffer } from '../engine/pixel-data';

type NoiseType = 'gaussian' | 'uniform';

/** Box-Muller transform: two uniform randoms -> one Gaussian random (mean 0, stddev 1) */
function gaussianRandom(): number {
  let u1 = Math.random();
  const u2 = Math.random();
  // Avoid log(0)
  while (u1 === 0) {
    u1 = Math.random();
  }
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function generateNoiseValue(type: NoiseType, amount: number): number {
  if (type === 'gaussian') {
    return gaussianRandom() * amount;
  }
  return (Math.random() - 0.5) * 2 * amount;
}

export function addNoise(
  buf: PixelBuffer,
  amount: number,
  type: NoiseType,
  monochromatic: boolean,
): PixelBuffer {
  if (amount <= 0) {
    return buf.clone();
  }

  const result = buf.clone();
  const { width, height } = buf;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = buf.getPixel(x, y);

      if (monochromatic) {
        const noise = generateNoiseValue(type, amount);
        result.setPixel(x, y, {
          r: clamp(Math.round(pixel.r + noise), 0, 255),
          g: clamp(Math.round(pixel.g + noise), 0, 255),
          b: clamp(Math.round(pixel.b + noise), 0, 255),
          a: pixel.a,
        });
      } else {
        result.setPixel(x, y, {
          r: clamp(Math.round(pixel.r + generateNoiseValue(type, amount)), 0, 255),
          g: clamp(Math.round(pixel.g + generateNoiseValue(type, amount)), 0, 255),
          b: clamp(Math.round(pixel.b + generateNoiseValue(type, amount)), 0, 255),
          a: pixel.a,
        });
      }
    }
  }

  return result;
}

export function fillWithNoise(
  buf: PixelBuffer,
  type: NoiseType,
  monochromatic: boolean,
): PixelBuffer {
  const result = new PixelBuffer(buf.width, buf.height);
  const { width, height } = buf;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (monochromatic) {
        const value = type === 'gaussian'
          ? clamp(Math.round(128 + gaussianRandom() * 64), 0, 255)
          : Math.round(Math.random() * 255);
        result.setPixel(x, y, { r: value, g: value, b: value, a: 1 });
      } else {
        const r = type === 'gaussian'
          ? clamp(Math.round(128 + gaussianRandom() * 64), 0, 255)
          : Math.round(Math.random() * 255);
        const g = type === 'gaussian'
          ? clamp(Math.round(128 + gaussianRandom() * 64), 0, 255)
          : Math.round(Math.random() * 255);
        const b = type === 'gaussian'
          ? clamp(Math.round(128 + gaussianRandom() * 64), 0, 255)
          : Math.round(Math.random() * 255);
        result.setPixel(x, y, { r, g, b, a: 1 });
      }
    }
  }

  return result;
}

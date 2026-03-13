import { PixelBuffer } from '../engine/pixel-data';

function buildGaussianKernel(radius: number): Float64Array {
  const size = radius * 2 + 1;
  const kernel = new Float64Array(size);
  const sigma = radius / 3 || 1;
  const coeff = 1 / (Math.sqrt(2 * Math.PI) * sigma);
  const expDenom = 2 * sigma * sigma;

  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - radius;
    kernel[i] = coeff * Math.exp(-(x * x) / expDenom);
    sum += kernel[i]!;
  }

  for (let i = 0; i < size; i++) {
    kernel[i] = kernel[i]! / sum;
  }

  return kernel;
}

function horizontalPass(
  src: PixelBuffer,
  dst: PixelBuffer,
  kernel: Float64Array,
  radius: number,
): void {
  const { width, height } = src;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;

      for (let k = -radius; k <= radius; k++) {
        const sx = Math.min(Math.max(x + k, 0), width - 1);
        const pixel = src.getPixel(sx, y);
        const weight = kernel[k + radius]!;
        rSum += pixel.r * weight;
        gSum += pixel.g * weight;
        bSum += pixel.b * weight;
        aSum += pixel.a * weight;
      }

      dst.setPixel(x, y, {
        r: Math.round(rSum),
        g: Math.round(gSum),
        b: Math.round(bSum),
        a: aSum,
      });
    }
  }
}

function verticalPass(
  src: PixelBuffer,
  dst: PixelBuffer,
  kernel: Float64Array,
  radius: number,
): void {
  const { width, height } = src;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;

      for (let k = -radius; k <= radius; k++) {
        const sy = Math.min(Math.max(y + k, 0), height - 1);
        const pixel = src.getPixel(x, sy);
        const weight = kernel[k + radius]!;
        rSum += pixel.r * weight;
        gSum += pixel.g * weight;
        bSum += pixel.b * weight;
        aSum += pixel.a * weight;
      }

      dst.setPixel(x, y, {
        r: Math.round(rSum),
        g: Math.round(gSum),
        b: Math.round(bSum),
        a: aSum,
      });
    }
  }
}

export function gaussianBlur(buf: PixelBuffer, radius: number): PixelBuffer {
  if (radius <= 0) {
    return buf.clone();
  }

  const intRadius = Math.round(radius);
  const kernel = buildGaussianKernel(intRadius);
  const temp = new PixelBuffer(buf.width, buf.height);
  const result = new PixelBuffer(buf.width, buf.height);

  horizontalPass(buf, temp, kernel, intRadius);
  verticalPass(temp, result, kernel, intRadius);

  return result;
}

export function boxBlur(buf: PixelBuffer, radius: number): PixelBuffer {
  if (radius <= 0) {
    return buf.clone();
  }

  const intRadius = Math.round(radius);
  const size = intRadius * 2 + 1;
  const weight = 1 / size;
  const kernel = new Float64Array(size).fill(weight);
  const temp = new PixelBuffer(buf.width, buf.height);
  const result = new PixelBuffer(buf.width, buf.height);

  horizontalPass(buf, temp, kernel, intRadius);
  verticalPass(temp, result, kernel, intRadius);

  return result;
}

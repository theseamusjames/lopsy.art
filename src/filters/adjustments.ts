import { PixelBuffer } from '../engine/pixel-data';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

    if (max === rNorm) {
      h = ((gNorm - bNorm) / delta + (gNorm < bNorm ? 6 : 0)) * 60;
    } else if (max === gNorm) {
      h = ((bNorm - rNorm) / delta + 2) * 60;
    } else {
      h = ((rNorm - gNorm) / delta + 4) * 60;
    }
  }

  return [h, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sNorm = s / 100;
  const lNorm = l / 100;

  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const hPrime = h / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  const m = lNorm - c / 2;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;

  if (hPrime >= 0 && hPrime < 1) {
    rPrime = c; gPrime = x; bPrime = 0;
  } else if (hPrime >= 1 && hPrime < 2) {
    rPrime = x; gPrime = c; bPrime = 0;
  } else if (hPrime >= 2 && hPrime < 3) {
    rPrime = 0; gPrime = c; bPrime = x;
  } else if (hPrime >= 3 && hPrime < 4) {
    rPrime = 0; gPrime = x; bPrime = c;
  } else if (hPrime >= 4 && hPrime < 5) {
    rPrime = x; gPrime = 0; bPrime = c;
  } else {
    rPrime = c; gPrime = 0; bPrime = x;
  }

  return [
    Math.round((rPrime + m) * 255),
    Math.round((gPrime + m) * 255),
    Math.round((bPrime + m) * 255),
  ];
}

export function brightnessContrast(
  buf: PixelBuffer,
  brightness: number,
  contrast: number,
): PixelBuffer {
  const result = buf.clone();
  const { width, height } = buf;

  // brightness: -100..100 mapped to -255..255
  const brightnessOffset = (brightness / 100) * 255;

  // contrast: -100..100 mapped to a multiplier
  // At -100 contrast factor is 0 (all gray), at 0 it's 1, at 100 it approaches infinity
  const contrastFactor =
    contrast >= 0
      ? (100 + contrast) / 100
      : (100 + contrast) / 100;
  const contrastMultiplier = contrastFactor * contrastFactor;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = buf.getPixel(x, y);

      let r = pixel.r + brightnessOffset;
      let g = pixel.g + brightnessOffset;
      let b = pixel.b + brightnessOffset;

      r = ((r - 128) * contrastMultiplier) + 128;
      g = ((g - 128) * contrastMultiplier) + 128;
      b = ((b - 128) * contrastMultiplier) + 128;

      result.setPixel(x, y, {
        r: clamp(Math.round(r), 0, 255),
        g: clamp(Math.round(g), 0, 255),
        b: clamp(Math.round(b), 0, 255),
        a: pixel.a,
      });
    }
  }

  return result;
}

export function hueSaturation(
  buf: PixelBuffer,
  hue: number,
  saturation: number,
  lightness: number,
): PixelBuffer {
  const result = buf.clone();
  const { width, height } = buf;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = buf.getPixel(x, y);
      const [h, s, l] = rgbToHsl(pixel.r, pixel.g, pixel.b);

      let newH = (h + hue) % 360;
      if (newH < 0) newH += 360;

      // saturation adjustment: -100 removes all saturation, +100 doubles it (clamped)
      const satMultiplier = 1 + saturation / 100;
      const newS = clamp(s * satMultiplier, 0, 100);

      // lightness adjustment: shift lightness
      const newL = clamp(l + (lightness / 100) * 50, 0, 100);

      const [r, g, b] = hslToRgb(newH, newS, newL);

      result.setPixel(x, y, {
        r: clamp(r, 0, 255),
        g: clamp(g, 0, 255),
        b: clamp(b, 0, 255),
        a: pixel.a,
      });
    }
  }

  return result;
}

export function invert(buf: PixelBuffer): PixelBuffer {
  const result = buf.clone();
  const { width, height } = buf;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = buf.getPixel(x, y);
      result.setPixel(x, y, {
        r: 255 - pixel.r,
        g: 255 - pixel.g,
        b: 255 - pixel.b,
        a: pixel.a,
      });
    }
  }

  return result;
}

export function desaturate(buf: PixelBuffer): PixelBuffer {
  const result = buf.clone();
  const { width, height } = buf;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = buf.getPixel(x, y);
      // Luminance-weighted desaturation
      const gray = Math.round(0.299 * pixel.r + 0.587 * pixel.g + 0.114 * pixel.b);
      result.setPixel(x, y, {
        r: gray,
        g: gray,
        b: gray,
        a: pixel.a,
      });
    }
  }

  return result;
}

export function posterize(buf: PixelBuffer, levels: number): PixelBuffer {
  const result = buf.clone();
  const { width, height } = buf;

  const safeLevels = Math.max(2, Math.round(levels));
  const numAreas = safeLevels - 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = buf.getPixel(x, y);

      result.setPixel(x, y, {
        r: Math.round(Math.round((pixel.r / 255) * numAreas) / numAreas * 255),
        g: Math.round(Math.round((pixel.g / 255) * numAreas) / numAreas * 255),
        b: Math.round(Math.round((pixel.b / 255) * numAreas) / numAreas * 255),
        a: pixel.a,
      });
    }
  }

  return result;
}

export function threshold(buf: PixelBuffer, level: number): PixelBuffer {
  const result = buf.clone();
  const { width, height } = buf;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = buf.getPixel(x, y);
      const luminance = 0.299 * pixel.r + 0.587 * pixel.g + 0.114 * pixel.b;
      const value = luminance >= level ? 255 : 0;

      result.setPixel(x, y, {
        r: value,
        g: value,
        b: value,
        a: pixel.a,
      });
    }
  }

  return result;
}

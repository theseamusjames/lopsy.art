/**
 * GPU-accelerated filter implementations using CanvasKit.
 *
 * Each function takes a PixelBuffer, applies a Skia filter, and returns
 * a new PixelBuffer.  Falls back to null if CanvasKit isn't available.
 */

import type { CanvasKit, ImageFilter, ColorFilter } from 'canvaskit-wasm';
import { getCanvasKit } from './canvaskit-loader';
import { PixelBuffer } from './pixel-data';

function getCK(): CanvasKit | null {
  return getCanvasKit() as CanvasKit | null;
}

/** Helper: PixelBuffer → CanvasKit Image → apply filter → PixelBuffer. */
function applyImageFilter(
  ck: CanvasKit,
  buf: PixelBuffer,
  makeFilter: (ck: CanvasKit) => ImageFilter,
): PixelBuffer {
  const info = {
    width: buf.width,
    height: buf.height,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  };

  const img = ck.MakeImage(info, buf.rawData, buf.width * 4);
  if (!img) return buf;

  const surf = ck.MakeSurface(buf.width, buf.height);
  if (!surf) { img.delete(); return buf; }

  const filter = makeFilter(ck);
  const paint = new ck.Paint();
  paint.setImageFilter(filter);

  const canvas = surf.getCanvas();
  canvas.drawImage(img, 0, 0, paint);
  surf.flush();

  const pixels = canvas.readPixels(0, 0, info);
  paint.delete();
  filter.delete();
  img.delete();

  let result: PixelBuffer;
  if (pixels) {
    const ab = pixels.buffer.slice(0) as ArrayBuffer;
    result = PixelBuffer.fromData(new Uint8ClampedArray(ab), buf.width, buf.height);
  } else {
    result = buf;
  }

  surf.dispose();
  return result;
}

/** Helper: Apply a color filter (no spatial component). */
function applyColorFilter(
  ck: CanvasKit,
  buf: PixelBuffer,
  makeFilter: (ck: CanvasKit) => ColorFilter,
): PixelBuffer {
  const imgFilter = ck.ImageFilter.MakeColorFilter(makeFilter(ck), null);
  const result = applyImageFilter(ck, buf, () => imgFilter);
  return result;
}

// ---------------------------------------------------------------------------
// Public filter functions — return null if GPU is unavailable
// ---------------------------------------------------------------------------

export function gpuGaussianBlur(buf: PixelBuffer, radius: number): PixelBuffer | null {
  const ck = getCK();
  if (!ck) return null;
  const sigma = radius / 2;
  return applyImageFilter(ck, buf, (c) =>
    c.ImageFilter.MakeBlur(sigma, sigma, c.TileMode.Clamp, null),
  );
}

export function gpuBrightnessContrast(
  buf: PixelBuffer,
  brightness: number,
  contrast: number,
): PixelBuffer | null {
  const ck = getCK();
  if (!ck) return null;

  // Brightness: offset. Contrast: scale around 0.5.
  const b = brightness / 255;
  const c = 1 + contrast / 100;
  const offset = b + 0.5 * (1 - c);

  // 5x4 color matrix (row-major, last column is offset)
  const matrix = [
    c, 0, 0, 0, offset,
    0, c, 0, 0, offset,
    0, 0, c, 0, offset,
    0, 0, 0, 1, 0,
  ];

  return applyColorFilter(ck, buf, (ckInst) =>
    ckInst.ColorFilter.MakeMatrix(matrix as unknown as Float32Array),
  );
}

export function gpuInvert(buf: PixelBuffer): PixelBuffer | null {
  const ck = getCK();
  if (!ck) return null;

  const matrix = [
    -1, 0, 0, 0, 1,
    0, -1, 0, 0, 1,
    0, 0, -1, 0, 1,
    0, 0, 0, 1, 0,
  ];

  return applyColorFilter(ck, buf, (ckInst) =>
    ckInst.ColorFilter.MakeMatrix(matrix as unknown as Float32Array),
  );
}

export function gpuDesaturate(buf: PixelBuffer): PixelBuffer | null {
  const ck = getCK();
  if (!ck) return null;

  // ITU-R BT.709 luminance weights
  const rw = 0.2126;
  const gw = 0.7152;
  const bw = 0.0722;

  const matrix = [
    rw, gw, bw, 0, 0,
    rw, gw, bw, 0, 0,
    rw, gw, bw, 0, 0,
    0, 0, 0, 1, 0,
  ];

  return applyColorFilter(ck, buf, (ckInst) =>
    ckInst.ColorFilter.MakeMatrix(matrix as unknown as Float32Array),
  );
}

export function gpuHueSaturation(
  buf: PixelBuffer,
  _hue: number,
  saturation: number,
  _lightness: number,
): PixelBuffer | null {
  const ck = getCK();
  if (!ck) return null;

  // Saturation adjustment via color matrix
  const s = 1 + saturation / 100;
  const rw = 0.2126;
  const gw = 0.7152;
  const bw = 0.0722;

  const matrix = [
    rw * (1 - s) + s, gw * (1 - s), bw * (1 - s), 0, 0,
    rw * (1 - s), gw * (1 - s) + s, bw * (1 - s), 0, 0,
    rw * (1 - s), gw * (1 - s), bw * (1 - s) + s, 0, 0,
    0, 0, 0, 1, 0,
  ];

  return applyColorFilter(ck, buf, (ckInst) =>
    ckInst.ColorFilter.MakeMatrix(matrix as unknown as Float32Array),
  );
}

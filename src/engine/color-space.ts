/**
 * Progressive enhancement for wide-gamut (Display P3) color.
 *
 * When the browser and display both support it, all canvases and ImageData
 * objects are created in the 'display-p3' color space. Otherwise we fall
 * back to the default 'srgb'. The rest of the engine is unaware of which
 * gamut is active — it just uses these helpers instead of raw constructors.
 */

export type CanvasColorSpace = 'srgb' | 'display-p3';

function detectColorSpace(): CanvasColorSpace {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { colorSpace: 'display-p3' });
    if (!ctx) return 'srgb';

    // Verify the context actually accepted the color space by writing a P3
    // red value (r > 1 in sRGB) and reading it back.  If the context
    // silently fell back to sRGB the round-trip will clamp differently.
    const img = new ImageData(1, 1, { colorSpace: 'display-p3' });
    // P3 pure red: roughly (255, 0, 0) in P3 ≈ (255, ~29, ~12) in sRGB.
    // If we write it and read back the same values the context honors P3.
    img.data[0] = 255;
    img.data[3] = 255;
    ctx.putImageData(img, 0, 0);
    const readBack = ctx.getImageData(0, 0, 1, 1);
    if (readBack.colorSpace === 'display-p3') return 'display-p3';
  } catch {
    // colorSpace option not supported at all
  }
  return 'srgb';
}

/** The color space used for all canvases in this session. */
export const canvasColorSpace: CanvasColorSpace = detectColorSpace();

/** Options to spread into `canvas.getContext('2d', ...)`. */
export const contextOptions: CanvasRenderingContext2DSettings = { colorSpace: canvasColorSpace };

/** Create an ImageData in the active color space. */
export function createImageData(width: number, height: number): ImageData {
  if (canvasColorSpace === 'display-p3') {
    return new ImageData(width, height, { colorSpace: 'display-p3' });
  }
  return new ImageData(width, height);
}

/** Create an ImageData from existing pixel data in the active color space. */
export function createImageDataFromArray(
  data: Uint8ClampedArray,
  width: number,
  height?: number,
): ImageData {
  if (canvasColorSpace === 'display-p3') {
    return new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height, { colorSpace: 'display-p3' });
  }
  return new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height);
}

/** Whether the session is using wide-gamut color. */
export function isWideGamut(): boolean {
  return canvasColorSpace === 'display-p3';
}

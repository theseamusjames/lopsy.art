/**
 * Soft Proof & Gamut Warning overlay rendering.
 *
 * These functions run on the 2D overlay canvas after the WebGL compositor has
 * drawn the frame. They read the composited pixel data from the WebGL canvas
 * and paint either:
 *
 *   - A magenta highlight over any pixel that exceeds the sRGB gamut (gamut
 *     warning mode), or
 *   - A full-frame re-draw with colours clamped or shifted to simulate a
 *     target colour space (soft proof mode).
 *
 * Both operations are purely visual — they do not modify any layer data.
 */

import type { SoftProofMode } from '../ui-store';
import { isWideGamut } from '../../engine/color-space';
import { buildGamutWarningBuffer, clampToSrgb, simulateCmyk } from './gamut-check';

/** Represents the viewport used to position the document on the overlay canvas. */
interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

/**
 * Read the current composited frame from the WebGL canvas and return the
 * pixel buffer. Returns null if the canvas or context is unavailable.
 * The buffer is bottom-up (WebGL convention).
 */
function readWebGLPixels(glCanvas: HTMLCanvasElement): Uint8Array | null {
  const gl = glCanvas.getContext('webgl2') as WebGL2RenderingContext | null;
  if (!gl) return null;
  const { width, height } = glCanvas;
  if (width === 0 || height === 0) return null;
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
}

/**
 * Flip a bottom-up pixel buffer in place to top-down so it can be drawn
 * via `putImageData` onto the 2D canvas (which is top-down).
 */
function flipVertical(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const rowBytes = width * 4;
  const out = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * rowBytes;
    const dstRow = y * rowBytes;
    out.set(pixels.subarray(srcRow, srcRow + rowBytes), dstRow);
  }
  return out;
}

/**
 * Render the gamut warning overlay onto `overlayCtx`.
 *
 * Reads composited pixels from the WebGL canvas and paints magenta over any
 * pixel whose display P3 encoded values exceed the sRGB gamut boundary.
 * Does nothing when the session is in sRGB-only mode (no wide gamut display).
 */
export function renderGamutWarning(
  overlayCtx: CanvasRenderingContext2D,
  glCanvas: HTMLCanvasElement,
  _viewport: Viewport,
  _docWidth: number,
  _docHeight: number,
): void {
  const rawPixels = readWebGLPixels(glCanvas);
  if (!rawPixels) return;

  const { width, height } = glCanvas;
  const wg = isWideGamut();

  const warningBuf = new Uint8ClampedArray(rawPixels.length);
  buildGamutWarningBuffer(rawPixels, warningBuf, wg);

  // Flip from WebGL bottom-up to canvas top-down
  const flipped = flipVertical(warningBuf, width, height);
  const imageData = new ImageData(flipped as Uint8ClampedArray<ArrayBuffer>, width, height);

  // The overlay canvas may differ in size from the WebGL canvas (different
  // device pixel ratios, etc.). Draw scaled to fill the overlay canvas which
  // covers the full viewport including the document.
  overlayCtx.save();
  overlayCtx.setTransform(1, 0, 0, 1, 0, 0);

  // Draw the gamut warning image at the same dimensions as the WebGL canvas.
  // The WebGL canvas is positioned inside the container at (0,0) and shares
  // the same bounding rect as the overlay canvas — so we just drawImage at 1:1.
  const offscreen = document.createElement('canvas');
  offscreen.width = width;
  offscreen.height = height;
  const offCtx = offscreen.getContext('2d');
  if (offCtx) {
    offCtx.putImageData(imageData, 0, 0);
    overlayCtx.drawImage(offscreen, 0, 0, overlayCtx.canvas.width, overlayCtx.canvas.height);
  }

  overlayCtx.restore();
}

/**
 * Render a soft-proof overlay onto `overlayCtx`.
 *
 * In `srgb-clamp` mode, pixels with out-of-gamut P3 values are clamped to
 * sRGB, giving a preview of what the image will look like when exported to an
 * sRGB format (JPEG, PNG without wide-gamut profile).
 *
 * In `cmyk-sim` mode, all colours are shifted to approximate how the image
 * will appear when printed in CMYK (reduced saturation, muted blues/greens).
 *
 * A semi-transparent opaque rectangle is drawn first so the original WebGL
 * frame is completely replaced by the proof in the overlay.
 */
export function renderSoftProof(
  overlayCtx: CanvasRenderingContext2D,
  glCanvas: HTMLCanvasElement,
  mode: SoftProofMode,
  _viewport: Viewport,
  _docWidth: number,
  _docHeight: number,
): void {
  if (mode === 'off') return;

  const rawPixels = readWebGLPixels(glCanvas);
  if (!rawPixels) return;

  const { width, height } = glCanvas;
  const wg = isWideGamut();

  const proofBuf = new Uint8ClampedArray(rawPixels.length);

  for (let i = 0; i < rawPixels.length; i += 4) {
    const r = rawPixels[i] ?? 0;
    const g = rawPixels[i + 1] ?? 0;
    const b = rawPixels[i + 2] ?? 0;
    const a = rawPixels[i + 3] ?? 0;

    let ro: number;
    let go: number;
    let bo: number;

    if (mode === 'srgb-clamp') {
      [ro, go, bo] = clampToSrgb(r, g, b, wg);
    } else {
      // cmyk-sim
      [ro, go, bo] = simulateCmyk(r, g, b);
    }

    proofBuf[i] = ro;
    proofBuf[i + 1] = go;
    proofBuf[i + 2] = bo;
    proofBuf[i + 3] = a;
  }

  // Flip bottom-up WebGL buffer to top-down
  const flipped = flipVertical(proofBuf, width, height);
  const imageData = new ImageData(flipped as Uint8ClampedArray<ArrayBuffer>, width, height);

  overlayCtx.save();
  overlayCtx.setTransform(1, 0, 0, 1, 0, 0);

  const offscreen = document.createElement('canvas');
  offscreen.width = width;
  offscreen.height = height;
  const offCtx = offscreen.getContext('2d');
  if (offCtx) {
    offCtx.putImageData(imageData, 0, 0);
    // Full opaque draw to replace the WebGL image with the proof
    overlayCtx.globalAlpha = 1;
    overlayCtx.drawImage(offscreen, 0, 0, overlayCtx.canvas.width, overlayCtx.canvas.height);
  }

  overlayCtx.restore();
}

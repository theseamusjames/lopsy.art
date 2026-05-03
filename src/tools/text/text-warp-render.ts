/**
 * Canvas2D-based warp renderer for text layers.
 *
 * The Rust engine renders the flat (unwarped) text into a pixel buffer.
 * This module takes those pixels, paints them onto a hidden offscreen canvas
 * column by column, and applies the warp deformation via `ctx.translate` /
 * `ctx.rotate` per column to produce the warped raster. The result is then
 * returned as a `Uint8Array` ready for `uploadLayerPixels`.
 *
 * Column-based rendering matches the Photoshop approach: the source image is
 * sliced into 1-pixel-wide vertical columns. Each column is drawn at the
 * transformed position, producing a smooth warp with no visible seams.
 */

import { applyWarp } from './text-warp';
import type { TextWarpStyle } from '../../types/layers';

export interface WarpedPixels {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** Canvas-space x offset from the original texture origin. */
  readonly offsetX: number;
  /** Canvas-space y offset from the original texture origin. */
  readonly offsetY: number;
}

/**
 * Apply a warp style to a flat text raster.
 *
 * @param flatPixels  RGBA pixel data from the Rust text renderer
 * @param srcWidth    Width of the flat raster in pixels
 * @param srcHeight   Height of the flat raster in pixels
 * @param style       Which warp preset to apply
 * @param bend        -100..+100 bend amount
 * @returns           Warped raster with its canvas-space offset
 */
export function renderWarpedText(
  flatPixels: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  style: TextWarpStyle,
  bend: number,
): WarpedPixels {
  if (style === 'none' || bend === 0 || srcWidth === 0 || srcHeight === 0) {
    return {
      data: flatPixels,
      width: srcWidth,
      height: srcHeight,
      offsetX: 0,
      offsetY: 0,
    };
  }

  // Compute the bounding box of the warped result by probing each corner and
  // a grid of points to find the axis-aligned extent.
  const margin = Math.ceil(srcHeight * 0.5);
  const outW = srcWidth + margin * 2;
  const outH = srcHeight + margin * 2;

  // Create source canvas with the flat raster
  const srcCanvas = new OffscreenCanvas(srcWidth, srcHeight);
  const srcCtx = srcCanvas.getContext('2d');
  if (!srcCtx) {
    return { data: flatPixels, width: srcWidth, height: srcHeight, offsetX: 0, offsetY: 0 };
  }

  // ImageData requires the ArrayBuffer to be a plain ArrayBuffer (not SharedArrayBuffer).
  // Copy the bytes to ensure compatibility.
  const pixelBytes = new Uint8ClampedArray(flatPixels.byteLength);
  pixelBytes.set(flatPixels);
  const imageData = new ImageData(pixelBytes, srcWidth, srcHeight);
  srcCtx.putImageData(imageData, 0, 0);

  // Create destination canvas — wider/taller to accommodate warp overflow
  const dstCanvas = new OffscreenCanvas(outW, outH);
  const dstCtx = dstCanvas.getContext('2d');
  if (!dstCtx) {
    return { data: flatPixels, width: srcWidth, height: srcHeight, offsetX: 0, offsetY: 0 };
  }

  // Render column by column. For each 1-pixel-wide column at x, we compute
  // where its top and bottom warp to, then draw the column with a transform
  // that maps it to the correct position and angle.
  for (let col = 0; col < srcWidth; col++) {
    const topPt = applyWarp(col, 0, srcWidth, srcHeight, style, bend);
    const botPt = applyWarp(col, srcHeight, srcWidth, srcHeight, style, bend);

    const dx = botPt.x - topPt.x;
    const dy = botPt.y - topPt.y;
    const angle = Math.atan2(dx, dy); // rotation of the column vector from vertical

    dstCtx.save();
    // Translate to the top of this column in the destination canvas
    dstCtx.translate(margin + topPt.x, margin + topPt.y);
    dstCtx.rotate(angle);

    // drawImage: draw the 1-pixel column. The column height is scaled to match
    // the actual distance between warped top and bottom.
    const colLen = Math.sqrt(dx * dx + dy * dy);
    const scaleY = colLen / srcHeight;

    dstCtx.scale(1, scaleY);
    dstCtx.drawImage(srcCanvas, col, 0, 1, srcHeight, 0, 0, 1, srcHeight);
    dstCtx.restore();
  }

  // Read back the result
  const outData = dstCtx.getImageData(0, 0, outW, outH);
  const outBytes = new Uint8Array(outData.data.buffer);

  return {
    data: outBytes,
    width: outW,
    height: outH,
    offsetX: -margin,
    offsetY: -margin,
  };
}

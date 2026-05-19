import type { BrushTipData } from '../../types/brush';

export interface SelectionInfo {
  bounds: { x: number; y: number; width: number; height: number };
  mask: Uint8ClampedArray;
  maskWidth: number;
  maskHeight: number;
  maskOffsetX?: number;
  maskOffsetY?: number;
}

/**
 * Create a custom brush tip from the selected region of an image.
 *
 * Converts the image to grayscale, multiplies by the selection mask,
 * then inverts so dark image areas produce opaque brush strokes
 * (matching Photoshop's "Define Brush Preset" convention).
 */
export function createBrushTipFromSelection(
  imageData: ImageData,
  selection: SelectionInfo,
): BrushTipData {
  const { bounds, mask, maskWidth, maskHeight } = selection;
  const maskOX = selection.maskOffsetX ?? 0;
  const maskOY = selection.maskOffsetY ?? 0;
  const imgW = imageData.width;
  const imgH = imageData.height;
  const pixels = imageData.data;

  // Clamp bounds to imageData extents
  const x0 = Math.max(0, bounds.x);
  const y0 = Math.max(0, bounds.y);
  const x1 = Math.min(imgW, bounds.x + bounds.width);
  const y1 = Math.min(imgH, bounds.y + bounds.height);

  const regionW = x1 - x0;
  const regionH = y1 - y0;

  if (regionW <= 0 || regionH <= 0) {
    return { width: 1, height: 1, data: new Uint8ClampedArray([255]) };
  }

  const raw = new Uint8ClampedArray(regionW * regionH);

  for (let row = 0; row < regionH; row++) {
    for (let col = 0; col < regionW; col++) {
      const imgX = x0 + col;
      const imgY = y0 + row;
      const imgIdx = (imgY * imgW + imgX) * 4;

      const r = pixels[imgIdx] ?? 0;
      const g = pixels[imgIdx + 1] ?? 0;
      const b = pixels[imgIdx + 2] ?? 0;
      const a = pixels[imgIdx + 3] ?? 0;

      // Sample the selection mask in document space
      const maskX = imgX + maskOX;
      const maskY = imgY + maskOY;
      let maskVal = 1;
      if (maskX >= 0 && maskX < maskWidth && maskY >= 0 && maskY < maskHeight) {
        maskVal = (mask[maskY * maskWidth + maskX] ?? 0) / 255;
      } else {
        maskVal = 0;
      }

      // Transparent pixels → 0 (no paint). Opaque pixels: invert
      // grayscale so dark areas → opaque brush, white → transparent.
      let value = 0;
      if (a > 0) {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        value = Math.round((255 - gray) * (a / 255) * maskVal);
      }
      raw[row * regionW + col] = value;
    }
  }

  // Crop to content bounds (trim rows/columns that are all 0)
  let cropTop = 0;
  let cropBottom = regionH - 1;
  let cropLeft = 0;
  let cropRight = regionW - 1;

  // Top
  outer_top: for (let row = 0; row < regionH; row++) {
    for (let col = 0; col < regionW; col++) {
      if ((raw[row * regionW + col] ?? 0) > 0) break outer_top;
    }
    cropTop = row + 1;
  }

  // Bottom
  outer_bottom: for (let row = regionH - 1; row >= cropTop; row--) {
    for (let col = 0; col < regionW; col++) {
      if ((raw[row * regionW + col] ?? 0) > 0) break outer_bottom;
    }
    cropBottom = row - 1;
  }

  // Left
  outer_left: for (let col = 0; col < regionW; col++) {
    for (let row = cropTop; row <= cropBottom; row++) {
      if ((raw[row * regionW + col] ?? 0) > 0) break outer_left;
    }
    cropLeft = col + 1;
  }

  // Right
  outer_right: for (let col = regionW - 1; col >= cropLeft; col--) {
    for (let row = cropTop; row <= cropBottom; row++) {
      if ((raw[row * regionW + col] ?? 0) > 0) break outer_right;
    }
    cropRight = col - 1;
  }

  const croppedW = cropRight - cropLeft + 1;
  const croppedH = cropBottom - cropTop + 1;

  if (croppedW <= 0 || croppedH <= 0) {
    return { width: 1, height: 1, data: new Uint8ClampedArray([255]) };
  }

  const cropped = new Uint8ClampedArray(croppedW * croppedH);
  for (let row = 0; row < croppedH; row++) {
    const srcOffset = (row + cropTop) * regionW + cropLeft;
    const dstOffset = row * croppedW;
    cropped.set(raw.subarray(srcOffset, srcOffset + croppedW), dstOffset);
  }

  return { width: croppedW, height: croppedH, data: cropped };
}

/**
 * Create a color brush tip from the selected region, preserving RGBA data.
 * The result is stored as straight alpha; premultiplication happens on GPU upload.
 */
export function createColorBrushTipFromSelection(
  imageData: ImageData,
  selection: SelectionInfo,
): BrushTipData {
  const { bounds, mask, maskWidth, maskHeight } = selection;
  const maskOX = selection.maskOffsetX ?? 0;
  const maskOY = selection.maskOffsetY ?? 0;
  const imgW = imageData.width;
  const imgH = imageData.height;
  const pixels = imageData.data;

  const x0 = Math.max(0, bounds.x);
  const y0 = Math.max(0, bounds.y);
  const x1 = Math.min(imgW, bounds.x + bounds.width);
  const y1 = Math.min(imgH, bounds.y + bounds.height);

  const regionW = x1 - x0;
  const regionH = y1 - y0;

  if (regionW <= 0 || regionH <= 0) {
    return { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 0]), kind: 'color' };
  }

  const raw = new Uint8ClampedArray(regionW * regionH * 4);

  for (let row = 0; row < regionH; row++) {
    for (let col = 0; col < regionW; col++) {
      const imgX = x0 + col;
      const imgY = y0 + row;
      const imgIdx = (imgY * imgW + imgX) * 4;
      const dstIdx = (row * regionW + col) * 4;

      const maskX = imgX + maskOX;
      const maskY = imgY + maskOY;
      let maskVal = 1;
      if (maskX >= 0 && maskX < maskWidth && maskY >= 0 && maskY < maskHeight) {
        maskVal = (mask[maskY * maskWidth + maskX] ?? 0) / 255;
      } else {
        maskVal = 0;
      }

      raw[dstIdx] = pixels[imgIdx] ?? 0;
      raw[dstIdx + 1] = pixels[imgIdx + 1] ?? 0;
      raw[dstIdx + 2] = pixels[imgIdx + 2] ?? 0;
      raw[dstIdx + 3] = Math.round((pixels[imgIdx + 3] ?? 0) * maskVal);
    }
  }

  // Crop to content bounds (trim rows/columns where alpha is all 0)
  let cropTop = 0;
  let cropBottom = regionH - 1;
  let cropLeft = 0;
  let cropRight = regionW - 1;

  outer_top: for (let row = 0; row < regionH; row++) {
    for (let col = 0; col < regionW; col++) {
      if ((raw[(row * regionW + col) * 4 + 3] ?? 0) > 0) break outer_top;
    }
    cropTop = row + 1;
  }

  outer_bottom: for (let row = regionH - 1; row >= cropTop; row--) {
    for (let col = 0; col < regionW; col++) {
      if ((raw[(row * regionW + col) * 4 + 3] ?? 0) > 0) break outer_bottom;
    }
    cropBottom = row - 1;
  }

  outer_left: for (let col = 0; col < regionW; col++) {
    for (let row = cropTop; row <= cropBottom; row++) {
      if ((raw[(row * regionW + col) * 4 + 3] ?? 0) > 0) break outer_left;
    }
    cropLeft = col + 1;
  }

  outer_right: for (let col = regionW - 1; col >= cropLeft; col--) {
    for (let row = cropTop; row <= cropBottom; row++) {
      if ((raw[(row * regionW + col) * 4 + 3] ?? 0) > 0) break outer_right;
    }
    cropRight = col - 1;
  }

  const croppedW = cropRight - cropLeft + 1;
  const croppedH = cropBottom - cropTop + 1;

  if (croppedW <= 0 || croppedH <= 0) {
    return { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 0]), kind: 'color' };
  }

  const cropped = new Uint8ClampedArray(croppedW * croppedH * 4);
  for (let row = 0; row < croppedH; row++) {
    const srcOffset = ((row + cropTop) * regionW + cropLeft) * 4;
    const dstOffset = row * croppedW * 4;
    cropped.set(raw.subarray(srcOffset, srcOffset + croppedW * 4), dstOffset);
  }

  return { width: croppedW, height: croppedH, data: cropped, kind: 'color' };
}
